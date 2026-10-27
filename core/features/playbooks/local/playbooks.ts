import { L } from './_i18n'

// 风格卡（表 playbooks，设计见 docs/playbooks.md）：拆解一个参考对象（参考博主 creator、竞品网站 competitor）得出的写法，写作和出选题时交给 AI 参考。
// 竞品的页面在模板的 competitors 表和 competitors.analysisContext 里（外贸），这里只认对象、存卡。
// 一个对象一张卡，重新拆解更新这张、version +1。拆解是任务 tasks/analyze-reference.md，这里只取数和存表：
//   playbooks.context({ subject_type?, subject_id })   拆解要读的：对象资料、最近的来源（有正文的在前）、已有的卡
//   playbooks.save({ subject_type?, subject_id, name, guide, … })   存卡（同一个对象已有就更新，没传的字段留着原来的）
//   playbooks.list({ subject_id? })    卡、用了几次（选题、文章上的 playbook_id）、拆完以后新收进来几条（new_sources）
//   playbooks.get({ id })    写作要的那几样（name、guide、标题公式、开场、fit、avoid）
//   playbooks.archive({ id, restore? })

type Row = { id: string; [k: string]: any }

const SUBJECTS: Record<string, string> = { creator: 'reference_creators', competitor: 'competitors' }
const MIN_SOURCES = 3
const MAX_SOURCES = 20

const text = (v: unknown) => String(v ?? '').trim()
const now = () => new Date().toISOString()
const parse = <T>(v: unknown, fallback: T): T => {
  if (Array.isArray(v)) return v as T
  try {
    return v ? JSON.parse(String(v)) : fallback
  } catch {
    return fallback
  }
}
const query = (ctx: any, table: string, where?: Record<string, unknown>): Row[] => {
  try {
    return ctx.db.query(table, { ...(where ? { where } : {}), limit: 1000 }).list
  } catch {
    return [] // 这个模板没有这张表（比如没有灵感库的模板）
  }
}

function subjectOf(ctx: any, input: { subject_type?: string; subject_id?: string }) {
  const type = text(input?.subject_type) || 'creator'
  const table = SUBJECTS[type]
  if (!table) throw new Error(L(ctx, `不认识的对象类型：${type}`, `Unknown subject type: ${type}`))
  const row: Row | null = input?.subject_id ? ctx.db.get(table, text(input.subject_id)) : null
  if (!row) throw new Error(L(ctx, '没有这个参考对象，请刷新后重试', 'Reference not found. Refresh and try again.'))
  return { type, row }
}

const cardOf = (ctx: any, type: string, id: string): Row | null =>
  query(ctx, 'playbooks', { subject_type: type, subject_id: id })[0] ?? null

/** 同一人物（person_key）的几个平台账号一起算 */
function creatorGroup(ctx: any, c: Row): Row[] {
  return c.person_key ? query(ctx, 'reference_creators', { person_key: c.person_key }) : [c]
}

export function context(input: { subject_type?: string; subject_id: string }, ctx: any) {
  const { type, row } = subjectOf(ctx, input)
  if (type === 'competitor') {
    // 竞品网站：页面清单和标题在模板的 competitors.analysisContext 里（任务里接着跑它），这里给对象和已有的卡
    const card = cardOf(ctx, type, row.id)
    return {
      subject: { type, id: row.id, name: row.name, url: row.url, host: row.host, reason: row.reason ?? '' },
      sources: [],
      sources_total: 0,
      enough: !!row.scanned_at && !row.error,
      min_sources: 0,
      next: `annulo run competitors.analysisContext --input '{"id":"${row.id}"}'`,
      playbook: card ? { ...card, title_patterns: parse(card.title_patterns, []), hooks: parse(card.hooks, []) } : null,
    }
  }
  const group = creatorGroup(ctx, row)
  const ids = new Set(group.map((c) => c.id))
  const sources = query(ctx, 'research_sources')
    .filter((s) => ids.has(s.creator_id) && s.library_status !== 'archived')
    .sort((a, b) => Number(!!text(b.content)) - Number(!!text(a.content)) || text(b.collected_at).localeCompare(text(a.collected_at)))
  const usable = sources.filter((s) => text(s.content) || text(s.summary))
  const card = cardOf(ctx, type, row.id)
  return {
    subject: {
      type,
      id: row.id,
      nickname: row.nickname,
      platform: row.platform,
      profile_url: row.profile_url,
      bio: row.bio,
      content_focus: row.content_focus,
      notes: row.notes,
      followers_count: row.followers_count,
      likes_count: row.likes_count,
      snapshot_at: row.snapshot_at,
      accounts: group.filter((c) => c.id !== row.id).map((c) => ({ platform: c.platform, nickname: c.nickname, profile_url: c.profile_url })),
    },
    sources: sources.slice(0, MAX_SOURCES).map((s) => ({
      id: s.id,
      title: s.title,
      source_title: s.source_title,
      url: s.url,
      platform: s.platform,
      format: s.format,
      content: s.content,
      summary: s.summary,
      hook: s.hook,
      why_save: s.why_save,
      notes: s.notes,
      image_count: parse<unknown[]>(s.images, []).length,
      tags: parse<string[]>(s.tags, []),
      likes: s.likes_count ?? null,
      collects: s.collects_count ?? null,
      comments: s.comments_count ?? null,
      published_at: s.published_at || '',
      collected_at: s.collected_at,
    })),
    sources_total: sources.length,
    enough: usable.length >= MIN_SOURCES,
    min_sources: MIN_SOURCES,
    playbook: card ? { ...card, title_patterns: parse(card.title_patterns, []), hooks: parse(card.hooks, []) } : null,
  }
}

type Pattern = { pattern: string; example?: string; source_id?: string }
const patterns = (v: unknown): Pattern[] =>
  parse<any[]>(v, [])
    .map((p) => (typeof p === 'string' ? { pattern: text(p) } : { pattern: text(p?.pattern), example: text(p?.example), source_id: text(p?.source_id) }))
    .filter((p) => p.pattern)
    .slice(0, 12)

export function save(
  input: {
    subject_type?: string
    subject_id: string
    name?: string
    guide?: string
    platform?: string
    content_type?: string
    summary?: string
    title_patterns?: Pattern[]
    hooks?: Pattern[]
    fit?: string
    avoid?: string
    example_source_ids?: string[]
  },
  ctx: any,
) {
  const { type, row } = subjectOf(ctx, input)
  const old = cardOf(ctx, type, row.id)
  const name = text(input?.name) || text(old?.name)
  const guide = text(input?.guide) || text(old?.guide)
  if (!name || !guide) throw new Error(L(ctx, '风格卡要有 name 和 guide', 'A playbook needs name and guide'))
  // 在对话里改一处时可以只传改了的字段：没传的留着原来的
  const keep = (k: keyof typeof input, v: () => unknown) => (input[k] === undefined && old ? old[k as string] ?? '' : v())
  const t = now()
  const data = {
    name,
    guide,
    subject_type: type,
    subject_id: row.id,
    platform: keep('platform', () => text(input.platform) || row.platform || (type === 'competitor' ? 'website' : '')),
    content_type: keep('content_type', () => text(input.content_type) || (type === 'competitor' ? 'article' : '')),
    summary: keep('summary', () => text(input.summary)),
    title_patterns: keep('title_patterns', () => JSON.stringify(patterns(input.title_patterns))),
    hooks: keep('hooks', () => JSON.stringify(patterns(input.hooks))),
    fit: keep('fit', () => text(input.fit)),
    avoid: keep('avoid', () => text(input.avoid)),
    example_source_ids: keep('example_source_ids', () =>
      JSON.stringify([...new Set(parse<string[]>(input.example_source_ids, []).map(text).filter(Boolean))].filter((id) => ctx.db.get('research_sources', id))),
    ),
    version: (Number(old?.version) || 0) + 1,
    status: 'active',
    generated_at: t,
    updated_at: t,
    ...(ctx.chat_id ? { chat_id: String(ctx.chat_id) } : {}),
  }
  if (old) ctx.db.update('playbooks', old.id, data)
  const id = old ? old.id : ctx.db.insert('playbooks', { ...data, created_at: t }).id
  return { id, version: data.version, updated: !!old }
}

export function list(input: { subject_id?: string }, ctx: any) {
  const uses: Record<string, number> = {}
  for (const t of [...query(ctx, 'topics'), ...query(ctx, 'articles')]) if (t.playbook_id) uses[t.playbook_id] = (uses[t.playbook_id] ?? 0) + 1
  // 拆完以后又收进来的（自动同步、手动收录）：页面上提示可以重新拆解
  const sources = query(ctx, 'research_sources').filter((s) => s.library_status !== 'archived')
  const pages = query(ctx, 'competitor_pages')
  const fresh = (p: Row) =>
    p.subject_type === 'competitor'
      ? pages.filter((x) => x.competitor_id === p.subject_id && text(x.first_seen) > text(p.generated_at)).length
      : sources.filter((s) => s.creator_id === p.subject_id && text(s.created_at || s.collected_at) > text(p.generated_at)).length
  return {
    playbooks: query(ctx, 'playbooks', input?.subject_id ? { subject_id: input.subject_id } : undefined)
      .sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)))
      .map((p) => ({ ...p, title_patterns: parse<Pattern[]>(p.title_patterns, []), hooks: parse<Pattern[]>(p.hooks, []), example_source_ids: parse<string[]>(p.example_source_ids, []), uses: uses[p.id] ?? 0, new_sources: fresh(p) })),
  }
}

/** 写作、出选题要的那几样；没有这张卡（或删了）返回 null，调用方照常写 */
export function forWriting(ctx: any, id?: string) {
  const p: Row | null = id ? query(ctx, 'playbooks').find((x) => x.id === id) ?? null : null
  if (!p) return null
  return {
    id: p.id,
    version: Number(p.version) || 1,
    name: p.name,
    platform: p.platform,
    content_type: p.content_type,
    guide: p.guide,
    title_patterns: parse(p.title_patterns, []),
    hooks: parse(p.hooks, []),
    fit: p.fit,
    avoid: p.avoid,
  }
}

export function get(input: { id: string }, ctx: any) {
  const p = forWriting(ctx, text(input?.id))
  if (!p) throw new Error(L(ctx, '没有这张风格卡', 'No such playbook'))
  return p
}

export function archive(input: { id: string; restore?: boolean }, ctx: any) {
  const p: Row | null = ctx.db.get('playbooks', text(input?.id))
  if (!p) throw new Error(L(ctx, '没有这张风格卡', 'No such playbook'))
  return ctx.db.update('playbooks', p.id, { status: input.restore ? 'active' : 'archived', updated_at: now() })
}
