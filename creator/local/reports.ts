// 运营周报的数字和存档（本机函数）。周报的解读和建议由助手写（任务 tasks/weekly-report.md：每 7 天定时，或周报页点按钮），
// 数字不让助手自己查表加总：一律从这里拿，和各页面显示的是同一份。
//
//   reports.data({ days? })   这一期要用的全部数字：各社媒账号的数据、发布的内容，和上一期周报
//   reports.save({ period_start, period_end, title, summary, body, highlights?, suggestions? })  出自哪段对话：读 ctx.chat_id，不用传
//                             存一期周报；同一周期已有就更新，不重复建
//
//   命令行：annulo run reports.data --input '{"days":7}'

import { L } from './_i18n'
import { stats as channelStats } from './channels'

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
  for (const c of all(ctx, 'social_accounts')) chName[c.id] = c.name

  // 社媒：近 days 天（社交媒体页、总览同一份）；读失败的在 failed，不当 0
  let channels: any
  try {
    channels = await channelStats({ days }, ctx)
  } catch (e: any) {
    channels = { error: e.message }
  }

  // 这一期发出去的内容
  const articles = all(ctx, 'articles').filter((a) => a.status === 'published' && inWindow(Date.parse(a.published_at || '') || 0))
  const posts = all(ctx, 'social_posts').filter((p) => p.status === 'published' && inWindow(Date.parse(p.published_at || '') || 0))
  const content = {
    articles: articles.map((a) => ({ title: a.title, url: a.url })),
    social_posts: posts.length,
    social_by_channel: Object.entries(posts.reduce((m: Record<string, number>, p) => ((m[chName[p.channel_id] ?? p.channel_id] = (m[chName[p.channel_id] ?? p.channel_id] ?? 0) + 1), m), {})).map(([channel, n]) => ({ channel, n })),
    pending_review: all(ctx, 'articles').filter((a) => a.status === 'pending_review').length + all(ctx, 'social_posts').filter((p) => p.status === 'pending_review').length,
  }

  // 上一期周报：和它比
  const period_start = ymd(start + DAY)
  const period_end = ymd(now)
  const prevReport = newest(all(ctx, 'reports') as Report[]).find((r) => r.period_end < period_start || (r.period_end <= period_end && r.period_start < period_start))
  const previous_report = prevReport
    ? { period_start: prevReport.period_start, period_end: prevReport.period_end, summary: prevReport.summary, highlights: parse(prevReport.highlights), suggestions: parse(prevReport.suggestions) }
    : null

  return { period_start, period_end, days, channels, content, previous_report }
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
  if (!input.title || !input.summary || !input.body) throw new Error(L(ctx, 'title、summary、body 都要写', 'title, summary and body are all required'))
  const body = {
    period_start: input.period_start,
    period_end: input.period_end,
    title: input.title,
    summary: input.summary,
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
