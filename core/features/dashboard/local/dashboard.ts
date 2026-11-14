import { L } from './_i18n'
import { overview as siteVisits } from './channels'
import { overview as ga4Overview } from './ga4'

// 手机上也能看：网站访问走 creght MCP（云端也有），GA4 要本机授权，云端读不到就标成没连上，别的数照样出
export const cloud = ['summary']

// 运营总览的数据看板：一次算好六张卡片（当期、上期、按天的小折线）、趋势、从流量到成交的漏斗、流量来源、询盘来自哪里、内容效果、外部动向。
// 每个来源单独取、单独容错：没连上的标 status=none（页面显示「去连接」，不显示 0），出错的标 error，不影响别的。
//
//   dashboard.summary({ days?, channel_id? })   days 默认 30（7~180）；channel_id 只看这一个网站，不给是全部网站合起来
//
//   命令行：annulo run dashboard.summary --input '{"days":30}'

type Status = 'ok' | 'none' | 'error'
type Card = { cur: number | null; prev: number | null; trend: number[]; status: Status; error?: string }
type DayPoint = { day: string; visitors: number; leads: number; clicks: number; impressions: number; interactions: number }

const DAY = 86400_000
const p2 = (n: number) => String(n).padStart(2, '0')
/** 本机时区的日期 YYYY-MM-DD（和社媒插件、谷歌数据存的日期一样） */
const localDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
/** 各来源的日期写法不一样（20261016、2026-10-16T…），统一成 YYYY-MM-DD */
export const normDay = (v: unknown) => {
  const s = String(v ?? '')
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return s.slice(0, 10)
}
const read = (ctx: any, table: string, where?: Record<string, unknown>) => {
  try {
    return ctx.db.query(table, { limit: 10000, ...(where ? { where } : {}) }).list as any[]
  } catch {
    return []
  }
}
const isReal = (l: any) => l.is_real !== false && l.status !== 'spam'
const leadDay = (l: any) => normDay(l.submitted_at || l.created_at)
const msg = (e: any) => String(e?.message ?? e).slice(0, 300)

/** 当期（最近 days 天，含今天）和上期（再往前 days 天）的日期范围 */
export function periods(days: number, now = new Date()) {
  const today = localDay(now)
  const curStart = localDay(new Date(now.getTime() - (days - 1) * DAY))
  const prevStart = localDay(new Date(now.getTime() - (2 * days - 1) * DAY))
  const list: string[] = []
  for (let i = days - 1; i >= 0; i--) list.push(localDay(new Date(now.getTime() - i * DAY)))
  return { today, curStart, prevStart, days: list }
}

/** 一串按天的数加到当期、上期 */
function split(rows: { day: string; n: number }[], p: ReturnType<typeof periods>) {
  let cur = 0, prev = 0
  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (r.day >= p.curStart && r.day <= p.today) {
      cur += r.n
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.n)
    } else if (r.day >= p.prevStart && r.day < p.curStart) prev += r.n
  }
  return { cur, prev, trend: p.days.map((d) => byDay.get(d) ?? 0), byDay }
}

/**
 * 社媒每天一行存的是累计数：每个账号每天的增量 = 当天 − 前一条记录（第一条没有前一条，不算增量）。
 * 返回每天所有账号的增量之和（互动 = 点赞 + 评论 + 收藏 + 分享，另外单独给浏览）
 */
export function socialDeltas(rows: any[]) {
  const byChannel = new Map<string, any[]>()
  for (const r of rows) {
    const list = byChannel.get(r.channel_id) ?? []
    list.push(r)
    byChannel.set(r.channel_id, list)
  }
  const out: { day: string; n: number; views: number }[] = []
  const inter = (r: any) => ['likes', 'comments', 'collects', 'shares'].reduce((s, k) => s + (Number(r?.[k]) || 0), 0)
  for (const list of byChannel.values()) {
    list.sort((a, b) => normDay(a.date).localeCompare(normDay(b.date)))
    for (let i = 1; i < list.length; i++) {
      out.push({ day: normDay(list[i].date), n: Math.max(0, inter(list[i]) - inter(list[i - 1])), views: Math.max(0, (Number(list[i].views) || 0) - (Number(list[i - 1].views) || 0)) })
    }
  }
  return out
}

/** 加到一张按 key 的表上（来源、国家、页面），按数从大到小取前 n 个 */
function top(map: Map<string, any>, n: number, by: string) {
  return [...map.values()].sort((a, b) => b[by] - a[by]).slice(0, n)
}
function bump(map: Map<string, any>, key: string, fields: Record<string, number>) {
  if (!key) return
  const row = map.get(key) ?? { key }
  for (const [k, v] of Object.entries(fields)) row[k] = (row[k] ?? 0) + v
  map.set(key, row)
}

export async function summary(input: { days?: number; channel_id?: string }, ctx: any) {
  const days = Math.min(Math.max(Math.floor(Number(input?.days) || 30), 7), 180)
  const p = periods(days)
  const allSites = read(ctx, 'channels').filter((c) => ['creght_site', 'wordpress', 'website'].includes(c.type))
  const sites = input?.channel_id ? allSites.filter((c) => c.id === input.channel_id) : allSites
  const siteIds = new Set(sites.map((c) => c.id))

  // ---- 网站访问：creght 站点读平台的访问统计，WordPress 读 GA4（访客 = GA4 的用户数） ----
  // 当期访客用这段时间去重后的合计（每天的访客加起来会把来了好几天的人算好几次）；按天的数只用来画趋势。
  // 平台的访问统计最多给最近 31 天的按天数据：上期只有按天数据覆盖了整个上期才算，不然不比（不给错的对比）
  const visitRows: { day: string; n: number }[] = []
  const sources = new Map<string, any>()
  const pages = new Map<string, any>()
  const visitErrors: string[] = []
  let visitSites = 0
  let visitCur = 0
  let visitPrev: number | null = 0
  const path = (u: string) => String(u || '').replace(/^https?:\/\/[^/]+/, '') || '/'
  for (const c of sites) {
    try {
      if (c.type === 'creght_site' && c.project_id && c.site_id) {
        const site = `${c.project_id}/${c.site_id}`
        const [both, cur] = await Promise.all([siteVisits({ site, days: days * 2 }, ctx), siteVisits({ site, days }, ctx)])
        const daily = (both?.trend ?? []).map((d: any) => ({ day: normDay(d.day), n: Number(d.uv_count) || 0 }))
        for (const d of daily) if (d.day >= p.curStart) visitRows.push(d)
        visitCur += Number(cur?.summary?.uv_count) || 0
        const prevDays = daily.filter((d: any) => d.day >= p.prevStart && d.day < p.curStart)
        if (visitPrev != null && daily.some((d: any) => d.day <= p.prevStart)) visitPrev += prevDays.reduce((s: number, d: any) => s + d.n, 0)
        else visitPrev = null
        for (const r of cur?.breakdowns?.referrer_host ?? []) bump(sources, r.key || L(ctx, '直接访问', 'Direct'), { visitors: Number(r.uv_count) || 0 })
        for (const r of cur?.breakdowns?.url ?? []) bump(pages, path(r.key), { visitors: Number(r.uv_count) || 0 })
        visitSites++
      } else if ((c.type === 'wordpress' || c.type === 'website') && c.ga4_property) {
        const g = await ga4Overview({ channel_id: c.id, days }, ctx)
        for (const d of g?.trend ?? []) visitRows.push({ day: normDay(d.day), n: Number(d.users) || 0 })
        visitCur += Number(g?.current?.users) || 0
        if (visitPrev != null && g?.previous) visitPrev += Number(g.previous.users) || 0
        for (const r of g?.sources ?? []) bump(sources, r.key, { visitors: Number(r.sessions) || 0 })
        for (const r of g?.pages ?? []) bump(pages, path(r.key), { visitors: Number(r.sessions) || 0 })
        visitSites++
      }
    } catch (e) {
      visitErrors.push(`${c.name}：${msg(e)}`)
    }
  }
  const visits = split(visitRows, p)
  const visitors: Card = visitSites
    ? { cur: visitCur, prev: visitPrev, trend: visits.trend, status: 'ok', ...(visitErrors.length ? { error: visitErrors.join('；') } : {}) }
    : { cur: null, prev: null, trend: [], status: visitErrors.length ? 'error' : 'none', ...(visitErrors.length ? { error: visitErrors.join('；') } : {}) }

  // ---- 谷歌：Search Console 每天的点击、曝光 ----
  const gscRows = read(ctx, 'search_daily').filter((r) => siteIds.has(r.channel_id))
  const clicksSplit = split(gscRows.map((r) => ({ day: normDay(r.date), n: Number(r.clicks) || 0 })), p)
  const imprSplit = split(gscRows.map((r) => ({ day: normDay(r.date), n: Number(r.impressions) || 0 })), p)
  const gscOn = gscRows.length > 0 || sites.some((c) => c.gsc_property)
  const clicks: Card = gscOn ? { cur: clicksSplit.cur, prev: clicksSplit.prev, trend: clicksSplit.trend, status: 'ok' } : { cur: null, prev: null, trend: [], status: 'none' }

  // ---- AI 搜索可见度：每个网站最近一次检测的分数（几个网站取平均），和它的上一次比 ----
  const runs = read(ctx, 'geo_runs').filter((r) => siteIds.has(r.channel_id) && r.visibility != null && (r.finished_at || r.created_at))
  const geoBy = new Map<string, any[]>()
  for (const r of runs) geoBy.set(r.channel_id, [...(geoBy.get(r.channel_id) ?? []), r])
  const lastScores: number[] = [], prevScores: number[] = []
  const geoTrend = new Map<string, number[]>()
  for (const list of geoBy.values()) {
    list.sort((a, b) => String(a.finished_at || a.created_at).localeCompare(String(b.finished_at || b.created_at)))
    lastScores.push(Number(list[list.length - 1].visibility) || 0)
    if (list.length > 1) prevScores.push(Number(list[list.length - 2].visibility) || 0)
    for (const r of list) {
      const d = normDay(r.finished_at || r.created_at)
      geoTrend.set(d, [...(geoTrend.get(d) ?? []), Number(r.visibility) || 0])
    }
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null)
  const geo: Card = lastScores.length
    ? { cur: avg(lastScores), prev: avg(prevScores), trend: [...geoTrend.keys()].sort().slice(-12).map((d) => avg(geoTrend.get(d)!) ?? 0), status: 'ok' }
    : { cur: null, prev: null, trend: [], status: 'none' }

  // ---- 询盘 ----
  // 只看某个网站时，只算这个网站的表单来的；全部网站时连主动获客转来的一起算
  const allLeads = read(ctx, 'leads').filter((l) => !input?.channel_id || l.channel_id === input.channel_id)
  const real = allLeads.filter(isReal)
  const leadSplit = split(real.map((l) => ({ day: leadDay(l), n: 1 })), p)
  const leads: Card = { cur: leadSplit.cur, prev: leadSplit.prev, trend: leadSplit.trend, status: 'ok' }
  const PIPE = ['contacted', 'quoted', 'negotiating', 'qualified']
  const pipeline: Card = { cur: real.filter((l) => PIPE.includes(l.status)).length, prev: null, trend: [], status: 'ok' }
  const inPeriod = real.filter((l) => leadDay(l) >= p.curStart)
  const reached = (stages: string[]) => inPeriod.filter((l) => stages.includes(l.status)).length
  const funnel = {
    visitors: visitors.cur,
    leads: inPeriod.length,
    contacted: reached(['contacted', 'quoted', 'negotiating', 'qualified', 'won']),
    quoted: reached(['quoted', 'negotiating', 'won']),
    won: reached(['won']),
  }
  const countries = new Map<string, any>(), landing = new Map<string, any>()
  for (const l of inPeriod) {
    bump(countries, l.country || L(ctx, '未知', 'Unknown'), { n: 1, high: l.intent === 'high' ? 1 : 0 })
    bump(landing, l.landing_page ? String(l.landing_page).replace(/^https?:\/\/[^/]+/, '') || '/' : L(ctx, '（不知道哪个页面）', '(page unknown)'), { n: 1, high: l.intent === 'high' ? 1 : 0 })
  }

  // ---- 社媒互动（点赞 + 评论 + 收藏 + 分享，按天的增量） ----
  const accounts = read(ctx, 'social_accounts')
  const deltas = socialDeltas(read(ctx, 'social_daily'))
  const socialSplit = split(deltas.map((d) => ({ day: d.day, n: d.n })), p)
  const social: Card = accounts.length ? { cur: socialSplit.cur, prev: socialSplit.prev, trend: socialSplit.trend, status: 'ok' } : { cur: null, prev: null, trend: [], status: 'none' }

  // ---- 内容效果：访问最多的网站页面、浏览最多的社媒内容 ----
  let topPages = top(pages, 5, 'visitors').map((r) => ({ page: r.key, visitors: r.visitors, metric: 'visitors' }))
  if (!topPages.length) {
    // 没有访问统计时用谷歌点击
    topPages = read(ctx, 'search_pages').filter((r) => siteIds.has(r.channel_id)).sort((a, b) => (Number(b.clicks) || 0) - (Number(a.clicks) || 0)).slice(0, 5).map((r) => ({ page: String(r.page).replace(/^https?:\/\/[^/]+/, '') || '/', visitors: Number(r.clicks) || 0, metric: 'clicks' }))
  }
  const topPosts = read(ctx, 'social_posts')
    .filter((x) => x.status === 'published')
    .sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0))
    .slice(0, 5)
    .map((x) => ({ id: x.id, title: x.title || String(x.body || '').split('\n')[0].slice(0, 80), views: Number(x.views) || 0, interactions: ['likes', 'comments', 'collects', 'shares'].reduce((s, k) => s + (Number(x[k]) || 0), 0), channel_id: x.channel_id, article_id: x.article_id || '', url: x.post_url || '' }))

  // ---- 外部动向 ----
  const competitorNew = read(ctx, 'competitor_pages', { is_new: true }).filter((x) => normDay(x.first_seen) >= p.curStart).length
  const issuesHigh = read(ctx, 'site_issues').filter((i) => siteIds.has(i.channel_id) && i.status === 'open' && i.severity === 'high').length

  // ---- 趋势图：每天的访客、询盘、谷歌点击、曝光、社媒互动 ----
  const trend: DayPoint[] = p.days.map((d) => ({
    day: d,
    visitors: visits.byDay.get(d) ?? 0,
    leads: leadSplit.byDay.get(d) ?? 0,
    clicks: clicksSplit.byDay.get(d) ?? 0,
    impressions: imprSplit.byDay.get(d) ?? 0,
    interactions: socialSplit.byDay.get(d) ?? 0,
  }))
  const totalSource = [...sources.values()].reduce((s, r) => s + r.visitors, 0)

  return {
    days,
    period: { start: p.curStart, end: p.today, prev_start: p.prevStart },
    sites: allSites.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    cards: { visitors, clicks, geo, leads, pipeline, social },
    trend,
    funnel,
    traffic_sources: top(sources, 8, 'visitors').map((r) => ({ key: r.key, visitors: r.visitors, share: totalSource ? Math.round((r.visitors / totalSource) * 1000) / 10 : 0 })),
    lead_origins: { countries: top(countries, 6, 'n'), pages: top(landing, 6, 'n') },
    top_pages: topPages,
    top_posts: topPosts,
    external: { competitor_new: competitorNew, geo: geo.cur, geo_prev: geo.prev, issues_high: issuesHigh },
  }
}
