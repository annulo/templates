// 文章译文（本机函数）：多语言网站上一篇文章每种语言一份译文（article_translations 表），发布时写进 CMS 的 body._i18n.<语言>。设计见 docs/multilingual.md。
// 翻译交给助手（任务 tasks/translate-article.md），这里只取数、存表。
//
//   translations.context({ article_id, locales? })   翻译要的上下文：原文、要翻的语言（不写就是没翻的和原文改过的）、已有的译文、术语表、项目资料
//   translations.save({ article_id, locale, title, body, summary?, keywords? })
//                                                    助手存一种语言的译文（AI 翻的，status 是 draft），记下原文指纹和这段对话（ctx.chat_id）
//   translations.update({ id, title?, summary?, body?, keywords?, confirm? })
//                                                    用户在文章页改译文、确认译文（confirm：标成 ready，原文指纹换成现在的）
//   translations.remove({ id })                      删掉一种语言的译文（网站上已经发出去的不动）

import { L } from './_i18n'
import { articleLang, multilingualSites, normLocale, sourceHash, unionLocales, TEXT_FIELDS } from './_locales'

const now = () => new Date().toISOString()
const text = (v: unknown) => String(v ?? '').trim()

function articleOf(ctx: any, id: string) {
  const a = ctx.db.get('articles', id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + id)
  return a
}
const rowsOf = (ctx: any, articleId: string) => ctx.db.query('article_translations', { where: { article_id: articleId }, limit: 100 }).list as any[]
const tryList = (ctx: any, table: string) => {
  try {
    return ctx.db.query(table, { limit: 500 }).list as any[]
  } catch {
    return []
  }
}

/** 正文里的图片地址（译文要和原文用同样的图） */
const imagesOf = (ctx: any, html: string): string[] => (html ? ctx.html(html).find('img[src]').map((i: any) => String(i.attrs.src)) : [])

export async function context(input: { article_id: string; locales?: string[] | string }, ctx: any) {
  const a = articleOf(ctx, input?.article_id)
  const sites = await multilingualSites(ctx)
  if (!sites.length) throw new Error(L(ctx, '还没有开了多语言的网站：先在 creght 编辑器里给网站开多语言，再在网站设置里点「重新读取语言」', 'No site has several languages yet: turn them on in the creght editor, then click "Read languages again" in the site settings'))
  const all = unionLocales(sites)
  const lang = articleLang(ctx, a, all)
  const hash = sourceHash(a)
  const rows = rowsOf(ctx, a.id)
  const asked = (Array.isArray(input.locales) ? input.locales : text(input.locales).split(/[,，\s]+/)).map(normLocale).filter(Boolean)
  const unknown = asked.filter((l) => !all.locales.includes(l))
  if (unknown.length) throw new Error(L(ctx, `网站没有开这些语言：${unknown.join(', ')}（开了的是 ${all.locales.join(', ')}）`, `The sites don't have these languages: ${unknown.join(', ')} (they have ${all.locales.join(', ')})`))
  const targets = (asked.length ? asked : all.locales.filter((l) => {
    const t = rows.find((r) => normLocale(r.locale) === l)
    return !t || t.source_hash !== hash
  })).filter((l) => l !== lang)
  return {
    article: { id: a.id, lang, title: a.title ?? '', summary: a.summary ?? '', body: a.body ?? '', keywords: a.keywords ?? '' },
    targets,
    existing: rows
      .filter((r) => targets.includes(normLocale(r.locale)))
      .map((r) => ({ locale: normLocale(r.locale), title: r.title ?? '', summary: r.summary ?? '', body: r.body ?? '', keywords: r.keywords ?? '', stale: r.source_hash !== hash, confirmed: r.status === 'ready' })),
    sites: sites.map(({ ch, site }) => ({ id: ch.id, name: ch.name, locales: site.locales, default_locale: site.default_locale })),
    glossary: tryList(ctx, 'glossary').map((g) => {
      let tr: Record<string, string> = {}
      try {
        tr = JSON.parse(g.translations || '{}')
      } catch {}
      return { term: g.term, translations: tr, keep: !!g.keep, note: g.note ?? '' }
    }),
    project: tryList(ctx, 'profile')[0] ?? null,
  }
}

export async function save(input: { article_id: string; locale: string; title: string; body: string; summary?: string; keywords?: string }, ctx: any) {
  const a = articleOf(ctx, input?.article_id)
  const sites = await multilingualSites(ctx)
  const all = unionLocales(sites)
  const locale = normLocale(input.locale)
  if (!all.locales.includes(locale)) throw new Error(L(ctx, `网站没有开这种语言：${locale}（开了的是 ${all.locales.join(', ') || '没有'}）`, `The sites don't have this language: ${locale} (they have ${all.locales.join(', ') || 'none'})`))
  if (locale === articleLang(ctx, a, all)) throw new Error(L(ctx, '这是原文的语言，不用翻：要改原文就改文章本身', "That's the article's own language: edit the article itself instead"))
  const title = text(input.title)
  const body = text(input.body)
  if (!title) throw new Error(L(ctx, 'title 不能空', 'title is required'))
  if (!body && text(a.body)) throw new Error(L(ctx, 'body 不能空：要把正文也翻过来', 'body is required: translate the body too'))
  // 图片和原文一样：只翻 alt，不换图、不删图
  // 两边都解析出地址再比（HTML 里的 & 常写成 &amp;，直接比字符串对不上）
  const have = new Set(imagesOf(ctx, body))
  const missing = imagesOf(ctx, a.body ?? '').filter((src) => !have.has(src))
  if (missing.length) throw new Error(L(ctx, `正文里少了原文的图片：${missing.slice(0, 3).join('、')}。HTML 结构、图片和链接照原文保留，只翻文字`, `The body is missing images from the original: ${missing.slice(0, 3).join(', ')}. Keep the HTML structure, images and links; only translate the text`))
  const row: Record<string, unknown> = { article_id: a.id, locale, title, body, summary: text(input.summary), keywords: text(input.keywords), source_hash: sourceHash(a), status: 'draft', updated_at: now() }
  if (ctx.chat_id) row.chat_id = String(ctx.chat_id)
  const prev = rowsOf(ctx, a.id).find((r) => normLocale(r.locale) === locale)
  const saved = prev ? (ctx.db.update('article_translations', prev.id, row), { ...prev, ...row }) : ctx.db.insert('article_translations', { ...row, created_at: now() })
  return { id: saved.id, article_id: a.id, locale, link: `/?view=content&article=${a.id}` }
}

export function update(input: { id: string; title?: string; summary?: string; body?: string; keywords?: string; confirm?: boolean }, ctx: any) {
  const t = ctx.db.get('article_translations', input?.id)
  if (!t) throw new Error(L(ctx, '没有这份译文：', 'No such translation: ') + input?.id)
  const patch: Record<string, unknown> = { updated_at: now() }
  for (const k of TEXT_FIELDS) if (input[k] !== undefined) patch[k] = text(input[k])
  if (patch.title === '') throw new Error(L(ctx, '标题不能空', 'The title is required'))
  // 用户自己改过、或者点了确认：就是用户看过的，标成 ready；确认时原文指纹换成现在的（「原文已改」的提示消掉）
  patch.status = 'ready'
  if (input.confirm) {
    const a = ctx.db.get('articles', t.article_id)
    if (a) patch.source_hash = sourceHash(a)
  }
  ctx.db.update('article_translations', t.id, patch)
  return { id: t.id }
}

export function remove(input: { id: string }, ctx: any) {
  const t = ctx.db.get('article_translations', input?.id)
  if (!t) return { deleted: false }
  ctx.db.delete('article_translations', t.id)
  return { deleted: true }
}
