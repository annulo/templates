// 关键词的闭环（文件名以 _ 开头：只给 _review.ts、review.ts import）：词 → 页面上线 → 17 天后这个词的排名变没变。设计见 docs/keywords.md「闭环」。
//
// 改动上线时（trackChange）linkKeywords 把相关的词挂到这条改动上：
//   - 发布文章：选题 → 文章，转成这个选题的词（keywords.topic_id = 文章的 topic_id）；
//   - 改标题描述、补内容：这个页面（search_pages）的词——search_page_id 一样，或者目标页面、曝光最多的页面就是它。
//   挂上的词记 change_id、live_at、目标页面（没有的话），标成在做；以前的复查结论清掉。
// 复查时（review.check）reviewKeywords 按每个词读 GSC 改动前后 14 天，写这个词自己的结论（页面整体的结论照旧在 site_changes）。

import { L } from './_i18n'
import { query, ymd } from './_gsc'
import { keywordVerdict, samePage, type KwMetrics } from './_keywords'

type Change = { id: string; channel_id: string; kind: string; ref_id: string; pages?: string; live_at: string }
type Kw = { id: string; channel_id: string; keyword: string; status?: string; topic_id?: string; target_page?: string; gsc_page?: string; search_page_id?: string; change_id?: string }

const MAX_REVIEW = 30 // 一条改动最多复查几个词（每个词两次 GSC 请求）

function keywordsOf(ctx: any, channelId: string): Kw[] {
  try {
    return ctx.db.query('keywords', { where: { channel_id: channelId }, limit: 1000 }).list ?? []
  } catch {
    return [] // 没有关键词表（老项目、没开这个功能）
  }
}

function pagesOf(c: Change): string[] {
  try {
    const v = JSON.parse(c.pages ?? '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** 改动上线：把相关的词挂上。只管文章和搜索页面的改动（体检修复多是全站的事，不按词算）。返回挂了几个 */
export function linkKeywords(ctx: any, c: Change): number {
  if (!['article', 'search_meta', 'search_content'].includes(c.kind)) return 0
  const pages = pagesOf(c)
  const all = keywordsOf(ctx, c.channel_id).filter((k) => k.status !== 'dismissed' && k.status !== 'raw')
  let hit: Kw[] = []
  if (c.kind === 'article') {
    const topic = ctx.db.get('articles', c.ref_id)?.topic_id
    hit = topic ? all.filter((k) => k.topic_id === topic) : []
  } else {
    hit = all.filter((k) => k.search_page_id === c.ref_id || pages.some((p) => samePage(p, k.target_page) || samePage(p, k.gsc_page)))
  }
  for (const k of hit)
    ctx.db.update('keywords', k.id, {
      change_id: c.id, live_at: c.live_at, ...(k.target_page ? {} : { target_page: pages[0] ?? '' }),
      ...(c.kind === 'article' ? { article_id: c.ref_id } : {}),
      status: 'targeting', review_verdict: '', review_summary: '', review_before: '', review_after: '',
    })
  return hit.length
}

async function metrics(ctx: any, property: string, keyword: string, start: number, end: number): Promise<KwMetrics> {
  const rows = await query(ctx, property, { start: ymd(start), end: ymd(end), dimensions: ['query'], query: keyword, rowLimit: 5 })
  const r = rows[0]
  return { clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0, position: r ? Math.round(r.position * 10) / 10 : 0 }
}

const pos = (m: KwMetrics) => (m.impressions ? String(m.position) : '-')

/** 复查一条改动时，给挂在它上面的词各写一句结论。before / after 是和页面复查同样的两段时间 */
export async function reviewKeywords(ctx: any, c: Change, property: string, before: { start: number; end: number }, after: { start: number; end: number }) {
  const list = keywordsOf(ctx, c.channel_id).filter((k) => k.change_id === c.id).slice(0, MAX_REVIEW)
  for (const k of list) {
    const b = await metrics(ctx, property, k.keyword, before.start, before.end)
    const a = await metrics(ctx, property, k.keyword, after.start, after.end)
    const v = keywordVerdict(b, a)
    const word = v ? ({ better: L(ctx, '变好了', 'Better'), flat: L(ctx, '没有明显变化', 'No clear change'), worse: L(ctx, '变差了', 'Worse') } as const)[v] : L(ctx, '前后都没有曝光', 'No impressions before or after')
    const summary = L(ctx, `${word}：排名 ${pos(b)} → ${pos(a)}，曝光 ${b.impressions} → ${a.impressions}，点击 ${b.clicks} → ${a.clicks}`, `${word}: position ${pos(b)} → ${pos(a)}, impressions ${b.impressions} → ${a.impressions}, clicks ${b.clicks} → ${a.clicks}`)
    ctx.db.update('keywords', k.id, { review_verdict: v || 'no_data', review_summary: summary, review_before: JSON.stringify(b), review_after: JSON.stringify(a), seen: false })
  }
  return list.length
}
