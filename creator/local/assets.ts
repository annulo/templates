// 资料库（本机函数，Annulo 在用户电脑上执行，不经过模型）。
//
//   assets.add({ url, article_id?, note?, mime?, name?, use? })
//        把助手做出来的产物（artifacts：视频、图片、网页、音频…）放进资料库：url 是 annulo upload --local 给的 local:<name>（或 annulo upload 给的地址），
//        mime 是文件类型（不给按扩展名猜：.mp4 → video/mp4、.html → text/html…），页面按它显示；
//        article_id 是哪篇文章做出来的（文章页列出它的产物），note 是备注（怎么做的、改了什么，不写路径）；
//        自动记下做它的对话（ctx.chat_id），要改就回到这段对话。use: true 时把它设成这篇文章发布用的视频（视频文章的 video）

import { L } from './_i18n'
import { typeOf } from './_types'

const now = () => new Date().toISOString()
const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
  html: 'text/html', htm: 'text/html', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
}
const mimeOf = (url: string) => EXT_MIME[url.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
/** 资料库的大类（筛选用）：图片、视频，其余都是 file */
const kindOf = (mime: string) => (mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'file')

export function add(input: { url: string; article_id?: string; note?: string; mime?: string; name?: string; use?: boolean }, ctx: any) {
  const url = String(input?.url ?? '').trim()
  if (!/^local:[0-9a-f]{32}(\.[a-z0-9]{1,6})?$/.test(url) && !/^(https?:\/\/|\/_(annulo|shuttle)\/uploaded\/)\S+$/.test(url))
    throw new Error(L(ctx, 'url 要是 annulo upload --local <文件> 打印的 local:<name>，或 annulo upload 给的地址（先把文件存进来）', 'url must be the local:<name> printed by annulo upload --local <file>, or the address from annulo upload (save the file first)'))
  const mime = /^[a-z]+\/[\w.+-]+$/.test(String(input.mime ?? '')) ? String(input.mime) : mimeOf(url)
  const kind = kindOf(mime)
  const article = input.article_id ? ctx.db.get('articles', input.article_id) : null
  if (input.article_id && !article) throw new Error(L(ctx, `没有这篇文章：${input.article_id}`, `No such article: ${input.article_id}`))
  const name = String(input.name ?? '').trim() || article?.title || L(ctx, '产物', 'Artifact')
  const row = ctx.db.insert('assets', { kind, mime, url, name, note: String(input.note ?? '').trim(), article_id: article?.id ?? '', chat_id: String(ctx.chat_id ?? ''), source: 'agent', created_at: now() })
  if (input.use) {
    if (!article || typeOf(article) !== 'video' || kind !== 'video') throw new Error(L(ctx, 'use 只用于把视频设成视频文章发布用的视频', 'use only sets a video as what a video article publishes'))
    ctx.db.update('articles', article.id, { video: url, unread: true, updated_at: now() })
  }
  return { asset_id: row.id, ...(article ? { link: `/?view=content&article=${article.id}` } : {}) }
}
