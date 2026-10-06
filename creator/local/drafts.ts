import { L } from './_i18n'
import { brief, profile } from './_profile'

// 稿件（本机函数）。写初稿、改稿由任务 tasks/write-draft.md、revise-draft.md 交给助手做，这里只取数、存表。
//
//   drafts.context({ idea_id? , draft_id? })   写稿 / 改稿要的上下文：定位、选题、现在的稿件
//   drafts.save({ draft_id?, idea_id?, title, summary?, body })   存稿件：带 draft_id 是改那一篇，不带是新建（选题标成 drafting）
//   drafts.source({ id })                      给社媒插件的写作任务用（social/write-<平台> 的 source.fn）：要改写的内容

export const cloud = ['source']

function get(ctx: any, table: string, id: string | undefined, what: [string, string]) {
  if (!id) return null
  const row = ctx.db.get(table, id)
  if (!row) throw new Error(L(ctx, `没有这个${what[0]}：`, `No such ${what[1]}: `) + id)
  return row
}

export function context(input: { idea_id?: string; draft_id?: string }, ctx: any) {
  const draft = get(ctx, 'drafts', input?.draft_id, ['稿件', 'draft'])
  const idea = get(ctx, 'ideas', input?.idea_id ?? draft?.idea_id, ['选题', 'idea'])
  if (!draft && !idea) throw new Error(L(ctx, '要给出 idea_id（写初稿）或 draft_id（改稿）', 'Give idea_id (new draft) or draft_id (revise)'))
  return {
    profile: brief(profile(ctx)),
    idea: idea && { id: idea.id, title: idea.title, angle: idea.angle ?? '', notes: idea.notes ?? '' },
    draft: draft && { id: draft.id, title: draft.title, summary: draft.summary ?? '', body: draft.body ?? '' },
  }
}

export function save(input: { draft_id?: string; idea_id?: string; title: string; summary?: string; body: string }, ctx: any) {
  const title = String(input?.title ?? '').trim()
  const body = String(input?.body ?? '').trim()
  if (!title || !body) throw new Error(L(ctx, '标题和正文都要写', 'Both title and body are required'))
  const now = new Date().toISOString()
  const fields = { title, summary: String(input.summary ?? '').trim(), body, updated_at: now }
  if (input.draft_id) {
    get(ctx, 'drafts', input.draft_id, ['稿件', 'draft'])
    ctx.db.update('drafts', input.draft_id, fields)
    return { draft_id: input.draft_id }
  }
  const idea = get(ctx, 'ideas', input.idea_id, ['选题', 'idea'])
  const row = ctx.db.insert('drafts', { ...fields, status: 'draft', idea_id: idea?.id ?? '', created_at: now })
  if (idea) ctx.db.update('ideas', idea.id, { status: 'drafting', updated_at: now })
  return { draft_id: row.id }
}

/** Markdown 变成纯文本：去掉图片、链接只留文字、去掉标记 */
function plain(md: string) {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function source(input: { id: string }, ctx: any) {
  const d = get(ctx, 'drafts', input?.id, ['稿件', 'draft'])
  if (!d) throw new Error(L(ctx, '要给出 id', 'id is required'))
  const body = String(d.body ?? '')
  const images = [...body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)[^)]*\)/g)].map((m) => m[1])
  return {
    id: d.id,
    title: d.title,
    summary: d.summary ?? '',
    text: plain(body).slice(0, 8000),
    url: /^https?:\/\//.test(d.url ?? '') ? d.url : '',
    images,
    project: brief(profile(ctx)),
  }
}
