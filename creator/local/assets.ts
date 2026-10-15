// 资料库（本机函数，Annulo 在用户电脑上执行，不经过模型）。
//
//   assets.add({ url, article_id?, note?, kind?, name?, use? })
//        把助手做出来的产物（视频、图片…）放进资料库：url 是 annulo upload --local 给的 local:<name>（或 annulo upload 给的地址），
//        article_id 是哪篇文章做出来的（文章页列出它的产物），note 是备注（怎么做的、改了什么，不写路径）；
//        自动记下做它的对话（ctx.chat_id），要改就回到这段对话。use: true 时把它设成这篇文章发布用的视频（视频文章的 video）

import { L } from './_i18n'
import { typeOf } from './_types'

const now = () => new Date().toISOString()
const KINDS = ['image', 'video', 'text']

/** 按地址的扩展名猜类型，猜不出当图片 */
function kindOf(url: string) {
  const path = url.split(/[?#]/)[0].toLowerCase()
  if (/\.(mp4|mov|webm|m4v)$/.test(path)) return 'video'
  return 'image'
}

export function add(input: { url: string; article_id?: string; note?: string; kind?: string; name?: string; use?: boolean }, ctx: any) {
  const url = String(input?.url ?? '').trim()
  if (!/^local:[0-9a-f]{32}(\.[a-z0-9]{1,6})?$/.test(url) && !/^(https?:\/\/|\/_(annulo|shuttle)\/uploaded\/)\S+$/.test(url))
    throw new Error(L(ctx, 'url 要是 annulo upload --local <文件> 打印的 local:<name>，或 annulo upload 给的地址（先把文件存进来）', 'url must be the local:<name> printed by annulo upload --local <file>, or the address from annulo upload (save the file first)'))
  const kind = KINDS.includes(String(input.kind)) ? String(input.kind) : kindOf(url)
  const article = input.article_id ? ctx.db.get('articles', input.article_id) : null
  if (input.article_id && !article) throw new Error(L(ctx, `没有这篇文章：${input.article_id}`, `No such article: ${input.article_id}`))
  const name = String(input.name ?? '').trim() || article?.title || L(ctx, '产物', 'Output')
  const row = ctx.db.insert('assets', { kind, url, name, note: String(input.note ?? '').trim(), article_id: article?.id ?? '', chat_id: String(ctx.chat_id ?? ''), source: 'agent', created_at: now() })
  if (input.use) {
    if (!article || typeOf(article) !== 'video' || kind !== 'video') throw new Error(L(ctx, 'use 只用于把视频设成视频文章发布用的视频', 'use only sets a video as what a video article publishes'))
    ctx.db.update('articles', article.id, { video: url, unread: true, updated_at: now() })
  }
  return { asset_id: row.id, ...(article ? { link: `/?view=content&article=${article.id}` } : {}) }
}
