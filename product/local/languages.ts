// 网站的语言（本机函数）。设计见 docs/multilingual.md。
//
//   languages.read({ channel_id })            读一个 creght 站点开了哪些语言（抓首页，页面里内嵌的语言设置），存进渠道表；
//                                             站点后来在 creght 编辑器里加了语言，网站设置里点「重新读取语言」调它
//   languages.setReview({ channel_id, review })   这个网站是不是只发用户确认过的译文（默认 AI 翻好就能发）
//   languages.article({ article_id })         文章页的语言一栏：要发的多语言网站、原文语言、每种语言的译文状态（没翻 / AI 翻的 / 确认过 / 原文已改）、
//                                             各语言发上去的网址。还没读过语言的 creght 站点先读一次
//   languages.setLang({ article_id, lang })   改文章的原文语言

import { L } from './_i18n'
import { articleLang, multilingualSites, normLocale, parseLocales, readSiteLocales, sourceHash, unionLocales } from './_locales'

const now = () => new Date().toISOString()

function channelOf(ctx: any, id: string) {
  const ch = ctx.db.get('channels', id)
  if (!ch || ch.type !== 'creght_site') throw new Error(L(ctx, 'channel_id 要是一个 creght 站点（WordPress 网站这次不做多语言）', "channel_id must be a creght site (WordPress sites don't do languages yet)"))
  return ch
}

export async function read(input: { channel_id: string }, ctx: any) {
  const ch = channelOf(ctx, input?.channel_id)
  const got = await readSiteLocales(ctx, ch)
  ctx.db.update('channels', ch.id, { locales: JSON.stringify(got.locales), default_locale: got.default_locale, locales_read_at: now() })
  return { channel: ch.name, locales: got.locales, default_locale: got.default_locale, multilingual: got.locales.length > 1 }
}

export function setReview(input: { channel_id: string; review: boolean }, ctx: any) {
  const ch = channelOf(ctx, input?.channel_id)
  ctx.db.update('channels', ch.id, { translations_review: !!input.review })
  return { channel: ch.name, review: !!input.review }
}

export type LocaleState = 'source' | 'none' | 'draft' | 'ready' | 'stale'

export async function article(input: { article_id: string }, ctx: any) {
  const a = ctx.db.get('articles', input?.article_id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.article_id)
  const sites = await multilingualSites(ctx)
  if (!sites.length) return { sites: [], locales: [], lang: '', states: [] }
  const all = unionLocales(sites)
  const lang = articleLang(ctx, a, all)
  const hash = sourceHash(a)
  const rows = ctx.db.query('article_translations', { where: { article_id: a.id }, limit: 100 }).list as any[]
  const pubs = ctx.db.query('publications', { where: { article_id: a.id }, limit: 50 }).list as any[]
  const states = all.locales.map((locale) => {
    if (locale === lang) return { locale, state: 'source' as LocaleState }
    const t = rows.find((r) => normLocale(r.locale) === locale)
    if (!t) return { locale, state: 'none' as LocaleState }
    const state: LocaleState = t.source_hash && t.source_hash !== hash ? 'stale' : t.status === 'ready' ? 'ready' : 'draft'
    return { locale, state, id: t.id, status: t.status || 'draft', title: t.title ?? '', summary: t.summary ?? '', body: t.body ?? '', keywords: t.keywords ?? '', chat_id: t.chat_id ?? '', updated_at: t.updated_at || t.created_at || '' }
  })
  return {
    lang,
    article_lang: a.lang ?? '',
    locales: all.locales,
    default_locale: all.default_locale,
    sites: sites.map(({ ch, site }) => {
      const p = pubs.find((x) => x.channel_id === ch.id)
      let urls: Record<string, string> = {}
      try {
        urls = JSON.parse(p?.locale_urls || '{}')
      } catch {}
      return { id: ch.id, name: ch.name, locales: site.locales, default_locale: site.default_locale, review: !!ch.translations_review, url: p?.url ?? '', urls, published: parseLocales(p?.locales) }
    }),
    states,
  }
}

export function setLang(input: { article_id: string; lang: string }, ctx: any) {
  const a = ctx.db.get('articles', input?.article_id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.article_id)
  const lang = normLocale(input.lang)
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(lang)) throw new Error(L(ctx, 'lang 要是语言代码，比如 en、zh、pt-br', 'lang must be a language code, e.g. en, zh, pt-br'))
  ctx.db.update('articles', a.id, { lang })
  return { article_id: a.id, lang }
}

