// 选题的取数和存表（本机函数）。出选题本身交给助手按任务 tasks/suggest-topics.md 做（过程在对话里看得见、要求用户可改），
// 这里只管给它上下文、把它想好的选题去重存进 topics。
//
//   topics.context({})       我的定位、已有选题、最近发出去的帖子和它们的互动（哪类内容反响好）
//   topics.save({ ideas: [{ title, angle, keywords }], source? })   去掉和已有选题重复的，写进 topics（status=idea），返回存了哪些

import { L } from './_i18n'
import { profile, projectBrief } from './_ai'

type Topic = { id: string; title: string; status?: string }
type Idea = { title: string; angle: string; keywords: string }

export function context(_input: {}, ctx: any) {
  const project = profile(ctx)
  const existing: Topic[] = ctx.db.query('topics', { limit: 500 }).list
  let recent: any[] = []
  try {
    recent = ctx.db
      .query('social_posts', { where: { status: 'published' }, limit: 200 })
      .list.sort((a: any, b: any) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')))
      .slice(0, 30)
      .map((p: any) => ({ title: p.title, views: p.views ?? 0, likes: p.likes ?? 0, comments: p.comments ?? 0 }))
  } catch {
    // 社媒插件还没装
  }
  return {
    project,
    brief: projectBrief(project),
    existing: existing.map((t) => ({ title: t.title, status: t.status })),
    recent_posts: recent,
  }
}

export function save(input: { ideas: Idea[]; source?: string }, ctx: any) {
  const existing: Topic[] = ctx.db.query('topics', { limit: 500 }).list
  const seen = new Set(existing.map((t) => t.title.trim()))
  const saved: string[] = []
  const skipped: string[] = []
  for (const x of input?.ideas ?? []) {
    const title = String(x?.title ?? '').trim()
    if (!title) continue
    if (seen.has(title)) {
      skipped.push(title)
      continue
    }
    seen.add(title)
    ctx.db.insert('topics', { title, angle: String(x?.angle ?? '').trim(), keywords: String(x?.keywords ?? '').trim(), source: 'agent', status: 'idea' })
    saved.push(title)
  }
  if (!saved.length) throw new Error(L(ctx, '一个都没存：没有标题，或者都和已有选题重复了', 'Nothing saved: no titles, or all duplicate existing topics'))
  return { saved, skipped }
}
