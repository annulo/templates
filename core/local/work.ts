// 「在这篇上做」要的上下文（本机函数，Annulo 在用户电脑上执行，不经过模型）：任务 tasks/work-on-article.md 先跑它。
// 照稿子写正文、配图、做视频……做什么由用户的要求（Prompt）定，这里只把这篇有的东西都给出来，读哪个、怎么用由 AI 自己定。
//
//   work.context({ article_id })
//     → { article: { id, type, title, draft, body, … }, type_note, source（改写自哪篇：它的稿子和正文）, artifacts（这篇已有的产物）, platforms, project }

import { L } from './_i18n'
import { profile, projectBrief } from './_ai'
import { htmlText, parseList, platformsFor, typeOf, type ArticleType } from './_types'
import { FIELDS, fieldsFor } from '../plugins/social/local/_fields'

const TYPE_NOTE: Record<ArticleType, string> = {
  article: '长文：body 是 HTML（<h2> <h3> <p> <ul> <ol> <li> <blockquote> <strong> <a> <img>），图片插在正文里',
  post: '图文笔记：body 是纯文字（不要 HTML、不要 Markdown 标记），配图是 images（顺序就是轮播顺序，第一张是封面）',
  video: '视频：body 是视频简介（纯文字），video 是发布用的视频（资料库里的一条产物，assets.add 传 use: true 设它）',
}

const text = (a: any) => {
  const body = String(a?.body ?? '')
  return typeOf(a) === 'article' ? htmlText(body) : body
}

/** 这种类型在用户有账号的平台上的限制（没有账号就是所有支持的平台）；只发视频的平台排前面（定横竖屏） */
function platformsOf(ctx: any, t: ArticleType) {
  let mine: string[] = []
  try { mine = [...new Set<string>(ctx.db.query('social_accounts', { limit: 200 }).list.map((c: any) => c.type))] } catch {}
  const all = platformsFor(t)
  const list = mine.filter((p) => all.includes(p)).length ? all.filter((p) => mine.includes(p)) : all
  return list.sort((x, y) => Number(FIELDS[y].video === 'only') - Number(FIELDS[x].video === 'only')).map((p) => {
    const f = fieldsFor(p, t)!
    return { platform: p, title_max: f.title === 'publish' ? f.titleMax : 0, body_max: f.bodyMax, tags_max: f.tags, ...(t === 'post' ? { images_max: f.images } : {}), ...(t === 'video' ? { video: f.video, ...(f.category ? { category: true } : {}) } : {}) }
  })
}

const filesOf = (x: any) => {
  try {
    const l = JSON.parse(x.files || '[]')
    if (Array.isArray(l) && l.length) return l
  } catch {}
  return x.url ? [{ url: x.url, mime: x.mime ?? '' }] : []
}

export function context(input: { article_id: string }, ctx: any) {
  const a = input?.article_id ? ctx.db.get('articles', input.article_id) : null
  if (!a) throw new Error(L(ctx, `没有这篇文章：${input?.article_id}`, `No such article: ${input?.article_id}`))
  const t = typeOf(a)
  const src = a.source_id ? ctx.db.get('articles', a.source_id) : null
  let artifacts: any[] = []
  try {
    artifacts = ctx.db.query('assets', { where: { article_id: a.id }, limit: 100 }).list
      .sort((x: any, y: any) => String(y.created_at ?? '').localeCompare(String(x.created_at ?? '')))
      .map((x: any) => ({ id: x.id, ref: `@assets:${x.id}`, note: x.note ?? '', files: filesOf(x), in_use: !!x.url && (x.url === a.video || parseList(a.images).includes(x.url)) }))
  } catch {}
  return {
    article: { id: a.id, type: t, title: a.title ?? '', draft: htmlText(String(a.draft ?? '')).slice(0, 20000), body: text(a).slice(0, 20000), ...(t === 'article' ? { html: String(a.body ?? '').slice(0, 60000) } : {}), summary: a.summary ?? '', tags: parseList(a.tags), images: parseList(a.images), video: a.video ?? '' },
    type_note: TYPE_NOTE[t],
    source: src ? { id: src.id, type: typeOf(src), title: src.title ?? '', draft: htmlText(String(src.draft ?? '')).slice(0, 20000), body: text(src).slice(0, 20000) } : null,
    artifacts,
    platforms: platformsOf(ctx, t),
    project: projectBrief(profile(ctx)),
  }
}
