// 文章发布到网站的公共函数（文件名以 _ 开头：只给别的文件 import）。
//
// 每个网站一个发布脚本 local/pub_<网站 id>.ts，由助手按任务 tasks/setup-publish.md 看过这个网站的 CMS 后写：
// 字段怎么对应、正文要 HTML 还是 Markdown、封面和分类怎么填、文章地址怎么拼，全在脚本里，系统不猜。
// 脚本用这里的 publishTo 包一层，发布状态、发布记录（publications 表）、效果追踪都由它统一处理：
//
//   import { publishTo, slugOf, markdown, creght } from './_publish'
//   export async function publish(input: { article_id: string; dry?: boolean }, ctx: any) {
//     return publishTo(ctx, input, '<网站 id>', async ({ a, ch, prev, dry }) => {
//       const slug = prev?.slug || slugOf(a)
//       const body = { title: a.title, content: markdown(ctx, a.body), cover: a.cover }   // 按这个网站的字段写
//       const url = `https://…/blog/${slug}`
//       if (dry) return { collection: 'posts', slug, body, url }                 // 试发：只返回要发的内容
//       const cms_id = prev?.cms_id
//         ? (await creght.update(ctx, ch.project_id, 'posts', prev.cms_id, slug, body), prev.cms_id)
//         : await creght.create(ctx, ch.project_id, 'posts', slug, body)
//       return { cms_id, collection: 'posts', slug, url }
//     })
//   }

import { L } from './_i18n'
import { contents, createContent, getContent, updateContent, uploadAsset, type LocalFile } from './_creght'
import { wp, wpUpload } from './_wp'
import { trackChange } from './_review'
import { articleLang, changedFields, localeURL, mergeI18n, normLocale, siteLocales, TEXT_FIELDS, type LocaleText, type SiteLocales } from './_locales'

export type Article = { id: string; title: string; summary?: string; body?: string; video?: string; cover?: string; keywords?: string; slug?: string; status: string; url?: string; published_at?: string; topic_id?: string; lang?: string }
export type Channel = { id: string; name: string; type: string; project_id?: string; site_id?: string; preview_url?: string; wp_user?: string; wp_secret?: string; publisher?: string; publish_status?: string; article_collection?: string; locales?: string; default_locale?: string; translations_review?: boolean }
export type Publication = { id: string; article_id: string; channel_id: string; status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed'; scheduled_at?: string; title?: string; summary?: string; body?: string; video?: string; keywords?: string; cms_id?: string; cms_collection?: string; slug?: string; url?: string; media?: string; error?: string; warning?: string; published_at?: string; updated_at?: string; locales?: string; locale_urls?: string }

/** 发布脚本返回的结果：真发时要有 cms_id 和 url；试发（dry）时返回要发出去的内容，原样交给调用方看 */
export type SendResult = { cms_id?: string; collection?: string; slug?: string; url?: string; [k: string]: unknown }
type Send = (x: { a: Article; ch: Channel; prev: Publication | null; dry: boolean }) => Promise<SendResult>

const now = () => new Date().toISOString()

/** 文章没写 slug：用标题里的英文数字，没有就按日期 + id 生成 */
export function slugOf(a: Article) {
  if (a.slug) return a.slug
  const ascii = a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (ascii.length >= 8) return ascii.slice(0, 60)
  return `post-${now().slice(0, 10).replace(/-/g, '')}-${a.id.slice(-4)}`
}

/** 网站文章可选视频：只允许公开 https 素材，不将 local: 本机文件错误发布到网站。 */
function publicVideo(a: Article) {
  if (a.video && !/^https:\/\/[^\s"<>]+$/.test(a.video)) throw new Error('文章视频须为公开 https 素材地址，请先上传到资料库')
  return a.video || ''
}
export function articleHtml(a: Article) {
  const video = publicVideo(a)
  if (!video) return a.body ?? ''
  const src = video.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<figure><video controls playsinline preload="metadata" src="${src}"></video></figure>${a.body ?? ''}`
}
/** Markdown 站点保留视频的可点击链接，避免 HTML 转换时丢失视频播放器。 */
export const articleMarkdown = (ctx: any, a: Article) => `${publicVideo(a) ? `[观看视频](${publicVideo(a)})\n\n` : ''}${ctx.html(a.body ?? '').markdown()}`
/** 正文（后台里存的是 HTML）转 Markdown：网站的正文字段要 Markdown 时用 */
export const markdown = (ctx: any, html?: string) => ctx.html(html ?? '').markdown()
/** 正文的纯文本（摘要字段为空、要截一段时用） */
export const plainText = (ctx: any, html?: string) => ctx.html(html ?? '').text()
/** 正文里的图片地址 */
export const imagesIn = (ctx: any, html?: string): string[] =>
  html ? ctx.html(html).find('img[src]').map((i: any) => String(i.attrs.src)).filter((u: string) => /^https?:\/\//.test(u)) : []
/** 只在这台电脑上能打开的地址：页面上传的 /_annulo/uploaded/…（老数据带 127.0.0.1 和端口）、AI 做的 local:…、内容文件夹里的 folder:… / work:… */
export const isLocalSrc = (u: string) => /^(?:(?:https?:\/\/(?:127\.0\.0\.1|localhost):\d+)?\/_(?:annulo|shuttle)\/uploaded\/|local:|folder:|work:)/.test(u)
/** 正文里只在这台电脑上能打开的图片 */
export const localImagesIn = (ctx: any, html?: string): string[] =>
  html ? [...new Set<string>(ctx.html(html).find('img[src]').map((i: any) => String(i.attrs.src)).filter(isLocalSrc))] : []

/** 这个网站怎么传图：creght 站点传到站点素材库，WordPress 传到媒体库；别的没有 */
function uploaderOf(ctx: any, ch: Channel): ((f: LocalFile) => Promise<string>) | null {
  if (ch.type === 'creght_site' && ch.project_id && ch.site_id) return (f) => uploadAsset(ctx, ch.project_id!, ch.site_id!, f)
  if (ch.type === 'wordpress') return (f) => wpUpload(ctx, ch, f)
  return null
}

/**
 * 发布前把正文里的本机图片传到网站，地址换成网站上的。media 是这篇在这个网站上传过的（文件内容的 sha256 → 网站上的地址），
 * 同一张图再发不重传；传了几张后失败，已经传的也记下来。
 */
async function hostImages(ctx: any, a: Article, ch: Channel, media: Record<string, string>) {
  const cover = a.cover && isLocalSrc(a.cover) ? a.cover : ''
  const srcs = [...new Set([...localImagesIn(ctx, a.body), ...(cover ? [cover] : [])])]
  if (!srcs.length) return
  if (typeof ctx.file !== 'function') throw new Error(L(ctx, '正文里有这台电脑上的图片，要先更新 Annulo 才能传到网站', 'The body has images stored on this computer: update Annulo to upload them to the site'))
  const upload = uploaderOf(ctx, ch)
  if (!upload) throw new Error(L(ctx, `正文里有这台电脑上的图片，「${ch.name}」还不支持自动传图：换成网上的图片地址再发`, `The body has images stored on this computer and "${ch.name}" can't take uploads yet: use online image URLs instead`))
  let body = a.body ?? ''
  for (const src of srcs) {
    const f: LocalFile = ctx.file(src)
    let url = media[f.sha256]
    if (!url) {
      try {
        url = await upload(f)
      } catch (e: any) {
        throw new Error(L(ctx, `图片「${f.name}」传到网站失败：`, `Failed to upload image "${f.name}" to the site: `) + (e?.message ?? String(e)))
      }
      media[f.sha256] = url
    }
    const esc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    body = body.replace(new RegExp(`(src=["'])${esc}(["'])`, 'g'), (_m, l, r) => l + url + r)
    if (src === cover) a.cover = url
  }
  a.body = body
}

/**
 * 发布脚本拿到的 a.cover：文章设了封面用它，没设用正文第一张图（都已经是网站上的地址）。
 * 记下脚本有没有读 a.cover：文章设了封面、脚本却没读，是配置发布时还没有封面字段的老脚本，发完提醒用户让助手更新
 */
function coverFor(ctx: any, a: Article) {
  const own = a.cover || ''
  const value = own || imagesIn(ctx, a.body)[0] || ''
  let read = false
  Object.defineProperty(a, 'cover', { get: () => ((read = true), value), enumerable: true, configurable: true })
  return { unused: () => !!own && !read }
}
const coverWarning = (ctx: any) => L(ctx, '这篇设了封面，但这个网站的发布脚本是旧的，没用上（网站上还是正文第一张图或没有封面）：点「让 AI 更新发布脚本」，更新后再发一次',
  "This article has a cover, but this site's publish script is older and didn't use it (the site still shows the first body image or no cover). Click \"Have AI update the publish script\", then publish again")

const mediaOf = (p: Publication | null): Record<string, string> => {
  try {
    return p?.media ? JSON.parse(p.media) : {}
  } catch {
    return {}
  }
}

/** 今天的日期 YYYY-MM-DD */
export const today = () => now().slice(0, 10)

/** creght 站点的 CMS：列内容、新建（返回内容 id）、更新 */
export const creght = { contents, create: createContent, update: updateContent }
/** WordPress 的 REST 接口（带应用密码）：wp(ctx, ch, '/wp/v2/posts', { method: 'POST', body }) */
export { wp }

// ---- 多语言网站（docs/multilingual.md）----
// 发布脚本不用管语言：默认语言的内容照常交给脚本发；别的语言，把译文代进文章、让脚本试发（dry）一次，
// 和原文试发出来的 body 比，不一样的字段就是这种语言的译文，发完后写进这条内容的 body._i18n.<语言>。

type LocalePlan = { site: SiteLocales; lang: string; texts: Record<string, LocaleText>; others: string[] }

/** 这篇在这个网站上每种语言用什么内容；单语言网站返回 null。默认语言既不是原文、也没有译文时不能发 */
function localePlan(ctx: any, a: Article, ch: Channel): LocalePlan | null {
  const site = siteLocales(ch)
  if (!site) return null
  const lang = articleLang(ctx, a, site)
  const texts: Record<string, LocaleText> = { [lang]: { title: a.title, summary: a.summary, body: a.body, keywords: a.keywords } }
  let rows: any[] = []
  try {
    rows = ctx.db.query('article_translations', { where: { article_id: a.id }, limit: 100 }).list
  } catch {
    // 老项目还没有这张表：当没有译文
  }
  for (const t of rows) {
    const l = normLocale(t.locale)
    if (l === lang || !site.locales.includes(l)) continue
    if (ch.translations_review && t.status !== 'ready') continue
    texts[l] = { title: t.title, summary: t.summary, body: t.body, keywords: t.keywords }
  }
  if (!texts[site.default_locale])
    throw new Error(L(ctx, `这篇是 ${lang} 写的，「${ch.name}」的默认语言是 ${site.default_locale}：先在文章页把它翻成 ${site.default_locale} 再发`, `This article is in ${lang} and the default language of "${ch.name}" is ${site.default_locale}: translate it into ${site.default_locale} on the article page first`))
  return { site, lang, texts, others: site.locales.filter((l) => l !== site.default_locale && texts[l]) }
}

/** 一种语言的文章：译文空着的字段（没翻摘要、关键词）照用原文；别的（封面、图片、视频、slug）都跟着原文 */
const withText = (a: Article, t: LocaleText): Article => {
  const out: Article = { ...a }
  for (const k of TEXT_FIELDS) if (String(t[k] ?? '').trim()) (out as any)[k] = t[k]
  return out
}

/** 用发布脚本的试发算每种语言的 body，再和默认语言的比出要写进 _i18n 的字段 */
async function localeBodies(ctx: any, plan: LocalePlan, a: Article, ch: Channel, prev: Publication | null, send: Send) {
  const cover = a.cover || imagesIn(ctx, a.body)[0] || ''
  const bodyOf = (r: SendResult) => (r && typeof r.body === 'object' && r.body && !Array.isArray(r.body) ? (r.body as Record<string, unknown>) : null)
  const out = { i18n: {} as Record<string, Record<string, unknown>>, errors: {} as Record<string, string>, oldScript: false, collection: undefined as string | undefined }
  let main: SendResult
  try {
    main = await send({ a: { ...a, cover }, ch, prev, dry: true })
  } catch (e: any) {
    // 原文试发都不行：别的语言算不出来，默认语言照常发（真发出错由真发报）
    for (const l of plan.others) out.errors[l] = e?.message ?? String(e)
    return out
  }
  const mainBody = bodyOf(main)
  out.collection = main?.collection as string | undefined
  out.oldScript = !mainBody
  if (!mainBody) return out
  for (const l of plan.others) {
    try {
      const r = await send({ a: { ...withText(a, plan.texts[l]), cover, slug: (main.slug as string) || a.slug }, ch, prev, dry: true })
      const body = bodyOf(r)
      if (!body) throw new Error(L(ctx, '试发没有返回 body', 'The dry run returned no body'))
      const diff = changedFields(mainBody, body)
      if (Object.keys(diff).length) out.i18n[l] = diff
    } catch (e: any) {
      out.errors[l] = e?.message ?? String(e)
    }
  }
  return out
}
type LocaleBodies = Awaited<ReturnType<typeof localeBodies>>

const oldScriptWarning = (ctx: any) => L(ctx, '这个网站开了多语言，但发布脚本是旧的（试发时没有返回 body），算不出各语言的字段：这次只发了默认语言。点「让 AI 更新发布脚本」，更新后再发一次',
  "This site has several languages, but its publish script is older (its dry run returns no body), so the other languages couldn't be mapped: only the default language went out. Click \"Have AI update the publish script\", then publish again")

/** 发完默认语言后写 _i18n：先读出线上的，保留后台不管的语言（用户在 creght 编辑器里手动翻的），只换这次有的 */
async function writeI18n(ctx: any, ch: Channel, collection: string, cmsId: string, bodies: LocaleBodies) {
  const ours = bodies.i18n
  if (!Object.keys(ours).length || !ch.project_id || !collection) return
  const online = await getContent(ctx, ch.project_id, collection, cmsId)
  const merged = mergeI18n(online?.body?._i18n, ours)
  if (JSON.stringify(merged) === JSON.stringify(online?.body?._i18n ?? null)) return
  await updateContent(ctx, ch.project_id, collection, cmsId, '', { _i18n: merged })
}

/** 这次多语言发布的结果：发上去的语言、各语言网址、要提醒的（脚本旧了、某种语言没发上去） */
function localeOutcome(ctx: any, plan: LocalePlan, bodies: LocaleBodies | null, url: string, writeError = '') {
  const sent = bodies && !bodies.oldScript && !writeError ? plan.others.filter((l) => !bodies.errors[l]) : []
  const locales = [plan.site.default_locale, ...sent]
  const locale_urls: Record<string, string> = {}
  if (url) for (const l of locales) locale_urls[l] = localeURL(url, l, plan.site.default_locale)
  const warnings: string[] = []
  if (bodies?.oldScript) warnings.push(oldScriptWarning(ctx))
  for (const [l, msg] of Object.entries(bodies?.errors ?? {})) warnings.push(L(ctx, `${l} 的译文没发上去：${msg}`, `The ${l} translation didn't go out: ${msg}`))
  if (writeError) warnings.push(L(ctx, `默认语言发好了，其他语言的译文没写上去：${writeError}`, `The default language went out, but the other languages weren't written: ${writeError}`))
  return { locales, locale_urls, warning: warnings.join('\n') }
}

/** 这篇文章在这个网站上的发布记录（没有返回 null） */
export function publicationOf(ctx: any, articleId: string, channelId: string): Publication | null {
  return (ctx.db.query('publications', { where: { article_id: articleId, channel_id: channelId }, limit: 1 }).list[0] as Publication) ?? null
}

function upsert(ctx: any, prev: Publication | null, a: Article, ch: Channel, patch: Partial<Publication>) {
  const row = { article_id: a.id, channel_id: ch.id, ...patch, updated_at: now() }
  if (prev) ctx.db.update('publications', prev.id, row)
  else return ctx.db.insert('publications', row) as Publication
  return { ...prev, ...row } as Publication
}

/**
 * 发布脚本的外壳：读文章和网站，dry 时直接返回 send 的结果；真发时记「发布中」，send 成功记「已发布」
 * （第一次发到这个网站进效果追踪），失败记「失败」和报错原文再抛出。同一篇文章再发就是更新（prev 里有上次的 cms_id）。
 */
export async function publishTo(ctx: any, input: { article_id: string; dry?: boolean }, channelId: string, send: Send) {
  const source: Article | null = ctx.db.get('articles', input?.article_id)
  if (!source) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.article_id)
  const ch: Channel | null = ctx.db.get('channels', channelId)
  if (!ch) throw new Error(L(ctx, '这个网站已经不在了：', 'This site no longer exists: ') + channelId)
  const prev = publicationOf(ctx, source.id, ch.id)
  // 每个网站可在内容页独立改写；未覆盖的字段始终继承文章。
  const a: Article = { ...source }
  for (const field of ['title', 'summary', 'body', 'video', 'keywords'] as const)
    if (prev?.[field]) a[field] = prev[field]
  if (prev?.slug && !prev.cms_id) a.slug = prev.slug
  // 多语言网站：主字段发默认语言的内容（原文不是默认语言时用它的译文）。
  // 真发时排不出来（缺默认语言的译文）要在下面记成发布失败、清掉排期，不然定时任务每隔几分钟重试
  let plan: LocalePlan | null = null
  let planError: unknown = null
  try {
    plan = localePlan(ctx, a, ch)
  } catch (e) {
    if (input?.dry) throw e
    planError = e
  }
  if (plan && plan.lang !== plan.site.default_locale) Object.assign(a, withText(a, plan.texts[plan.site.default_locale]))
  if (input?.dry) {
    // 试发不传图：列出发布时要传到网站的本机图片
    const local = [...new Set([...localImagesIn(ctx, a.body), ...(a.cover && isLocalSrc(a.cover) ? [a.cover] : []), ...(plan ? plan.others.flatMap((l) => localImagesIn(ctx, plan.texts[l].body)) : [])])]
    const bodies = plan?.others.length ? await localeBodies(ctx, plan, a, ch, prev, send) : null
    const cover = coverFor(ctx, a)
    const r = await send({ a, ch, prev, dry: true })
    let out: Record<string, unknown> = cover.unused() ? { ...r, warning: coverWarning(ctx) } : r
    if (plan) {
      const o = localeOutcome(ctx, plan, bodies, String(r?.url ?? ''))
      out = { ...out, i18n: bodies?.i18n ?? {}, locales: o.locales, locale_urls: o.locale_urls, ...(o.warning ? { warning: [out.warning, o.warning].filter(Boolean).join('\n') } : {}) }
    }
    return local.length ? { ...out, local_images: [...new Set(local)] } : out
  }

  // 开始发就清掉排期：失败了不会每隔几分钟重试，留在发布记录里等用户处理
  const row = upsert(ctx, prev, a, ch, { status: 'publishing', error: '', scheduled_at: '' })
  const media = mediaOf(prev)
  try {
    if (planError) throw planError
    await hostImages(ctx, a, ch, media)
    // 译文正文里的本机图片也传上去（和原文同一张的按内容去重，不重传）
    if (plan) for (const l of plan.others) {
      const t = withText(a, plan.texts[l])
      await hostImages(ctx, t, ch, media)
      plan.texts[l] = { ...plan.texts[l], body: t.body }
    }
    const bodies = plan?.others.length ? await localeBodies(ctx, plan, a, ch, prev, send) : null
    const cover = coverFor(ctx, a)
    const r = await send({ a, ch, prev, dry: false })
    if (!r?.cms_id || !r.url) throw new Error(L(ctx, '发布脚本没有返回内容 id 和文章地址，不确定有没有发成功：到网站后台看一眼，再让助手检查发布脚本', "The publish script returned no content id or URL, so it's unclear whether it worked: check the site, then have the assistant check the script"))
    const t = now()
    let warning = cover.unused() ? coverWarning(ctx) : ''
    let localeRow: Partial<Publication> = {}
    if (plan) {
      // 默认语言已经发上去了：写译文出错不算发布失败，记在提醒里
      let writeError = ''
      try {
        if (bodies && !bodies.oldScript) await writeI18n(ctx, ch, String(r.collection || bodies.collection || prev?.cms_collection || ch.article_collection || ''), String(r.cms_id), bodies)
      } catch (e: any) {
        writeError = e?.message ?? String(e)
      }
      const o = localeOutcome(ctx, plan, bodies, r.url, writeError)
      warning = [warning, o.warning].filter(Boolean).join('\n')
      localeRow = { locales: JSON.stringify(o.locales), locale_urls: JSON.stringify(o.locale_urls) }
    }
    upsert(ctx, row, a, ch, { status: 'published', warning, media: JSON.stringify(media), cms_id: String(r.cms_id), cms_collection: r.collection ?? '', slug: r.slug ?? '', url: r.url, error: '', published_at: prev?.published_at || t, ...localeRow })
    // 文章本身：第一次发出去就算已发布；url 记第一个网站的（发社媒时带这个链接）
    ctx.db.update('articles', a.id, { status: 'published', ...(a.url ? {} : { url: r.url }), ...(a.published_at ? {} : { published_at: t }) })
    if (!prev?.cms_id) trackChange(ctx, { kind: 'article', ref_id: a.id, channel_id: ch.id, title: L(ctx, `发布文章：${a.title}（${ch.name}）`, `Published article: ${a.title} (${ch.name})`), pages: localeRow.locale_urls ? Object.values(JSON.parse(String(localeRow.locale_urls))) as string[] : [r.url] })
    return { ...r, channel: ch.name, updated: !!prev?.cms_id, ...(warning ? { warning } : {}), ...(localeRow.locale_urls ? { locales: JSON.parse(String(localeRow.locale_urls)) } : {}) }
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    upsert(ctx, row, a, ch, { status: 'failed', error: msg, media: JSON.stringify(media) })
    throw new Error(msg)
  }
}
