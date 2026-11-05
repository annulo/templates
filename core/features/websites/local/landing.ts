// 落地页（本机函数）：为一个目标单独做的网站页面（拿询盘、试用、推一款产品、接住一个关键词）。
// 页面怎么做全在任务 tasks/landing-page.md：助手写简报、直接改网站代码、推到预览，用户在那段对话里确认后上线。这里只管记录。
//
//   landing.create({ channel_id, goal, title?, note?, product_ids?, keyword?, keyword_id?, topic_id?, opportunity_id?, language? })
//                                        新建一条（planning），返回 { id }；页面「新建落地页」先调它，再把 id 交给任务
//   landing.context({ id })              做这页要的上下文：这条记录、网站（地址、类型、怎么改代码）、项目资料、推的产品、
//                                        来源（关键词、选题、增长机会）、能用的图、网站的表单（creght 站点）、同一个网站上已有的落地页
//   landing.save({ id, title?, brief?, path?, preview_url?, url?, status?, summary?, language? })
//                                        助手存进度：简报、路径、预览地址、线上地址、状态；记下做它的对话（ctx.chat_id）。
//                                        第一次标成 live 时记一次上线的改动（site_changes，到期对比前后的数据）

import { L } from './_i18n'
import { forms } from './_creght'
import { siteBase } from './_site'
import { trackChange } from './_review'

const SITE_TYPES = ['creght_site', 'wordpress']
const STATUSES = ['planning', 'preview', 'live', 'archived']
const now = () => new Date().toISOString()
const text = (v: unknown) => String(v ?? '').trim()
const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(text).filter(Boolean)
  try {
    const l = JSON.parse(String(v || '[]'))
    return Array.isArray(l) ? l.map(text).filter(Boolean) : []
  } catch {
    return []
  }
}
/** 有的模板没有这张表（自媒体没有产品、只有产品运营有增长机会）：读不到当没有 */
const tryGet = (ctx: any, table: string, id?: string) => {
  if (!id) return null
  try {
    return ctx.db.get(table, id)
  } catch {
    return null
  }
}
const tryList = (ctx: any, table: string, q: Record<string, unknown> = {}) => {
  try {
    return ctx.db.query(table, { limit: 200, ...q }).list as any[]
  } catch {
    return []
  }
}
const isURL = (u: string) => /^https?:\/\/\S+$/.test(u)

function pageOf(ctx: any, id: string) {
  const p = ctx.db.get('landing_pages', id)
  if (!p) throw new Error(L(ctx, '没有这个落地页：', 'No such landing page: ') + id)
  return p
}
function siteOf(ctx: any, id: string) {
  const ch = ctx.db.get('channels', id)
  if (!ch || !SITE_TYPES.includes(ch.type)) throw new Error(L(ctx, 'channel_id 要是一个网站（creght 站点或 WordPress）', 'channel_id must be a site (creght or WordPress)'))
  return ch
}

export function create(input: { channel_id: string; goal: string; title?: string; note?: string; product_ids?: string[] | string; keyword?: string; keyword_id?: string; topic_id?: string; opportunity_id?: string; language?: string }, ctx: any) {
  const ch = siteOf(ctx, input?.channel_id)
  const goal = text(input?.goal)
  if (!goal) throw new Error(L(ctx, '写一句这页要做什么', 'Say what this page is for'))
  const kw = tryGet(ctx, 'keywords', input.keyword_id)
  const t = now()
  const row = ctx.db.insert('landing_pages', {
    channel_id: ch.id,
    title: text(input.title),
    goal,
    note: text(input.note),
    product_ids: JSON.stringify(list(input.product_ids)),
    keyword: text(input.keyword) || kw?.keyword || '',
    keyword_id: kw?.id ?? '',
    topic_id: text(input.topic_id),
    opportunity_id: text(input.opportunity_id),
    language: text(input.language) || kw?.lang || '',
    status: 'planning',
    created_at: t,
    updated_at: t,
  })
  return { id: row.id }
}

export async function context(input: { id: string }, ctx: any) {
  const p = pageOf(ctx, input?.id)
  const ch = ctx.db.get('channels', p.channel_id)
  if (!ch) throw new Error(L(ctx, '这个网站已经不在了：', 'This site no longer exists: ') + p.channel_id)
  const ids = list(p.product_ids)
  const products = ids.map((id) => tryGet(ctx, 'products', id)).filter(Boolean)
  const images: { url: string; name: string; from: string }[] = []
  for (const a of tryList(ctx, 'assets', { where: { kind: 'image' } })) if (isURL(a.url ?? '') || /^(local:|\/_(annulo|shuttle)\/uploaded\/)/.test(a.url ?? '')) images.push({ url: a.url, name: a.name ?? '', from: 'assets' })
  for (const pr of products) for (const u of list(pr.images).slice(0, 5)) images.push({ url: u, name: pr.name ?? '', from: 'products' })
  let siteForms: unknown = undefined
  if (ch.type === 'creght_site' && ch.project_id) {
    try {
      siteForms = (await forms(ctx, ch.project_id)).map((f) => ({ id: f.id, key: f.key, name: f.name, fields: f.fields?.map((x) => x.key) }))
    } catch (e: any) {
      siteForms = { error: e?.message ?? String(e) }
    }
  }
  let base = ''
  try {
    base = await siteBase(ch, ctx)
  } catch {}
  return {
    page: p,
    site: {
      id: ch.id, name: ch.name, type: ch.type, base,
      ...(ch.type === 'creght_site' ? { site_ref: `${ch.project_id}/${ch.site_id}`, site_id: ch.site_id, preview_url: ch.preview_url ?? '', live_url: ch.live_url ?? '' } : { url: ch.preview_url ?? '' }),
      ...(siteForms !== undefined ? { forms: siteForms } : {}),
    },
    project: tryList(ctx, 'profile')[0] ?? null,
    products,
    from: {
      keyword: tryGet(ctx, 'keywords', p.keyword_id),
      topic: tryGet(ctx, 'topics', p.topic_id),
      opportunity: tryGet(ctx, 'growth_opportunities', p.opportunity_id),
    },
    images: images.slice(0, 80),
    others: tryList(ctx, 'landing_pages', { where: { channel_id: ch.id } }).filter((x) => x.id !== p.id && x.status !== 'archived').map((x) => ({ id: x.id, title: x.title, path: x.path, status: x.status, url: x.url || x.preview_url })),
  }
}

export function save(input: { id: string; title?: string; brief?: string; path?: string; preview_url?: string; url?: string; status?: string; summary?: string; language?: string }, ctx: any) {
  const p = pageOf(ctx, input?.id)
  const patch: Record<string, unknown> = {}
  for (const k of ['title', 'brief', 'summary', 'language'] as const) if (input[k] !== undefined) patch[k] = text(input[k])
  if (input.path !== undefined) {
    const path = text(input.path)
    if (path && !path.startsWith('/')) throw new Error(L(ctx, 'path 是站内路径，以 / 开头，比如 /led-panel-wholesale', 'path is a site path starting with /, e.g. /led-panel-wholesale'))
    patch.path = path
  }
  for (const k of ['preview_url', 'url'] as const) {
    if (input[k] === undefined) continue
    const u = text(input[k])
    if (u && !isURL(u)) throw new Error(L(ctx, `${k} 要是完整的网址（https://…）`, `${k} must be a full URL (https://…)`))
    patch[k] = u
  }
  const status = input.status === undefined ? p.status : text(input.status)
  if (!STATUSES.includes(status)) throw new Error(L(ctx, 'status 要是 ', 'status must be ') + STATUSES.join(' / '))
  patch.status = status
  const next = { ...p, ...patch }
  if (status === 'preview' && !next.preview_url && !next.url) throw new Error(L(ctx, '标成预览前先给 preview_url：用户要能打开看', 'Give preview_url before marking it preview: the user needs to open it'))
  if (status === 'live' && !next.url) throw new Error(L(ctx, '标成已上线要给 url：线上的完整网址', 'Give url (the live address) when marking it live'))
  if (ctx.chat_id) patch.chat_id = String(ctx.chat_id)
  const firstLive = status === 'live' && p.status !== 'live' && !p.live_at
  if (firstLive) patch.live_at = now()
  ctx.db.update('landing_pages', p.id, { ...patch, updated_at: now() })
  // 第一次上线：记一次改动，到期对比前后的数据（和新文章一样）；出错不影响保存
  if (firstLive) {
    try {
      trackChange(ctx, { kind: 'landing', ref_id: p.id, channel_id: p.channel_id, title: L(ctx, `新落地页：${next.title || next.path}`, `New landing page: ${next.title || next.path}`), pages: [String(next.url)] })
    } catch (e: any) {
      ctx.log(L(ctx, '没记上这次上线：', 'Could not record the launch: ') + (e?.message ?? e))
    }
  }
  return { id: p.id, status, link: `/?view=landing&page=${p.id}` }
}
