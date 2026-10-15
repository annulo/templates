// 资料库（本机函数，Annulo 在用户电脑上执行，不经过模型）。产物（artifacts）是资料库里带 article_id 的一条，可以是一组文件（creator/docs/artifacts.md）。
//
//   assets.add({ url | urls, article_id?, note?, name?, use? })
//        把助手做出来的东西放进资料库：url / urls 是 annulo upload --local 给的 local:<name>（或 annulo upload 给的地址）；
//        urls 是一组（小红书的 6 张图），存成一条（files），顺序就是轮播顺序；mime 按扩展名推。
//        article_id 是哪篇文章做出来的（文章页列出它的产物），note 是备注（怎么做的、改了什么，不写路径），自动记下做它的对话（ctx.chat_id）。
//        use: true 时把它用到这篇文章上：视频文章设成发布用的视频，图文把这组图换成配图
//   assets.replace({ asset_id, n, url, note? })
//        只改一组里的第 n 个（从 1 开始）：换成新文件，备注后面追加这次改了什么；这篇文章里用着旧地址的（配图、视频）一起换

import { L } from './_i18n'
import { parseList, typeOf } from './_types'

const now = () => new Date().toISOString()
const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
  html: 'text/html', htm: 'text/html', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
}
const mimeOf = (url: string) => EXT_MIME[url.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
/** 资料库的大类（筛选用）：全是图片归图片，全是视频归视频，其余 file */
const kindOf = (mimes: string[]) => (mimes.every((m) => m.startsWith('image/')) ? 'image' : mimes.every((m) => m.startsWith('video/')) ? 'video' : 'file')
const validUrl = (u: string) => /^local:[0-9a-f]{32}(\.[a-z0-9]{1,6})?$/.test(u) || /^(https?:\/\/|\/_(annulo|shuttle)\/uploaded\/)\S+$/.test(u)
const badUrl = (ctx: any) => new Error(L(ctx, '地址要是 annulo upload --local <文件> 打印的 local:<name>，或 annulo upload 给的地址（先把文件存进来）', 'URLs must be the local:<name> printed by annulo upload --local <file>, or the address from annulo upload (save the files first)'))

type File = { url: string; mime: string; name?: string }
const filesOf = (x: any): File[] => {
  try {
    const l = JSON.parse(x.files || '[]')
    if (Array.isArray(l) && l.length) return l
  } catch {}
  return x.url ? [{ url: x.url, mime: x.mime || mimeOf(x.url) }] : []
}

/** 把这组用到文章上：视频文章取组里第一个视频；图文用组里的图片当配图（按顺序） */
function useOn(ctx: any, article: any, files: File[]) {
  const t = typeOf(article)
  if (t === 'video') {
    const v = files.find((f) => f.mime.startsWith('video/'))
    if (!v) throw new Error(L(ctx, '这组里没有视频，不能设成视频文章发布用的视频', 'This group has no video to use for the video article'))
    ctx.db.update('articles', article.id, { video: v.url, unread: true, updated_at: now() })
  } else if (t === 'post') {
    const imgs = files.filter((f) => f.mime.startsWith('image/')).map((f) => f.url)
    if (!imgs.length) throw new Error(L(ctx, '这组里没有图片，不能用作配图', 'This group has no images to use'))
    ctx.db.update('articles', article.id, { images: JSON.stringify(imgs), unread: true, updated_at: now() })
  } else throw new Error(L(ctx, 'use 只用于视频、图文：长文的图插进正文（content.update）', 'use is for videos and image posts; insert images into a long-form body with content.update'))
}

export function add(input: { url?: string; urls?: string[]; article_id?: string; note?: string; name?: string; use?: boolean }, ctx: any) {
  const urls = (input?.urls?.length ? input.urls : input?.url ? [input.url] : []).map((u) => String(u).trim()).filter(Boolean)
  if (!urls.length || urls.some((u) => !validUrl(u))) throw badUrl(ctx)
  const files: File[] = urls.map((u) => ({ url: u, mime: mimeOf(u) }))
  const article = input.article_id ? ctx.db.get('articles', input.article_id) : null
  if (input.article_id && !article) throw new Error(L(ctx, `没有这篇文章：${input.article_id}`, `No such article: ${input.article_id}`))
  const name = String(input.name ?? '').trim() || article?.title || L(ctx, '产物', 'Artifact')
  const row = ctx.db.insert('assets', {
    kind: kindOf(files.map((f) => f.mime)), url: files[0].url, mime: files[0].mime, ...(files.length > 1 ? { files: JSON.stringify(files) } : {}),
    name, note: String(input.note ?? '').trim(), article_id: article?.id ?? '', chat_id: String(ctx.chat_id ?? ''), source: 'agent', created_at: now(),
  })
  if (input.use) {
    if (!article) throw new Error(L(ctx, 'use 要和 article_id 一起用', 'use needs article_id'))
    useOn(ctx, article, files)
  }
  return { asset_id: row.id, ref: `@assets:${row.id}`, files: files.length, ...(article ? { link: `/?view=content&article=${article.id}` } : {}) }
}

export function replace(input: { asset_id: string; n: number; url: string; note?: string }, ctx: any) {
  const x = input?.asset_id ? ctx.db.get('assets', input.asset_id) : null
  if (!x) throw new Error(L(ctx, `资料库里没有这一条：${input?.asset_id}`, `No such library item: ${input?.asset_id}`))
  const url = String(input.url ?? '').trim()
  if (!validUrl(url)) throw badUrl(ctx)
  const files = filesOf(x)
  const n = Number(input.n)
  if (!Number.isInteger(n) || n < 1 || n > files.length) throw new Error(L(ctx, `n 要在 1 到 ${files.length} 之间`, `n must be between 1 and ${files.length}`))
  const old = files[n - 1].url
  files[n - 1] = { ...files[n - 1], url, mime: mimeOf(url) }
  const note = [String(x.note ?? '').trim(), String(input.note ?? '').trim()].filter(Boolean).join('\n')
  ctx.db.update('assets', x.id, { url: files[0].url, mime: files[0].mime, ...(files.length > 1 || x.files ? { files: JSON.stringify(files) } : {}), kind: kindOf(files.map((f) => f.mime)), note })
  // 这篇文章里用着旧地址的（图文的配图、视频文章的视频）一起换成新的；已经发出去的帖子不动
  const a = x.article_id ? ctx.db.get('articles', x.article_id) : null
  if (a) {
    const patch: Record<string, any> = {}
    const imgs = parseList(a.images)
    if (imgs.includes(old)) patch.images = JSON.stringify(imgs.map((u: string) => (u === old ? url : u)))
    if (a.video === old) patch.video = url
    if (Object.keys(patch).length) ctx.db.update('articles', a.id, { ...patch, updated_at: now() })
  }
  return { asset_id: x.id, n, ref: `@assets:${x.id}#${n}` }
}
