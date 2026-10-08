// 文章类型（文件名以 _ 开头：不是可调用的函数，本机函数和页面都 import 它）。
//
// 各社媒平台的发帖框不一样，归纳成三种文章类型，新建文章时先选类型，编辑框、发布、改写都按类型走：
//   article 长文：标题 + 富文本正文（小标题、列表、图片插在正文里），知乎这类；
//   post    图文笔记：标题 + 纯文字正文 + 一组配图（顺序就是轮播顺序），小红书、X、LinkedIn、Facebook、Instagram；
//   video   视频：标题 + 简介 + 一个视频，YouTube、抖音、B 站，以及能发视频的图文平台。
// 文章就是社媒插件认的那份内容（plugins/social/local/_content.ts）：三种类型、哪个平台支持哪种、发到某个平台转成什么样、字数多少，
// 都是插件按平台规格算的，这里只转出去，不另写一份（分界见 Annulo 的 docs/plugins.md「插件和模板的分界」）。

import { CONTENT_TYPES, contentType, lengthOn as contentLength, parseList, type ContentType } from '../plugins/social/local/_content'

export { fromContent, htmlImages, parseList, platformsFor, supports } from '../plugins/social/local/_content'

export type ArticleType = ContentType
export const ARTICLE_TYPES: ArticleType[] = CONTENT_TYPES

/** 一篇文章的类型：老数据没有 type，按长文看 */
export const typeOf = contentType
export const isType = (t: unknown): t is ArticleType => ARTICLE_TYPES.includes(t as ArticleType)

/** 话题：表里是 JSON 数组；老文章只有 keywords（逗号分隔） */
export const tagsOf = (a: { tags?: string; keywords?: string }) => {
  const tags = parseList(a.tags)
  return tags.length ? tags : String(a.keywords ?? '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
}

/** 富文本的纯文字 */
export const htmlText = (html: string) =>
  String(html ?? '')
    .replace(/<(br|\/p|\/h\d|\/li|\/blockquote|\/pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/**
 * 老文章补成插件认的格式：没有 type 的写 article，只有 keywords（逗号分隔）没有 tags 的把关键词写进 tags。
 * 返回要写回表的字段（不用改是 null）；publish.prepare 发之前写回去，排期到点时插件读到的就是补好的。
 */
export function articleFixes(a: any): Record<string, string> | null {
  const fix: Record<string, string> = {}
  if (!a?.type) fix.type = typeOf(a)
  if (!parseList(a?.tags).length && String(a?.keywords ?? '').trim()) fix.tags = JSON.stringify(tagsOf(a))
  return Object.keys(fix).length ? fix : null
}

/** 这篇发到这个平台，正文有多长、上限多少（插件按平台算；老文章先按 articleFixes 补齐） */
export const lengthOn = (a: any, platform: string) => contentLength({ ...a, ...articleFixes(a) }, platform)

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
