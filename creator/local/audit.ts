// 站点体检（本机函数，Shuttle 在用户电脑上执行，不经过模型）。
//
//   audit.run({ channel_id?, max?, dry? })  抓取渠道站点 → 按清单检查 → 打分 → 写 audit_runs，合并 site_issues
//   dry: true 只抓取和检查、不写表（试跑、排查用）；channel_id 不填 = 所有独立站逐个体检（每周定时）
//   audit.inspect({ url, max? })  检查任意公开网址，返回结果和问题明细；无需渠道、不写表
//   audit.report({ channel_id })  SEO 报告：最近一次体检的分数和四类得分、谷歌收录概况、搜索表现、按影响排好的全站建议、AI 写的优化方案
//   audit.samples({ channel_id })  AI 逐页审查用：每类页面（首页、分类、产品、文章、案例…）挑几页现读，给标题、描述、H1/H2、自己的内容、套话占比、结构化数据、正文开头
//   audit.saveFindings({ channel_id, findings })  存 AI 审查发现的问题（site_issues，check 是 ai.<类>.<名字>），和规则查出的问题一个清单、一样修
//   audit.savePlan({ channel_id, plan })  存 AI 写的全站审查结论和优化方案（任务 tasks/seo-review.md），记在最近一次体检上
//   audit.publish({ channel_id, note? })     「确认上线」：助手修完推到预览、用户在预览里看过后点它——发布站点，再体检一次。
//                                            修好的问题变成已解决并进改站复查；还在的问题从「已修，待上线」退回待修复
//
// 页面「开始体检 / 重新体检」按钮直接调它；命令行 annulo run audit.run --input '{"channel_id":"..."}'。
// 修问题（改站代码）是另一回事：要判断、要改代码，交给助手（site-audit skill）。
// 问题这次没再出现（标成 fixed）= 修复已经上线，记一条改动进改站复查（_review.ts），到期对比前后数据。

import { liveURL, sitePublish, status } from './_creght'
import { isEn, L } from './_i18n'
import { trackChange } from './_review'
import { keywordChecks } from './_audit_keywords'
import { indexChecks, type IndexSummary } from './_audit_index'

// 要电脑的（浏览器、本机授权、密钥、外部接口）：手机上点了转给电脑上开着的 Shuttle 跑（设置 → 远程访问）
export const remote = ['run', 'publish']

type Channel = { id: string; name: string; type: string; project_id?: string; site_id?: string; preview_url?: string; live_url?: string; gsc_property?: string; gsc_link_disabled?: boolean }
type Issue = { id: string; channel_id: string; check: string; status: string; title?: string; pages?: string }

type Page = {
  url: string
  status: number
  error?: string
  html: boolean
  ttfb_ms: number
  load_ms: number
  truncated: boolean
  title: string
  description: string
  robots: string
  canonical: string
  lang: string
  viewport: boolean
  og_title: boolean
  og_image: boolean
  jsonld_types: string[]
  h1: string[]
  h2_count: number
  /** 前 15 个 H2 的文字（AI 审查看页面结构用） */
  h2: string[]
  images: number
  images_no_alt: string[]
  text_chars: number
  internal_links: number
  links: string[]
  /** 跳转后的最终地址（没跳转就是 url） */
  final_url: string
  /** <link rel="alternate" hreflang> 的个数 */
  hreflang: number
  /** https 页面里用 http:// 加载的图片、脚本、样式、iframe（浏览器会拦或者标不安全） */
  insecure: string[]
  /** 页面上看得见的文字（找每页都有的模板段落、算独有内容，最多 2 万字） */
  text: string
  /** alt 是空的图片地址（alt="" 只该用在装饰图上） */
  images_empty_alt: string[]
  /** 按大尺寸加载的图片：地址里要了 2000 像素以上的宽度，又没有 srcset 给小屏换小图 */
  images_big: string[]
  /** 链到本站别的域名（预览地址、系统域名、www 和不带 www 的另一个）的链接 */
  other_host_links: string[]
  /** 结构化数据里不是本站域名的网址（url、@id 这些；图片、sameAs 不算） */
  ld_foreign: string[]
  /** 结构化数据里 Product 写了哪些字段（没有 Product 是 null） */
  ld_product: string[] | null
}

/** 只读体检（任意网址、起步向导）抓几页 */
const DEFAULT_MAX = 40
/** 渠道体检抓全站：sitemap 里的页面都抓，最多这么多 */
const FULL_MAX = 300
/** 能体检的网站渠道：creght 站点、WordPress（「确认上线」只有 creght 站点有） */
const SITE_TYPES = ['creght_site', 'wordpress']
const FILE_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|mp3|css|js|xml|txt|json|ico)$/i

const hostOf = (u: string) => (/^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(u)?.[1] ?? '').toLowerCase()
const pathOf = (u: string) => {
  try {
    return new URL(u).pathname || '/'
  } catch {
    return u
  }
}
const normalize = (u: string) => {
  try {
    const x = new URL(u)
    // 老版本的 Annulo 运行时 https://a.com 的 pathname 是空串：当成 /，首页带不带 / 是同一页
    return `${x.protocol}//${x.host}${x.pathname || '/'}`
  } catch {
    return ''
  }
}
/** 中文按字算：用码点数 */
const chars = (s: string) => [...s].length

/** 体检的目标地址：发布过就用正式域名（自定义域名优先），没发布过用预览地址（预览会带 noindex，那不算问题） */
async function target(ch: Channel, ctx: any): Promise<{ url: string; preview: boolean }> {
  // WordPress 没有预览环境：填的地址就是线上站点
  if (ch.type === 'wordpress') {
    if (!ch.preview_url) throw new Error(L(ctx, `渠道「${ch.name}」没有站点地址`, `Channel "${ch.name}" has no site URL`))
    return { url: ch.preview_url.replace(/\/$/, ''), preview: false }
  }
  if (ch.project_id && ch.site_id) {
    try {
      const live = await liveURL(ctx, ch)
      if (live) return { url: live, preview: false }
    } catch (e: any) {
      ctx.log(L(ctx, '读不到发布状态，用预览地址：', "Couldn't read publish status, using the preview URL: ") + e.message)
    }
  }
  if (!ch.preview_url) throw new Error(L(ctx, `渠道「${ch.name}」没有访问地址`, `Channel "${ch.name}" has no URL`))
  return { url: ch.preview_url.replace(/\/$/, ''), preview: true }
}

/** 结构化数据里指向页面的字段（图片、sameAs 这些指到别的网站是正常的，不看） */
const LD_URL_KEYS = ['url', '@id', 'mainEntityOfPage', 'item', 'target']

/** 一段 JSON-LD：有哪些 @type、指向页面的网址、Product 写了哪些字段 */
function ldInfo(raw: string): { types: string[]; urls: string[]; product: string[] | null } {
  const types: string[] = []
  const urls: string[] = []
  let product: string[] | null = null
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach(walk)
    const t = v['@type']
    const ts = typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter((x) => typeof x === 'string') : []
    types.push(...ts)
    if (ts.includes('Product')) product = Object.keys(v)
    for (const [k, x] of Object.entries(v)) {
      if (LD_URL_KEYS.includes(k) && typeof x === 'string' && /^https?:\/\//.test(x)) urls.push(x)
      else if (typeof x === 'object' && !['image', 'logo', 'sameAs', 'thumbnailUrl', 'contentUrl'].includes(k)) walk(x)
    }
  }
  try {
    walk(JSON.parse(raw))
  } catch {
    // 写坏的 JSON-LD 当作没有
  }
  return { types, urls, product }
}

/** www.example.com ↔ example.com：同一个站的另一个写法 */
const twinHost = (h: string) => (h.startsWith('www.') ? h.slice(4) : 'www.' + h)

/** own：本站的别的域名（预览、系统域名…），链到它们算「用了别的域名」；www 和不带 www 的另一个总是算 */
async function page(r: any, url: string, host: string, ctx: any, own: string[] = []): Promise<Page> {
  const p: Page = {
    url, status: r.status ?? 0, error: r.error, html: false, ttfb_ms: r.timing?.ttfb_ms ?? 0, load_ms: r.timing?.total_ms ?? 0, truncated: !!r.truncated,
    title: '', description: '', robots: '', canonical: '', lang: '', viewport: false, og_title: false, og_image: false,
    jsonld_types: [], h1: [], h2_count: 0, h2: [], images: 0, images_no_alt: [], text_chars: 0, internal_links: 0, links: [],
    final_url: normalize(r.url || url) || url, hreflang: 0, insecure: [],
    text: '', images_empty_alt: [], images_big: [], other_host_links: [], ld_foreign: [], ld_product: null,
  }
  if (r.error || !r.ok) return p
  p.html = /text\/html/.test(r.headers.get('content-type') ?? '') && p.status < 400
  if (!p.html) return p
  const raw = await r.text()
  const doc = ctx.html(raw)
  const meta = (name: string) => doc.find(`meta[name="${name}" i]`)[0]?.attrs.content?.trim() ?? ''
  p.robots = [r.headers.get('x-robots-tag'), meta('robots')].filter(Boolean).join(', ')
  p.title = doc.find('title')[0]?.text ?? ''
  p.description = meta('description')
  p.viewport = doc.find('meta[name="viewport" i]').length > 0
  p.og_title = doc.find('meta[property="og:title"]').length > 0
  p.og_image = doc.find('meta[property="og:image"]').length > 0
  p.canonical = doc.find('link[rel="canonical" i]')[0]?.attrs.href ?? ''
  p.lang = doc.find('html')[0]?.attrs.lang ?? ''
  p.h1 = doc.find('h1').map((h: any) => h.text)
  p.h2_count = doc.find('h2').length
  p.h2 = doc.find('h2').slice(0, 15).map((h: any) => String(h.text ?? '').trim()).filter(Boolean)
  const imgs = doc.find('img')
  p.images = imgs.length
  p.images_no_alt = imgs.filter((i: any) => !('alt' in i.attrs)).slice(0, 10).map((i: any) => i.attrs.src ?? '')
  p.images_empty_alt = imgs.filter((i: any) => 'alt' in i.attrs && !String(i.attrs.alt ?? '').trim()).map((i: any) => String(i.attrs.src ?? ''))
  p.images_big = imgs
    .filter((i: any) => !i.attrs.srcset && Number(/[?&](?:w|width)=(\d+)/i.exec(String(i.attrs.src ?? '').replace(/&amp;/g, '&'))?.[1] ?? 0) >= 2000)
    .map((i: any) => String(i.attrs.src))
  // ctx.html 只给看得见的文字，<script> 里的 JSON-LD 要从源码里读
  for (const script of raw.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json(?=\s|$))/i.test(script[1])) continue
    const ld = ldInfo(script[2])
    p.jsonld_types.push(...ld.types)
    p.ld_foreign.push(...ld.urls.filter((u) => hostOf(u) && hostOf(u) !== host && hostOf(u) !== twinHost(host)))
    if (ld.product) p.ld_product = ld.product
  }
  p.hreflang = doc.find('link[rel="alternate" i][hreflang]').length
  if (url.startsWith('https:'))
    p.insecure = [...doc.find('img[src^="http:"], script[src^="http:"], iframe[src^="http:"]').map((x: any) => x.attrs.src), ...doc.find('link[rel="stylesheet" i][href^="http:"]').map((x: any) => x.attrs.href)].slice(0, 10)
  p.text = doc.text().replace(/\s+/g, ' ').trim().slice(0, 20000)
  p.text_chars = p.text.replace(/\s+/g, '').length
  for (const a of doc.find('a[href]')) {
    let u: URL
    try {
      u = new URL(a.attrs.href, url)
    } catch {
      continue
    }
    const h = u.hostname.toLowerCase()
    if (h !== host && (h === twinHost(host) || own.includes(h)) && /^https?:$/.test(u.protocol)) p.other_host_links.push(u.href)
    if (h !== host || !/^https?:$/.test(u.protocol) || FILE_EXT.test(u.pathname)) continue
    p.links.push(`${u.protocol}//${u.host}${u.pathname}`)
    p.internal_links++
  }
  return p
}

/** sitemap 里的地址；是 sitemap 索引就再展开一层。没有（404、410）是 []，读不到（超时、5xx，重试过）是 null：不能说成「没有 sitemap」 */
async function sitemapURLs(url: string, host: string, limit: number, depth = 0): Promise<string[] | null> {
  let r: any = null
  for (let i = 0; i < 2 && !r?.ok; i++) {
    r = await fetch(url).catch(() => null)
    if (r?.status === 404 || r?.status === 410) return []
  }
  if (!r?.ok) return null
  const xml = await r.text()
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'))
  if (/<sitemapindex/i.test(xml) && depth === 0) {
    const out: string[] = []
    for (const sm of locs) {
      if (out.length >= limit) break
      out.push(...((await sitemapURLs(sm, host, limit - out.length, 1)) ?? []))
    }
    return out
  }
  return locs.filter((u) => hostOf(u) === host || hostOf(u) === twinHost(host)).slice(0, limit)
}

/**
 * 地址会跳转（不带 www 跳到 www、http 跳到 https）时换成跳转后的地址：不然每一页都多跳一次、canonical 也都对不上。
 * 网站一时没响应就再试，最多 3 次（第一次试的时候就因为这一步没成，整份结果都错了）
 */
async function resolveBase(base: string, ctx: any): Promise<string> {
  for (let i = 0; i < 3; i++) {
    const r = (await ctx.fetchAll([base]))[0]
    if (r && !r.error) return r.url && hostOf(r.url) ? normalize(r.url) || base : base
  }
  return base
}

type SiteFile = { state: 'present' | 'missing' | 'unknown'; text: string; reason?: string }

/** HTTP 错误、超时和截断不能证明文件不存在；HTML 的 200 兜底页也不是文件。 */
async function siteFile(r: any, kind: 'robots' | 'llms'): Promise<SiteFile> {
  if (r?.status === 404 || r?.status === 410) return { state: 'missing', text: '' }
  if (!r?.ok || r.error || r.truncated)
    return { state: 'unknown', text: '', reason: r?.error || (r?.truncated ? 'incomplete response' : `HTTP ${r?.status ?? 0}`) }
  const text = (await r.text()).replace(/^\uFEFF/, '').trim()
  if (!text) return { state: 'missing', text: '' }
  // 按内容识别，兼容把纯文本错标成 text/html 的服务器；拒绝 HTML/挑战页。
  const html = /<(?:!doctype\s+html|html|head|body|script)(?:\s|>)/i.test(text)
  const valid = kind === 'robots'
    ? /^\s*(?:user-agent|allow|disallow|sitemap)\s*:/im.test(text)
    : !/^[{[]/.test(text)
  if (html || !valid) return { state: 'unknown', text: '', reason: 'unexpected content' }
  return { state: 'present', text }
}

/** 页面属于哪一类：路径的第一段（/product/x → product，/blog/x → blog），首页是 home */
const groupOf = (u: string) => pathOf(u).split('/').filter(Boolean)[0]?.toLowerCase() ?? 'home'

/** sitemap 比能抓的多时，各类页面轮着取：分类页、文章、案例都抽得到，不会只抓到排在前面的几百个产品页 */
function spread(urls: string[], max: number): string[] {
  if (urls.length <= max) return urls
  const groups = new Map<string, string[]>()
  for (const u of urls) {
    const g = groupOf(u)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(u)
  }
  const out: string[] = []
  for (let i = 0; out.length < max; i++) {
    const before = out.length
    for (const g of groups.values()) if (i < g.length && out.length < max) out.push(g[i])
    if (out.length === before) break
  }
  return out
}

/** 抓取：首页 + sitemap 里的页面（多了就各类轮着取）；没有 sitemap 就顺着站内链接广度优先。own 是本站别的域名（见 page） */
async function crawl(base: string, max: number, ctx: any, own: string[] = []) {
  base = await resolveBase(base, ctx)
  const root = new URL(base).origin
  const start = normalize(base)
  const host = hostOf(root)
  const paths = [root + '/robots.txt', root + '/llms.txt']
  const responses = await ctx.fetchAll(paths)
  const files = await Promise.all(responses.map((r: any, i: number) => siteFile(r, i === 0 ? 'robots' : 'llms')))
  // 临时失败重试一次，避免一次网络抖动留下误报。
  const retry = files.map((f: SiteFile, i: number) => f.state === 'unknown' ? i : -1).filter((i: number) => i >= 0)
  if (retry.length) {
    const rs = await ctx.fetchAll(retry.map((i: number) => paths[i]))
    for (let n = 0; n < retry.length; n++) files[retry[n]] = await siteFile(rs[n], retry[n] === 0 ? 'robots' : 'llms')
  }
  const [robots, llms] = files as SiteFile[]
  const sitemap = new URL(/^\s*sitemap:\s*(\S+)/im.exec(robots.text)?.[1] ?? '/sitemap.xml', root).href
  // sitemap 全读（数出一共多少页、判断页面在不在 sitemap 里），抓前 max 个
  const read = await sitemapURLs(sitemap, host, 5000)
  // sitemap 里写的是 www 的另一个写法（首页没读到、没换过来）：按 sitemap 里的写
  const sitemapAll = (read ?? []).map((u) => (hostOf(u) === host ? u : u.replace('//' + hostOf(u), '//' + host)))
  const fromSitemap = spread(sitemapAll, max)

  const pages: Page[] = []
  const seen = new Set<string>()
  let queue = [start, root + '/', ...fromSitemap]
  while (queue.length && pages.length < max) {
    const batch: string[] = []
    for (const u of queue.map(normalize)) {
      if (u && !seen.has(u) && pages.length + batch.length < max) {
        seen.add(u)
        batch.push(u)
      }
    }
    queue = []
    if (!batch.length) break
    ctx.progress({ done: pages.length, total: Math.max(max, pages.length + batch.length), message: L(ctx, `正在抓取 ${pages.length + 1}~${pages.length + batch.length} 页`, `Crawling pages ${pages.length + 1}–${pages.length + batch.length}`) })
    const rs = await ctx.fetchAll(batch)
    for (let i = 0; i < batch.length; i++) {
      const p = await page(rs[i], batch[i], host, ctx, own)
      pages.push(p)
      if (!fromSitemap.length) queue.push(...p.links)
    }
  }
  // 请求失败的（超时、连接断了，不是 404 这种）最后再试一次：抓得多的时候网站偶尔顶不住，别算成打不开
  const failed = pages.map((p, i) => (p.error ? i : -1)).filter((i) => i >= 0)
  if (failed.length) {
    ctx.progress({ done: pages.length, total: pages.length, message: L(ctx, `${failed.length} 个页面没读到，再试一次`, `Retrying ${failed.length} pages that didn't load`) })
    const rs = await ctx.fetchAll(failed.map((i) => pages[i].url))
    for (let n = 0; n < failed.length; n++) pages[failed[n]] = await page(rs[n], pages[failed[n]].url, host, ctx, own)
  }
  return { root, robots, llms, has_sitemap: fromSitemap.length > 0, sitemap_unknown: read === null, sitemap_urls: sitemapAll.map(normalize).filter(Boolean), pages }
}

/**
 * AI 爬虫（docs/site-audit.md「AI 爬虫准入」）。search：拦了 ChatGPT、Perplexity 这些搜索时就读不到这个站，AI 搜索推荐不到你；
 * 其余是训练用的，拦了只影响以后的模型知不知道你，有的公司是有意拦的。
 */
const AI_BOTS = [
  { ua: 'OAI-SearchBot', zh: 'ChatGPT 搜索', en: 'ChatGPT search', search: true },
  { ua: 'ChatGPT-User', zh: 'ChatGPT 替用户打开网页', en: 'ChatGPT browsing for users', search: true },
  { ua: 'PerplexityBot', zh: 'Perplexity', en: 'Perplexity', search: true },
  { ua: 'Claude-SearchBot', zh: 'Claude 搜索', en: 'Claude search', search: true },
  { ua: 'GPTBot', zh: 'OpenAI 训练', en: 'OpenAI training', search: false },
  { ua: 'ClaudeBot', zh: 'Anthropic 训练', en: 'Anthropic training', search: false },
  { ua: 'Google-Extended', zh: 'Google Gemini 训练', en: 'Google Gemini training', search: false },
  { ua: 'Bytespider', zh: '字节跳动（豆包）', en: 'ByteDance (Doubao)', search: false },
  { ua: 'CCBot', zh: 'Common Crawl（很多模型的训练数据）', en: 'Common Crawl (training data for many models)', search: false },
]

/**
 * robots.txt 对某个爬虫：blocked 整站禁止（Disallow: /，没有 Allow）；partial 整站禁止但放行了部分路径；allowed 其余。
 * 只禁止后台、购物车这类路径不算拦（几乎每个站都这样，不影响 AI 读内容）。有专门写给它的组就用那组，没有就用 *。
 */
function robotsAccess(text: string, ua: string): 'allowed' | 'partial' | 'blocked' {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = []
  let cur: (typeof groups)[number] | null = null
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, '').match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }))
      cur.agents.push(m[2].toLowerCase())
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      cur.rules.push({ allow: key === 'allow', path: m[2] })
    }
  }
  const name = ua.toLowerCase()
  const g = groups.find((x) => x.agents.some((a) => a !== '*' && name.includes(a))) ?? groups.find((x) => x.agents.includes('*'))
  if (!g) return 'allowed'
  const root = g.rules.some((r) => !r.allow && (r.path === '/' || r.path === '/*'))
  if (!root) return 'allowed'
  return g.rules.some((r) => r.allow && r.path && r.path !== '/' && r.path !== '/*') ? 'partial' : g.rules.some((r) => r.allow && (r.path === '/' || r.path === '/*')) ? 'allowed' : 'blocked'
}

type Found = { check: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; pages: string[] }

/** 检查清单：每项的严重程度固定 */
/** 一段文字切成词（英文按单词，中文按字）：找模板文字用 */
const tokensOf = (t: string) => (/[\u4e00-\u9fff]/.test(t) ? t.replace(/\s+/g, '').split('') : t.toLowerCase().match(/[a-z0-9\u00c0-\u024f]+/g) ?? [])

/**
 * 每页「自己的内容」：页面文字按 8 个词（中文 16 个字）一组，40% 以上的页面都有的组是全站模板（导航、页脚、询价表单），
 * 同一类页面（路径第一段一样）3 页以上都有的组是这一类的套话（每个分类页都一样的介绍、同一系列产品页都一样的卖点）。
 * own：去掉全站模板和这一类模板后剩下多少词（字）；template：这一类模板占了去掉全站模板后的多少；sample：这一类模板里的一句话（举例用）
 */
function contentOf(pages: Page[]): Map<string, { own: number; template: number; min: number; cjk: boolean; sample: string }> {
  const out = new Map<string, { own: number; template: number; min: number; cjk: boolean; sample: string }>()
  const shingles = new Map<string, string[]>()
  for (const p of pages) {
    const cjk = /[\u4e00-\u9fff]/.test(p.text)
    const tk = tokensOf(p.text)
    const n = cjk ? 16 : 8
    const list: string[] = []
    for (let i = 0; i + n <= tk.length; i += 1) list.push(tk.slice(i, i + n).join(cjk ? '' : ' '))
    shingles.set(p.url, list)
  }
  const count = (ps: Page[]) => {
    const c = new Map<string, number>()
    for (const p of ps) for (const x of new Set(shingles.get(p.url))) c.set(x, (c.get(x) ?? 0) + 1)
    return c
  }
  const site = count(pages)
  const siteMin = pages.length >= 5 ? Math.ceil(pages.length * 0.4) : Infinity
  const groups = new Map<string, Page[]>()
  for (const p of pages) groups.set(groupOf(p.url), [...(groups.get(groupOf(p.url)) ?? []), p])
  for (const [, ps] of groups) {
    const g = count(ps)
    // 同一类里 3 页以上（而且至少一成）都有的就是这一类的套话：边几、餐桌各套各的，单看「一半以上的产品页都有」查不出来
    // 页面少的类（十来篇博客）要三成以上都有才算，免得「相关文章」这种列表被当成套话
    const gMin = ps.length < 3 ? Infinity : Math.max(3, Math.ceil(ps.length * (ps.length < 30 ? 0.3 : 0.1)))
    for (const p of ps) {
      const list = shingles.get(p.url)!
      const cjk = /[\u4e00-\u9fff]/.test(p.text)
      // 每个词算不算「自己的」：盖住它的组里有一个不是模板就算
      const tk = tokensOf(p.text)
      const n = cjk ? 16 : 8
      const mine = new Array(tk.length).fill(false)
      const inGroup = new Array(tk.length).fill(false)
      const notSite = new Array(tk.length).fill(false)
      let sample = ''
      list.forEach((x, i) => {
        const isSite = (site.get(x) ?? 0) >= siteMin
        const isGroup = !isSite && (g.get(x) ?? 0) >= gMin
        for (let k = i; k < i + n; k++) {
          if (!isSite) notSite[k] = true
          if (isGroup) inGroup[k] = true
          if (!isSite && !isGroup) mine[k] = true
        }
        if (isGroup && !sample) sample = x
      })
      // 盖住它的组都是模板才算模板：mine 里已经是 true 的不算
      const own = mine.filter(Boolean).length
      const rest = notSite.filter(Boolean).length
      const tplN = inGroup.filter((v, k) => v && !mine[k]).length
      out.set(p.url, { own, template: rest ? tplN / rest : 0, min: cjk ? 300 : 150, cjk, sample: sample ? original(p.text, sample, cjk) : '' })
    }
  }
  return out
}

/** 套话在页面上的原文（找模板时比的是小写的词，举例要给用户看页面上写的那句） */
function original(text: string, shingle: string, cjk: boolean): string {
  let at = -1
  if (cjk) at = text.replace(/\s+/g, '').indexOf(shingle)
  else {
    const words = shingle.split(' ').slice(0, 5).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    at = new RegExp(words.join('[^a-z0-9\\u00c0-\\u024f]+'), 'i').exec(text)?.index ?? -1
  }
  if (at < 0) return shingle.slice(0, 120)
  const src = cjk ? text.replace(/\s+/g, '') : text
  const cut = src.slice(at, at + 140)
  return (cut.length === 140 ? cut.replace(/\s+\S*$/, '') : cut).trim()
}

/** 同一类页面里，按同一个模板生成的文字（描述这类）：每段文字里一半以上的词在这一类大多数页面都出现，就算模板；这一类有一半以上是这样才报 */
function templated(pages: Page[], text: (p: Page) => string): Page[] {
  const groups = new Map<string, Page[]>()
  for (const p of pages) if (text(p)) groups.set(groupOf(p.url), [...(groups.get(groupOf(p.url)) ?? []), p])
  const out: Page[] = []
  for (const ps of groups.values()) {
    if (ps.length < 5) continue
    const df = new Map<string, number>()
    for (const p of ps) for (const w of new Set(tokensOf(text(p)))) df.set(w, (df.get(w) ?? 0) + 1)
    const hit = ps.filter((p) => {
      const ws = [...new Set(tokensOf(text(p)))]
      return ws.length >= 5 && ws.filter((w) => (df.get(w) ?? 0) >= ps.length * 0.5).length / ws.length >= 0.6
    })
    if (hit.length >= ps.length * 0.5) out.push(...hit)
  }
  return out
}

/** 每项检查的名字（不带好坏，列「已通过」时用） */
const CHECK_NAMES: Record<string, [string, string]> = {
  http_error: ['页面都能打开', 'Pages load'], noindex: ['允许搜索收录', 'Indexable'], title_missing: ['页面标题', 'Page titles'],
  slow_page: ['加载速度', 'Load speed'], title_duplicate: ['标题不重复', 'Unique titles'], desc_missing: ['页面描述', 'Meta descriptions'],
  h1_missing: ['H1 标题', 'H1 headings'], img_alt: ['图片 alt', 'Image alt text'], viewport: ['移动端 viewport', 'Mobile viewport'],
  sitemap: ['sitemap', 'Sitemap'], title_length: ['标题长度', 'Title length'], desc_length: ['描述长度', 'Description length'],
  desc_duplicate: ['描述不重复', 'Unique descriptions'], h1_multiple: ['一页一个 H1', 'One H1 per page'], thin_content: ['正文长度', 'Content length'],
  lang: ['页面语言', 'Page language'], canonical: ['canonical', 'Canonical'], og: ['分享卡片', 'Share cards'],
  structured_data: ['结构化数据', 'Structured data'], robots: ['robots.txt', 'robots.txt'], llms_txt: ['llms.txt', 'llms.txt'], ai_crawlers: ['AI 爬虫准入', 'AI crawler access'],
  // 全站检测加的
  broken_links: ['站内链接', 'Internal links'], redirect_links: ['链接不用跳转', 'Direct links'], sitemap_bad: ['sitemap 里的页面', 'Sitemap pages'],
  missing_from_sitemap: ['页面都在 sitemap 里', 'Pages in sitemap'], orphan: ['页面都有链接指向', 'Linked pages'], canonical_home: ['canonical 不指首页', 'Canonical not home'],
  canonical_other: ['canonical 指向本页', 'Self canonical'], hreflang: ['hreflang', 'hreflang'], content_template: ['正文不套模板', 'Unique body text'],
  desc_template: ['描述不套模板', 'Unique descriptions'], other_domain_links: ['不链到本站别的域名', 'Single domain links'], schema_domain: ['结构化数据的域名', 'Structured data domain'],
  image_size: ['图片大小', 'Image size'], image_many: ['图片数量', 'Image count'], img_alt_empty: ['alt 不为空', 'Non-empty alt'],
  product_schema: ['产品结构化数据', 'Product structured data'], article_schema: ['文章结构化数据', 'Article structured data'], mixed_content: ['没有 http 混合内容', 'No mixed content'],
}

/** 没扣分的检查项（这次检查了、没发现问题）：存进体检记录，页面列成「已通过」，免得用户以为没查 */
function passedOf(ran: string[], found: Found[], ctx: any) {
  const en = isEn(ctx)
  return [...new Set(ran)].filter((c) => !found.some((f) => f.check === c)).map((check) => ({ check, name: CHECK_NAMES[check]?.[en ? 1 : 0] ?? check }))
}

/** 检查清单：每项的严重程度固定。ran 记下这次检查了哪些项（有的项在预览地址、没有 robots.txt 时不查） */
function checks(site: Awaited<ReturnType<typeof crawl>>, preview: boolean, ctx: any, ran: string[] = []): Found[] {
  const en = isEn(ctx)
  const sep = en ? ', ' : '、'
  const list = (ps: Page[], n = 3) => ps.slice(0, n).map((p) => pathOf(p.url)).join(sep) + (ps.length > n ? (en ? ` and ${ps.length - n} more` : ` 等 ${ps.length} 个页面`) : '')
  const html = site.pages.filter((p) => p.html)
  const out: Found[] = []
  const add = (check: string, severity: Found['severity'], title: string, ps: Page[], detail: string) => {
    ran.push(check)
    if (ps.length) out.push({ check, severity, title, detail, pages: ps.map((p) => p.url) })
  }
  const site1 = (check: string, severity: Found['severity'], title: string, bad: boolean, detail: string) => {
    ran.push(check)
    if (bad) out.push({ check, severity, title, detail, pages: [site.root + '/'] })
  }
  const dup = (key: (p: Page) => string) => {
    const by = new Map<string, Page[]>()
    for (const p of html) {
      const k = key(p)
      if (k) by.set(k, [...(by.get(k) ?? []), p])
    }
    return [...by.values()].filter((g) => g.length > 1).flat()
  }

  // 请求失败（超时、断开）重试过还是失败的，多半是抓得多时网站一时没响应，不算打不开；大半页面都这样才报（网站真的打不开）
  const flaky = site.pages.filter((p) => p.error)
  const broken = site.pages.filter((p) => p.status >= 400 || (p.error && flaky.length > site.pages.length / 2))
  add('http_error', 'high', en ? "Pages don't load" : '页面打不开', broken, en ? `${list(broken)} don't load (${broken.map((p) => p.error ? 'request failed' : p.status).slice(0, 3).join(', ')}). Broken links lower how search engines rate the whole site.` : `${list(broken)} 打不开（${broken.map((p) => p.error ? '请求失败' : p.status).slice(0, 3).join('、')}），搜索引擎抓到坏链会降低对全站的评价。`)
  if (!preview) {
    const ni = html.filter((p) => /noindex/i.test(p.robots))
    add('noindex', 'high', en ? 'Pages blocked from indexing' : '页面禁止收录', ni, en ? `${list(ni)} set noindex and won't appear in search results.` : `${list(ni)} 设了 noindex，不会出现在搜索结果里。`)
  }
  const noTitle = html.filter((p) => !p.title)
  add('title_missing', 'high', en ? 'Missing page title' : '缺少页面标题', noTitle, en ? `${list(noTitle)} have no title; set it with the page's metadata.title.` : `${list(noTitle)} 没有标题，用页面的 metadata.title 设置。`)

  const slow = html.filter((p) => p.ttfb_ms > 3000 || p.load_ms > 8000 || p.truncated)
  add('slow_page', 'medium', en ? 'Slow pages' : '页面加载过慢', slow, en ? `Slow pages hurt rankings and bounce rate: ${slow.slice(0, 3).map((p) => `${pathOf(p.url)} ${p.truncated ? "didn't finish loading" : `first byte ${(p.ttfb_ms / 1000).toFixed(1)}s, load ${(p.load_ms / 1000).toFixed(1)}s`}`).join('; ')}.` : `页面太慢，影响排名和跳出率：${slow.slice(0, 3).map((p) => `${pathOf(p.url)} ${p.truncated ? '没加载完' : `首字节 ${(p.ttfb_ms / 1000).toFixed(1)} 秒、加载 ${(p.load_ms / 1000).toFixed(1)} 秒`}`).join('；')}。`)
  const dupTitle = dup((p) => p.title)
  add('title_duplicate', 'medium', en ? 'Duplicate page titles' : '多个页面标题相同', dupTitle, en ? `${list(dupTitle)} share the same title; give each page a title that describes it.` : `${list(dupTitle)} 的标题一样，每页写说明本页内容的标题。`)
  const noDesc = html.filter((p) => !p.description)
  add('desc_missing', 'medium', en ? 'Missing meta description' : '缺少页面描述', noDesc, en ? `${list(noDesc)} have no description — the text under the title in search results, which affects click-through.` : `${list(noDesc)} 没有 description，它是搜索结果里标题下面那段话，影响点击率。`)
  const noH1 = html.filter((p) => !p.h1.length)
  add('h1_missing', 'medium', en ? 'Missing H1' : '缺少 H1 标题', noH1, en ? `Every page needs one H1 stating its topic; ${list(noH1)} have none.` : `每个页面都要有一个 H1 说明主题，${list(noH1)} 没有 H1。`)
  const noAlt = html.filter((p) => p.images_no_alt.length)
  add('img_alt', 'medium', en ? 'Images missing alt' : '图片缺少 alt', noAlt, en ? `${list(noAlt)} have images without alt: describe meaningful images in a sentence, use alt="" for decorative ones.` : `${list(noAlt)} 有图片没写 alt：有内容的图片写一句描述，装饰图用 alt=""。`)
  const noVp = html.filter((p) => !p.viewport)
  add('viewport', 'medium', en ? 'Missing mobile viewport' : '缺少移动端 viewport', noVp, en ? `${list(noVp)} have no viewport, so phones show a shrunken desktop layout.` : `${list(noVp)} 没有 viewport，手机上会按电脑版缩小显示。`)
  site1('sitemap', 'medium', en ? 'No sitemap' : '没有 sitemap', !site.has_sitemap && !site.sitemap_unknown, en ? 'No sitemap.xml found, so new pages get indexed slowly.' : '没找到 sitemap.xml，新页面收录会慢。')

  const badTitleLen = html.filter((p) => p.title && (chars(p.title) < 6 || chars(p.title) > 60))
  add('title_length', 'low', en ? 'Title length off' : '标题长度不合适', badTitleLen, en ? `Titles work best at 6–60 characters: ${badTitleLen.slice(0, 3).map((p) => `${pathOf(p.url)} ${chars(p.title)} chars`).join(', ')}.` : `标题建议 6~60 个字：${badTitleLen.slice(0, 3).map((p) => `${pathOf(p.url)} ${chars(p.title)} 字`).join('、')}。`)
  const badDescLen = html.filter((p) => p.description && (chars(p.description) < 20 || chars(p.description) > 160))
  add('desc_length', 'low', en ? 'Description length off' : '描述长度不合适', badDescLen, en ? `Descriptions work best at 20–160 characters: ${badDescLen.slice(0, 3).map((p) => `${pathOf(p.url)} ${chars(p.description)} chars`).join(', ')}.` : `描述建议 20~160 字：${badDescLen.slice(0, 3).map((p) => `${pathOf(p.url)} ${chars(p.description)} 字`).join('、')}。`)
  const dupDesc = dup((p) => p.description)
  add('desc_duplicate', 'low', en ? 'Duplicate descriptions' : '多个页面描述相同', dupDesc, en ? `${list(dupDesc)} share the same description — usually the site-wide default.` : `${list(dupDesc)} 的描述一样，通常是用了全站默认描述。`)
  const multiH1 = html.filter((p) => p.h1.length > 1)
  add('h1_multiple', 'low', en ? 'More than one H1' : 'H1 多于一个', multiH1, en ? `Keep one H1 per page: ${multiH1.slice(0, 3).map((p) => `${pathOf(p.url)} has ${p.h1.length}`).join(', ')}; make the rest h2.` : `一页只保留一个 H1：${multiH1.slice(0, 3).map((p) => `${pathOf(p.url)} 有 ${p.h1.length} 个`).join('、')}，其余改成 h2。`)
  // 内容页才算「内容太少」：首页和列表页（站内链接多）除外
  // 内容太少：按「这一页自己的内容」算——导航、页脚、每页都有的询价表单这些模板文字不算（见下面 content）
  const content = contentOf(html)
  // 按页面类型汇总（一类几百个产品页一条一条列没法看）：「/product 232 页，平均 100 个词是自己的」
  const byGroup = (ps: Page[]) => {
    const g = new Map<string, Page[]>()
    for (const p of ps) g.set(groupOf(p.url), [...(g.get(groupOf(p.url)) ?? []), p])
    return [...g].sort((a, b) => b[1].length - a[1].length)
  }
  const avgOwn = (ps: Page[]) => Math.round(ps.reduce((n, p) => n + content.get(p.url)!.own, 0) / ps.length)
  const unit = (p?: Page) => (p && content.get(p.url)!.cjk ? (en ? 'characters' : '字') : en ? 'words' : '个词')
  const groupLine = (ps: Page[], extra: (g: Page[]) => string) => byGroup(ps).slice(0, 4).map(([g, gp]) => en ? `/${g === 'home' ? '' : g} (${gp.length} pages${extra(gp)})` : `/${g === 'home' ? '' : g}（${gp.length} 页${extra(gp)}）`).join(sep)
  // 联系、隐私这类功能页本来就没什么内容，不算
  const UTILITY = /^(contact|contact-us|privacy|privacy-policy|terms|cart|checkout|login|account|search|thank-you|thanks|404)$/
  // 文章的分类、标签、翻页这些列表页本来就是标题加链接，也不算
  const listing = (p: Page) => /\/(category|categories|tag|tags|page|author)\//.test(pathOf(p.url) + '/')
  const thin = html.filter((p) => pathOf(p.url) !== '/' && !UTILITY.test(groupOf(p.url)) && !listing(p) && content.get(p.url)!.own < content.get(p.url)!.min)
  add('thin_content', 'medium', en ? 'Thin content' : '页面自己的内容太少', thin, en
    ? `Leaving out the menu, footer and copy repeated across pages, these have little text of their own: ${groupLine(thin, (g) => `, about ${avgOwn(g)} ${unit(g[0])} each`)}. Search engines and AI rarely index or cite pages like this; add what buyers need to know about each specific page — dimensions, materials, options, uses, packing, lead time.`
    : `去掉导航、页脚和各页重复的套话，这些页面自己的内容很少：${groupLine(thin, (g) => `，平均约 ${avgOwn(g)} ${unit(g[0])}`)}。这样的页面搜索引擎和 AI 很少收录、引用：给每一页补上只属于它的内容（尺寸、材质、可选项、用途、包装、交期）。`)
  const noLang = html.filter((p) => !p.lang)
  add('lang', 'low', en ? 'No page language declared' : '没有声明页面语言', noLang, en ? `${list(noLang)} have no lang on <html>.` : `${list(noLang)} 的 <html> 没有 lang。`)
  const noCanon = html.filter((p) => !p.canonical)
  add('canonical', 'low', en ? 'Missing canonical' : '缺少 canonical', noCanon, en ? `${list(noCanon)} have no canonical, so duplicate URLs split ranking signals.` : `${list(noCanon)} 没有 canonical，重复地址会分散权重。`)
  const noOg = html.filter((p) => !p.og_title || !p.og_image)
  add('og', 'low', en ? 'Incomplete share cards' : '分享卡片信息不全', noOg, en ? `${list(noOg)} lack og:title or og:image, so shared links show no title or image.` : `${list(noOg)} 缺 og:title 或 og:image，分享出去没有标题或配图。`)

  // 站内链接：链到打不开的页面、链到会跳转的地址（只认这次抓到的页面）
  // 比地址时不管结尾的 /（sitemap 写 /about、链接写 /about/ 是同一页）
  const key = (u: string) => u.replace(/\/$/, '')
  const byURL = new Map(site.pages.map((p) => [key(p.url), p]))
  const linkTo = (bad: (t: Page) => boolean) => {
    const from: Page[] = []
    const targets = new Set<string>()
    for (const p of html) {
      const hit = [...new Set(p.links)].map((u) => byURL.get(key(u))).filter((t): t is Page => !!t && t.url !== p.url && bad(t))
      if (hit.length) {
        from.push(p)
        hit.forEach((t) => targets.add(pathOf(t.url)))
      }
    }
    return { from, targets: [...targets] }
  }
  const dead = linkTo((t) => t.status >= 400)
  add('broken_links', 'medium', en ? 'Links to pages that don\'t load' : '站内链接指向打不开的页面', dead.from, en ? `${list(dead.from)} link to ${dead.targets.slice(0, 3).join(', ')}${dead.targets.length > 3 ? ` and ${dead.targets.length - 3} more` : ''}, which don't load. Fix or remove these links: crawlers waste time on them and visitors hit dead ends.` : `${list(dead.from)} 链到了 ${dead.targets.slice(0, 3).join('、')}${dead.targets.length > 3 ? ` 等 ${dead.targets.length} 个` : ''}打不开的页面。改成正确地址或删掉这些链接：搜索引擎会在死链上浪费抓取，访客点进去也走不下去。`)
  const moved = linkTo((t) => !t.error && t.status > 0 && t.status < 400 && key(t.final_url) !== key(t.url))
  add('redirect_links', 'low', en ? 'Links that go through a redirect' : '站内链接要跳转一次', moved.from, en ? `${list(moved.from)} link to ${moved.targets.slice(0, 3).join(', ')}, which redirect elsewhere. Link straight to the final address so ranking signals aren't diluted.` : `${list(moved.from)} 链到的 ${moved.targets.slice(0, 3).join('、')} 会跳转到别的地址。直接链到最终地址，权重不会在跳转里损耗，抓取也更快。`)

  // sitemap：只该列能打开、能收录、不跳转的正式地址；被站内链接到的页面也该在里面
  const inSitemap = new Set(site.sitemap_urls.map(key))
  if (inSitemap.size) {
    const badSm = site.pages.filter((p) => inSitemap.has(key(p.url)) && (p.status >= 400 || /noindex/i.test(p.robots) || key(p.final_url) !== key(p.url)))
    add('sitemap_bad', 'medium', en ? 'sitemap lists pages it shouldn\'t' : 'sitemap 里有不该列的页面', badSm, en ? `${list(badSm)} are in the sitemap but don't load, redirect or are noindex. Google treats a sitemap full of bad URLs as less trustworthy; list only final, indexable pages.` : `${list(badSm)} 在 sitemap 里，但打不开、会跳转或者设了 noindex。sitemap 里坏地址多了，Google 会不太信它；只列能收录的正式地址。`)
    const linked = new Set(html.flatMap((p) => p.links.map(key)))
    const missing = [...linked].filter((u) => !inSitemap.has(u) && byURL.get(u)?.html !== false && u !== site.root).map((u) => byURL.get(u) ?? ({ url: u } as Page))
    add('missing_from_sitemap', 'low', en ? 'Linked pages missing from the sitemap' : '有页面没放进 sitemap', missing, en ? `${list(missing)} are linked from the site but not in the sitemap. Add them so Google finds and recrawls them sooner.` : `${list(missing)} 站内有链接，但不在 sitemap 里。加进去，Google 发现和重新抓取会快一些。`)
  }
  // 没有站内链接指向的页面（只在 sitemap 里）：Google 觉得它不重要，常常不收录。
  // sitemap 没抓全时不判断：链到它的分类页可能就在没抓的那部分里
  const complete = site.pages.length >= site.sitemap_urls.length
  const inbound = new Map<string, number>()
  for (const p of html) for (const u of new Set(p.links.map(key))) if (u !== key(p.url)) inbound.set(u, (inbound.get(u) ?? 0) + 1)
  const orphan = !complete ? [] : html.filter((p) => inSitemap.has(key(p.url)) && !inbound.get(key(p.url)) && pathOf(p.url) !== '/')
  add('orphan', 'medium', en ? 'Pages nothing links to' : '没有站内链接指向的页面', orphan, en ? `${list(orphan)} are only in the sitemap; no page on the site links to them. Google sees them as unimportant and often leaves them out: link them from category pages, related articles or the menu.` : `${list(orphan)} 只在 sitemap 里，站内没有任何页面链到它们。Google 会觉得不重要、常常不收录：从分类页、相关文章或菜单链过去。`)

  // canonical 指到别处：都指首页是建站时的常见错误（Google 只收首页）；指到别的页面要确认是有意的
  const canonOf = (p: Page) => {
    try {
      // www 和不带 www 的另一个写法算同一个地址（哪个是正式域名是另一回事，这里只看是不是指到了别的页面）
      const c = p.canonical ? normalize(new URL(p.canonical, p.url).href) : ''
      return c && hostOf(c) === twinHost(hostOf(p.url)) ? c.replace('//' + hostOf(c), '//' + hostOf(p.url)) : c
    } catch {
      return ''
    }
  }
  const toHome = html.filter((p) => pathOf(p.url) !== '/' && canonOf(p) === site.root + '/')
  add('canonical_home', 'high', en ? 'Pages declare the homepage as canonical' : '页面的 canonical 指向首页', toHome, en ? `${list(toHome)} set their canonical to the homepage, telling Google they're copies of it — Google then indexes only the homepage. Each page's canonical should be its own address.` : `${list(toHome)} 的 canonical 写成了首页，等于告诉 Google 它们是首页的副本，Google 就只收录首页。每个页面的 canonical 应该是它自己的地址。`)
  const toOther = html.filter((p) => canonOf(p) && key(canonOf(p)) !== key(p.url) && key(canonOf(p)) !== site.root)
  add('canonical_other', 'low', en ? 'Pages point their canonical elsewhere' : '页面的 canonical 指向别的页面', toOther, en ? `${list(toOther)} declare another page as canonical, so they won't be indexed themselves. Fine for product variants; otherwise point it at the page itself.` : `${list(toOther)} 把 canonical 写成了别的页面，它们自己不会被收录。同一产品的不同规格这样写没问题；不是的话改成页面自己的地址。`)

  // 多语言：页面语言不止一种，却没有 hreflang 告诉 Google 哪个语言版本给哪里的用户
  const langs = new Set(html.map((p) => p.lang.toLowerCase().split('-')[0]).filter(Boolean))
  site1('hreflang', 'medium', en ? 'Multilingual pages without hreflang' : '多语言页面没有 hreflang', langs.size > 1 && !html.some((p) => p.hreflang > 0), en ? `Pages are in ${[...langs].join(', ')} but none declare hreflang alternates, so Google may show the wrong language version to buyers in each market. Add <link rel="alternate" hreflang> on every language version.` : `页面有 ${[...langs].join('、')} 几种语言，但都没写 hreflang，Google 可能给各国买家展示错的语言版本。每个语言版本都加上 <link rel="alternate" hreflang>。`)

  // 同一类页面套同一段话：比如每个分类页的介绍都是同一段、每个产品页的卖点文案都一样。按类（路径第一段）看
  const tpl = html.filter((p) => !listing(p) && content.get(p.url)!.template >= 0.4)
  const sample = tpl.map((p) => content.get(p.url)!.sample).find(Boolean) ?? ''
  const tplShare = (g: Page[]) => Math.round((g.reduce((n, p) => n + content.get(p.url)!.template, 0) / g.length) * 100)
  add('content_template', 'medium', en ? 'Pages of the same type repeat the same copy' : '同一类页面套用同一段文字', tpl, en
    ? `On these pages much of the text is copy repeated across pages of the same type: ${groupLine(tpl, (g) => `, ${tplShare(g)}% repeated`)}${sample ? `, e.g. "${sample}…"` : ''}. Google treats them as near-duplicates and buyers learn nothing specific; write what is particular to each category or product (materials, sizes, uses, what can be customized), and only show options that apply to it.`
    : `这些页面很大一部分文字是同一类页面都有的套话：${groupLine(tpl, (g) => `，平均 ${tplShare(g)}% 是重复的`)}${sample ? `，比如「${sample}…」` : ''}。Google 会当成近似重复，买家也看不到具体信息：写出每个分类、每个产品自己的东西（材质、尺寸、用途、能定制什么），只显示对这个产品适用的选项。`)

  // 描述是一个模板套出来的（只换了型号、名称）
  const descTpl = templated(html, (p) => p.description)
  add('desc_template', 'low', en ? 'Descriptions generated from one template' : '页面描述是一个模板套出来的', descTpl, en ? `${list(descTpl)} have descriptions that only swap a name or model in the same sentence (e.g. "${descTpl[0]?.description ?? ''}"). Write each description around what a buyer searching for that page wants to know.` : `${list(descTpl)} 的描述是同一句话只换了名称、型号（比如「${descTpl[0]?.description ?? ''}」）。按搜这个页面的买家想知道什么来写每一页的描述。`)

  // 域名不统一：链到本站别的域名、结构化数据写了别的域名
  const otherLinks = html.filter((p) => p.other_host_links.length)
  add('other_domain_links', 'medium', en ? 'Links use another domain of this site' : '站内链接用了本站别的域名', otherLinks, en ? `${list(otherLinks)} link to ${otherLinks[0]?.other_host_links[0] ?? ''} and similar — this site under another domain (old system domain, preview or the www/non-www twin). Point every link at ${site.root} so ranking signals aren't split.` : `${list(otherLinks)} 链到了 ${otherLinks[0]?.other_host_links[0] ?? ''} 这样本站的别的域名（旧的系统域名、预览地址或 www 的另一个写法）。全站链接统一用 ${site.root}，权重才不会分散。`)
  const ldBad = html.filter((p) => p.ld_foreign.length)
  add('schema_domain', 'medium', en ? 'Structured data points to another domain' : '结构化数据里的网址不是本站域名', ldBad, en ? `${list(ldBad)} have structured data with ${ldBad[0]?.ld_foreign[0] ?? ''} as a url/@id. Search engines read it as the organization or page living elsewhere; use ${site.root} addresses.` : `${list(ldBad)} 的结构化数据里 url / @id 写的是 ${ldBad[0]?.ld_foreign[0] ?? ''}，搜索引擎会以为公司或页面在别的网站上：都改成 ${site.root} 下的地址。`)

  // 图片：按大尺寸加载、一页太多、alt 留空
  const big = html.filter((p) => p.images_big.length >= 3)
  add('image_size', 'medium', en ? 'Images load at full size' : '图片按大尺寸加载', big, en ? `${list(big)} load images at 2000px+ wide without srcset (e.g. ${big[0]?.images_big[0] ?? ''}${big[0] ? `, ${big[0].images_big.length} on ${pathOf(big[0].url)}` : ''}). Thumbnails and list cards should request the size they're shown at; this is usually the biggest cause of slow mobile pages.` : `${list(big)} 的图片按 2000 像素以上的宽度加载、又没有 srcset（比如 ${big[0]?.images_big[0] ?? ''}${big[0] ? `，${pathOf(big[0].url)} 有 ${big[0].images_big.length} 张` : ''}）。列表、缩略图按显示的尺寸要图，这通常是手机上打开慢的最大原因。`)
  const many = html.filter((p) => p.images > 120)
  add('image_many', 'low', en ? 'Very long pages full of images' : '一页图片太多', many, en ? `${list(many)} have over 120 images (${pathOf(many[0]?.url ?? '')}: ${many[0]?.images ?? 0}). Split long lists into crawlable pages or filters, and lazy-load the rest.` : `${list(many)} 一页超过 120 张图（${pathOf(many[0]?.url ?? '')} 有 ${many[0]?.images ?? 0} 张）。长列表分页或加筛选（分页要是搜索引擎能抓的链接），其余图片延迟加载。`)
  // 每页都有的图（菜单、页脚里的）alt 为空只算一次；各页自己的图 alt 为空按页算
  const altDf = new Map<string, number>()
  for (const p of html) for (const src of new Set(p.images_empty_alt)) altDf.set(src, (altDf.get(src) ?? 0) + 1)
  const shared = [...altDf].filter(([, n]) => html.length >= 5 && n >= html.length * 0.4).map(([src]) => src)
  const ownEmpty = (p: Page) => p.images_empty_alt.filter((src) => !shared.includes(src)).length
  const emptyAlt = html.filter((p) => ownEmpty(p) >= 3 && ownEmpty(p) >= (p.images - shared.length) * 0.3)
  const homePage = html.find((p) => pathOf(p.url) === '/')
  const altPages = shared.length >= 3 && homePage && !emptyAlt.includes(homePage) ? [homePage, ...emptyAlt] : emptyAlt
  add('img_alt_empty', 'low', en ? 'Many images have empty alt' : '很多图片的 alt 是空的', altPages, (en
    ? `${emptyAlt.length ? `${list(emptyAlt)} have alt="" on their own images (${pathOf(emptyAlt[0].url)}: ${ownEmpty(emptyAlt[0])}). ` : ''}${shared.length >= 3 ? `${shared.length} images shown on every page (menu, footer) also have empty alt. ` : ''}Empty alt is only for decoration; product and project photos need a short description for image search and accessibility.`
    : `${emptyAlt.length ? `${list(emptyAlt)} 自己的图片很多 alt 是空的（${pathOf(emptyAlt[0].url)} 有 ${ownEmpty(emptyAlt[0])} 张）。` : ''}${shared.length >= 3 ? `每页都有的菜单、页脚里还有 ${shared.length} 张图 alt 是空的。` : ''}空 alt 只该用在装饰图上，产品图、案例图要写一句图上是什么，图片搜索才找得到。`))

  // 按页面类型看结构化数据：产品页的 Product 缺字段、文章没有 Article
  const prodMissing = (p: Page) => (p.ld_product ? ['image', 'description', 'brand', 'sku|mpn', 'offers'].filter((k) => !k.split('|').some((x) => p.ld_product!.includes(x))) : [])
  const prod = html.filter((p) => prodMissing(p).length >= 2)
  add('product_schema', 'low', en ? 'Product structured data is incomplete' : '产品的结构化数据不完整', prod, en ? `${list(prod)} have Product markup missing ${prodMissing(prod[0] ?? ({} as Page)).join(', ')}. Fill them from real product data (no made-up prices or ratings) so Google can show product details.` : `${list(prod)} 的 Product 标记缺 ${prodMissing(prod[0] ?? ({} as Page)).join('、')}。按真实的产品资料补上（没有的价格、评价不要编），Google 才能展示产品信息。`)
  const isPost = (p: Page) => /^(blog|news|articles?|insights|posts?|resources|guides?)$/.test(groupOf(p.url)) && pathOf(p.url).split('/').filter(Boolean).length >= 2 && !/\/(category|tag|page|author)\//.test(pathOf(p.url) + '/')
  const noArticle = html.filter((p) => isPost(p) && !p.jsonld_types.some((t) => /Article|BlogPosting/.test(t)))
  add('article_schema', 'low', en ? 'Articles without Article structured data' : '文章没有 Article 结构化数据', noArticle, en ? `${list(noArticle)} have no Article / BlogPosting markup. Add headline, author, datePublished and image so search engines and AI know who wrote it and when.` : `${list(noArticle)} 没有 Article / BlogPosting 标记。加上标题、作者、发布日期和配图，搜索引擎和 AI 才知道是谁、什么时候写的。`)

  const mixed = html.filter((p) => p.insecure.length)
  add('mixed_content', 'medium', en ? 'Secure pages load insecure resources' : 'https 页面里用了 http 资源', mixed, en ? `${list(mixed)} load images or scripts over http:// (${mixed[0]?.insecure[0] ?? ''}). Browsers block or flag these; switch them to https.` : `${list(mixed)} 用 http:// 加载图片或脚本（比如 ${mixed[0]?.insecure[0] ?? ''}），浏览器会拦掉或标成不安全，改成 https。`)

  const home = html.find((p) => pathOf(p.url) === '/')
  site1('structured_data', 'low', en ? 'No structured data on the homepage' : '首页缺少结构化数据', !!home && !home.jsonld_types.length, en ? 'The homepage has no JSON-LD. Add Organization / WebSite structured data so search engines and AI understand the site.' : '首页没有 JSON-LD，建议加 Organization / WebSite 的结构化数据，便于搜索和 AI 理解站点。')
  for (const [check, name, file] of [['robots', 'robots.txt', site.robots], ['llms_txt', 'llms.txt', site.llms]] as const) {
    ran.push(check)
    if (file.state === 'missing') {
      site1(check, 'low', en ? `No ${name}` : `没有 ${name}`, true,
        en ? `${name} is missing or empty.` : `${name} 返回 404/410 或内容为空。`)
    } else if (file.state === 'unknown') {
      site1(check, 'low', en ? `Could not verify ${name}` : `无法确认 ${name}`, true,
        en ? `Could not verify ${site.root}/${name} (${file.reason}). Retry later; this does not prove the file is missing.`
          : `本次无法确认 ${site.root}/${name}（${file.reason}）。请稍后重试，不能据此认定文件缺失。`)
    }
  }
  // AI 爬虫准入：robots.txt 读到了才判断（没有 robots.txt 等于全放行）。预览地址本来就禁止所有爬虫（creght 的预览是 Disallow: /），不算
  if (site.robots.state === 'present' && !preview && !/\.preview\./.test(hostOf(site.root))) {
    ran.push('ai_crawlers')
    const access = AI_BOTS.map((b) => ({ ...b, state: robotsAccess(site.robots.text, b.ua) })).filter((b) => b.state !== 'allowed')
    if (access.length) {
      const search = access.filter((b) => b.search)
      const severity: Found['severity'] = search.some((b) => b.state === 'blocked') ? 'high' : search.length ? 'medium' : 'low'
      const line = (b: (typeof access)[number]) => en ? `${b.ua} (${b.en}): ${b.state === 'blocked' ? 'blocked' : 'only some paths allowed'}` : `${b.ua}（${b.zh}）：${b.state === 'blocked' ? '整站禁止' : '只放行了部分路径'}`
      site1('ai_crawlers', severity, en ? 'robots.txt blocks AI crawlers' : 'robots.txt 拦了 AI 爬虫', true,
        (en ? `${access.map(line).join('; ')}. ` : `${access.map(line).join('；')}。`) +
        (search.length
          ? (en ? 'Blocked search crawlers mean ChatGPT / Perplexity can\'t read the site when answering, so AI search won\'t recommend you. Remove the Disallow: / for them in robots.txt.' : '搜索类爬虫被拦，ChatGPT、Perplexity 回答问题时读不到这个站，AI 搜索就推荐不到你。在 robots.txt 里去掉对它们的 Disallow: /。')
          : (en ? 'These are training crawlers: blocking them only affects whether future models know you. Ignore this if it is intentional.' : '这些是训练用的爬虫，拦了只影响以后的模型知不知道你；如果是有意拦的，可以忽略。')))
    }
  }
  return out
}

/** 整站一条的问题（不按页面算） */
const SITE_WIDE = ['sitemap', 'structured_data', 'robots', 'llms_txt', 'ai_crawlers', 'hreflang', 'sitemap_unsubmitted', 'sitemap_errors']

/** 得分：从 100 扣，high 12、medium 5、low 2；按页面算的问题乘以 0.5 + 0.5 × 涉及页面数 / 总页面数 */
function score(found: Found[], total: number) {
  const base = { high: 12, medium: 5, low: 2 }
  let s = 100
  for (const f of found) {
    const perPage = f.pages.length > 1 || !SITE_WIDE.includes(f.check)
    s -= base[f.severity] * (perPage && total ? 0.5 + (0.5 * f.pages.length) / total : 1)
  }
  return Math.max(0, Math.round(s))
}

/** 检查项归成四类，报告里分开打分：技术（能不能打开、抓取、收录）、页面（标题描述这些）、内容（够不够、重不重、有没有链接）、AI 可读 */
export const CATEGORY: Record<string, 'tech' | 'page' | 'content' | 'ai'> = {
  http_error: 'tech', noindex: 'tech', slow_page: 'tech', viewport: 'tech', robots: 'tech', sitemap: 'tech', canonical: 'tech', canonical_home: 'tech', canonical_other: 'tech',
  broken_links: 'tech', redirect_links: 'tech', sitemap_bad: 'tech', missing_from_sitemap: 'tech', mixed_content: 'tech', hreflang: 'tech',
  other_domain_links: 'tech', schema_domain: 'tech', image_size: 'tech', image_many: 'tech',
  index_crawled: 'tech', index_discovered: 'tech', index_unknown: 'tech', index_canonical: 'tech', index_excluded: 'tech', sitemap_unsubmitted: 'tech', sitemap_errors: 'tech',
  title_missing: 'page', title_duplicate: 'page', title_length: 'page', desc_missing: 'page', desc_duplicate: 'page', desc_length: 'page', h1_missing: 'page', h1_multiple: 'page',
  img_alt: 'page', img_alt_empty: 'page', lang: 'page', og: 'page', keyword_missing: 'page', desc_template: 'page',
  thin_content: 'content', content_template: 'content', keyword_cannibal: 'content', orphan: 'content',
  ai_crawlers: 'ai', llms_txt: 'ai', structured_data: 'ai', product_schema: 'ai', article_schema: 'ai',
}
/** AI 审查记的问题 check 是 ai.<area>.<名字>，area 就是它的类 */
const catOf = (check: string) => (check.startsWith('ai.') ? ((['tech', 'page', 'content', 'ai'].includes(check.split('.')[1]) ? check.split('.')[1] : 'content') as 'tech' | 'page' | 'content' | 'ai') : CATEGORY[check] ?? 'tech')
/** 谷歌收录检查出的问题（_audit_index.ts） */
const INDEX_CHECKS = ['index_crawled', 'index_discovered', 'index_unknown', 'index_canonical', 'index_excluded', 'sitemap_unsubmitted', 'sitemap_errors']

/** 四类各自的得分（同一套扣分规则，只算这一类的问题） */
function categoryScores(found: Found[], total: number) {
  return Object.fromEntries((['tech', 'page', 'content', 'ai'] as const).map((c) => [c, score(found.filter((f) => catOf(f.check) === c), total)]))
}

export async function run(input: { channel_id?: string; max?: number; dry?: boolean }, ctx: any) {
  if (input?.channel_id) return runOne(input, ctx)
  // 不指定渠道（每周定时就是这样调）：所有独立站逐个体检，一个失败不影响别的
  const sites: Channel[] = (ctx.db.query('channels', { limit: 200 }).list as Channel[]).filter((c) => SITE_TYPES.includes(c.type))
  if (!sites.length) return { channels: [], note: L(ctx, '还没有独立站渠道', 'No site channels yet') }
  const out: any[] = []
  for (const ch of sites) {
    try {
      out.push({ channel_id: ch.id, name: ch.name, ...(await runOne({ ...input, channel_id: ch.id }, ctx)) })
    } catch (e: any) {
      out.push({ channel_id: ch.id, name: ch.name, error: e.message })
    }
  }
  if (out.every((o) => o.error)) throw new Error(out.map((o) => `${o.name}${L(ctx, '：', ': ')}${o.error}`).join(L(ctx, '；', '; ')))
  return { channels: out }
}

/** 任意网址的只读体检，复用渠道体检的抓取、检查和评分规则。 */
export async function inspect(input: { url: string; max?: number }, ctx: any) {
  let value: URL
  try { value = new URL(input?.url); if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password) throw new Error() }
  catch { throw new Error(L(ctx, '请输入有效的 HTTP 或 HTTPS 网站地址', 'Enter a valid HTTP or HTTPS website URL')) }
  value.hash = ''
  const target = value.href.replace(/\/$/, '')
  ctx.progress({ done: 0, message: L(ctx, `开始体检 ${target}`, `Auditing ${target}`) })
  const site = await crawl(target, Math.min(Math.max(input.max ?? DEFAULT_MAX, 1), 200), ctx)
  // 预览地址（creght 的 *.preview.*）本来就 noindex、robots 禁止所有爬虫，按预览检查，不误报
  const preview = /\.preview\./.test(hostOf(target))
  const found = checks(site, preview, ctx)
  const by = (s: string) => found.filter((f) => f.severity === s).length
  return { target, preview, pages: site.pages.length, score: score(found, site.pages.filter((p) => p.html).length), issues: { high: by('high'), medium: by('medium'), low: by('low') }, top: found.slice(0, 3).map((f) => f.title), found }
}

export async function publish(input: { channel_id: string; note?: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  if (ch.type !== 'creght_site' || !ch.project_id || !ch.site_id) throw new Error(L(ctx, '只能发布 creght 独立站渠道', 'Only creght site channels can be published'))
  const fixing: Issue[] = ctx.db.query('site_issues', { where: { channel_id: ch.id, status: 'fixing' }, limit: 500 }).list
  ctx.progress({ done: 0, message: L(ctx, `发布「${ch.name}」…`, `Publishing "${ch.name}"…`) })
  const note = input.note || (fixing.length ? L(ctx, `修复体检问题：${fixing.map((i) => i.title ?? i.check).join('、')}`, `Fix audit issues: ${fixing.map((i) => i.title ?? i.check).join(', ')}`).slice(0, 200) : L(ctx, '修复体检问题', 'Fix audit issues'))
  let alreadyLive = false
  try {
    await sitePublish(ctx, ch.project_id, ch.site_id, note)
  } catch (e: any) {
    const msg = String(e?.message)
    if (/没有工具|unknown tool|no such tool|not found/i.test(msg)) throw new Error(L(ctx, 'creght 还没开放发布站点的接口，等平台更新后再点；现在可以在 creght 编辑器里发布，发布后点「重新体检」', "creght can't publish sites from here yet — try again after the platform update. For now, publish in the creght editor, then click \"Re-run audit\""))
    // 预览和线上一样（已经在别处发布过了）：不算失败，照样重新体检
    if (/没有更改|no changes/i.test(msg)) alreadyLive = true
    else throw e
  }
  // 发布后按线上地址再体检一次：修好的自动变成已解决、进改站复查
  const r = await runOne({ channel_id: ch.id }, ctx)
  const still = ctx.db.query('site_issues', { where: { channel_id: ch.id, status: 'fixing' }, limit: 500 }).list as Issue[]
  for (const i of still) ctx.db.update('site_issues', i.id, { status: 'open', updated_at: new Date().toISOString() })
  return { published: !alreadyLive, already_live: alreadyLive, audit: r, fixed: fixing.length - still.length, reopened: still.map((i) => i.title ?? i.check) }
}

/** 本站别的域名：预览地址、creght 的系统域名、绑过的别的域名。页面链到它们、结构化数据写它们，都算「域名不统一」 */
async function ownHosts(ch: Channel, ctx: any): Promise<string[]> {
  const out = new Set<string>()
  if (ch.preview_url) out.add(hostOf(ch.preview_url))
  if (ch.type === 'creght_site' && ch.project_id && ch.site_id) {
    try {
      const st = await status(ctx, ch.project_id, ch.site_id)
      if (st?.system_domain) out.add(String(st.system_domain).toLowerCase())
      for (const d of st?.domains ?? []) if (d?.domain) out.add(String(d.domain).toLowerCase())
    } catch {}
  }
  out.delete('')
  return [...out]
}

async function runOne(input: { channel_id?: string; max?: number; dry?: boolean }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  if (!SITE_TYPES.includes(ch.type)) throw new Error(L(ctx, '只能体检独立站渠道', 'Only site channels can be audited'))
  const startedAt = new Date().toISOString()
  const t = await target(ch, ctx)
  ctx.progress({ done: 0, message: L(ctx, `开始体检 ${t.url}${t.preview ? '（还没发布，用预览地址）' : ''}`, `Auditing ${t.url}${t.preview ? " (not published yet, using the preview URL)" : ''}`) })
  const site = await crawl(t.url, Math.min(Math.max(input.max ?? FULL_MAX, 1), 500), ctx, await ownHosts(ch, ctx))
  const ran: string[] = []
  const found = checks(site, t.preview, ctx, ran)
  const passed = passedOf(ran, found, ctx) // 关键词、收录检查不算在里面
  // 关键词的目标页面有没有用上这个词、几个页面抢一个词（_audit_keywords.ts）；出错不影响体检
  try {
    const host = hostOf(site.root)
    found.push(...(await keywordChecks(ch.id, site.pages, ctx, async (urls) => {
      const rs = await ctx.fetchAll(urls)
      return Promise.all(urls.map((u, i) => page(rs[i], u, host, ctx, [])))
    })))
  } catch (e: any) {
    ctx.log(L(ctx, '关键词检查没做成：', 'Keyword checks failed: ') + (e?.message ?? e))
  }
  // 谷歌收录（_audit_index.ts）：关联了 Search Console 的正式站点才查；出错不影响体检
  let index: IndexSummary | null = null
  if (!t.preview) {
    try {
      const r = await indexChecks(ch, site.pages, site.root, ctx, !!input.dry, site.pages.length >= site.sitemap_urls.length)
      found.push(...r.found)
      index = r.summary
    } catch (e: any) {
      ctx.log(L(ctx, '收录检查没做成：', 'Indexing checks failed: ') + (e?.message ?? e))
    }
  }
  const total = site.pages.filter((p) => p.html).length
  if (input.dry)
    return {
      target: t.url, preview: t.preview, pages: site.pages.length, sitemap_pages: site.sitemap_urls.length, score: score(found, total), categories: categoryScores(found, total), index, found,
      // 各页概况：写内容、出问题库时也能拿来看站点讲了什么
      page_list: (() => {
        const c = contentOf(site.pages.filter((p) => p.html))
        return site.pages.map((p) => ({ url: p.url, status: p.status, title: p.title, description: p.description, h1: p.h1, text_chars: p.text_chars, own: c.get(p.url)?.own, template: c.get(p.url)?.template }))
      })(),
    }

  const run = ctx.db.insert('audit_runs', {
    channel_id: ch.id, target_url: t.url, pages_checked: site.pages.length, sitemap_pages: site.sitemap_urls.length,
    score: score(found, total), categories: JSON.stringify(categoryScores(found, total)), index: index ? JSON.stringify(index) : '',
    issues: found.length, passed: JSON.stringify(passed), started_at: startedAt, finished_at: new Date().toISOString(),
  })

  // 按 check 合并，每个渠道每个 check 一条：这次有的更新（fixed 改回 open；ignored、fixing 不动），新的建，没了的标 fixed
  const existing: Issue[] = ctx.db.query('site_issues', { where: { channel_id: ch.id }, limit: 500 }).list
  const now = new Date().toISOString()
  for (const f of found) {
    const old = existing.find((e) => e.check === f.check)
    const body = { channel_id: ch.id, run_id: run.id, check: f.check, severity: f.severity, title: f.title, detail: f.detail, pages: JSON.stringify(f.pages), updated_at: now }
    if (!old) ctx.db.insert('site_issues', { ...body, status: 'open' })
    else ctx.db.update('site_issues', old.id, { ...body, status: old.status === 'fixed' ? 'open' : old.status })
  }
  // 这次没查收录（没关联 Search Console、读失败、预览地址）：收录的问题不知道修没修好，原样留着
  const unknown = index ? [] : INDEX_CHECKS
  for (const e of existing) {
    // AI 审查记的问题（ai.*）不是抓取查出来的，这次没有不代表修好了：由下一次 AI 审查（saveFindings）判断
    if (!found.some((f) => f.check === e.check) && !unknown.includes(e.check) && !e.check.startsWith('ai.') && e.status !== 'ignored' && e.status !== 'fixed') {
      ctx.db.update('site_issues', e.id, { status: 'fixed', run_id: run.id, updated_at: now })
      // 体检跑的是预览地址时（站点还没发布），修复还没真正上线，不进复查
      if (!t.preview) {
        let pages: string[] = []
        try {
          pages = JSON.parse(e.pages ?? '[]')
        } catch {}
        trackChange(ctx, { kind: 'issue_fix', ref_id: e.id, channel_id: ch.id, title: L(ctx, `修复：${e.title ?? e.check}`, `Fix: ${e.title ?? e.check}`), pages: pages.length ? pages : [t.url] })
      }
    }
  }

  const by = (s: string) => found.filter((f) => f.severity === s).length
  ctx.progress({ done: site.pages.length, total: site.pages.length, message: L(ctx, `体检完成：${run.score} 分，${found.length} 个问题`, `Audit done: score ${run.score}, ${found.length} issues`) })
  return {
    run_id: run.id, target: t.url, preview: t.preview, pages: site.pages.length, score: run.score,
    issues: { high: by('high'), medium: by('medium'), low: by('low') },
    top: found.slice(0, 3).map((f) => f.title),
  }
}

/**
 * 全站建议：把还没处理的问题按「要做的一件事」归组（一组一条建议），按影响排序。
 * 影响 = 每个问题的严重程度权重 × 涉及页面占比，加起来，再乘这一组的权重；文案在页面的 messages 里（audit.sg_<key>），这里只给数据
 */
const GROUPS: { key: string; weight?: number; checks: string[]; prefix?: string }[] = [
  // AI 逐页审查发现的（标题有没有说清给谁、分类介绍是不是套话、产品文案对不对得上…），规则查不出来，最值得看
  { key: 'review', weight: 2, checks: [], prefix: 'ai.' },
  // 收录、坏链挡住的是整站（没收录的页面别的都白做），同样的问题排得更靠前
  { key: 'indexing', weight: 2, checks: ['index_crawled', 'index_discovered', 'index_unknown', 'index_canonical', 'index_excluded', 'canonical_home', 'noindex', 'sitemap_unsubmitted', 'sitemap_errors'] },
  { key: 'domain', weight: 1.5, checks: ['other_domain_links', 'schema_domain'] },
  { key: 'broken', weight: 1.5, checks: ['http_error', 'broken_links', 'sitemap_bad', 'redirect_links', 'mixed_content'] },
  { key: 'content', weight: 1.5, checks: ['content_template', 'thin_content', 'keyword_cannibal', 'title_duplicate', 'desc_duplicate', 'desc_template', 'canonical_other'] },
  { key: 'links', checks: ['orphan', 'missing_from_sitemap'] },
  { key: 'onpage', checks: ['title_missing', 'desc_missing', 'h1_missing', 'keyword_missing', 'title_length', 'desc_length', 'h1_multiple', 'img_alt', 'img_alt_empty', 'og', 'canonical'] },
  { key: 'speed', checks: ['image_size', 'image_many', 'slow_page', 'viewport'] },
  { key: 'international', checks: ['hreflang', 'lang'] },
  { key: 'ai', checks: ['ai_crawlers', 'llms_txt', 'structured_data', 'product_schema', 'article_schema', 'robots', 'sitemap'] },
]

export function report(input: { channel_id: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  const runs: any[] = ctx.db.query('audit_runs', { where: { channel_id: ch.id }, order_by: 'created_at desc', limit: 12 }).list
  const run = runs[0]
  if (!run) return { channel: { id: ch.id, name: ch.name }, run: null }
  const parse = (v: any, fb: any) => {
    try {
      return v ? JSON.parse(v) : fb
    } catch {
      return fb
    }
  }
  const issues: any[] = (ctx.db.query('site_issues', { where: { channel_id: ch.id }, limit: 500 }).list as any[]).filter((i) => i.status === 'open' || i.status === 'fixing')
  const total = Math.max(1, Number(run.pages_checked) || 1)
  const w = { high: 12, medium: 5, low: 2 } as Record<string, number>
  const impact = (i: any) => {
    const n = parse(i.pages, []).length
    return (w[i.severity] ?? 2) * (SITE_WIDE.includes(i.check) ? 1 : 0.5 + (0.5 * Math.min(n, total)) / total)
  }
  const suggestions = GROUPS.map((g) => {
    const its = issues.filter((i) => g.checks.includes(i.check) || (g.prefix && i.check.startsWith(g.prefix))).sort((a, b) => impact(b) - impact(a))
    return {
      key: g.key,
      impact: Math.round(its.reduce((n, i) => n + impact(i), 0) * (g.weight ?? 1) * 10) / 10,
      severity: its.some((i) => i.severity === 'high') ? 'high' : its.some((i) => i.severity === 'medium') ? 'medium' : 'low',
      pages: new Set(its.flatMap((i) => parse(i.pages, []))).size,
      issues: its.map((i) => ({ id: i.id, check: i.check, title: i.title, severity: i.severity, status: i.status, pages: parse(i.pages, []).length })),
    }
  }).filter((g) => g.issues.length).sort((a, b) => b.impact - a.impact)

  // 搜索表现（gsc.sync 存的最近 28 天）：排在第 8~20 名、点击率偏低的页面是最快见效的机会
  let search: any = null
  try {
    const rows: any[] = ctx.db.query('search_pages', { where: { channel_id: ch.id }, limit: 1000 }).list
    if (rows.length)
      search = {
        clicks: rows.reduce((n, r) => n + (r.clicks ?? 0), 0),
        impressions: rows.reduce((n, r) => n + (r.impressions ?? 0), 0),
        prev_clicks: rows.reduce((n, r) => n + (r.prev_clicks ?? 0), 0),
        pages_with_impressions: rows.filter((r) => (r.impressions ?? 0) > 0).length,
        striking_distance: rows.filter((r) => r.opportunity === 'striking_distance').length,
        low_ctr: rows.filter((r) => r.opportunity === 'low_ctr').length,
        period_end: rows[0]?.period_end ?? '',
      }
  } catch {}

  return {
    channel: { id: ch.id, name: ch.name, gsc: !!ch.gsc_property && !ch.gsc_link_disabled },
    run: { id: run.id, target_url: run.target_url, pages_checked: run.pages_checked, sitemap_pages: run.sitemap_pages ?? null, score: run.score, finished_at: run.finished_at || run.created_at },
    categories: parse(run.categories, null),
    history: runs.map((r) => ({ score: r.score, at: r.finished_at || r.created_at })).reverse(),
    index: parse(run.index, null) as IndexSummary | null,
    search,
    suggestions,
    // AI 写的全站方案存在最近一次写过方案的体检上：新体检之后还显示，标出是哪次体检时写的
    plan: (() => {
      const r = runs.find((x) => x.plan)
      return r ? { text: r.plan, at: r.plan_at, chat_id: r.plan_chat_id ?? '', run_id: r.id, stale: r.id !== run.id } : null
    })(),
  }
}

/** 存 AI 审查写的全站优化方案（Markdown，任务 tasks/seo-review.md），记在最近一次体检上，连同写它的对话（页面「继续对话」回到这段对话） */
export function savePlan(input: { channel_id: string; plan: string }, ctx: any) {
  const plan = String(input?.plan ?? '').trim()
  if (plan.length < 200) throw new Error(L(ctx, '方案（plan）太短了，不像写完的', 'The plan is too short to be finished'))
  const run = ctx.db.query('audit_runs', { where: { channel_id: input.channel_id }, order_by: 'created_at desc', limit: 1 }).list[0]
  if (!run) throw new Error(L(ctx, '这个网站还没体检过：先跑一次 audit.run', 'This site has no audit yet: run audit.run first'))
  ctx.db.update('audit_runs', run.id, { plan, plan_at: new Date().toISOString(), plan_chat_id: String(ctx.chat_id ?? '') })
  return { run_id: run.id }
}

/** 每类页面挑几页：第一页、中间、最后一页（sitemap 里同一类的），有搜索曝光的优先 */
const PER_GROUP = 3
const MAX_SAMPLES = 24

export async function samples(input: { channel_id: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  const t = await target(ch, ctx)
  // 先看会不会跳到 www，再读 sitemap
  const base = await resolveBase(t.url, ctx)
  const root = new URL(base).origin
  const host = hostOf(root)
  const robots = await fetch(root + '/robots.txt').then((r: any) => (r.ok ? r.text() : '')).catch(() => '')
  const all = (await sitemapURLs(new URL(/^\s*sitemap:\s*(\S+)/im.exec(robots)?.[1] ?? '/sitemap.xml', root).href, host, 5000)) ?? []
  const shown = new Map<string, any>()
  try {
    for (const r of ctx.db.query('search_pages', { where: { channel_id: ch.id }, limit: 1000 }).list as any[]) shown.set(pathOf(r.page), r)
  } catch {}
  const groups = new Map<string, string[]>()
  for (const u of all) {
    const g = groupOf(u)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(u)
  }
  const pick: string[] = [root + '/']
  for (const [g, us] of groups) {
    if (g === 'home') continue
    const withData = us.filter((u) => shown.get(pathOf(u))?.impressions).slice(0, 1)
    const spreadOut = [us[0], us[Math.floor(us.length / 2)], us[us.length - 1]]
    for (const u of [...withData, ...spreadOut]) if (u && !pick.includes(u) && pick.filter((x) => groupOf(x) === g).length < PER_GROUP) pick.push(u)
  }
  const urls = pick.slice(0, MAX_SAMPLES)
  ctx.progress({ message: L(ctx, `在读 ${urls.length} 个代表页面…`, `Reading ${urls.length} sample pages…`) })
  const own = await ownHosts(ch, ctx)
  const rs = await ctx.fetchAll(urls)
  const pages = await Promise.all(urls.map((u, i) => page(rs[i], u, host, ctx, own)))
  const html = pages.filter((p) => p.html)
  const content = contentOf(html)
  return {
    site: root,
    sitemap_pages: all.length,
    groups: [...groups].map(([g, us]) => ({ group: g, pages: us.length })).sort((a, b) => b.pages - a.pages),
    pages: pages.map((p) => {
      const c = content.get(p.url)
      const sp = shown.get(pathOf(p.url))
      return {
        url: p.url, group: groupOf(p.url), status: p.status, title: p.title, description: p.description, h1: p.h1, h2: p.h2,
        own_words: c?.own ?? 0, repeated_share: Math.round((c?.template ?? 0) * 100) / 100, images: p.images, images_empty_alt: p.images_empty_alt.length,
        schema: [...new Set(p.jsonld_types)], internal_links: p.internal_links,
        text: p.text.slice(0, 2500),
        ...(sp ? { search: { clicks: sp.clicks, impressions: sp.impressions, position: sp.position, top_queries: sp.top_queries } } : {}),
      }
    }),
    // 规则已经查出来的（AI 审查不用再报一遍，挑规则查不到的说）
    known_issues: (ctx.db.query('site_issues', { where: { channel_id: ch.id }, limit: 500 }).list as any[])
      .filter((i) => (i.status === 'open' || i.status === 'fixing') && !String(i.check).startsWith('ai.'))
      .map((i) => ({ check: i.check, title: i.title, severity: i.severity })),
  }
}

type Finding = { area: string; key: string; severity: string; title: string; detail: string; pages: string[] }

/**
 * 存 AI 审查发现的问题：每条一个 site_issues（check = ai.<area>.<key>），这次又提到的更新，上次有、这次没提到的标成已解决。
 * 和规则查出的问题在一个清单里，一样「交给助手修 → 确认上线」；规则体检不会把它们标成已解决
 */
export function saveFindings(input: { channel_id: string; findings: Finding[] }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  const list = Array.isArray(input?.findings) ? input.findings : []
  const slug = (v: string) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
  for (const f of list) {
    if (!['tech', 'page', 'content', 'ai'].includes(f?.area)) throw new Error(L(ctx, `「${f?.title}」的 area 要是 tech / page / content / ai`, `"${f?.title}": area must be tech / page / content / ai`))
    if (!['high', 'medium', 'low'].includes(f?.severity)) throw new Error(L(ctx, `「${f?.title}」的 severity 要是 high / medium / low`, `"${f?.title}": severity must be high / medium / low`))
    if (!slug(f?.key) || !String(f?.title ?? '').trim() || String(f?.detail ?? '').trim().length < 30) throw new Error(L(ctx, '每条要有 key、title 和具体的 detail（30 字以上）', 'Each finding needs a key, a title and a specific detail (30+ characters)'))
    if (!Array.isArray(f.pages) || !f.pages.length) throw new Error(L(ctx, `「${f.title}」要列出涉及的页面（pages）`, `"${f.title}" must list the pages it affects`))
  }
  const run = ctx.db.query('audit_runs', { where: { channel_id: ch.id }, order_by: 'created_at desc', limit: 1 }).list[0]
  const existing: Issue[] = ctx.db.query('site_issues', { where: { channel_id: ch.id }, limit: 500 }).list
  const now = new Date().toISOString()
  const keys: string[] = []
  for (const f of list) {
    const check = `ai.${f.area}.${slug(f.key)}`
    keys.push(check)
    const body = { channel_id: ch.id, run_id: run?.id ?? '', check, severity: f.severity, title: String(f.title).trim(), detail: String(f.detail).trim(), pages: JSON.stringify(f.pages.map(String)), updated_at: now }
    const old = existing.find((e) => e.check === check)
    if (!old) ctx.db.insert('site_issues', { ...body, status: 'open' })
    else ctx.db.update('site_issues', old.id, { ...body, status: old.status === 'fixed' ? 'open' : old.status })
  }
  let resolved = 0
  for (const e of existing)
    if (e.check.startsWith('ai.') && !keys.includes(e.check) && (e.status === 'open' || e.status === 'fixing')) {
      ctx.db.update('site_issues', e.id, { status: 'fixed', updated_at: now })
      resolved++
    }
  return { saved: list.length, resolved }
}
