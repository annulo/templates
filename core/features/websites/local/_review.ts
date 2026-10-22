// 改站复查的「上线」记录（文件名以 _ 开头：只给别的文件 import）。
// 体检问题被标成已解决（audit.ts）、文章发布（content.ts）、改标题描述点了「已上线」、补内容推了预览（review.track）时调 trackChange，
// 建一条 site_changes（等数据），相关的关键词挂上（_keyword_track.ts）；review.check 到期对比改动前后 14 天，写结论。

import { L } from './_i18n'
import { linkKeywords } from './_keyword_track'

export const REVIEW_DELAY_DAYS = 17 // GSC 延迟约 3 天 + 改动后 14 天的窗口
export const WINDOW_DAYS = 14

export type ChangeKind = 'issue_fix' | 'search_meta' | 'search_content' | 'article'
const REF_TABLE: Record<ChangeKind, string> = { issue_fix: 'site_issues', search_meta: 'search_pages', search_content: 'search_pages', article: 'articles' }

export function trackChange(
  ctx: any,
  c: { kind: ChangeKind; ref_id: string; channel_id: string; title: string; pages: string[]; live_at?: string },
) {
  const waiting = ctx.db.query('site_changes', { where: { ref_id: c.ref_id, status: 'waiting' }, limit: 5 }).list
  if (waiting.length) return waiting[0]
  const live = c.live_at ? new Date(c.live_at) : new Date()
  if (isNaN(live.getTime())) throw new Error(L(ctx, '上线时间不对：', 'Invalid go-live time: ') + c.live_at)
  const now = new Date().toISOString()
  const row = ctx.db.insert('site_changes', {
    channel_id: c.channel_id,
    kind: c.kind,
    ref_table: REF_TABLE[c.kind],
    ref_id: c.ref_id,
    title: c.title,
    pages: JSON.stringify(c.pages.filter(Boolean).slice(0, 50)),
    live_at: live.toISOString(),
    review_at: new Date(live.getTime() + REVIEW_DELAY_DAYS * 86400_000).toISOString(),
    status: 'waiting',
    created_at: now,
  })
  // 这次改动对应的关键词挂上，复查时各自出结论（docs/keywords.md「闭环」）；出错不影响记改动
  try {
    linkKeywords(ctx, row)
  } catch (e: any) {
    ctx.log(L(ctx, '关键词没挂上这次改动：', 'Could not link keywords to this change: ') + (e?.message ?? e))
  }
  return row
}
