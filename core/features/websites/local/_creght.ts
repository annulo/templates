// creght 站点渠道的数据读写：走 creght 的 MCP（Shuttle 的 设置 → MCP 里的 creght，第一次用要授权）。
// 文件名以 _ 开头：不作为可调用的函数，只给别的文件 import。站点源码的同步不在这里，用 creght CLI。

import { L } from './_i18n'

export type Site = { project_id: string; site_id: string; project_name: string; site_name: string }

/** 账号下的全部站点（平台按登录账号返回，读不到别人的） */
export async function sites(ctx: any): Promise<Site[]> {
  return (await ctx.mcp('creght', 'list_sites', {}))?.sites ?? []
}

/** 发布状态：published、live_url（自定义域名优先，没发布过是空）、preview_url、system_domain、domains[] */
export function status(ctx: any, projectID: string, siteID: string) {
  return ctx.mcp('creght', 'site_status', { project_id: projectID, site_id: siteID })
}

/** 站点后台（editor / cms / forms / domains / analytics / settings）的一次性登录跳转链接：60 秒内打开一次有效，打开就是登录状态。
 *  链接等于临时登录凭证：只给用户本人当场打开，不存表、不写进页面 */
export function adminLink(ctx: any, projectID: string, siteID: string, target = 'editor'): Promise<{ url: string; target_url: string; expires_at: string }> {
  return ctx.mcp('creght', 'admin_link', { project_id: projectID, site_id: siteID, target })
}

/** 把站点当前的远端版本（预览里看到的）发布上线，返回发布后的状态（字段同 status） */
export function sitePublish(ctx: any, projectID: string, siteID: string, note?: string) {
  return ctx.mcp('creght', 'site_publish', { project_id: projectID, site_id: siteID, note: note ?? '' })
}

/** 访问概览：summary、trend（按天）、breakdowns（各维度 Top N）。平台按 UTC 日期分组，起点取 UTC 零点 */
export function visits(ctx: any, projectID: string, siteID: string, days: number) {
  const n = Math.min(Math.max(Math.floor(days) || 30, 1), 365)
  const end = new Date()
  const start = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - (n - 1) * 86400_000
  return ctx.mcp('creght', 'visit_stats', { project_id: projectID, site_id: siteID, start_at: Math.floor(start / 1000), end_at: Math.floor(end.getTime() / 1000), limit: 20 })
}

/** 按起止时间取访问概览（毫秒时间戳），breakdowns.url 里是页面的 PV。改站复查拿改动前后两段对比用 */
export function visitsBetween(ctx: any, projectID: string, siteID: string, startMs: number, endMs: number, limit = 100) {
  return ctx.mcp('creght', 'visit_stats', { project_id: projectID, site_id: siteID, start_at: Math.floor(startMs / 1000), end_at: Math.floor(endMs / 1000), limit })
}

/** CMS 集合里的内容（collection 写 key 或 id 都行） */
export async function contents(ctx: any, projectID: string, collection: string, limit = 20): Promise<any[]> {
  return (await ctx.mcp('creght', 'cms_content_list', { project_id: projectID, collection, limit }))?.list ?? []
}

/** 新建一条内容，立即上线，返回 id */
export async function createContent(ctx: any, projectID: string, collection: string, slug: string, body: Record<string, unknown>): Promise<string> {
  return (await ctx.mcp('creght', 'cms_content_create', { project_id: projectID, collection, slug, body }))?.id
}

/** 更新一条内容（body 和已有内容合并），立即上线 */
export function updateContent(ctx: any, projectID: string, collection: string, id: string, slug: string, body: Record<string, unknown>) {
  return ctx.mcp('creght', 'cms_content_update', { project_id: projectID, collection, id, slug, body })
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
    return (await ctx.mcp('creght', 'form_list', { project_id: projectID }))?.forms ?? []
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
    const r = await ctx.mcp('creght', 'form_submissions', args)
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
    const r = await ctx.mcp('creght', 'form_webhook_create', { project_id: projectID, url })
    return { webhook: { ...r?.webhook, id: String(r?.webhook?.id ?? '') }, secret: String(r?.secret ?? '') }
  } catch (e) {
    throw formToolError(ctx, e)
  }
}

/** 项目下的 webhook，每个带最近 10 次投递（recent_deliveries） */
export async function formWebhookList(ctx: any, projectID: string): Promise<(FormWebhook & { recent_deliveries?: any[] })[]> {
  return (await ctx.mcp('creght', 'form_webhook_list', { project_id: projectID }))?.webhooks ?? []
}

export async function formWebhookDelete(ctx: any, projectID: string, webhookID: string) {
  return await ctx.mcp('creght', 'form_webhook_delete', { project_id: projectID, webhook_id: webhookID })
}

/** 同步发一条 form.test 事件，返回这次投递的 status_code / error / response（平台包在 delivery 里） */
export async function formWebhookTest(ctx: any, projectID: string, webhookID: string): Promise<{ status_code?: number; error?: string; response?: string }> {
  const r = await ctx.mcp('creght', 'form_webhook_test', { project_id: projectID, webhook_id: webhookID })
  return r?.delivery ?? r ?? {}
}
