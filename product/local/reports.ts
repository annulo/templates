// 运营周报的数字和存档（本机函数）。周报的解读和建议由助手写（任务 tasks/weekly-report.md：每 7 天定时，或周报页点按钮），
// 数字不让助手自己查表加总：一律从这里拿，和各页面显示的是同一份。
//
//   reports.data({ days? })   这一期要用的全部数字：网站访问、社媒、搜索、GEO、体检、改站复查、发布的内容、增长机会、关键词，和上一期周报；
//                             有对应模块的再带上：询盘（leads）、竞品动向（competitors）、转化（metrics）、增长机会和运营主题（campaigns）
//                             外贸和产品运营共用（business 模块）
//   reports.save({ period_start, period_end, title, summary, body, highlights?, suggestions? })  出自哪段对话：读 ctx.chat_id，不用传
//                             存一期周报；同一周期已有就更新，不重复建
//
//   命令行：annulo run reports.data --input '{"days":7}'

import { L } from './_i18n'
import { stats as channelStats } from './channels'
import { summary as searchSummary } from './gsc'
import { unpublished } from './_types'

declare const require: (path: string) => any

/** 只有部分模板有的模块（拼出来的路径：没有这个文件的模板打包时不报错） */
function optional(name: string): any {
  try {
    return require('./' + name + '.ts')
  } catch {
    return null
  }
}

type Report = { id: string; period_start: string; period_end: string; title?: string; summary?: string; highlights?: string; suggestions?: string; created_at?: string }

const DAY = 86400_000
/** 本机时区的 YYYY-MM-DD */
const ymd = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const at = (x: { finished_at?: string; created_at?: string; published_at?: string; reviewed_at?: string }) => Date.parse(x.finished_at || x.published_at || x.reviewed_at || x.created_at || '') || 0
const newest = <T extends object>(l: T[]) => [...l].sort((a: any, b: any) => at(b) - at(a))
const all = (ctx: any, table: string) => {
  try {
    return ctx.db.query(table, { limit: 1000 }).list as any[]
  } catch {
    return [] // 表还没建（老项目）：当作没有数据
  }
}

export async function data(input: { days?: number }, ctx: any) {
  const days = Math.min(Math.max(Math.floor(input?.days ?? 7), 1), 90)
  const now = Date.now()
  const start = now - days * DAY
  const inWindow = (t: number) => t > start && t <= now
  const chName: Record<string, string> = {}
  for (const c of [...all(ctx, 'channels'), ...all(ctx, 'social_accounts')]) chName[c.id] = c.name

  // 网站、社媒：近 days 天（渠道页、总览同一份）；读失败的在 failed，不当 0
  let channels: any
  try {
    channels = await channelStats({ days }, ctx)
  } catch (e: any) {
    channels = { error: e.message }
  }

  // 询盘（询盘模块）：近 days 天和再往前 days 天；没有询盘模块不给
  let leads: any
  const leadsModule = optional('leads')
  if (leadsModule) try {
    const { by_page, by_utm_source, ...rest } = leadsModule.stats({ days }, ctx)
    leads = { ...rest, by_page: by_page.slice(0, 5), by_utm_source: by_utm_source.slice(0, 5) }
  } catch (e: any) {
    leads = { error: e.message }
  }

  // 搜索：GSC 同步的是近 28 天和上一个 28 天（口径和周期不同，照 note 说）
  let search: any = null
  try {
    const s = searchSummary({}, ctx)
    search = s.pages ? { ...s, note: L(ctx, '近 28 天（GSC 有 2~3 天延迟）对比上一个 28 天，不是这一周', 'Last 28 days (GSC lags 2–3 days) vs. the 28 days before — not this week') } : null
  } catch {}

  // GEO：每个站、每个引擎最近一次检测和它前一次
  const geo: any[] = []
  const runs = newest(all(ctx, 'geo_runs'))
  const seen = new Set<string>()
  for (const r of runs) {
    const k = `${r.channel_id}|${r.engine || 'perplexity'}`
    if (seen.has(k)) continue
    seen.add(k)
    const prev = runs.find((x) => x !== r && x.channel_id === r.channel_id && (x.engine || 'perplexity') === (r.engine || 'perplexity') && at(x) < at(r))
    const pick = (x: any) => x && { at: x.finished_at || x.created_at, visibility: x.visibility ?? 0, cited: x.cited ?? 0, questions: x.questions ?? 0 }
    geo.push({ channel: chName[r.channel_id] ?? r.channel_id, engine: r.engine || 'perplexity', latest: pick(r), previous: pick(prev) ?? null, in_period: inWindow(at(r)) })
  }

  // 体检：每个站最近一次和前一次的得分，还开着的问题数
  const audits: any[] = []
  const aruns = newest(all(ctx, 'audit_runs'))
  const issues = all(ctx, 'site_issues')
  for (const id of [...new Set(aruns.map((r) => r.channel_id))]) {
    const [cur, prev] = aruns.filter((r) => r.channel_id === id)
    const open = issues.filter((i) => i.channel_id === id && i.status === 'open')
    audits.push({
      channel: chName[id] ?? id, score: cur.score ?? 0, at: cur.finished_at || cur.created_at, previous_score: prev?.score ?? null,
      open_issues: open.length, open_high: open.filter((i) => i.severity === 'high').length,
      fixing: issues.filter((i) => i.channel_id === id && i.status === 'fixing').length,
    })
  }

  // 改站复查：这一期复查完的（有结论），和还在等数据的
  const changes = all(ctx, 'site_changes')
  const reviewed = changes.filter((c) => c.status === 'reviewed' && inWindow(Date.parse(c.reviewed_at || '') || 0))
    .map((c) => ({ channel: chName[c.channel_id] ?? c.channel_id, title: c.title, verdict: c.verdict, summary: c.summary }))
  const waiting = changes.filter((c) => c.status === 'waiting').length

  // 这一期发出去的内容
  const articles = all(ctx, 'articles').filter((a) => a.status === 'published' && inWindow(Date.parse(a.published_at || '') || 0))
  const posts = all(ctx, 'social_posts').filter((p) => p.status === 'published' && inWindow(Date.parse(p.published_at || '') || 0))
  const content = {
    articles: articles.map((a) => ({ channel: chName[a.channel_id] ?? a.channel_id, title: a.title, url: a.url })),
    social_posts: posts.length,
    social_by_channel: Object.entries(posts.reduce((m: Record<string, number>, p) => ((m[chName[p.channel_id] ?? p.channel_id] = (m[chName[p.channel_id] ?? p.channel_id] ?? 0) + 1), m), {})).map(([channel, n]) => ({ channel, n })),
    // 写好了还没发的文章
    unpublished: unpublished(all(ctx, 'articles'), [...all(ctx, 'social_posts'), ...all(ctx, 'publications')]).length,
  }

  // 增长机会（growth.scan 每周算的）：还没处理的，按分数排前 10；流量下滑的页面另给汇总
  const growth = {
    open: all(ctx, 'growth_items').filter((i) => !i.status).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10)
      .map((i) => ({ priority: i.priority, title: i.title, why: i.why, next: i.next })),
    declining_pages: all(ctx, 'content_decay').filter((d) => d.status !== 'dismissed').length,
  }

  // 关键词（core 网站模块的 keywords，docs/keywords.md）：在做的词这一期排名涨了、掉了的（排名历史最近两条，最新一条在这一期里），
  // 这一期复查出结论的词，还有快赢、新机会没处理的个数。没有关键词表就是 null
  const kws = all(ctx, 'keywords')
  const changeAt = new Map(all(ctx, 'site_changes').map((c) => [c.id, Date.parse(c.reviewed_at || '') || 0]))
  const moves = kws.filter((k) => k.status === 'targeting').map((k) => {
    const h = parse(k.rank_history) as { d: string; p: number; s: string }[]
    const [a, b] = h.slice(-2)
    return a && b && inWindow(Date.parse(b.d) + DAY - 1) ? { keyword: k.keyword, from: a.p || null, to: b.p || null } : null
  }).filter(Boolean) as { keyword: string; from: number | null; to: number | null }[]
  const better = (m: { from: number | null; to: number | null }) => (m.to ?? 99) < (m.from ?? 99)
  const keywords = kws.length ? {
    targeting: kws.filter((k) => k.status === 'targeting').length,
    rank_up: moves.filter(better),
    rank_down: moves.filter((m) => (m.to ?? 99) > (m.from ?? 99)),
    reviewed: kws.filter((k) => k.review_verdict && inWindow(changeAt.get(k.change_id) ?? 0)).map((k) => ({ keyword: k.keyword, verdict: k.review_verdict, summary: k.review_summary })),
    quick_win: kws.filter((k) => k.bucket === 'quick_win' && k.status === 'idea').length,
    open: kws.filter((k) => k.bucket === 'open' && k.status === 'idea' && !k.topic_id).length,
  } : null

  // 上一期周报：和它比
  const period_start = ymd(start + DAY)
  const period_end = ymd(now)
  const prevReport = newest(all(ctx, 'reports') as Report[]).find((r) => r.period_end < period_start || (r.period_end <= period_end && r.period_start < period_start))
  const previous_report = prevReport
    ? { period_start: prevReport.period_start, period_end: prevReport.period_end, summary: prevReport.summary, highlights: parse(prevReport.highlights), suggestions: parse(prevReport.suggestions) }
    : null

  // 竞品本周动向（竞品模块）：这一期各家新上了哪些页面（没在盯的竞品、没有竞品模块就是 null）
  const competitorsModule = optional('competitors')
  const cw = competitorsModule ? competitorsModule.week({ days }, ctx) : { competitors: [] }
  const competitors = cw.competitors.length ? cw.competitors : null
  const out: Record<string, unknown> = { period_start, period_end, days, channels, ...(leadsModule ? { leads } : {}), search, geo, audits, changes: { reviewed, waiting }, content, growth, keywords, competitors, previous_report }

  // 转化（转化指标模块）：这一期和上一期同样长的一段，按天导入的注册、激活、付费
  const metrics = optional('metrics')
  if (metrics) {
    const prevEnd = ymd(start), prevStart = ymd(start - days * DAY + DAY)
    out.conversion = metrics.summary({ start: period_start, end: period_end }, ctx)
    out.previous_conversion = metrics.summary({ start: prevStart, end: prevEnd }, ctx)
  }
  // 增长机会和运营主题（运营主题模块）：周报要结合它们写
  if (optional('campaigns')) {
    out.profile = all(ctx, 'profile')[0] || {}
    out.opportunities = all(ctx, 'growth_opportunities')
    out.campaigns = all(ctx, 'campaigns')
  }
  return out
}

function parse(s?: string) {
  try {
    return JSON.parse(s || '[]')
  } catch {
    return []
  }
}

type SaveInput = {
  period_start: string
  period_end: string
  title: string
  summary: string
  body: string
  highlights?: unknown
  suggestions?: unknown
  chat_id?: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const asJSON = (k: string, v: unknown, ctx: any) => {
  if (v == null || v === '') return '[]'
  if (typeof v !== 'string') return JSON.stringify(v)
  try {
    JSON.parse(v)
  } catch {
    throw new Error(L(ctx, `${k} 要是 JSON 数组`, `${k} must be a JSON array`))
  }
  return v
}

export function save(input: SaveInput, ctx: any) {
  if (!DATE.test(input?.period_start ?? '') || !DATE.test(input?.period_end ?? '')) throw new Error(L(ctx, 'period_start / period_end 要写成 YYYY-MM-DD（用 reports.data 返回的）', 'period_start / period_end must be YYYY-MM-DD (use the ones reports.data returns)'))
  if (!input.title || !input.body) throw new Error(L(ctx, 'title、body 都要写', 'title and body are both required'))
  const body = {
    period_start: input.period_start,
    period_end: input.period_end,
    title: input.title,
    summary: input.summary || '',
    body: input.body,
    highlights: asJSON('highlights', input.highlights, ctx),
    suggestions: asJSON('suggestions', input.suggestions, ctx),
    // 「看助手怎么写的」：助手在对话里 annulo run 时，Annulo 带上了对话 id（ctx.chat_id）；老写法传进来的也认
    ...(ctx.chat_id || input.chat_id ? { chat_id: ctx.chat_id || input.chat_id } : {}),
  }
  const old = (ctx.db.query('reports', { where: { period_start: input.period_start, period_end: input.period_end }, limit: 1 }).list as Report[])[0]
  if (old) {
    ctx.db.update('reports', old.id, body)
    return { id: old.id, updated: true }
  }
  const r = ctx.db.insert('reports', { ...body, created_at: new Date().toISOString() })
  return { id: r.id, updated: false }
}
