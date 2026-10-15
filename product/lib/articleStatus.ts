export type ContentStatus = 'draft' | 'published'

/** 手动状态用于内容管理；自动状态沿用文章和真实发布记录。 */
export function articleStatus(a: { status?: string; manual_status?: string }, hasPublished: boolean): ContentStatus {
  if (a.manual_status === 'draft' || a.manual_status === 'published') return a.manual_status
  return hasPublished || a.status === 'published' ? 'published' : 'draft'
}
