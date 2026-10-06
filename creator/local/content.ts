import { L } from './_i18n'
import { profile, projectBrief } from './_ai'

const json = <T,>(value: unknown, fallback: T): T => { try { return typeof value === 'string' ? (value ? JSON.parse(value) : fallback) : ((value as T) ?? fallback) } catch { return fallback } }
function requireRow(ctx: any, table: string, id: string) {
  const row = id ? ctx.db.get(table, id) : null
  if (!row) throw new Error(L(ctx, `找不到这条记录：${id}`, `Record not found: ${id}`))
  return row
}

/** 选题中的简报：只存用户填写的内容。 */
export function saveBrief(input: { topic_id: string; title: string; angle?: string; keywords?: string; brief: any }, ctx: any) {
  const topic = requireRow(ctx, 'topics', input.topic_id)
  if (!input.title?.trim()) throw new Error(L(ctx, '请填写选题', 'Enter a topic title.'))
  const b = input.brief || {}
  const brief: any = {}
  for (const key of ['audience', 'buyer_question', 'outline', 'language', 'channels', 'cta', 'gaps']) brief[key] = String(b[key] || '').trim()
  ctx.db.update('topics', topic.id, { title: input.title.trim(), angle: String(input.angle || '').trim(), keywords: String(input.keywords || '').trim(), brief: JSON.stringify(brief) })
  return { topic_id: topic.id }
}

// 文章（本机函数，Annulo 在用户电脑上执行，不经过模型）。
//
//   content.context({ topic_id? })              写文章要的上下文：我的定位、选题（没给就列出选题池让助手挑）、写过的标题、能配的图
//   content.images({})                           能配进文章的图（资料库的图片），改文章时配图用
//   content.save({ topic_id, title, summary, keywords, body })
//                                                 存一篇写好的文章（待审），选题标成已写。写文章本身由助手按任务 tasks/write-article.md 做
//   content.update({ article_id, title?, summary?, keywords?, body? })
//                                                 改一篇文章（助手按任务 tasks/revise-article.md 改完用它存）；没发布的改完回到待审
//   content.socialSource({ id })                 社媒插件的写作任务取文章内容用（见下）

type Article = { id: string; title: string; summary?: string; body?: string; keywords?: string; slug?: string; status: string; url?: string }

export function images(_input: {}, ctx: any) {
  return { images: imagesOf(ctx) }
}

/** 能配进文章的图：资料库的图片（名称、说明、标签帮助挑）。只用这些，不去外站找图、不盗链 */
function imagesOf(ctx: any) {
  const out: { url: string; name: string; text?: string; tags?: string; from: string }[] = []
  try {
    for (const a of ctx.db.query('assets', { where: { kind: 'image' }, limit: 200 }).list)
      if (/^https?:\/\//.test(a.url ?? '')) out.push({ url: a.url, name: a.name ?? '', text: a.text ?? '', tags: a.tags ?? '', from: 'assets' })
  } catch {}
  return out.slice(0, 120)
}

/** 写文章要的上下文（任务 tasks/write-article.md 里助手先跑它）：给了选题就是那个选题，没给就列出选题池让助手挑 */
export function context(input: { topic_id?: string }, ctx: any) {
  const project = profile(ctx)
  const topics: any[] = ctx.db.query('topics', { limit: 500 }).list
  const topic = input?.topic_id ? topics.find((t) => t.id === input.topic_id) : null
  if (input?.topic_id && !topic) throw new Error(L(ctx, '没有这个选题：', 'No such topic: ') + input.topic_id)
  const ideas = topic ? [] : topics.filter((t) => t.status === 'idea').map((t) => ({ id: t.id, title: t.title, angle: t.angle ?? '', keywords: t.keywords ?? '' }))
  if (!topic && !ideas.length) throw new Error(L(ctx, '选题池是空的：先点「出选题」', 'The topic pool is empty: click "Suggest topics" first'))
  const written: any[] = ctx.db.query('articles', { limit: 200 }).list
  return {
    project: projectBrief(project),
    topic: topic ? { id: topic.id, title: topic.title, angle: topic.angle ?? '', keywords: topic.keywords ?? '', brief: json(topic.brief, null) } : null,
    ideas,
    written_titles: written.map((a) => a.title),
    // 能配进正文的图（资料库）：挑和段落内容对得上的插 <img>，没有合适的就不配
    images: imagesOf(ctx),
  }
}

type Fields = { title?: string; summary?: string; slug?: string; keywords?: string; body?: string }
type SaveInput = Fields & { topic_id: string; title: string; body: string }

const cleanSlug = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

/** 文章字段的校验：标题不能空、正文要是 HTML 且像一篇写完的文章。只校验传了的字段 */
function checkFields(f: Fields, ctx: any) {
  if (f.title !== undefined && !String(f.title).trim()) throw new Error(L(ctx, '缺标题（title）', 'Missing title'))
  if (f.body !== undefined) {
    const body = String(f.body).trim()
    if (body.length < 200) throw new Error(L(ctx, '正文（body）太短了，不像一篇写完的文章', 'The body is too short to be a finished article'))
    if (/^\s*#{1,6}\s|\n#{1,6}\s/.test(body) && !/<(p|h2|h3)[\s>]/i.test(body)) throw new Error(L(ctx, '正文要用 HTML（<h2> <p> <ul> …），不是 Markdown', 'The body must be HTML (<h2> <p> <ul> …), not Markdown'))
  }
}

/** 存一篇写好的文章，状态待审；选题标成已写。字段不对就报错，别让坏数据进表 */
export function save(input: SaveInput, ctx: any) {
  const topic = ctx.db.get('topics', input?.topic_id)
  if (!topic) throw new Error(L(ctx, 'topic_id 不对：没有这个选题', 'Bad topic_id: no such topic'))
  checkFields({ title: input.title ?? '', body: input.body ?? '' }, ctx)
  const title = String(input.title).trim()
  const article = ctx.db.insert('articles', {
    topic_id: topic.id,
    title,
    summary: String(input.summary ?? ''),
    slug: cleanSlug(input.slug),
    keywords: String(input.keywords ?? ''),
    body: String(input.body).trim(),
    status: 'draft',
  })
  ctx.db.update('topics', topic.id, { status: 'done', article_id: article.id })
  return { article_id: article.id, title }
}

/** 改一篇文章：只改传了的字段。没发布的改完回到待审；已发布的保持已发布（页面上点「更新到站点」才会发出去） */
/** 改文章要的上下文（任务 tasks/revise-article.md）：文章本身和我的定位 */
export function revisionContext(input: { article_id: string }, ctx: any) {
  const a = ctx.db.get('articles', input.article_id)
  if (!a) throw new Error(L(ctx, '没有这篇文章', 'Article not found'))
  return { article: a, project: projectBrief(profile(ctx)), images: imagesOf(ctx) }
}

export function update(input: Fields & { article_id: string }, ctx: any) {
  const a: Article | null = ctx.db.get('articles', input?.article_id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.article_id)
  const f: Fields = {}
  for (const k of ['title', 'summary', 'keywords', 'body'] as const) if (input[k] !== undefined) f[k] = String(input[k]).trim()
  if (input.slug !== undefined) f.slug = cleanSlug(input.slug)
  if (!Object.keys(f).length) throw new Error(L(ctx, '没有要改的字段（title / summary / slug / keywords / body）', 'Nothing to change (title / summary / slug / keywords / body)'))
  checkFields(f, ctx)
  ctx.db.update('articles', a.id, { ...f, ...(a.status === 'published' ? {} : { status: 'draft', review_note: null }) })
  return { article_id: a.id, title: f.title ?? a.title, changed: Object.keys(f) }
}

/**
 * 把一篇文章写成社媒帖子时要的内容（社媒插件的写作任务 social/write-<平台> 先跑它：任务参数 source.fn = 'content.socialSource'）。
 * 插件不读模板的表，文章、配图、候选视频、项目资料都从这里给：
 * { id, title, summary, text（纯文本正文）, url, images（正文里的图）, videos（资料库里的视频）, project }
 */
export function socialSource(input: { id: string }, ctx: any) {
  const a = ctx.db.get('articles', input?.id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.id)
  const $ = ctx.html(a.body ?? '')
  let videos: any[] = []
  try {
    videos = ctx.db.query('assets', { where: { kind: 'video' }, limit: 200 }).list.map((v: any) => ({ url: v.url, name: v.name ?? '', text: v.text ?? '', tags: v.tags ?? '' }))
  } catch {
    // 还没有素材表：没有候选视频
  }
  return {
    id: a.id,
    title: a.title,
    summary: a.summary ?? '',
    text: $.text().slice(0, 8000),
    url: /^https?:\/\//.test(a.url ?? '') ? a.url : '',
    images: $.find('img[src]').map((i: any) => String(i.attrs.src)).filter((u: string) => /^https?:\/\//.test(u)),
    videos,
    project: projectBrief(profile(ctx)),
  }
}
