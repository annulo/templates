// Google Search Console 的接口封装（文件名以 _ 开头：不作为可调用的函数，只给别的文件 import）。
// 授权走 Shuttle 的「连接」：await ctx.oauth('google') 拿 access token，没连接时它会抛「到 设置 → 连接 里连接 Google」。
// 一个项目可以连多个 Google 账号（Shuttle 能力版本 23 起；连接按项目分开，只看得到这个项目连的）：每个属性用能看到它的那个账号，运行时按属性找，不存表。
// 接口文档：https://developers.google.com/webmaster-tools/v1/searchanalytics/query

import { L } from './_i18n'

const API = 'https://www.googleapis.com/webmasters/v3'

export type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

/** 是不是「还没连接 / 授权失效」这类要用户去设置里处理的错 */
export const notConnected = (e: any) => /设置\s*→\s*连接|Settings\s*→\s*Connections/i.test(String(e?.message ?? e))

/** 这个项目连着的 Google 账号（邮箱）。旧版 Shuttle 只能连一个、没有 accounts：返回 ['']，用默认账号 */
export function googleAccounts(ctx: any): string[] {
  const list: string[] = ctx.oauth.accounts?.('google') ?? []
  return list.length ? list : ['']
}

async function call(ctx: any, method: string, path: string, body?: unknown, account = '') {
  const token = await ctx.oauth('google', account ? { account } : undefined)
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.ok) return r.json()
  const text = await r.text()
  let msg = text.slice(0, 300)
  try {
    msg = JSON.parse(text)?.error?.message ?? msg
  } catch {}
  if (r.status === 403) throw new Error(L(ctx, `Google 账号${account ? ` ${account} ` : ''}没有这个 Search Console 属性的权限（${msg}）：在 Annulo 的连接设置里再连一个有权限的账号，或者在 Search Console 里把这个账号加为用户`, `Google account${account ? ` ${account}` : ''} has no access to this Search Console property (${msg}): connect an account that does in Annulo's connection settings, or add this account as a user in Search Console`))
  if (r.status === 401) throw new Error(L(ctx, `Google 的授权失效了：到 Annulo 的 设置 → 连接 里重新连接 Google（${msg}）`, `Google authorization expired: reconnect Google in Annulo's Settings → Connections (${msg})`))
  throw new Error(L(ctx, `Search Console 接口出错（${r.status}）：${msg}`, `Search Console API error (${r.status}): ${msg}`))
}

export type Site = { siteUrl: string; permissionLevel: string; google: string }

const owner = new Map<string, string>() // 属性 → 能看到它的 Google 账号（这次运行里列过的）

/** 连着的所有 Google 账号能看的属性，google 是用哪个账号看的（几个账号都能看的算最早连的那个）。
 *  某个账号读不到（授权失效）就跳过；全都读不到才抛 */
export async function sites(ctx: any): Promise<Site[]> {
  const out: Site[] = []
  let failed: unknown = null
  for (const google of googleAccounts(ctx)) {
    let r: any
    try {
      r = await call(ctx, 'GET', '/sites', undefined, google)
    } catch (e) {
      failed ??= e
      continue
    }
    for (const s of r?.siteEntry ?? []) {
      if (s.permissionLevel === 'siteUnverifiedUser' || owner.has(s.siteUrl) && owner.get(s.siteUrl) !== google) continue
      owner.set(s.siteUrl, google)
      out.push({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel, google })
    }
  }
  if (failed && !out.length) throw failed
  return out
}

/** 读这个属性用哪个 Google 账号：只连了一个就是它，多个时看谁能看到 */
async function accountFor(ctx: any, property: string): Promise<string> {
  const list = googleAccounts(ctx)
  if (list.length < 2) return list[0]
  if (!owner.has(property)) await sites(ctx)
  return owner.get(property) ?? list[0]
}

/** searchAnalytics.query。page 给了就只看这些页面（equals，多个用 OR：一组 filters 里 GSC 是 AND，所以每页一次，调用方自己合） */
export async function query(ctx: any, property: string, opts: { start: string; end: string; dimensions: string[]; rowLimit?: number; page?: string }): Promise<Row[]> {
  const body: any = { startDate: opts.start, endDate: opts.end, dimensions: opts.dimensions, rowLimit: opts.rowLimit ?? 1000, dataState: 'final' }
  if (opts.page) body.dimensionFilterGroups = [{ filters: [{ dimension: 'page', operator: 'equals', expression: opts.page }] }]
  const r = await call(ctx, 'POST', `/sites/${encodeURIComponent(property)}/searchAnalytics/query`, body, await accountFor(ctx, property))
  return r?.rows ?? []
}

/** YYYY-MM-DD（UTC）。GSC 的日期是太平洋时间，差一天以内不影响 28 天窗口的结论 */
export const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const DAY = 86400_000

/** 按域名找属性：优先 sc-domain:（覆盖所有子域和协议），其次 URL 前缀里最长能匹配上的 */
export function matchProperty(props: { siteUrl: string }[], siteUrl: string): string {
  let host = ''
  try {
    host = new URL(siteUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
  const bare = host.replace(/^www\./, '')
  const domain = props.find((p) => {
    const d = p.siteUrl.startsWith('sc-domain:') ? p.siteUrl.slice(10).toLowerCase() : ''
    return d && (bare === d || bare.endsWith('.' + d))
  })
  if (domain) return domain.siteUrl
  const prefix = props
    .filter((p) => /^https?:\/\//.test(p.siteUrl))
    .filter((p) => {
      try {
        return new URL(p.siteUrl).hostname.toLowerCase() === host
      } catch {
        return false
      }
    })
    .sort((a, b) => b.siteUrl.length - a.siteUrl.length)[0]
  return prefix?.siteUrl ?? ''
}

/**
 * 按平均排名的期望点击率。经验值（参考公开的 CTR 曲线研究，不同行业、有没有富摘要差别很大），
 * 只用来挑「明显偏低」的页面，不当成精确目标。
 */
export function expectedCtr(position: number): number {
  if (!position || position <= 0) return 0
  if (position < 1.5) return 0.28
  if (position < 2.5) return 0.15
  if (position < 3.5) return 0.1
  if (position < 5.5) return 0.06
  if (position < 10.5) return 0.03
  if (position < 20.5) return 0.01
  return 0.005
}

/** 机会：low_ctr（曝光 ≥ 100 且点击率低于期望的一半）优先；否则排名 8~20 且曝光 ≥ 50 是 striking_distance（再往前挪一点就上首页） */
export function opportunity(r: { impressions: number; ctr: number; position: number }): '' | 'low_ctr' | 'striking_distance' {
  const exp = expectedCtr(r.position)
  if (r.impressions >= 100 && r.position <= 10.5 && r.ctr < exp / 2) return 'low_ctr'
  if (r.impressions >= 50 && r.position >= 8 && r.position <= 20) return 'striking_distance'
  return ''
}

// ---- 噪音搜索词（搜索指令、品牌词）----
// 搜 site:xxx 的是在查收录，搜品牌词的人本来就是冲着你来的：都不是真实的搜索需求，
// 算进来会拉高曝光、拉低点击率，让页面被误标「点击率偏低」。机会、选题都按去掉它们的「非品牌」口径算。

const OPERATOR = /(^|[^a-z])(site|inurl|allinurl|intitle|allintitle|intext|allintext|cache|related|info|link|filetype):/i
// 两段式后缀（co.uk、com.cn…）的第二段
const SLD = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go'])

/** 站点域名的主体：去掉 www 和后缀后最靠近后缀的那一段。www.creght.com → creght，blog.bysir.top → bysir，sc-domain:example.co.uk → example */
export function domainBrand(site: string): string {
  let host = site.trim().toLowerCase().replace(/^sc-domain:/, '')
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname
  } catch {
    return ''
  }
  const parts = host.replace(/^www\./, '').split('.').filter(Boolean)
  if (parts.length < 2) return ''
  parts.pop() // 顶级后缀
  if (parts.length >= 2 && SLD.has(parts[parts.length - 1])) parts.pop()
  return parts[parts.length - 1] ?? ''
}

/** 品牌词：站点域名的主体 + 项目资料里的 brand_terms（逗号分隔，中英文逗号都认）。少于 3 个字符的不要（太容易误伤） */
export function brandTerms(site: string, extra?: string): string[] {
  const list = [domainBrand(site), ...String(extra ?? '').split(/[,，、]/)].map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3)
  return [...new Set(list)]
}

/** 是不是噪音搜索词：带搜索指令（site: 等，任意位置），或者包含品牌词（不区分大小写） */
export function isNoise(query: string, brands: string[]): boolean {
  const q = String(query ?? '').toLowerCase()
  if (OPERATOR.test(q)) return true
  return brands.some((b) => b.length >= 3 && q.includes(b.toLowerCase()))
}

export type NonBrand = { nb_clicks: number; nb_impressions: number; nb_ctr: number; nb_position: number; noise_impressions: number; queries: Row[] }

/**
 * 页面的「非品牌」口径：页面数据减掉噪音搜索词的点击和曝光。
 * GSC 的 page+query 数据是页面数据的子集（长尾词被匿名掉了），所以用减法，不是把非噪音词加起来。
 * 排名 = 非噪音搜索词按曝光加权的平均排名，没有非噪音词时用页面排名。queries 是非噪音词。
 */
export function nonBrand(page: { clicks: number; impressions: number; ctr: number; position: number }, queries: Row[], brands: string[]): NonBrand {
  let nc = 0, ni = 0, w = 0, wpos = 0
  const keep: Row[] = []
  for (const q of queries) {
    if (isNoise(q.keys[q.keys.length - 1], brands)) {
      nc += q.clicks
      ni += q.impressions
    } else {
      keep.push(q)
      w += q.impressions
      wpos += q.position * q.impressions
    }
  }
  const clicks = Math.max(0, page.clicks - nc)
  const impressions = Math.max(0, page.impressions - ni)
  return {
    nb_clicks: clicks,
    nb_impressions: impressions,
    nb_ctr: impressions ? clicks / impressions : 0,
    nb_position: w ? wpos / w : page.position,
    noise_impressions: ni,
    queries: keep,
  }
}

/**
 * 有搜索需求、站内没有排得上的页面的词（按 query 维度的行）：非噪音、曝光 ≥ 30、平均排名 > 15，按曝光从高到低。
 * existing 是已经有选题的搜索词（小写），这些跳过。最多 limit 个。
 */
export function pickQueryTopics(rows: Row[], brands: string[], existing: Set<string>, limit = 10): Row[] {
  return rows
    .filter((r) => {
      const q = String(r.keys[0] ?? '').trim()
      return q && !isNoise(q, brands) && r.impressions >= 30 && r.position > 15 && !existing.has(q.toLowerCase())
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
}
