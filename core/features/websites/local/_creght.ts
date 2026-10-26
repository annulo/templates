// creght 站点渠道的数据读写：走 creght 的 MCP（Annulo 连着 creght 时内置的，不用授权）。
// 文件名以 _ 开头：不作为可调用的函数，只给别的文件 import。站点源码的同步不在这里，用 creght CLI。
//
// creght 有几个分开的区域（creght.cn、creght.com、talizen.com），站点各在各的区域。项目所在区域的 MCP 叫 creght；
// 用户在 Annulo 的 设置 → 连接 里另外连上的区域各有一个：creght-cn、creght-com、talizen（Annulo 能力版本 53 起）。
// 渠道表记着站点在哪个区域（channels.api_host，空是项目所在的区域），这里按 project_id 查出来选 MCP，调用的地方不用管。

import { L } from './_i18n'

export type Site = { project_id: string; site_id: string; project_name: string; site_name: string; api_host: string }

const norm = (h: string) => String(h ?? '').trim().replace(/\/+$/, '').toLowerCase()

/** 项目所在的区域 */
export const homeHost = (ctx: any) => norm(ctx.workspace?.api_host || 'https://creght.cn')

/** 别的区域的 MCP 名字（和 Annulo 的 creghtMCPName 一样） */
const OTHER: Record<string, string> = { 'https://creght.cn': 'creght-cn', 'https://creght.com': 'creght-com', 'https://talizen.com': 'talizen' }

/** host 区域的 creght MCP 名字：项目所在的区域（或者没写）是 creght */
export function mcpName(ctx: any, host?: string) {
  const h = norm(host ?? '')
  if (!h || h === homeHost(ctx)) return 'creght'
  return OTHER[h] ?? 'creght-' + h.replace(/^https?:\/\//, '').replace(/[.:]/g, '-')
}

/** host 区域的 MCP 的状态：connected / needs_auth / failed / disabled，没有是空 */
export function mcpState(ctx: any, host?: string): string {
  const name = mcpName(ctx, host)
  return (ctx.mcp.servers() as { name: string; status: string }[]).find((s) => s.name === name)?.status ?? ''
}

/** 站点在哪个区域：渠道表里记的，没记（老渠道、还没加成渠道）是项目所在的区域 */
export function hostOf(ctx: any, projectID: string): string {
  const ch = ctx.db.query('channels', { where: { type: 'creght_site', project_id: projectID }, limit: 1 }).list[0]
  return norm(ch?.api_host) || homeHost(ctx)
}

/** 调站点所在区域的 creght MCP。host 不写就按 project_id 查渠道表 */
function call(ctx: any, projectID: string, tool: string, args: Record<string, unknown>, host?: string) {
  return ctx.mcp(mcpName(ctx, host ?? hostOf(ctx, projectID)), tool, args)
}

/** 账号下的全部站点：项目所在的区域，加上另外连着的区域（各区域的账号各是各的）。每个站点带上它在哪个区域（api_host）。
 *  项目所在区域读失败就报错；别的区域读失败只记日志，不拖累别的 */
export async function sites(ctx: any): Promise<Site[]> {
  const home = homeHost(ctx)
  const list: Site[] = ((await ctx.mcp('creght', 'list_sites', {}))?.sites ?? []).map((s: Site) => ({ ...s, api_host: home }))
  for (const [host, name] of Object.entries(OTHER)) {
    if (host === home || mcpState(ctx, host) !== 'connected') continue
    try {
      list.push(...((await ctx.mcp(name, 'list_sites', {}))?.sites ?? []).map((s: Site) => ({ ...s, api_host: host })))
    } catch (e: any) {
      ctx.log(L(ctx, `读不到 ${host} 的站点：`, `Couldn't read sites on ${host}: `) + e.message)
    }
  }
  return list
}

/** 预览地址和 creght CLI 的算法一致：预览环境是站点所在区域的 API host 的子域名 */
export function previewURL(ctx: any, siteID: string, host?: string) {
  const domain = /^https?:\/\/([^/]+)/.exec(norm(host ?? '') || homeHost(ctx))?.[1] ?? 'creght.cn'
  return `https://${siteID}.preview.${domain}/`
}

/** 发布状态：published、live_url（自定义域名优先，没发布过是空）、preview_url、system_domain、domains[]。
 *  还没加成渠道的站点（向导里选站点时）要写 host */
export function status(ctx: any, projectID: string, siteID: string, host?: string) {
  return call(ctx, projectID, 'site_status', { project_id: projectID, site_id: siteID }, host)
}

/** 渠道站点的正式地址（live_url，自定义域名优先，没发布过是空，不带结尾的 /）。和渠道表里记的不一样就写回 channels.live_url：
 *  页面显示地址直接读表，不用每次打开都调 MCP。读不到发布状态时抛错，表不动 */
export async function liveURL(ctx: any, ch: { id?: string; project_id?: string; site_id?: string; live_url?: string }): Promise<string> {
  if (!ch.project_id || !ch.site_id) return ''
  const st = await status(ctx, ch.project_id, ch.site_id)
  const url = String(st?.live_url ?? '').replace(/\/$/, '')
  if (ch.id && url !== (ch.live_url ?? '')) ctx.db.update('channels', ch.id, { live_url: url })
  return url
}

/** 站点后台（editor / cms / forms / domains / analytics / settings）的一次性登录跳转链接：60 秒内打开一次有效，打开就是登录状态。
 *  链接等于临时登录凭证：只给用户本人当场打开，不存表、不写进页面 */
export function adminLink(ctx: any, projectID: string, siteID: string, target = 'editor'): Promise<{ url: string; target_url: string; expires_at: string }> {
  return call(ctx, projectID, 'admin_link', { project_id: projectID, site_id: siteID, target })
}

/** 把站点当前的远端版本（预览里看到的）发布上线，返回发布后的状态（字段同 status） */
export function sitePublish(ctx: any, projectID: string, siteID: string, note?: string) {
  return call(ctx, projectID, 'site_publish', { project_id: projectID, site_id: siteID, note: note ?? '' })
}

/** 访问概览：summary、trend（按天）、breakdowns（各维度 Top N）。平台按 UTC 日期分组，起点取 UTC 零点 */
export function visits(ctx: any, projectID: string, siteID: string, days: number) {
  const n = Math.min(Math.max(Math.floor(days) || 30, 1), 365)
  const end = new Date()
  const start = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - (n - 1) * 86400_000
  return call(ctx, projectID, 'visit_stats', { project_id: projectID, site_id: siteID, start_at: Math.floor(start / 1000), end_at: Math.floor(end.getTime() / 1000), limit: 20 })
}

/** 按起止时间取访问概览（毫秒时间戳），breakdowns.url 里是页面的 PV。改站复查拿改动前后两段对比用 */
export function visitsBetween(ctx: any, projectID: string, siteID: string, startMs: number, endMs: number, limit = 100) {
  return call(ctx, projectID, 'visit_stats', { project_id: projectID, site_id: siteID, start_at: Math.floor(startMs / 1000), end_at: Math.floor(endMs / 1000), limit })
}

/** CMS 集合里的内容（collection 写 key 或 id 都行） */
export async function contents(ctx: any, projectID: string, collection: string, limit = 20): Promise<any[]> {
  return (await call(ctx, projectID, 'cms_content_list', { project_id: projectID, collection, limit }))?.list ?? []
}

/** 新建一条内容，立即上线，返回 id */
export async function createContent(ctx: any, projectID: string, collection: string, slug: string, body: Record<string, unknown>): Promise<string> {
  return (await call(ctx, projectID, 'cms_content_create', { project_id: projectID, collection, slug, body }))?.id
}

/** 更新一条内容（body 和已有内容合并），立即上线 */
export function updateContent(ctx: any, projectID: string, collection: string, id: string, slug: string, body: Record<string, unknown>) {
  return call(ctx, projectID, 'cms_content_update', { project_id: projectID, collection, id, slug, body })
}

/** 删掉一条内容，线上立即不可见。平台还没有这个工具时报一句说清楚的错 */
export async function deleteContent(ctx: any, projectID: string, collection: string, id: string) {
  try {
    return await call(ctx, projectID, 'cms_content_delete', { project_id: projectID, collection, id })
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (/没有工具|unknown tool|no such tool|tool .*not found/i.test(msg)) throw new Error(L(ctx, 'creght 还没开放删除内容的接口，等平台更新后再删；现在可以到网站后台的 CMS 里删掉，再点「只删记录」', "creght can't delete content from here yet — try again after the platform update. For now, delete it in the site's CMS, then choose \"Remove record only\""))
    if (/不存在|not found|no such content/i.test(msg)) return { deleted: false } // 网站上已经没有了，当成删掉了
    throw e
  }
}

/** ctx.file(…) 给的本机文件 */
export type LocalFile = { name: string; size: number; type: string; sha256: string }

/** 把本机文件传到站点的素材库（和 creght upload 同一套：预上传拿地址 → 本机直接 PUT → 确认），返回网站上的地址。
 *  按内容的 sha256 去重：同样内容传过的（existed）不再传。PUT 照 put_headers 带头（签名里签了 Content-Type），地址 2 小时内有效 */
export async function uploadAsset(ctx: any, projectID: string, siteID: string, f: LocalFile): Promise<string> {
  const pre = await call(ctx, projectID, 'asset_pre_upload', { project_id: projectID, site_id: siteID, filename: f.name, size: f.size, content_type: f.type, hash: f.sha256 })
  if (!pre?.existed) {
    if (!pre?.presigned_url) throw new Error(L(ctx, 'creght 没给上传地址', 'creght returned no upload URL'))
    const res = await fetch(pre.presigned_url, { method: 'PUT', headers: pre.put_headers ?? { 'content-type': f.type }, body: f as any }) // body 是 ctx.file：发这个文件
    if (!res.ok) throw new Error(L(ctx, `上传失败（${res.status}）`, `Upload failed (${res.status})`))
    await call(ctx, projectID, 'asset_upload_ack', { project_id: projectID, site_id: siteID, id: pre.id })
  }
  if (!pre?.url) throw new Error(L(ctx, 'creght 没返回文件地址', 'creght returned no file URL'))
  return pre.url
}

// ---- 表单（询盘线索用，local/leads.ts）----

/** creght MCP 还没有这个工具时的报错换成一句能看懂的话 */
function formToolError(ctx: any, e: any): Error {
  const msg = String(e?.message ?? e)
  if (/没有工具|unknown tool|no such tool/i.test(msg)) return new Error(L(ctx, 'creght 还没开放读表单提交的接口，等平台更新后再同步询盘', "creght doesn't offer form submissions yet — sync leads after the platform update"))
  return e instanceof Error ? e : new Error(msg)
}

export type Form = { id: string; key?: string; name?: string; desc?: string; fields?: { key: string; title?: string; type?: string }[]; submissions_total?: number }

/** 站点所在项目下的表单 */
export async function forms(ctx: any, projectID: string): Promise<Form[]> {
  try {
    return (await call(ctx, projectID, 'form_list', { project_id: projectID }))?.forms ?? []
  } catch (e) {
    throw formToolError(ctx, e)
  }
}

export type FormSubmission = {
  id: string
  form_id?: string
  form_key?: string
  form_name?: string
  /** RFC3339，精确到微秒 */
  created_at: string
  /** 提交所在页面，带 query（可能有 utm） */
  form_url?: string
  /** 字段 key → 可读的字符串（多选逗号分隔，文件是 URL） */
  fields?: Record<string, string>
  ua?: string
  /** 按 IP 解析的国家代码（CN、US），解析不了没有 */
  country?: string
}

/**
 * 表单提交，按提交顺序；cursor 是上次返回的 next_cursor（最后一条的 id，精确续传）。
 * 返回 { submissions, next_cursor, has_more }；limit 最多 200
 */
export async function formSubmissions(ctx: any, projectID: string, opts: { cursor?: string; since?: string; limit?: number; form_id?: string }): Promise<{ submissions: FormSubmission[]; next_cursor: string; has_more: boolean }> {
  const args: Record<string, unknown> = { project_id: projectID, limit: opts.limit ?? 200 }
  if (opts.cursor) args.cursor = opts.cursor
  if (opts.since) args.since = opts.since
  if (opts.form_id) args.form_id = opts.form_id
  try {
    const r = await call(ctx, projectID, 'form_submissions', args)
    return { submissions: r?.submissions ?? [], next_cursor: String(r?.next_cursor ?? opts.cursor ?? ''), has_more: !!r?.has_more }
  } catch (e) {
    throw formToolError(ctx, e)
  }
}

// ---- 表单 webhook（询盘线索实时推送用，local/leads.ts 的 connect）----
// 平台在表单收到提交时 POST 到注册的 https 地址，带 HMAC 签名；接收端是运营后台的 Func（backend/func/leads_hook.ts）。

export type FormWebhook = { id: string; url: string; form_ids?: string[]; secret_prefix?: string; created_at?: string }

/** 注册：form_ids 不传就是项目下全部表单（包括以后新建的）。secret 只在这里返回一次 */
export async function formWebhookCreate(ctx: any, projectID: string, url: string): Promise<{ webhook: FormWebhook; secret: string }> {
  try {
    const r = await call(ctx, projectID, 'form_webhook_create', { project_id: projectID, url })
    return { webhook: { ...r?.webhook, id: String(r?.webhook?.id ?? '') }, secret: String(r?.secret ?? '') }
  } catch (e) {
    throw formToolError(ctx, e)
  }
}

/** 项目下的 webhook，每个带最近 10 次投递（recent_deliveries） */
export async function formWebhookList(ctx: any, projectID: string): Promise<(FormWebhook & { recent_deliveries?: any[] })[]> {
  return (await call(ctx, projectID, 'form_webhook_list', { project_id: projectID }))?.webhooks ?? []
}

export async function formWebhookDelete(ctx: any, projectID: string, webhookID: string) {
  return await call(ctx, projectID, 'form_webhook_delete', { project_id: projectID, webhook_id: webhookID })
}

/** 同步发一条 form.test 事件，返回这次投递的 status_code / error / response（平台包在 delivery 里） */
export async function formWebhookTest(ctx: any, projectID: string, webhookID: string): Promise<{ status_code?: number; error?: string; response?: string }> {
  const r = await call(ctx, projectID, 'form_webhook_test', { project_id: projectID, webhook_id: webhookID })
  return r?.delivery ?? r ?? {}
}
