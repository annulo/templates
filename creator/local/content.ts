import { L } from './_i18n'
import { profile, projectBrief } from './_ai'
import { htmlImages, htmlText, isType, parseList, platformsFor, tagsOf, typeOf, type ArticleType } from './_types'
import { FIELDS } from '../plugins/social/local/_fields'

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

// 文章（本机函数，Annulo 在用户电脑上执行，不经过模型）。一篇文章一种类型（local/_types.ts）：
// article 长文（HTML 正文，图在正文里）、post 图文笔记（纯文字正文 + 一组配图）、video 视频（标题 + 简介 + 视频）。
//
//   content.context({ topic_id?, subject?, type? })  写文章要的上下文：我的定位、选题（没给选题也没给主题就列出选题池让助手挑）、写过的标题、能配的图、这种类型在各平台的限制
//   content.images({})                           能配进文章的图（资料库的图片），改文章时配图用
//   content.save({ type, topic_id?, source_id?, title, body, … })
//                                                 存一篇写好的文章（草稿）；有选题的把选题标成已写。写由助手按任务 tasks/write-article.md / rewrite-article.md 做
//   content.update({ article_id, title?, summary?, body?, tags?, images?, … })
//                                                 改一篇文章（助手按任务 tasks/revise-article.md 改完用它存）
//   content.rewriteContext({ article_id, type })  改写成另一种类型要的上下文：原文、目标类型在各平台的限制、我的定位、能配的图和视频
//   content.socialSource({ id })                 社媒插件的写作任务取文章内容用（见下）

type Article = { id: string; type?: string; title: string; summary?: string; body?: string; keywords?: string; slug?: string; status: string; url?: string; topic_id?: string }

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

/** 资料库里的视频（视频类型挑视频用） */
function videosOf(ctx: any) {
  try {
    return ctx.db.query('assets', { where: { kind: 'video' }, limit: 200 }).list.map((v: any) => ({ url: v.url, name: v.name ?? '', text: v.text ?? '', tags: v.tags ?? '' }))
  } catch {
    return []
  }
}

/** 这种类型在各平台的限制：有账号的平台（没有账号就是所有支持的平台）。写的时候照最严的写，发布时各平台还会再查一遍 */
function limitsOf(ctx: any, t: ArticleType) {
  let mine: string[] = []
  try { mine = [...new Set<string>(ctx.db.query('social_accounts', { limit: 200 }).list.map((c: any) => c.type))] } catch {}
  const all = platformsFor(t)
  const list = mine.filter((p) => all.includes(p)).length ? all.filter((p) => mine.includes(p)) : all
  return list.map((p) => {
    const f = FIELDS[p]
    return { platform: p, title: f.title === 'publish' ? `发出去，最多 ${f.titleMax} 字` : '平台上没有标题（只在后台列表里显示）', body_max: f.bodyMax, tags_max: f.tags, ...(t === 'post' ? { images_max: f.images, text_cover: f.cover } : {}), ...(t === 'video' && f.category ? { category: true } : {}) }
  })
}

const TYPE_NOTE: Record<ArticleType, string> = {
  article: '长文：body 是 HTML（<h2> <h3> <p> <ul> <ol> <li> <blockquote> <strong> <a> <img>），图片插在正文里',
  post: '图文笔记：body 是纯文字（不要 HTML、不要 Markdown 标记，可以用换行和 emoji），配图单独放在 images 数组（顺序就是轮播顺序，第一张是封面）',
  video: '视频：body 是视频简介（纯文字），视频放在 video（资料库视频的地址）；视频本身由用户提供，没有就留空、提醒用户补',
}

/** 写文章要的上下文（任务 tasks/write-article.md 里助手先跑它）：给了选题就是那个选题，给了主题就照主题写，都没给列出选题池让助手挑 */
export function context(input: { topic_id?: string; subject?: string; type?: string }, ctx: any) {
  const project = profile(ctx)
  const t: ArticleType = isType(input?.type) ? input.type : 'article'
  const topics: any[] = ctx.db.query('topics', { limit: 500 }).list
  const topic = input?.topic_id ? topics.find((x) => x.id === input.topic_id) : null
  if (input?.topic_id && !topic) throw new Error(L(ctx, '没有这个选题：', 'No such topic: ') + input.topic_id)
  const subject = String(input?.subject ?? '').trim()
  const ideas = topic || subject ? [] : topics.filter((x) => x.status === 'idea').map((x) => ({ id: x.id, title: x.title, angle: x.angle ?? '', keywords: x.keywords ?? '' }))
  if (!topic && !subject && !ideas.length) throw new Error(L(ctx, '选题池是空的：先点「出一批选题」', 'The topic pool is empty: click "Suggest topics" first'))
  const written: any[] = ctx.db.query('articles', { limit: 200 }).list
  return {
    type: t,
    type_note: TYPE_NOTE[t],
    limits: limitsOf(ctx, t),
    project: projectBrief(project),
    topic: topic ? { id: topic.id, title: topic.title, angle: topic.angle ?? '', keywords: topic.keywords ?? '', brief: json(topic.brief, null) } : null,
    subject,
    ideas,
    written_titles: written.map((a) => a.title),
    // 能配的图（资料库）：长文插进正文、图文笔记放进 images；没有合适的就不配
    images: imagesOf(ctx),
    ...(t === 'video' ? { videos: videosOf(ctx) } : {}),
  }
}

type Fields = { title?: string; summary?: string; slug?: string; keywords?: string; body?: string; tags?: string[]; images?: string[]; cover_text?: string; video?: string; category?: string }
type SaveInput = Fields & { type?: string; topic_id?: string; source_id?: string; title: string; body: string }

const cleanSlug = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
const isAsset = (u: string) => /^(https?:\/\/|\/_(annulo|shuttle)\/uploaded\/)\S+$/.test(u)
const cleanTags = (v: unknown) => [...new Set(parseList(v).map((x) => x.replace(/^#/, '').trim()).filter(Boolean))]

/** 文章字段的校验（按类型）：标题不能空；长文正文是 HTML、像写完的文章；图文笔记、视频正文是纯文字。只校验传了的字段 */
function checkFields(f: Fields, t: ArticleType, ctx: any) {
  if (f.title !== undefined && !String(f.title).trim()) throw new Error(L(ctx, '缺标题（title）', 'Missing title'))
  if (f.body !== undefined) {
    const body = String(f.body).trim()
    if (t === 'article') {
      if (body.length < 200) throw new Error(L(ctx, '正文（body）太短了，不像一篇写完的文章', 'The body is too short to be a finished article'))
      if (/^\s*#{1,6}\s|\n#{1,6}\s/.test(body) && !/<(p|h2|h3)[\s>]/i.test(body)) throw new Error(L(ctx, '长文的正文要用 HTML（<h2> <p> <ul> …），不是 Markdown', 'An article body must be HTML (<h2> <p> <ul> …), not Markdown'))
    } else {
      if (t === 'post' && !body) throw new Error(L(ctx, '图文笔记的正文不能是空的', 'A post needs body text'))
      if (/<(p|h\d|ul|ol|li|div|br|img)[\s/>]/i.test(body)) throw new Error(L(ctx, '图文笔记、视频简介的正文是纯文字，不要 HTML；配图放进 images', 'Post and video bodies are plain text, not HTML; put images in images'))
    }
  }
  if (f.images?.some((u) => !isAsset(u))) throw new Error(L(ctx, '配图（images）只能用资料库里的图片地址', 'images must be image URLs from the Library'))
}

/** 只留这种类型用得上的字段 */
function pick(input: any, t: ArticleType): Record<string, any> {
  const f: Record<string, any> = {}
  for (const k of ['title', 'summary', 'body'] as const) if (input[k] !== undefined) f[k] = String(input[k] ?? '').trim()
  if (input.tags !== undefined) f.tags = JSON.stringify(cleanTags(input.tags))
  if (t === 'article') {
    if (input.keywords !== undefined) f.keywords = String(input.keywords ?? '').trim()
    if (input.slug !== undefined) f.slug = cleanSlug(input.slug)
  }
  if (t === 'post') {
    if (input.images !== undefined) f.images = JSON.stringify([...new Set(parseList(input.images).map((u) => u.trim()).filter(Boolean))])
    if (input.cover_text !== undefined) f.cover_text = String(input.cover_text ?? '').trim()
  }
  if (t === 'video') {
    if (input.video !== undefined) f.video = String(input.video ?? '').trim()
    if (input.category !== undefined) f.category = String(input.category ?? '').trim()
  }
  return f
}

/** 存一篇写好的文章（草稿）；从选题写的把选题标成已写，改写的记下原文（source_id）。字段不对就报错，别让坏数据进表 */
export function save(input: SaveInput, ctx: any) {
  const t: ArticleType = isType(input?.type) ? input.type : 'article'
  const source = input?.source_id ? ctx.db.get('articles', input.source_id) : null
  if (input?.source_id && !source) throw new Error(L(ctx, 'source_id 不对：没有这篇文章', 'Bad source_id: no such article'))
  const topic = input?.topic_id ? ctx.db.get('topics', input.topic_id) : source?.topic_id ? ctx.db.get('topics', source.topic_id) : null
  if (input?.topic_id && !topic) throw new Error(L(ctx, 'topic_id 不对：没有这个选题', 'Bad topic_id: no such topic'))
  const f = pick({ ...input, title: input?.title ?? '', body: input?.body ?? '' }, t)
  checkFields({ ...f, images: input.images === undefined ? undefined : parseList(f.images) }, t, ctx)
  const now = new Date().toISOString()
  const article = ctx.db.insert('articles', { ...f, type: t, ...(topic ? { topic_id: topic.id } : {}), ...(source ? { source_id: source.id } : {}), status: 'draft', created_at: now, updated_at: now })
  if (topic && !source) ctx.db.update('topics', topic.id, { status: 'done', article_id: article.id })
  return { article_id: article.id, type: t, title: f.title }
}

/** 改文章要的上下文（任务 tasks/revise-article.md）：文章本身和我的定位 */
export function revisionContext(input: { article_id: string }, ctx: any) {
  const a = ctx.db.get('articles', input.article_id)
  if (!a) throw new Error(L(ctx, '没有这篇文章', 'Article not found'))
  const t = typeOf(a)
  return { article: a, type: t, type_note: TYPE_NOTE[t], limits: limitsOf(ctx, t), project: projectBrief(profile(ctx)), images: imagesOf(ctx) }
}

/** 改一篇文章：只改传了的字段（按文章的类型校验） */
export function update(input: Fields & { article_id: string }, ctx: any) {
  const a: Article | null = ctx.db.get('articles', input?.article_id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.article_id)
  const t = typeOf(a)
  const f = pick(input, t)
  if (!Object.keys(f).length) throw new Error(L(ctx, '没有要改的字段', 'Nothing to change'))
  checkFields({ ...f, tags: undefined, images: f.images === undefined ? undefined : parseList(f.images) }, t, ctx)
  ctx.db.update('articles', a.id, { ...f, updated_at: new Date().toISOString() })
  return { article_id: a.id, title: f.title ?? a.title, changed: Object.keys(f) }
}

/** 改写成另一种类型要的上下文（任务 tasks/rewrite-article.md）：原文（富文本给 html 和纯文字、笔记给配图）、目标类型和它在各平台的限制 */
export function rewriteContext(input: { article_id: string; type: string }, ctx: any) {
  const a = ctx.db.get('articles', input?.article_id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.article_id)
  if (!isType(input?.type)) throw new Error(L(ctx, 'type 要是 article / post / video', 'type must be article / post / video'))
  const from = typeOf(a)
  const body = String(a.body ?? '')
  return {
    source: {
      id: a.id, type: from, title: a.title, summary: a.summary ?? '',
      ...(from === 'article' ? { html: body.slice(0, 60000), text: htmlText(body).slice(0, 12000), images: htmlImages(body) } : { text: body, images: parseList(a.images) }),
      tags: tagsOf(a), video: a.video ?? '',
    },
    type: input.type,
    type_note: TYPE_NOTE[input.type],
    limits: limitsOf(ctx, input.type),
    project: projectBrief(profile(ctx)),
    images: imagesOf(ctx),
    ...(input.type === 'video' ? { videos: videosOf(ctx) } : {}),
  }
}

/**
 * 社媒插件的写作任务 social/write-<平台> 取文章内容用（任务参数 source.fn = 'content.socialSource'）。页面上已经不用它（文章直接发），
 * 留给助手在对话里按插件的任务写。插件不读模板的表，文章、配图、候选视频、项目资料都从这里给：
 * { id, title, summary, text（纯文本正文）, html, url, images, videos, project }
 */
export function socialSource(input: { id: string }, ctx: any) {
  const a = ctx.db.get('articles', input?.id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.id)
  const rich = typeOf(a) === 'article'
  const body = String(a.body ?? '')
  return {
    id: a.id,
    title: a.title,
    summary: a.summary ?? '',
    text: (rich ? htmlText(body) : body).slice(0, 8000),
    // 正文原样的富文本（HTML）：知乎这类富文本平台照它改写，图片留在原来的位置
    ...(rich ? { html: body.slice(0, 60000) } : {}),
    url: /^https?:\/\//.test(a.url ?? '') ? a.url : '',
    // 公开地址，或离线项目传到本机的 /_annulo/uploaded/…（发帖时 b.upload 认它）
    images: (rich ? htmlImages(body) : parseList(a.images)).filter(isAsset),
    videos: a.video ? [{ url: a.video, name: a.title }, ...videosOf(ctx)] : videosOf(ctx),
    project: projectBrief(profile(ctx)),
  }
}
