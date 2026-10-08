// 文章类型（文件名以 _ 开头：不是可调用的函数，本机函数和页面都 import 它）。
//
// 各社媒平台的发帖框不一样，归纳成三种文章类型，新建文章时先选类型，编辑框、发布、改写都按类型走：
//   article 长文：标题 + 富文本正文（小标题、列表、图片插在正文里），知乎这类；
//   post    图文笔记：标题 + 纯文字正文 + 一组配图（顺序就是轮播顺序），小红书、X、LinkedIn、Facebook、Instagram；
//   video   视频：标题 + 简介 + 一个视频，YouTube、抖音、B 站，以及能发视频的图文平台。
// 哪个平台支持哪种类型不在这里写死：按社媒插件的字段表（plugins/social/local/_fields.ts）算，插件加了平台这里跟着变。

import { FIELDS, type PostFields } from '../plugins/social/local/_fields'

export type ArticleType = 'article' | 'post' | 'video'
export const ARTICLE_TYPES: ArticleType[] = ['article', 'post', 'video']

/** 一篇文章的类型：老数据没有 type，按长文看 */
export const typeOf = (a: { type?: string } | null | undefined): ArticleType => (a?.type === 'post' || a?.type === 'video' ? a.type : 'article')
export const isType = (t: unknown): t is ArticleType => ARTICLE_TYPES.includes(t as ArticleType)

/** 这个平台能不能发这种类型的文章 */
export function supports(f: PostFields | undefined, t: ArticleType) {
  if (!f) return false
  if (t === 'article') return f.body === 'rich'
  if (t === 'post') return f.body === 'text' && f.images > 0
  return !!f.video
}

/** 支持这种类型的平台（社媒插件里的平台 id：x、xiaohongshu…）；enabled 给了就只看这几个 */
export const platformsFor = (t: ArticleType, enabled?: string[]) => Object.keys(FIELDS).filter((p) => (!enabled || enabled.includes(p)) && supports(FIELDS[p], t))

export const parseList = (s: unknown): string[] => {
  if (Array.isArray(s)) return s.map(String)
  try { const v = JSON.parse(String(s || '[]')); return Array.isArray(v) ? v.map(String) : [] } catch { return [] }
}

/** 话题：表里是 JSON 数组；老文章只有 keywords（逗号分隔） */
export const tagsOf = (a: { tags?: string; keywords?: string }) => {
  const tags = parseList(a.tags)
  return tags.length ? tags : String(a.keywords ?? '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
}

/** 富文本里的图（按出现顺序） */
export const htmlImages = (html: string) => [...String(html ?? '').matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, '&'))

/** 富文本的纯文字 */
export const htmlText = (html: string) =>
  String(html ?? '')
    .replace(/<(br|\/p|\/h\d|\/li|\/blockquote|\/pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/**
 * 一篇文章发到某个平台时的帖子字段（存进社媒插件的 social_posts）：文章本身就是要发的内容，原样搬过去，
 * 只按平台去掉它没有的字段、截掉超过上限的配图。字数这类超限不在这里改：发布前提示用户（改文章，或改写成更短的一篇）。
 */
export function postFrom(a: any, platform: string) {
  const f = FIELDS[platform]
  const t = typeOf(a)
  const tags = tagsOf(a).slice(0, f?.tags ?? 0)
  const title = String(a.title ?? '').trim()
  // 平台上没有标题（X、LinkedIn…）：title 只是后台列表里认这条用的，截短
  const shownTitle = f?.title === 'note' ? [...title].slice(0, f.titleMax).join('') : title
  const base = { title: shownTitle, body: String(a.body ?? '').trim(), tags: JSON.stringify(tags), cover_text: '', video: '', images: '[]', category: '' }
  if (t === 'article') return { ...base, images: JSON.stringify(htmlImages(base.body)) }
  if (t === 'post') return { ...base, images: JSON.stringify(parseList(a.images).slice(0, f?.images ?? 0)), cover_text: f?.cover ? String(a.cover_text ?? '') : '' }
  return { ...base, video: String(a.video ?? ''), category: f?.category ? String(a.category ?? '') : '' }
}

/** 这篇发到这个平台，正文有多长、上限多少（X 中日韩文字算 2、话题接在正文后的平台把话题算进去） */
export function lengthOn(a: any, platform: string) {
  const f = FIELDS[platform]
  if (!f) return { length: 0, max: 0 }
  const p = postFrom(a, platform)
  return { length: f.len(p.body, parseList(p.tags)), max: f.bodyMax }
}

/**
 * 写好了还没发的文章（总览「待发布」、左侧内容中心的数字、今天要做的）：有内容，又没有一个账号发出去或排上期的。
 * 最近改的在前
 */
export function unpublished<A extends { id: string; title?: string; body?: string; video?: string; images?: string; updated_at?: string; created_at?: string }>(articles: A[], posts: { article_id?: string; status: string }[]): A[] {
  const out = new Set(posts.filter((p) => p.article_id && ['published', 'publishing', 'scheduled'].includes(p.status)).map((p) => p.article_id))
  return articles
    .filter((a) => !out.has(a.id) && (String(a.body ?? '').trim() || a.video || parseList(a.images).length))
    .sort((x, y) => String(y.updated_at || y.created_at || '').localeCompare(String(x.updated_at || x.created_at || '')))
}
