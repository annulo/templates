import { L } from './_i18n'
import { profile } from './_ai'
import { brandTerms, DAY, isNoise, notConnected, query, ymd, type Row } from './_gsc'

// 手机上也能看、能标看过、能忽略：只用 ctx.db
export const cloud = ['list', 'markSeen', 'dismiss', 'context']

// 要调 Google 接口的：手机上点了转给电脑上开着的 Annulo 跑
export const remote = ['scan']

// 内容衰减雷达：以前从 Google 带来点击、最近明显下滑的页面（参考 TradeMax「内容衰减雷达」，docs/content-decay.md）。
//
// 把最近 168 天切成 6 个 28 天：最近 28 天和之前 5 个 28 天里最好的那个（高峰）比，点击少了三成以上、少了至少 5 次的算下滑。
// 只按页面算会被品牌词带偏（首页的点击多半是搜公司名），所以先按页面挑出候选，再按「页面 + 搜索词」去掉品牌词和 site: 查询重算一遍。
// 原因按数据分三种，决定下一步：rank 排名掉了 → 刷新内容；ctr 排名没掉、点击率降了 → 改标题描述；demand 曝光少了 → 先看是不是季节性。
//
//   decay.scan({ channel_id?, manual? })   重算（定时任务每周一次；manual 时没连 Google 就报错）
//   decay.list({ channel_id? })            下滑的页面，按少掉的点击排
//   decay.context({ id })                  给助手刷新内容用：高峰和现在的数据、掉得最多的搜索词（任务 tasks/refresh-page.md）
//   decay.markSeen({ ids? })               去掉「新」标识（不给 ids 就是全部）
//   decay.dismiss({ id, undo? })           不用管（季节性、已经下线的页面）
//
// 刷新内容、改标题描述、上线复查都挂在 search_pages 同一个页面的记录上（search_page_id），和「谷歌排名」页的流程是一套。

const WINDOW = 28
const WINDOWS = 6 // 最近 1 个 + 之前 5 个
const LAG = 3 // GSC 数据延迟 2~3 天
const MIN_PEAK = 10 // 高峰 28 天至少这么多点击才算「以前带过流量」
const MIN_LOST = 5
const MIN_DROP = 0.3
const MAX_CANDIDATES = 20 // 按搜索词重算的页面上限（每个页面两次请求）

type Channel = { id: string; name: string; type: string; gsc_property?: string; gsc_link_disabled?: boolean }
type Decay = {
  id: string; channel_id: string; page: string; search_page_id?: string
  peak_start: string; peak_end: string; peak_clicks: number; peak_impressions: number; peak_ctr: number; peak_position: number
  clicks: number; impressions: number; ctr: number; position: number; drop: number; lost_clicks: number
  cause: Cause; trend?: string; lost_queries?: string; status?: string; seen?: boolean; first_seen?: string; scanned_at?: string
}
export type Cause = 'rank' | 'ctr' | 'demand'
export type Stat = { clicks: number; impressions: number; ctr: number; position: number }
type Window = { start: string; end: string }

const nowISO = () => new Date().toISOString()
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d
const parse = <T,>(v: unknown, d: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : ((v as T) ?? d)
  } catch {
    return d
  }
}

/** 最近 6 个 28 天，从早到晚；最后一个是最近 28 天 */
export function windows(now = Date.now()): Window[] {
  const end = now - LAG * DAY
  return Array.from({ length: WINDOWS }, (_, i) => {
    const e = end - (WINDOWS - 1 - i) * WINDOW * DAY
    return { start: ymd(e - (WINDOW - 1) * DAY), end: ymd(e) }
  })
}

/** 一组行加起来（排名按曝光加权） */
export function sum(rows: { clicks: number; impressions: number; position: number }[]): Stat {
  const clicks = rows.reduce((n, r) => n + r.clicks, 0)
  const impressions = rows.reduce((n, r) => n + r.impressions, 0)
  const position = impressions ? rows.reduce((n, r) => n + r.position * r.impressions, 0) / impressions : 0
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position }
}

/** 之前几个窗口里点击最多的那个是高峰；最近这个比高峰少了三成以上、至少 5 次才算下滑 */
export function detect(series: Stat[]): { peak: number; drop: number; lost: number } | null {
  if (series.length < 2) return null
  const cur = series[series.length - 1]
  let peak = 0
  for (let i = 1; i < series.length - 1; i++) if (series[i].clicks > series[peak].clicks) peak = i
  const p = series[peak]
  if (p.clicks < MIN_PEAK) return null
  const lost = p.clicks - cur.clicks
  const drop = lost / p.clicks
  if (lost < MIN_LOST || drop < MIN_DROP) return null
  return { peak, drop, lost }
}

/** 为什么掉：排名掉了 2 位以上 → rank；曝光还在八成以上、点击率掉了 → ctr；其余是曝光少了 → demand */
export function causeOf(peak: Stat, cur: Stat): Cause {
  if (peak.position && cur.position && cur.position - peak.position >= 2) return 'rank'
  if (peak.impressions && cur.impressions >= peak.impressions * 0.8 && cur.ctr < peak.ctr * 0.8) return 'ctr'
  return 'demand'
}

/** 掉得最多的搜索词（不含品牌词） */
export function lostQueries(peakRows: Row[], curRows: Row[], brands: string[], limit = 10) {
  const cur = new Map(curRows.map((r) => [r.keys[1], r]))
  return peakRows
    .filter((r) => !isNoise(r.keys[1], brands))
    .map((r) => {
      const c = cur.get(r.keys[1])
      return { query: r.keys[1], peak_clicks: r.clicks, clicks: c?.clicks ?? 0, peak_position: round(r.position, 1), position: c ? round(c.position, 1) : 0 }
    })
    .filter((q) => q.peak_clicks > q.clicks)
    .sort((a, b) => b.peak_clicks - b.clicks - (a.peak_clicks - a.clicks))
    .slice(0, limit)
}

const isHome = (u: string) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, '') === ''
  } catch {
    return false
  }
}

async function scanChannel(ch: Channel, ctx: any) {
  const property = ch.gsc_property!
  const ws = windows()
  ctx.progress({ message: L(ctx, `读取「${ch.name}」最近 ${WINDOWS} 个 28 天的页面数据`, `Reading ${WINDOWS} periods of 28 days for "${ch.name}"`) })
  const byWindow = await Promise.all(ws.map((w) => query(ctx, property, { ...w, dimensions: ['page'], rowLimit: 5000 })))
  const pages = new Set(byWindow.flatMap((rows) => rows.map((r) => r.keys[0])))
  const maps = byWindow.map((rows) => new Map(rows.map((r) => [r.keys[0], r])))
  const zero: Stat = { clicks: 0, impressions: 0, ctr: 0, position: 0 }
  const seriesOf = (page: string) => maps.map((m) => {
    const r = m.get(page)
    return r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } : zero
  })

  // 第一轮按页面挑候选；首页的点击几乎都是品牌词，不算内容衰减
  const candidates = [...pages]
    .filter((p) => !isHome(p))
    .map((page) => ({ page, series: seriesOf(page), hit: detect(seriesOf(page)) }))
    .filter((c) => c.hit)
    .sort((a, b) => b.hit!.lost - a.hit!.lost)
    .slice(0, MAX_CANDIDATES)

  // 第二轮按「页面 + 搜索词」去掉品牌词重算高峰和现在
  const brands = brandTerms(property, profile(ctx).brand_terms)
  const found: Omit<Decay, 'id'>[] = []
  for (let i = 0; i < candidates.length; i += 5) {
    ctx.progress({ message: L(ctx, `核对搜索词（${i + 1}/${candidates.length}）`, `Checking queries (${i + 1}/${candidates.length})`) })
    const batch = await Promise.all(candidates.slice(i, i + 5).map(async (c) => {
      const peakW = ws[c.hit!.peak], curW = ws[ws.length - 1]
      const [peakRows, curRows] = await Promise.all([
        query(ctx, property, { ...peakW, dimensions: ['page', 'query'], rowLimit: 1000, page: c.page }),
        query(ctx, property, { ...curW, dimensions: ['page', 'query'], rowLimit: 1000, page: c.page }),
      ])
      const clean = (rows: Row[]) => rows.filter((r) => !isNoise(r.keys[1], brands))
      // 搜索词数据有匿名的长尾，加起来比页面总数少：只拿它判断「去掉品牌词还算不算下滑」，展示的数字仍用页面总数
      const nbPeak = sum(clean(peakRows)), nbCur = sum(clean(curRows))
      if (peakRows.length && !detect([zero, nbPeak, nbCur])) return null
      const peak = c.series[c.hit!.peak], cur = c.series[c.series.length - 1]
      return {
        channel_id: ch.id, page: c.page,
        peak_start: peakW.start, peak_end: peakW.end,
        peak_clicks: peak.clicks, peak_impressions: peak.impressions, peak_ctr: round(peak.ctr), peak_position: round(peak.position, 1),
        clicks: cur.clicks, impressions: cur.impressions, ctr: round(cur.ctr), position: round(cur.position, 1),
        drop: round(c.hit!.drop), lost_clicks: c.hit!.lost, cause: causeOf(peak, cur),
        trend: JSON.stringify(c.series.map((s) => s.clicks)),
        lost_queries: JSON.stringify(lostQueries(peakRows, curRows, brands)),
      }
    }))
    for (const d of batch) if (d) found.push(d)
  }
  return write(ch, found, ctx)
}

/** 写进 content_decay：有的更新、新的建；不再下滑的删掉（回升了，或者页面没了） */
function write(ch: Channel, found: Omit<Decay, 'id'>[], ctx: any) {
  const existing: Decay[] = ctx.db.query('content_decay', { where: { channel_id: ch.id }, limit: 1000 }).list
  const byPage = new Map(existing.map((d) => [d.page, d]))
  const sp: { id: string; page: string }[] = ctx.db.query('search_pages', { where: { channel_id: ch.id }, limit: 1000 }).list
  const spBy = new Map(sp.map((p) => [p.page, p.id]))
  const at = nowISO()
  const keep = new Set<string>()
  let added = 0
  for (const d of found) {
    keep.add(d.page)
    const body = { ...d, search_page_id: spBy.get(d.page) ?? '', scanned_at: at }
    const old = byPage.get(d.page)
    if (old) ctx.db.update('content_decay', old.id, body)
    else {
      ctx.db.insert('content_decay', { ...body, status: '', seen: false, first_seen: at })
      added++
    }
  }
  for (const old of existing) if (!keep.has(old.page)) ctx.db.delete('content_decay', old.id)
  return { channel: ch.name, pages: found.length, new: added, lost_clicks: found.reduce((n, d) => n + d.lost_clicks, 0) }
}

export async function scan(input: { channel_id?: string; manual?: boolean }, ctx: any) {
  let chs: Channel[] = ctx.db.query('channels', { where: { type: 'creght_site' }, limit: 500 }).list
  if (input?.channel_id) chs = chs.filter((c) => c.id === input.channel_id)
  chs = chs.filter((c) => c.gsc_property && !c.gsc_link_disabled)
  if (!chs.length) {
    if (input?.manual) throw new Error(L(ctx, '还没有网站关联 Search Console：先到「谷歌排名」关联并同步一次', 'No site is linked to Search Console yet: link and sync one on the Google rankings page first'))
    return { skipped: L(ctx, '没有关联 Search Console 的网站', 'No site linked to Search Console') }
  }
  const results: any[] = []
  for (const ch of chs) {
    try {
      results.push(await scanChannel(ch, ctx))
    } catch (e) {
      // 定时任务：没连 Google 时安静跳过
      if (!input?.manual && notConnected(e)) return { skipped: L(ctx, '还没连接 Google', 'Google not connected') }
      throw e
    }
  }
  return { list: results }
}

const view = (d: Decay) => ({ ...d, trend: parse<number[]>(d.trend, []), lost_queries: parse<any[]>(d.lost_queries, []) })

export function list(input: { channel_id?: string }, ctx: any) {
  let rows: Decay[]
  try {
    rows = ctx.db.query('content_decay', { ...(input?.channel_id ? { where: { channel_id: input.channel_id } } : {}), limit: 1000 }).list
  } catch {
    return [] // 表还没建（老项目）
  }
  return rows.sort((a, b) => b.lost_clicks - a.lost_clicks).map(view)
}

export function context(input: { id: string }, ctx: any) {
  const d: Decay | null = ctx.db.get('content_decay', input?.id)
  if (!d) throw new Error(L(ctx, '找不到这条记录，可能已经回升、被删掉了', 'Record not found; the page may have recovered'))
  return view(d)
}

export function markSeen(input: { ids?: string[] }, ctx: any) {
  const rows: Decay[] = list({}, ctx) as any
  const ids = input?.ids?.length ? new Set(input.ids) : null
  let n = 0
  for (const d of rows) if (!d.seen && (!ids || ids.has(d.id))) (ctx.db.update('content_decay', d.id, { seen: true }), n++)
  return { marked: n }
}

export function dismiss(input: { id: string; undo?: boolean }, ctx: any) {
  if (!ctx.db.get('content_decay', input?.id)) throw new Error(L(ctx, '找不到这条记录', 'Record not found'))
  ctx.db.update('content_decay', input.id, { status: input.undo ? '' : 'dismissed', seen: true })
  return { ok: true }
}
