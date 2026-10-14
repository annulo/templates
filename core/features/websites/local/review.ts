import { L } from './_i18n'
import { visitsBetween } from './_creght'
import { DAY, notConnected, query, ymd } from './_gsc'
import { trackChange, WINDOW_DAYS, type ChangeKind } from './_review'

// 要电脑的（浏览器、本机授权、密钥、外部接口）：手机上点了转给电脑上开着的 Shuttle 跑（设置 → 远程访问）
export const remote = ['check', 'track']

// 改站复查（本机函数）：改动上线一段时间后，对比改动前后的数据，写结论。PRD 里「看数据 → 改站 → 复查」的最后一环。
//
//   review.track({ kind, ref_id, channel_id, title?, pages?, live_at? })   记一次上线的改动（体检修复、文章发布会自动记，这个给「已上线，开始复查」按钮和助手补完内容用）
//                                                                        kind：issue_fix / search_meta（改标题描述）/ search_content（补内容）/ article
//   review.check({ id? })                                                到期的改动逐条复查（定时任务每天 09:00 跑一次）
//
// 口径（写死在代码里，不调模型）：
//   改动前 = 上线前 14 天；改动后 = 上线 3 天后起的 14 天（GSC 有 2~3 天延迟，也给搜索引擎一点重新抓取的时间）。
//   数据优先用 GSC（渠道关联了属性、连了 Google）：涉及页面的点击、曝光、点击率、平均排名之和；
//   没有 GSC 用 creght 访问统计里这些页面的 PV。
//   结论：主指标（GSC 用点击，没有 GSC 用 PV）变化超过 +15% 算 better、低于 -15% 算 worse，其余 flat；
//   GSC 下点击掉了但曝光也同比例掉（点击率没降，± 15% 以内）时算 flat：是搜索量整体变了，不是改动的问题。
//   两边都没数据（样本太小：前后点击或 PV 加起来 < 10）算 no_data。

type Change = { id: string; channel_id: string; kind: ChangeKind; ref_id: string; title: string; pages?: string; live_at: string; review_at: string; status: string }
type Channel = { id: string; name: string; project_id?: string; site_id?: string; gsc_property?: string }
type Metrics = { source: 'gsc' | 'visits'; start: string; end: string; clicks?: number; impressions?: number; ctr?: number; position?: number; pv?: number }

const KINDS: ChangeKind[] = ['issue_fix', 'search_meta', 'search_content', 'article']
const THRESHOLD = 0.15
const MIN_SAMPLE = 10

export function track(input: { kind: ChangeKind; ref_id: string; channel_id: string; title?: string; pages?: string[]; live_at?: string }, ctx: any) {
  if (!KINDS.includes(input?.kind)) throw new Error(L(ctx, 'kind 要是 ', 'kind must be ') + KINDS.join(' / '))
  if (!input.ref_id || !input.channel_id) throw new Error(L(ctx, '缺 ref_id 或 channel_id', 'Missing ref_id or channel_id'))
  const ch: Channel | null = ctx.db.get('channels', input.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input.channel_id)
  let title = input.title ?? ''
  let pages = input.pages ?? []
  // 改标题描述、补内容：都是 search_pages 的一个页面，对比方式一样（前后的点击、排名）
  if (input.kind === 'search_meta' || input.kind === 'search_content') {
    const p = ctx.db.get('search_pages', input.ref_id)
    if (!p) throw new Error(L(ctx, '没有这个页面记录：', 'No such page record: ') + input.ref_id)
    pages = pages.length ? pages : [p.page]
    const path = p.page.replace(/^https?:\/\/[^/]+/, '') || '/'
    title = title || (input.kind === 'search_meta' ? L(ctx, `改了标题和描述：${path}`, `Changed title and description: ${path}`) : L(ctx, `补了内容：${path}`, `Added content: ${path}`))
    ctx.db.update('search_pages', p.id, { status: 'live' })
  }
  if (!title) throw new Error(L(ctx, '缺 title：一句话说改了什么', 'Missing title: one sentence on what changed'))
  return trackChange(ctx, { kind: input.kind, ref_id: input.ref_id, channel_id: ch.id, title, pages, live_at: input.live_at })
}

function pagesOf(c: Change): string[] {
  try {
    const v = JSON.parse(c.pages ?? '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** GSC：每个页面按 page 过滤查一次（一组 filters 里是 AND，没法一次 OR），加起来；排名按曝光加权 */
async function gscMetrics(ctx: any, property: string, pages: string[], startMs: number, endMs: number): Promise<Metrics> {
  const m: Metrics = { source: 'gsc', start: ymd(startMs), end: ymd(endMs), clicks: 0, impressions: 0, ctr: 0, position: 0 }
  let posW = 0
  for (const page of pages.slice(0, 20)) {
    const rows = await query(ctx, property, { start: m.start, end: m.end, dimensions: ['page'], rowLimit: 10, page })
    for (const r of rows) {
      m.clicks! += r.clicks
      m.impressions! += r.impressions
      posW += r.position * r.impressions
    }
  }
  m.ctr = m.impressions ? Math.round((m.clicks! / m.impressions) * 10000) / 10000 : 0
  m.position = m.impressions ? Math.round((posW / m.impressions) * 10) / 10 : 0
  return m
}

/** creght 访问统计：breakdowns.url 里命中这些页面路径的 PV 之和 */
async function visitMetrics(ctx: any, ch: Channel, pages: string[], startMs: number, endMs: number): Promise<Metrics> {
  const r = await visitsBetween(ctx, ch.project_id!, ch.site_id!, startMs, endMs, 200)
  const want = new Set(pages.map((p) => pathOf(p)))
  const pv = (r?.breakdowns?.url ?? []).filter((x: any) => want.has(pathOf(x.key))).reduce((s: number, x: any) => s + (x.pv_count ?? 0), 0)
  return { source: 'visits', start: ymd(startMs), end: ymd(endMs - DAY), pv } // endMs 是开区间（次日零点）
}

function pathOf(u: string): string {
  try {
    const p = new URL(u, 'https://x').pathname.replace(/\/+$/, '')
    return p || '/'
  } catch {
    return u
  }
}

const pct = (a: number, b: number) => (b ? (a - b) / b : a ? 1 : 0)
const fmtPct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`

function judge(before: Metrics, after: Metrics, ctx: any): { verdict: 'better' | 'flat' | 'worse' | ''; summary: string } {
  if (before.source === 'gsc') {
    const b = before.clicks ?? 0, a = after.clicks ?? 0
    if (a + b < MIN_SAMPLE && (after.impressions ?? 0) + (before.impressions ?? 0) < MIN_SAMPLE * 10) return { verdict: '', summary: '' }
    const dc = pct(a, b), di = pct(after.impressions ?? 0, before.impressions ?? 0), dr = pct(after.ctr ?? 0, before.ctr ?? 0)
    let verdict: 'better' | 'flat' | 'worse' = dc > THRESHOLD ? 'better' : dc < -THRESHOLD ? 'worse' : 'flat'
    // 点击掉了，但点击率没掉：搜索量整体变少，不怪改动
    if (verdict === 'worse' && Math.abs(dr) <= THRESHOLD) verdict = 'flat'
    const word = ({ better: L(ctx, '变好了', 'Better'), flat: L(ctx, '没有明显变化', 'No clear change'), worse: L(ctx, '变差了', 'Worse') } as const)[verdict]
    const why = verdict === 'flat' && dc < -THRESHOLD ? L(ctx, '（曝光同步下降，点击率基本没变，是搜索量整体变少）', ' (impressions fell too while CTR held, so overall search volume dropped)') : ''
    return { verdict, summary: L(ctx, `${word}：点击 ${b} → ${a}（${fmtPct(dc)}），曝光 ${fmtPct(di)}，点击率 ${((before.ctr ?? 0) * 100).toFixed(1)}% → ${((after.ctr ?? 0) * 100).toFixed(1)}%，排名 ${before.position || '-'} → ${after.position || '-'}${why}`, `${word}: clicks ${b} → ${a} (${fmtPct(dc)}), impressions ${fmtPct(di)}, CTR ${((before.ctr ?? 0) * 100).toFixed(1)}% → ${((after.ctr ?? 0) * 100).toFixed(1)}%, position ${before.position || '-'} → ${after.position || '-'}${why}`) }
  }
  const b = before.pv ?? 0, a = after.pv ?? 0
  if (a + b < MIN_SAMPLE) return { verdict: '', summary: '' }
  const d = pct(a, b)
  const verdict = d > THRESHOLD ? 'better' : d < -THRESHOLD ? 'worse' : 'flat'
  return { verdict, summary: L(ctx, `${({ better: L(ctx, '变好了', 'Better'), flat: L(ctx, '没有明显变化', 'No clear change'), worse: L(ctx, '变差了', 'Worse') } as const)[verdict]}：页面访问 ${b} → ${a}（${fmtPct(d)}，按 creght 访问统计；关联 Search Console 后能看到搜索点击）`, `${({ better: L(ctx, '变好了', 'Better'), flat: L(ctx, '没有明显变化', 'No clear change'), worse: L(ctx, '变差了', 'Worse') } as const)[verdict]}: page visits ${b} → ${a} (${fmtPct(d)}, from creght visit stats; link Search Console to see search clicks)`) }
}

async function reviewOne(c: Change, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', c.channel_id)
  const pages = pagesOf(c)
  const now = new Date().toISOString()
  if (!ch || !pages.length) {
    ctx.db.update('site_changes', c.id, { status: 'no_data', summary: !ch ? L(ctx, '渠道已经删了', 'The channel was deleted') : L(ctx, '没有记录涉及哪些页面，没法对比', 'No pages were recorded, so there is nothing to compare'), reviewed_at: now })
    return 'no_data'
  }
  const live = Date.parse(c.live_at)
  const before = { start: live - WINDOW_DAYS * DAY, end: live - DAY }
  const after = { start: live + 3 * DAY, end: live + (3 + WINDOW_DAYS - 1) * DAY }
  let b: Metrics | null = null, a: Metrics | null = null
  if (ch.gsc_property) {
    try {
      b = await gscMetrics(ctx, ch.gsc_property, pages, before.start, before.end)
      a = await gscMetrics(ctx, ch.gsc_property, pages, after.start, after.end)
    } catch (e: any) {
      if (!notConnected(e)) ctx.log(L(ctx, `「${c.title}」读 GSC 失败，改用访问统计：`, `Reading GSC for "${c.title}" failed, using visit stats instead: `) + e.message)
      b = a = null
    }
  }
  let res = b && a ? judge(b, a, ctx) : { verdict: '' as const, summary: '' }
  if (!res.verdict && ch.project_id && ch.site_id) {
    b = await visitMetrics(ctx, ch, pages, before.start, before.end + DAY)
    a = await visitMetrics(ctx, ch, pages, after.start, after.end + DAY)
    res = judge(b, a, ctx)
  }
  if (!res.verdict) {
    ctx.db.update('site_changes', c.id, { status: 'no_data', before: b ? JSON.stringify(b) : '', after: a ? JSON.stringify(a) : '', summary: L(ctx, '改动前后这些页面的访问和搜索数据都太少，看不出效果', 'Too little visit and search data before and after the change to tell'), reviewed_at: now })
    return 'no_data'
  }
  ctx.db.update('site_changes', c.id, { status: 'reviewed', before: JSON.stringify(b), after: JSON.stringify(a), verdict: res.verdict, summary: res.summary, reviewed_at: now })
  return res.verdict
}

export async function check(input: { id?: string }, ctx: any) {
  const all: Change[] = ctx.db.query('site_changes', { where: input?.id ? { id: input.id } : { status: 'waiting' }, limit: 500 }).list
  const due = input?.id ? all : all.filter((c) => Date.parse(c.review_at) <= Date.now())
  const out: Record<string, number> = {}
  for (const [i, c] of due.entries()) {
    ctx.progress({ done: i, total: due.length, message: L(ctx, '复查：', 'Reviewing: ') + c.title })
    const v = await reviewOne(c, ctx)
    out[v] = (out[v] ?? 0) + 1
  }
  return { checked: due.length, ...out, waiting: all.length - due.length }
}
