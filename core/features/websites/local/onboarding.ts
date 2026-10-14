// 表单、执行状态和结果的确定性读写。AI 推理全部在 tasks/trade-onboarding.md。
import { L } from './_i18n'
import { profile } from './_ai'
import { context as profileContext } from './profile'
import { status } from './_creght'
import { sites as channelSites, add as addChannel, fromURL as channelFromURL, match as matchChannel } from './channels'
import { run as runAudit, inspect as inspectAudit } from './audit'
import { onboarding, parse, write, websiteURL, type CompanyDraft, type Competitor, type Onboarding } from './_onboarding'
import { archiveCompetitorReport } from './_competitor-research'

// 手机上打开后台（不在 Shuttle 里）时这几个也能用：annulo push 会把它们打包成站点 Func，只用 ctx.db
export const cloud = ['get', 'saveDetails']

// 要电脑的（浏览器、本机授权、密钥、外部接口）：手机上点了转给电脑上开着的 Shuttle 跑（设置 → 远程访问）
export const remote = ['ai', 'audit', 'pending', 'preview', 'selectSite', 'selectURL', 'sites']

const fail = (ctx: any, zh: string, en: string): never => { throw new Error(L(ctx, zh, en)) }
const now = () => new Date().toISOString()
const resetResearch = { research_status: 'idle', research_report: '', research_note: '' } as const
const companyFacts = ['name', 'business', 'cooperation', 'keywords', 'customer_types', 'positioning', 'markets', 'advantages', 'company_role', 'buyer_concerns', 'profile', 'audience'] as const
const hasCompanyFacts = (ctx: any) => { const current = profile(ctx); return companyFacts.some((field) => !!current[field]?.trim()) }
function url(value: string, ctx: any) {
  try { const u = new URL(value.trim()); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); u.hash = ''; return u.href }
  catch { return fail(ctx, '请填写完整的 HTTP 或 HTTPS 网址：' + value, 'Enter a complete HTTP or HTTPS URL: ' + value) }
}
function competitors(values: Competitor[], ctx: any): Competitor[] {
  if (!Array.isArray(values) || values.length > 10) fail(ctx, '最多添加 10 个竞品', 'Add up to 10 competitors')
  const seen = new Set<string>()
  return values.map((c) => ({ url: url(String(c.url || ''), ctx), name: String(c.name || '').trim(), reason: String(c.reason || '').trim() })).filter((c) => !seen.has(c.url) && !!seen.add(c.url))
}
function checked(input: { revision: number }, ctx: any) {
  const row = onboarding(ctx)
  if (input?.revision !== row.revision) fail(ctx, '资料已修改，请刷新后重新执行', 'The brief changed. Refresh and restart this task')
  return row
}
function requireSite(row: Onboarding, ctx: any) {
  if (row.website_url) return null
  const ch = row.channel_id ? ctx.db.get('channels', row.channel_id) : null
  if (!ch || ch.type !== 'creght_site') fail(ctx, '请先输入网站地址或选择站点', 'Enter a website URL or select a site first')
  return ch
}
export function get(_input: {}, ctx: any) {
  const row = onboarding(ctx)
  return { ...row, competitors: parse<Competitor[]>(row.competitors, []), candidates: parse<Competitor[]>(row.candidates, []), company_draft: parse<CompanyDraft | null>(row.company_draft, null), audit_result: parse<any>(row.audit_result, null), profile: profile(ctx), channel: row.channel_id ? ctx.db.get('channels', row.channel_id) : null }
}
// 助手现在能不能跑（设置 → 模型 里有能用的模型，或本机的 Claude Code / Codex）。不能跑时向导不启动解析任务，直接手填简报
export function ai(_input: {}, ctx: any) {
  const a = ctx.agent.current()
  return { ready: !!a.ready, error: a.error || '' }
}
// connected=false：没连 creght（MCP 列表里没有 creght），或者用户在 设置 → MCP 里关掉了它：向导只显示网址输入框，不出现任何 creght 的东西。
export async function sites(_input: {}, ctx: any) {
  if (!ctx.mcp.servers().some((s: any) => s.name === 'creght' && s.status !== 'disabled')) return { connected: false, list: [] }
  const host = new URL(ctx.workspace?.api_host || 'https://creght.cn').host
  return { connected: true, list: (await channelSites({}, ctx)).list.map((s: any) => ({ ...s, preview_url: `https://${s.site_id}.preview.${host}/` })) }
}
// 只读站点发布元数据，不抓取公司资料或正文。
export async function preview(input: { project_id: string; site_id: string }, ctx: any) {
  const s = (await sites({}, ctx)).list.find((s: any) => s.project_id === input.project_id && s.site_id === input.site_id)
  if (!s) fail(ctx, '账号下没有这个站点', 'This site is not in your account')
  try { const st = await status(ctx, s.project_id, s.site_id); return { url: st?.live_url || st?.preview_url || s.preview_url } }
  catch { return { url: s.preview_url } }
}
export async function selectSite(input: { project_id: string; site_id: string; refresh?: boolean }, ctx: any) {
  const available = (await sites({}, ctx)).list.find((s: any) => s.project_id === input.project_id && s.site_id === input.site_id)
  if (!available) fail(ctx, '账号下没有这个站点', 'This site is not in your account')
  const row = onboarding(ctx)
  let ch = ctx.db.query('channels', { where: { type: 'creght_site', project_id: input.project_id, site_id: input.site_id }, limit: 1 }).list[0]
  if (!ch) ch = await addChannel(input, ctx)
  const changed = row.channel_id !== ch.id || !!row.website_url
  if (changed || input.refresh) {
    archiveCompetitorReport(row, ctx)
    write(ctx, { channel_id: ch.id, website_url: '', revision: row.revision + 1, details_saved_at: '', company_status: 'idle', company_note: '', company_draft: '', company_refresh: !!input.refresh || hasCompanyFacts(ctx), audit_status: 'idle', audit_result: '', audit_note: '', ...resetResearch, candidates: '[]' })
  }
  return get({}, ctx)
}
// 普通网址不需要账号授权，也不伪装成可发布或同步询盘的渠道。
// 认得出是 creght 站点的（channels.fromURL）直接加进网站和账号、记在 channel_id；读资料、检查仍用输入的网址。
// 没连 creght MCP、站点不在账号下也照加，渠道页再提示。WordPress 不自动加，渠道页顶部提示接入。
export async function selectURL(input: { url: string; refresh?: boolean }, ctx: any) {
  const value = websiteURL(String(input?.url || ''))
  if (!value) fail(ctx, '请输入有效的网站地址（HTTP 或 HTTPS）', 'Enter a valid HTTP or HTTPS website URL')
  const row = onboarding(ctx)
  const changed = row.website_url !== value
  if (changed || input.refresh) {
    const ch = changed ? await channelFromURL({ url: value }, ctx) : null
    archiveCompetitorReport(row, ctx)
    write(ctx, { channel_id: ch?.id ?? (changed ? '' : row.channel_id), website_url: value, revision: row.revision + 1, details_saved_at: '', company_status: 'idle', company_note: '', company_draft: '', company_refresh: !!input.refresh || hasCompanyFacts(ctx), audit_status: 'idle', audit_result: '', audit_note: '', ...resetResearch, candidates: '[]' })
  }
  return get({}, ctx)
}
// 向导里输入的网址还没加进网站和账号时返回它（渠道页顶部提示接入），加了返回空。
// 已经是某个渠道（自定义域名的 creght 站点也认得）就把渠道记回 onboarding，下次不用再抓页面。
export async function pending(_input: {}, ctx: any) {
  const row = onboarding(ctx)
  if (!row.website_url) return { url: '' }
  if (row.channel_id && ctx.db.get('channels', row.channel_id)) return { url: '' }
  const ch = await matchChannel({ url: row.website_url }, ctx)
  if (!ch) return { url: row.website_url }
  write(ctx, { channel_id: ch.id })
  return { url: '' }
}
type CompanyDetails = { name?: string; positioning?: string; business?: string; advantages?: string; company_role?: string; cooperation?: string; customer_types?: string; markets?: string; buyer_concerns?: string; profile?: string; audience?: string; tone?: string; keywords?: string; brand_terms?: string }
const companyFields = ['name', 'positioning', 'business', 'advantages', 'company_role', 'cooperation', 'customer_types', 'markets', 'buyer_concerns', 'profile', 'audience', 'tone', 'keywords', 'brand_terms'] as const
export function saveDetails(input: CompanyDetails & { competitors?: Competitor[] }, ctx: any) {
  const p = profile(ctx), row = onboarding(ctx), previous = parse<Competitor[]>(row.competitors, [])
  const links = input.competitors === undefined ? previous : competitors(input.competitors, ctx).map((c) => { const old = previous.find((v) => v.url === c.url); return { ...c, name: c.name || old?.name || '', reason: c.reason || old?.reason || '' } })
  const patch: Record<string, string> = {}
  for (const k of companyFields) if (input[k] !== undefined) patch[k] = String(input[k]).trim()
  const companyChanged = Object.keys(patch).some((k) => patch[k] !== (p[k as keyof CompanyDetails] || ''))
  const linksChanged = JSON.stringify(links) !== JSON.stringify(previous)
  const changed = linksChanged || companyChanged
  // 首次确认也建立一个新版本，避免还在后台抓取的网站资料晚到后改写已确认简报。
  const firstConfirmation = !row.details_saved_at
  archiveCompetitorReport(row, ctx)
  if (p.id) ctx.db.update('profile', p.id, patch)
  else ctx.db.insert('profile', { name: '', ...patch, created_at: now() })
  write(ctx, { revision: row.revision + (changed || firstConfirmation ? 1 : 0), details_saved_at: now(), company_draft: '', company_refresh: false,
    ...(linksChanged ? { competitors: JSON.stringify(links), competitors_confirmed: links.length > 0, candidates: '[]' } : {}),
    ...(firstConfirmation || companyChanged || !!row.company_draft ? { company_status: (patch.business ?? p.business)?.trim() && (patch.customer_types ?? p.customer_types)?.trim() ? 'done' : 'needs_review', company_note: '' } : {}),
    ...(companyChanged || linksChanged ? resetResearch : {}),
  })
  return get({}, ctx)
}
export function begin(input: { revision: number; stage: 'company'; refresh?: boolean }, ctx: any) {
  const row = checked(input, ctx); requireSite(row, ctx)
  if (input.stage !== 'company') fail(ctx, '未知执行事项', 'Unknown stage')
  write(ctx, { [`${input.stage}_status`]: 'running', [`${input.stage}_note`]: '', company_draft: '', company_refresh: row.company_refresh || !!input.refresh })
  return get({}, ctx)
}
export async function companyContext(input: { revision: number }, ctx: any) {
  const row = checked(input, ctx), ch = requireSite(row, ctx)
  return profileContext(row.website_url ? { url: row.website_url } : { channel_id: ch!.id }, ctx)
}
// 只补结构化的空字段；旧版自由描述原文不改。
const draftFields = ['name', 'positioning', 'business', 'advantages', 'company_role', 'cooperation', 'customer_types', 'markets', 'buyer_concerns', 'keywords'] as const
export function saveCompany(input: { revision: number; refresh?: boolean; name?: string; positioning?: string; business?: string; advantages?: string; company_role?: string; cooperation?: string; customer_types?: string; markets?: string; buyer_concerns?: string; keywords?: string; note?: string }, ctx: any) {
  const row = checked(input, ctx)
  if (row.company_refresh || input.refresh) {
    const draft: CompanyDraft = {}
    for (const k of draftFields) if (input[k]?.trim()) draft[k] = input[k]!.trim()
    write(ctx, { company_status: 'needs_review', company_draft: JSON.stringify(draft), company_note: String(input.note || '').trim() })
    return get({}, ctx)
  }
  const p = profile(ctx), patch: Record<string, string> = {}
  for (const k of draftFields) if (!p[k]?.trim() && input[k]?.trim()) patch[k] = input[k]!.trim()
  if (Object.keys(patch).length) {
    if (p.id) ctx.db.update('profile', p.id, patch)
    else ctx.db.insert('profile', { name: '', ...patch, created_at: now() })
  }
  const saved = profile(ctx)
  write(ctx, { company_status: (saved.business?.trim() && saved.customer_types?.trim()) || (saved.profile?.trim() && saved.audience?.trim()) ? 'done' : 'needs_review', company_note: String(input.note || '').trim() })
  return get({}, ctx)
}
export async function audit(input: { revision: number }, ctx: any) {
  const row = checked(input, ctx), ch = requireSite(row, ctx)
  write(ctx, { audit_status: 'running', audit_note: '' })
  try {
    const result = row.website_url ? await inspectAudit({ url: row.website_url }, ctx) : await runAudit({ channel_id: ch!.id }, ctx)
    checked(input, ctx)
    write(ctx, { audit_status: 'done', audit_result: JSON.stringify(result) })
  } catch (e) {
    checked(input, ctx)
    write(ctx, { audit_status: 'failed', audit_note: (e as Error).message })
    throw e
  }
  return get({}, ctx)
}
export function failed(input: { revision: number; stage: 'company'; error: string }, ctx: any) {
  checked(input, ctx)
  if (input.stage !== 'company') fail(ctx, '未知执行事项', 'Unknown stage')
  write(ctx, { [`${input.stage}_status`]: 'failed', [`${input.stage}_note`]: String(input.error || '') })
  return get({}, ctx)
}
