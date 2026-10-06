import { L } from './_i18n'
import { brief, profile } from './_profile'

// 选题（本机函数）。AI 出选题由任务 tasks/suggest-ideas.md 交给助手做，这里只取数、存表。
//
//   ideas.context({ hint? })     出选题要的上下文：定位、已有的选题和稿件标题（别重复）
//   ideas.save({ ideas })         存一批选题 [{ title, angle?, notes? }]，标题重复的跳过

export function context(input: { hint?: string }, ctx: any) {
  const ideas = ctx.db.query('ideas', { limit: 500 }).list
  const drafts = ctx.db.query('drafts', { limit: 500 }).list
  return {
    profile: brief(profile(ctx)),
    hint: String(input?.hint ?? '').trim(),
    existing: [...ideas.map((i: any) => i.title), ...drafts.map((d: any) => d.title)].filter(Boolean),
  }
}

export function save(input: { ideas: { title: string; angle?: string; notes?: string }[] }, ctx: any) {
  const list = Array.isArray(input?.ideas) ? input.ideas : []
  if (!list.length) throw new Error(L(ctx, '要给出 ideas：[{ title, angle }]', 'ideas is required: [{ title, angle }]'))
  const have = new Set(ctx.db.query('ideas', { limit: 1000 }).list.map((i: any) => String(i.title).trim()))
  const now = new Date().toISOString()
  const saved: string[] = []
  for (const it of list) {
    const title = String(it?.title ?? '').trim()
    if (!title || have.has(title)) continue
    ctx.db.insert('ideas', { title, angle: String(it.angle ?? '').trim(), notes: String(it.notes ?? '').trim(), status: 'idea', source: 'ai', created_at: now, updated_at: now })
    have.add(title)
    saved.push(title)
  }
  return { saved: saved.length, titles: saved }
}
