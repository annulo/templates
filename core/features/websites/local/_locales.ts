// 网站多语言的公共函数（文件名以 _ 开头：只给别的文件 import）。设计见 docs/multilingual.md。
//
// 照 creght 站点自己的多语言做：站点在 talizen.config.ts 里开语言（默认语言不带网址前缀，别的是 /<语言>），
// CMS 一条内容一个 slug，默认语言写在原字段，别的语言写在平台保留字段 body._i18n.<语言>（只放翻译过的字段）。

import { L } from './_i18n'
import { siteBase } from './_site'

export type SiteLocales = { locales: string[]; default_locale: string }
/** 一种语言的内容：和文章同名的几个字段 */
export type LocaleText = { title?: string; summary?: string; body?: string; keywords?: string }
export const TEXT_FIELDS = ['title', 'summary', 'body', 'keywords'] as const

const text = (v: unknown) => String(v ?? '').trim()
export const normLocale = (v: unknown) => text(v).toLowerCase().replace(/_/g, '-')

/** 渠道表里存的语言（JSON 数组字符串） */
export function parseLocales(v: unknown): string[] {
  let list: unknown = v
  if (typeof v === 'string') {
    try {
      list = JSON.parse(v || '[]')
    } catch {
      list = []
    }
  }
  return Array.isArray(list) ? [...new Set(list.map(normLocale).filter(Boolean))] : []
}

/** 这个网站开了几种语言：只有 creght 站点、开了两种以上才算多语言，别的返回 null（和现在一样只发一种） */
export function siteLocales(ch: { type?: string; locales?: unknown; default_locale?: string } | null | undefined): SiteLocales | null {
  if (!ch || ch.type !== 'creght_site') return null
  const locales = parseLocales(ch.locales)
  if (locales.length < 2) return null
  const def = normLocale(ch.default_locale)
  return { locales, default_locale: locales.includes(def) ? def : locales[0] }
}

/**
 * 从 creght 站点的页面里读语言设置：页面里内嵌了 window.TalizenConfig = { …, i18n: {"locale":"zh","locales":[…],"defaultLocale":"en"} }。
 * 没开多语言的站点没有 i18n（或只有一种），返回只有一种语言；页面里根本没有 TalizenConfig 返回 null（不是 creght 站点、页面打不开）
 */
export function parseSiteI18n(html: string): SiteLocales | null {
  const at = html.indexOf('TalizenConfig')
  if (at < 0) return null
  const m = /i18n\s*:\s*(\{[^{}]*\})/.exec(html.slice(at, at + 20000))
  if (!m) return { locales: [], default_locale: '' }
  try {
    const cfg = JSON.parse(m[1])
    const locales = parseLocales(cfg.locales)
    const def = normLocale(cfg.defaultLocale)
    return { locales, default_locale: locales.includes(def) ? def : locales[0] ?? '' }
  } catch {
    return { locales: [], default_locale: '' }
  }
}

/** 抓网站首页读语言设置 */
export async function readSiteLocales(ctx: any, ch: any): Promise<SiteLocales & { base: string }> {
  const base = await siteBase(ch, ctx)
  if (!base) throw new Error(L(ctx, '这个网站还没有能打开的地址，读不到语言设置', "This site has no address that opens yet, so its languages can't be read"))
  const res = await fetch(base + '/')
  if (!res.ok) throw new Error(L(ctx, `打不开网站首页（${res.status}），读不到语言设置`, `Couldn't open the site's home page (${res.status}) to read its languages`))
  const got = parseSiteI18n(await res.text())
  if (!got) throw new Error(L(ctx, '网站首页里没有 creght 站点的配置，读不到语言设置', "The home page has no creght site config, so its languages can't be read"))
  return { ...got, base }
}

/** 在网站的语言里找这种语言：先找一样的，再按主语言（zh-cn → zh） */
export function matchLocale(locales: string[], v: unknown): string {
  const l = normLocale(v)
  if (!l) return ''
  if (locales.includes(l)) return l
  const primary = l.split('-')[0]
  return locales.find((x) => x === primary) ?? locales.find((x) => x.split('-')[0] === primary) ?? ''
}

/** 文章的原文语言：文章的 lang，没有就是选题简报里的 language，再没有就当是网站的默认语言 */
export function articleLang(ctx: any, a: { lang?: string; topic_id?: string }, site: SiteLocales): string {
  let lang = text(a.lang)
  if (!lang && a.topic_id) {
    try {
      const brief = ctx.db.get('topics', a.topic_id)?.brief
      lang = text((typeof brief === 'string' ? JSON.parse(brief || '{}') : brief ?? {}).language)
    } catch {
      // 简报不是 JSON：当没写
    }
  }
  return matchLocale(site.locales, lang) || site.default_locale
}

/** 这种语言的网址：默认语言不带前缀，别的在域名后面加 /<语言>（和 creght 站点的路由一样） */
export function localeURL(url: string, locale: string, def: string) {
  if (!url || locale === def) return url
  const m = /^(https?:\/\/[^/?#]+)(.*)$/.exec(url)
  if (!m) return url
  const rest = m[2] || '/'
  return `${m[1]}/${locale}${rest === '/' ? '' : rest}`
}

/** 原文的指纹：翻译时记下，原文后来改了就对不上（「原文已改」） */
export function sourceHash(a: LocaleText) {
  const s = TEXT_FIELDS.map((k) => text(a[k])).join('\u0001')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16)
}

const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null)

/** 两份 CMS body 里不一样的字段：译文代进文章、发布脚本映射出来，和原文映射出来的比，不一样的就是这种语言要写进 _i18n 的 */
export function changedFields(main: Record<string, unknown>, other: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(other)) if (k !== '_i18n' && !same(main[k], other[k])) out[k] = other[k]
  return out
}

/** 线上已有的 _i18n 和这次的合并：这次有的语言整份换掉，别的语言（比如用户在 creght 编辑器里手动翻的）原样留着 */
export function mergeI18n(online: unknown, ours: Record<string, Record<string, unknown>>) {
  const base = online && typeof online === 'object' && !Array.isArray(online) ? (online as Record<string, unknown>) : {}
  return { ...base, ...ours }
}

/** 渠道表里的多语言网站（creght 站点、开了两种以上语言）；没读过语言的 creght 站点先读一次（读不到不报错：当单语言，记下时间不再每次读） */
export async function multilingualSites(ctx: any) {
  const all = ctx.db.query('channels', { where: { type: 'creght_site' }, limit: 200 }).list as any[]
  for (const ch of all) {
    if (ch.locales_read_at) continue
    try {
      const got = await readSiteLocales(ctx, ch)
      Object.assign(ch, { locales: JSON.stringify(got.locales), default_locale: got.default_locale })
      ctx.db.update('channels', ch.id, { locales: ch.locales, default_locale: ch.default_locale, locales_read_at: new Date().toISOString() })
    } catch (e: any) {
      ctx.log(L(ctx, `读不到「${ch.name}」的语言设置：`, `Couldn't read the languages of "${ch.name}": `) + (e?.message ?? e))
      ctx.db.update('channels', ch.id, { locales_read_at: new Date().toISOString() })
    }
  }
  return all.map((ch) => ({ ch, site: siteLocales(ch) })).filter((x): x is { ch: any; site: SiteLocales } => !!x.site)
}

/** 几个网站的语言合起来（默认语言排前面），和第一个网站的默认语言 */
export function unionLocales(sites: { site: SiteLocales }[]): SiteLocales {
  const locales: string[] = []
  for (const { site } of sites) for (const l of [site.default_locale, ...site.locales]) if (!locales.includes(l)) locales.push(l)
  return { locales, default_locale: sites[0]?.site.default_locale ?? locales[0] ?? '' }
}
