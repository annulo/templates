// 渠道和访问数据（本机函数，Shuttle 在用户电脑上执行；creght 的数据走 creght 的 MCP，见 _creght.ts）。
//
//   channels.sites()                      账号下可以添加为独立站的 creght 站点
//   channels.add({ project_id, site_id })   把一个站点加成独立站渠道
//   channels.wpPrepare({ url })           WordPress：规范站点地址，给出应用密码该存的本机密钥名、有没有存
//   channels.add({ type: 'wordpress', url, username })   WordPress：用应用密码调一次 /users/me 验证，通过才加
//   channels.wpVerify({ id })             WordPress：用现在存的应用密码再验证一次（页面先 PUT local/secrets 写进本机密钥）
//   channels.wpRequest({ id, path, method?, body? })   WordPress：用存好的应用密码调一次 REST（path 从 /wp-json 后面写起），返回 JSON。
//                                         给助手修站用：密钥只给本机函数，助手的命令行里没有
//   channels.fromURL({ url })             网址是 creght 站点（页面里有 window.__DATA__ 的 projectId、siteId）就加成独立站渠道，返回渠道；不是返回 null。
//                                         没连 creght MCP、站点不在这个账号下也照样加，渠道页再提示（access）
//   channels.match({ url })              这个网址已经是哪个网站渠道（域名一样，或者是同一个 creght 站点、自定义域名也认得），返回渠道；没有返回 null。不写数据
//   channels.access({ id })               creght 站点渠道现在能不能读写：ok / no_mcp（没加或关掉了）/ needs_auth / not_in_account / failed；
//                                         ok 时带 live_url（正式地址，没发布过是空），并写回渠道表
//   channels.adminLink({ id, target? })   creght 站点渠道的后台（target：editor 默认 / cms / forms / domains / analytics / settings）的一次性登录链接，
//                                         页面拿到马上打开（60 秒、一次有效），打开就是登录状态
//   channels.remove({ id })               删掉一个渠道（网站在 channels 表，社媒账号在社媒插件的 social_accounts 表）
//   channels.stats({ days })              各渠道近 days 天的汇总：list 是网站（pv / uv / ip），social 是社媒（社媒插件的 social/stats.summary：粉丝和互动），
//                                         no_stats 是没有访问统计的网站（WordPress），读失败的在 failed
//   channels.overview({ site, days })     一个独立站的访问概览：汇总、按天趋势、各维度 Top N
//
// 页面用 lib/shuttle.ts 里的封装（listCreghtSites / addSiteChannel / removeChannel / channelStats / visitOverview）。

import { L } from './_i18n'
import { adminLink as creghtAdminLink, hostOf, liveURL, mcpState, previewURL, sites as allSites, visits } from './_creght'
// 社媒的数据由社媒插件算（github.com/annulo/plugins 的 social，装在 plugins/social/）：和社媒页显示的是同一份
import { summary as socialSummary } from '../plugins/social/local/stats'
import { normalizeURL, secretName, wp } from './_wp'

// 手机上打开后台（不在 Shuttle 里）时这几个也能用：annulo push 会把它们打包成站点 Func，只能用 ctx.db、ctx.mcp('creght', …)、ctx.locale
export const cloud = ['stats', 'overview']

// 要电脑的（浏览器、本机授权、密钥、外部接口）：手机上点了转给电脑上开着的 Shuttle 跑（设置 → 远程访问）
export const remote = ['access', 'add', 'adminLink', 'fromURL', 'match', 'remove', 'sites', 'wpPrepare', 'wpVerify']

type Channel = { id: string; type: string; name: string; project_id?: string; site_id?: string; api_host?: string; preview_url?: string; live_url?: string; wp_user?: string; wp_secret?: string; created_at?: string }

const CHANNEL_TYPES = ['creght_site', 'wordpress']

/** Shuttle 的项目（运营后台）不是要运营的网站：列站点、加渠道时排除（老版本 Shuttle 没有这个字段，就不排除） */
const isShuttleProject = (ctx: any, projectID: string) => ((ctx.workspace?.shuttle_projects as string[] | undefined) ?? []).includes(projectID)

export async function sites(_: unknown, ctx: any) {
  const bound = new Set((ctx.db.query('channels', { limit: 1000 }).list as Channel[]).filter((c) => c.type === 'creght_site').map((c) => `${c.project_id}/${c.site_id}`))
  const list = (await allSites(ctx)).filter((s) => !isShuttleProject(ctx, s.project_id))
  return { list: list.map((s) => ({ ...s, added: bound.has(`${s.project_id}/${s.site_id}`) })) }
}

export function wpPrepare(input: { url: string }, ctx: any) {
  const url = normalizeURL(input?.url, ctx)
  const secret = secretName(url)
  const added = (ctx.db.query('channels', { where: { type: 'wordpress' }, limit: 1000 }).list as Channel[]).some((c) => c.preview_url && normalizeURL(c.preview_url, ctx) === url)
  return { url, secret, has_secret: !!ctx.secrets.get(secret), added }
}

async function addWordPress(input: { url: string; username: string }, ctx: any) {
  const { url, secret, added } = wpPrepare(input, ctx)
  if (added) throw new Error(L(ctx, `${url} 已经添加过了`, `${url} is already added`))
  const username = String(input?.username ?? '').trim()
  if (!username) throw new Error(L(ctx, '要填 WordPress 用户名（登录后台用的那个）', 'Enter the WordPress username (the one you log in to admin with)'))
  const ch = { type: 'wordpress', preview_url: url, wp_user: username, wp_secret: secret }
  await verifyWP(ctx, ch)
  let name = ''
  try {
    name = String((await wp(ctx, ch, '/', { auth: false }))?.name ?? '').trim()
  } catch {
    // 站点名读不到就用域名
  }
  return ctx.db.insert('channels', { ...ch, name: name || url.replace(/^https?:\/\//, '') })
}

/** 凭据对不对、这个用户能不能发文章：context=edit 只有登录后才给，能拿到 capabilities */
async function verifyWP(ctx: any, ch: { preview_url?: string; wp_user?: string; wp_secret?: string; type: string; name?: string }) {
  const me = await wp(ctx, ch, '/wp/v2/users/me?context=edit')
  if (me?.capabilities && !me.capabilities.publish_posts) throw new Error(L(ctx, `WordPress 用户 ${ch.wp_user} 没有发布文章的权限：换一个作者或编辑以上角色的账号`, `WordPress user ${ch.wp_user} can't publish posts: use an account with the Author role or higher`))
  return me
}

/** 已添加的 WordPress 渠道：用现在存的应用密码验证一次（页面「更新应用密码」存完调它） */
export async function wpVerify(input: { id: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.id)
  if (!ch || ch.type !== 'wordpress') throw new Error(L(ctx, '没有这个 WordPress 渠道', 'No such WordPress channel'))
  const me = await verifyWP(ctx, ch)
  return { ok: true, user: me?.name ?? ch.wp_user }
}

export async function add(input: { type?: string; project_id: string; site_id: string; url?: string; username?: string }, ctx: any) {
  const type = input?.type || 'creght_site'
  if (type === 'wordpress') return addWordPress({ url: input.url ?? '', username: input.username ?? '' }, ctx)
  if (isShuttleProject(ctx, input?.project_id)) throw new Error(L(ctx, '这是一个 Annulo 项目（运营后台），不能当成渠道：选你要运营的网站', "That's an Annulo project (a back office) and can't be a channel: pick the site you want to run"))
  if (!CHANNEL_TYPES.includes(type)) throw new Error(L(ctx, `暂不支持添加 ${type} 渠道`, `${type} channels aren't supported yet`))
  const site = (await allSites(ctx)).find((s) => s.project_id === input.project_id && s.site_id === input.site_id)
  if (!site) throw new Error(L(ctx, '你的 creght 账号下没有这个站点', "Your creght account doesn't have this site"))
  const cur = ctx.db.query('channels', { where: { type, project_id: site.project_id, site_id: site.site_id }, limit: 1 }).list
  if (cur.length) throw new Error(L(ctx, `「${site.site_name}」已经添加过了`, `"${site.site_name}" is already added`))
  // api_host：站点在哪个 creght 区域，之后读写都走那个区域的 MCP（_creght.ts）
  const ch = ctx.db.insert('channels', { type, name: site.site_name, project_id: site.project_id, site_id: site.site_id, api_host: site.api_host, preview_url: previewURL(ctx, site.site_id, site.api_host) })
  // 发布过的记下正式地址；读不到不要紧，渠道页检查权限（access）时会再补
  try { return { ...ch, live_url: await liveURL(ctx, ch) } } catch { return ch }
}

/** creght 渲染的页面里带 window.__DATA__ = { projectId, siteId, provider: { url } }：自定义域名也认得出，不用连 MCP */
async function creghtPage(url: string) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) return null
  const html = String(await res.text())
  const m = /window\.__DATA__\s*=\s*(\{[^<]*?\});?\s*<\/script>/.exec(html)
  if (!m) return null
  let data: any
  try { data = JSON.parse(m[1]) } catch { return null }
  if (!data?.projectId || !data?.siteId) return null
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? ''
  const host = /^https?:\/\/(?:www\.)?([^/]+)/.exec(String(data.provider?.url ?? ''))?.[1] ?? ''
  return { project_id: String(data.projectId), site_id: String(data.siteId), title, host }
}

const bareHost = (url: string) => { try { return new URL(url).host.replace(/^www\./, '') } catch { return '' } }

export async function match(input: { url: string }, ctx: any) {
  const url = String(input?.url ?? ''), host = bareHost(url)
  const sites = (ctx.db.query('channels', { limit: 1000 }).list as Channel[]).filter((c) => CHANNEL_TYPES.includes(c.type))
  const same = sites.find((c) => [c.live_url, c.preview_url].some((u) => !!u && bareHost(u) === host))
  if (same || !host || !sites.some((c) => c.type === 'creght_site')) return same ?? null
  let page: Awaited<ReturnType<typeof creghtPage>> = null
  try { page = await creghtPage(url) } catch { return null }
  return (page && sites.find((c) => c.type === 'creght_site' && c.project_id === page.project_id && c.site_id === page.site_id)) || null
}

export async function fromURL(input: { url: string }, ctx: any) {
  let page: Awaited<ReturnType<typeof creghtPage>> = null
  try { page = await creghtPage(String(input?.url ?? '')) } catch { return null }
  if (!page || isShuttleProject(ctx, page.project_id)) return null
  const cur = ctx.db.query('channels', { where: { type: 'creght_site', project_id: page.project_id, site_id: page.site_id }, limit: 1 }).list[0]
  if (cur) return cur
  const apiHost = page.host ? `https://${page.host}` : ''
  if (mcpState(ctx, apiHost) === 'connected') {
    try { return await add({ project_id: page.project_id, site_id: page.site_id }, ctx) } catch { /* 不在账号下、MCP 读失败：下面照样加，渠道页提示 */ }
  }
  const name = page.title.split(/\s+[|–—-]\s+/)[0] || String(input.url).replace(/^https?:\/\//, '').replace(/\/$/, '')
  const preview_url = previewURL(ctx, page.site_id, apiHost)
  // 用户给的网址不是预览地址，就是站点上线的地址：先记下，连上 MCP 后 access 会按发布状态更新
  const live_url = /\.preview\./.test(bareHost(input.url)) ? undefined : String(input.url).replace(/^(https?:\/\/[^/]+).*$/, '$1')
  return ctx.db.insert('channels', { type: 'creght_site', name, project_id: page.project_id, site_id: page.site_id, api_host: apiHost || undefined, preview_url, live_url })
}

export async function access(input: { id: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.id)
  if (!ch || ch.type !== 'creght_site') return { state: 'ok' }
  const host = hostOf(ctx, ch.project_id!)
  const st = mcpState(ctx, host)
  if (!st || st === 'disabled') return { state: 'no_mcp', api_host: host }
  if (st === 'needs_auth') return { state: 'needs_auth' }
  // 直接读站点状态：list_sites 不一定列出账号能读的全部站点（比如别的 Annulo 项目里的站点），只拿它判断会误报。
  // 顺便把正式地址写回渠道表（liveURL），页面显示地址读表
  let err: Error
  try {
    return { state: 'ok', live_url: await liveURL(ctx, ch) }
  } catch (e) {
    err = e as Error
  }
  try {
    const list = await allSites(ctx)
    return list.some((s) => s.project_id === ch.project_id && s.api_host === host) ? { state: 'failed', error: err.message } : { state: 'not_in_account' }
  } catch (e) {
    return { state: 'failed', error: (e as Error).message }
  }
}

export async function adminLink(input: { id: string; target?: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.id)
  if (!ch || ch.type !== 'creght_site') throw new Error(L(ctx, '不是 creght 站点', 'Not a creght site'))
  const r = await creghtAdminLink(ctx, ch.project_id!, ch.site_id!, input.target || 'editor')
  return { url: r.url }
}

export function remove(input: { id: string }, ctx: any) {
  if (!input?.id) throw new Error(L(ctx, '缺 id', 'Missing id'))
  if (ctx.db.get('channels', input.id)) ctx.db.delete('channels', input.id)
  else ctx.db.delete('social_accounts', input.id)
  return { ok: true }
}

/** 社媒账号（社媒插件的表）；插件还没装时是空的 */
function socialAccounts(ctx: any): Channel[] {
  try {
    return ctx.db.query('social_accounts', { limit: 1000 }).list
  } catch {
    return []
  }
}

export async function stats(input: { days?: number }, ctx: any) {
  const days = input?.days ?? 30
  const chs: Channel[] = [...ctx.db.query('channels', { limit: 1000 }).list.filter((c: Channel) => c.type === 'creght_site' || c.type === 'wordpress'), ...socialAccounts(ctx)]
  // 网站和社媒口径不同，分开放：网站有 PV / UV / IP；社媒只有粉丝和笔记互动，和渠道页显示的是同一份（social/stats.summary）。
  // 读失败的不填 0（填了会被当成「没人访问」），列在 failed
  const list = []
  const social = []
  const failed = []
  const no_stats = []
  for (const c of chs) {
    // WordPress 自己没有访问统计：单独列出来，不填 0
    if (c.type === 'wordpress') {
      no_stats.push({ id: c.id, name: c.name, type: c.type, reason: L(ctx, 'WordPress 站点没有访问统计', 'WordPress sites have no visit stats') })
      continue
    }
    if (c.type !== 'creght_site') {
      try {
        const { top, ...s } = socialSummary({ channel_id: c.id, days }, ctx)
        social.push({ id: c.id, name: c.name, type: c.type, ...s, top: top.slice(0, 3).map((p) => ({ title: p.title, views: (p as { views?: number | null }).views, gain: p.gain })) })
      } catch (e: any) {
        failed.push({ id: c.id, name: c.name, type: c.type, error: e.message })
      }
      continue
    }
    if (!c.project_id || !c.site_id) {
      failed.push({ id: c.id, name: c.name, type: c.type, error: L(ctx, '渠道缺 project_id / site_id', 'Channel is missing project_id / site_id') })
      continue
    }
    try {
      const s = (await visits(ctx, c.project_id, c.site_id, days))?.summary ?? {}
      list.push({ id: c.id, name: c.name, type: c.type, pv_count: s.pv_count ?? 0, uv_count: s.uv_count ?? 0, ip_count: s.ip_count ?? 0 })
    } catch (e: any) {
      ctx.log(L(ctx, `读不到渠道「${c.name}」的访问数据：`, `Couldn't read visit data for channel "${c.name}": `) + e.message)
      failed.push({ id: c.id, name: c.name, type: c.type, error: e.message })
    }
  }
  return { list, social, no_stats, failed }
}

export async function overview(input: { site: string; days?: number }, ctx: any) {
  const [projectID, siteID] = String(input?.site ?? '').split('/')
  if (!projectID || !siteID) throw new Error(L(ctx, 'site 要写成 <project_id>/<site_id>', 'site must be <project_id>/<site_id>'))
  return visits(ctx, projectID, siteID, input.days ?? 30)
}

/** 用存好的应用密码调一次 WordPress REST：助手要改 WordPress 站点时调它（助手自己拿不到应用密码）。改动立即上线 */
export async function wpRequest(input: { id: string; path: string; method?: string; body?: unknown }, ctx: any) {
  const ch = ctx.db.get('channels', input?.id)
  if (!ch || ch.type !== 'wordpress') throw new Error(L(ctx, '没有这个 WordPress 渠道：', 'No such WordPress channel: ') + input?.id)
  const path = String(input?.path ?? '')
  if (!path.startsWith('/')) throw new Error(L(ctx, 'path 从 /wp-json 后面写起，比如 /wp/v2/posts', 'path starts after /wp-json, e.g. /wp/v2/posts'))
  const method = String(input.method ?? 'GET').toUpperCase()
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error(L(ctx, '不支持的 method：', 'Unsupported method: ') + method)
  return wp(ctx, ch, path, { method, body: input.body })
}
