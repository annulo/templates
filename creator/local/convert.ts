// 把一篇文章机械地转成另一种类型，另存一篇（本机函数，不经过模型，点了马上好）。和「AI 改写」不同：内容一个字不改，只按类型换字段的格式。
//
//   convert.toType({ article_id, type })  → { article_id }
//   convert.copy({ article_id })          → { article_id }   同类型原样复制一篇（列表上的「更多 → 复制」）
//
// 怎么转：
//   长文 → 图文笔记 / 视频：正文 HTML 变成纯文字（小标题、段落各一行，列表前面加 •），正文里的图做图文的配图；视频沿用原文的视频
//   图文笔记 / 视频 → 长文：一行变一段，图文的配图按顺序接在正文后面
//   图文笔记 ⇄ 视频：正文原样；视频没有配图、图文没有视频，带不过去的丢掉
// 字数超了平台上限不在这里截：发布前的检查会报出来，让用户改。
import { L } from './_i18n'
import { htmlImages, parseList, typeOf, type ArticleType } from './_types'

const unesc = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 长文的 HTML → 纯文字：块一行一个，列表项前面加 • / 1.，图片去掉 */
export function htmlToText(html: string) {
  const lists: number[] = [] // 每层列表：-1 是无序，>=0 是有序的序号
  const out = String(html ?? '').replace(/<(\/?)([a-z0-9]+)\b[^>]*>/gi, (_, close, tag) => {
    const t = tag.toLowerCase()
    if (t === 'ul' || t === 'ol') {
      if (close) lists.pop()
      else lists.push(t === 'ol' ? 0 : -1)
      return '\n'
    }
    if (t === 'li' && !close) {
      const k = lists.length - 1
      const mark = k >= 0 && lists[k] >= 0 ? `${++lists[k]}. ` : '• '
      return '\n' + '  '.repeat(Math.max(0, k)) + mark
    }
    // 块结束换行；块开始（包括列表项里的段落）不另起一行
    if (t === 'br' || (close && /^(p|h\d|blockquote|pre|div)$/.test(t))) return '\n'
    return ''
  })
  return unesc(out)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .reduce<string[]>((acc, l) => {
      // 列表项之间的空行去掉；别处连着的空行并成一行
      if (!l.trim() && (!acc.length || !acc[acc.length - 1].trim())) return acc
      acc.push(l.trim() ? l : '')
      return acc
    }, [])
    .join('\n')
    .replace(/\n\n(?=\s*(• |\d+\. ))/g, '\n')
    .trim()
}

/** 纯文字 → 长文的 HTML：一行一段，空行不要；图片接在后面 */
export function textToHtml(text: string, images: string[] = []) {
  const paras = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`)
  return paras.join('') + images.map((u) => `<img src="${esc(u)}" alt="">`).join('')
}

export function toType(input: { article_id: string; type: ArticleType }, ctx: any) {
  const a = input?.article_id ? ctx.db.get('articles', input.article_id) : null
  if (!a) throw new Error(L(ctx, `找不到这篇文章：${input?.article_id}`, `Article not found: ${input?.article_id}`))
  const to: ArticleType = input.type === 'post' || input.type === 'video' ? input.type : 'article'
  const from = typeOf(a)
  // 同类型没有可转的：就是复制一篇（改写弹窗里选了同类型时按钮是「复制」）
  if (to === from) return copy(input, ctx)
  const body = String(a.body ?? '')
  const out: Record<string, any> = { type: to, title: a.title, tags: a.tags || '[]', source_id: a.id }
  if (to === 'article') {
    out.summary = a.summary || ''
    out.body = from === 'article' ? body : textToHtml(body, from === 'post' ? parseList(a.images) : [])
    if (a.video) out.video = a.video
  } else {
    out.body = from === 'article' ? htmlToText(body) : body
    if (to === 'post') {
      out.images = JSON.stringify(from === 'article' ? htmlImages(body) : from === 'post' ? parseList(a.images) : [])
      if (from === 'post' && a.cover_text) out.cover_text = a.cover_text
    } else {
      out.video = a.video || ''
      if (from === 'video' && a.category) out.category = a.category
    }
  }
  const t = new Date().toISOString()
  const row = ctx.db.insert('articles', { ...out, status: 'draft', created_at: t, updated_at: t })
  return { article_id: row.id }
}

/** 复制一篇：同类型、同内容另存一篇草稿，标题后面加「（副本）」；发布记录、导入来源不带过去 */
export function copy(input: { article_id: string }, ctx: any) {
  const a = input?.article_id ? ctx.db.get('articles', input.article_id) : null
  if (!a) throw new Error(L(ctx, `找不到这篇文章：${input?.article_id}`, `Article not found: ${input?.article_id}`))
  const keep: Record<string, any> = {}
  for (const k of ['type', 'summary', 'body', 'tags', 'images', 'video', 'cover_text', 'category', 'topic_id']) if (a[k] !== undefined && a[k] !== null) keep[k] = a[k]
  const t = new Date().toISOString()
  const row = ctx.db.insert('articles', { ...keep, title: `${a.title || ''}${L(ctx, '（副本）', ' (copy)')}`, status: 'draft', created_at: t, updated_at: t })
  return { article_id: row.id }
}
