// 站点体检（本机函数，Shuttle 在用户电脑上执行，不经过模型）。
//
//   audit.run({ channel_id?, max?, dry? })  抓取渠道站点 → 按清单检查 → 打分 → 写 audit_runs，合并 site_issues
//   dry: true 只抓取和检查、不写表（试跑、排查用）；channel_id 不填 = 所有独立站逐个体检（每周定时）
//   audit.inspect({ url, max? })  检查任意公开网址，返回结果和问题明细；无需渠道、不写表
//   audit.publish({ channel_id, note? })     「确认上线」：助手修完推到预览、用户在预览里看过后点它——发布站点，再体检一次。
//                                            修好的问题变成已解决并进改站复查；还在的问题从「已修，待上线」退回待修复
//
// 页面「开始体检 / 重新体检」按钮直接调它；命令行 annulo run audit.run --input '{"channel_id":"..."}'。
// 修问题（改站代码）是另一回事：要判断、要改代码，交给助手（site-audit skill）。
// 问题这次没再出现（标成 fixed）= 修复已经上线，记一条改动进改站复查（_review.ts），到期对比前后数据。

import { liveURL, sitePublish } from './_creght'
import { isEn, L } from './_i18n'
import { trackChange } from './_review'
import { keywordChecks } from './_audit_keywords'

// 要电脑的（浏览器、本机授权、密钥、外部接口）：手机上点了转给电脑上开着的 Shuttle 跑（设置 → 远程访问）
export const remote = ['run', 'publish']

type Channel = { id: string; name: string; type: string; project_id?: string; site_id?: string; preview_url?: string; live_url?: string }
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
  images: number
  images_no_alt: string[]
  text_chars: number
  internal_links: number
  links: string[]
}

const DEFAULT_MAX = 40
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
    return `${x.protocol}//${x.host}${x.pathname}`
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

function ldTypes(raw: string): string[] {
  const out: string[] = []
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach(walk)
    const t = v['@type']
    if (typeof t === 'string') out.push(t)
    else if (Array.isArray(t)) out.push(...t.filter((x) => typeof x === 'string'))
    if (v['@graph']) walk(v['@graph'])
  }
  try {
    walk(JSON.parse(raw))
  } catch {
    // 写坏的 JSON-LD 当作没有
  }
  return out
}

async function page(r: any, url: string, host: string, ctx: any): Promise<Page> {
  const p: Page = {
    url, status: r.status ?? 0, error: r.error, html: false, ttfb_ms: r.timing?.ttfb_ms ?? 0, load_ms: r.timing?.total_ms ?? 0, truncated: !!r.truncated,
    title: '', description: '', robots: '', canonical: '', lang: '', viewport: false, og_title: false, og_image: false,
    jsonld_types: [], h1: [], h2_count: 0, images: 0, images_no_alt: [], text_chars: 0, internal_links: 0, links: [],
  }
  if (r.error || !r.ok) return p
  p.html = /text\/html/.test(r.headers.get('content-type') ?? '') && p.status < 400
  if (!p.html) return p
  const doc = ctx.html(await r.text())
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
  const imgs = doc.find('img')
  p.images = imgs.length
  p.images_no_alt = imgs.filter((i: any) => !('alt' in i.attrs)).slice(0, 10).map((i: any) => i.attrs.src ?? '')
  for (const s of doc.find('script[type="application/ld+json"]')) p.jsonld_types.push(...ldTypes(s.text))
  p.text_chars = doc.text().replace(/\s+/g, '').length
  for (const a of doc.find('a[href]')) {
    let u: URL
    try {
      u = new URL(a.attrs.href, url)
    } catch {
      continue
    }
    if (u.hostname.toLowerCase() !== host || !/^https?:$/.test(u.protocol) || FILE_EXT.test(u.pathname)) continue
    p.links.push(`${u.protocol}//${u.host}${u.pathname}`)
    p.internal_links++
  }
  return p
}

/** sitemap 里的地址；是 sitemap 索引就再展开一层 */
async function sitemapURLs(url: string, host: string, limit: number, depth = 0): Promise<string[]> {
  const r = await fetch(url).catch(() => null)
  if (!r?.ok) return []
  const xml = await r.text()
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'))
  if (/<sitemapindex/i.test(xml) && depth === 0) {
    const out: string[] = []
    for (const sm of locs) {
      if (out.length >= limit) break
      out.push(...(await sitemapURLs(sm, host, limit - out.length, 1)))
    }
    return out
  }
  return locs.filter((u) => hostOf(u) === host).slice(0, limit)
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

/** 抓取：首页 + sitemap 里的页面；没有 sitemap 就顺着站内链接广度优先 */
async function crawl(base: string, max: number, ctx: any) {
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
  const fromSitemap = await sitemapURLs(sitemap, host, max)

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
      const p = await page(rs[i], batch[i], host, ctx)
      pages.push(p)
      if (!fromSitemap.length) queue.push(...p.links)
    }
  }
  return { root, robots, llms, has_sitemap: fromSitemap.length > 0, pages }
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
function checks(site: Awaited<ReturnType<typeof crawl>>, preview: boolean, ctx: any): Found[] {
  const en = isEn(ctx)
  const sep = en ? ', ' : '、'
  const list = (ps: Page[], n = 3) => ps.slice(0, n).map((p) => pathOf(p.url)).join(sep) + (ps.length > n ? (en ? ` and ${ps.length - n} more` : ` 等 ${ps.length} 个页面`) : '')
  const html = site.pages.filter((p) => p.html)
  const out: Found[] = []
  const add = (check: string, severity: Found['severity'], title: string, ps: Page[], detail: string) => {
    if (ps.length) out.push({ check, severity, title, detail, pages: ps.map((p) => p.url) })
  }
  const site1 = (check: string, severity: Found['severity'], title: string, bad: boolean, detail: string) => {
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

  const broken = site.pages.filter((p) => p.error || p.status >= 400)
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
  site1('sitemap', 'medium', en ? 'No sitemap' : '没有 sitemap', !site.has_sitemap, en ? 'No sitemap.xml found, so new pages get indexed slowly.' : '没找到 sitemap.xml，新页面收录会慢。')

  const badTitleLen = html.filter((p) => p.title && (chars(p.title) < 6 || chars(p.title) > 60))
  add('title_length', 'low', en ? 'Title length off' : '标题长度不合适', badTitleLen, en ? `Titles work best at 6–60 characters: ${badTitleLen.slice(0, 3).map((p) => `${pathOf(p.url)} ${chars(p.title)} chars`).join(', ')}.` : `标题建议 6~60 个字：${badTitleLen.slice(0, 3).map((p) => `${pathOf(p.url)} ${chars(p.title)} 字`).join('、')}。`)
  const badDescLen = html.filter((p) => p.description && (chars(p.description) < 20 || chars(p.description) > 160))
  add('desc_length', 'low', en ? 'Description length off' : '描述长度不合适', badDescLen, en ? `Descriptions work best at 20–160 characters: ${badDescLen.slice(0, 3).map((p) => `${pathOf(p.url)} ${chars(p.description)} chars`).join(', ')}.` : `描述建议 20~160 字：${badDescLen.slice(0, 3).map((p) => `${pathOf(p.url)} ${chars(p.description)} 字`).join('、')}。`)
  const dupDesc = dup((p) => p.description)
  add('desc_duplicate', 'low', en ? 'Duplicate descriptions' : '多个页面描述相同', dupDesc, en ? `${list(dupDesc)} share the same description — usually the site-wide default.` : `${list(dupDesc)} 的描述一样，通常是用了全站默认描述。`)
  const multiH1 = html.filter((p) => p.h1.length > 1)
  add('h1_multiple', 'low', en ? 'More than one H1' : 'H1 多于一个', multiH1, en ? `Keep one H1 per page: ${multiH1.slice(0, 3).map((p) => `${pathOf(p.url)} has ${p.h1.length}`).join(', ')}; make the rest h2.` : `一页只保留一个 H1：${multiH1.slice(0, 3).map((p) => `${pathOf(p.url)} 有 ${p.h1.length} 个`).join('、')}，其余改成 h2。`)
  // 内容页才算「内容太少」：首页和列表页（站内链接多）除外
  const thin = html.filter((p) => pathOf(p.url) !== '/' && p.internal_links < 15 && p.text_chars < 200)
  add('thin_content', 'low', en ? 'Thin content' : '页面内容太少', thin, en ? `${list(thin)} have under 200 characters of body text, so search engines and AI rarely cite them.` : `${list(thin)} 正文不到 200 字，搜索引擎和 AI 很难引用。`)
  const noLang = html.filter((p) => !p.lang)
  add('lang', 'low', en ? 'No page language declared' : '没有声明页面语言', noLang, en ? `${list(noLang)} have no lang on <html>.` : `${list(noLang)} 的 <html> 没有 lang。`)
  const noCanon = html.filter((p) => !p.canonical)
  add('canonical', 'low', en ? 'Missing canonical' : '缺少 canonical', noCanon, en ? `${list(noCanon)} have no canonical, so duplicate URLs split ranking signals.` : `${list(noCanon)} 没有 canonical，重复地址会分散权重。`)
  const noOg = html.filter((p) => !p.og_title || !p.og_image)
  add('og', 'low', en ? 'Incomplete share cards' : '分享卡片信息不全', noOg, en ? `${list(noOg)} lack og:title or og:image, so shared links show no title or image.` : `${list(noOg)} 缺 og:title 或 og:image，分享出去没有标题或配图。`)
  const home = html.find((p) => pathOf(p.url) === '/')
  site1('structured_data', 'low', en ? 'No structured data on the homepage' : '首页缺少结构化数据', !!home && !home.jsonld_types.length, en ? 'The homepage has no JSON-LD. Add Organization / WebSite structured data so search engines and AI understand the site.' : '首页没有 JSON-LD，建议加 Organization / WebSite 的结构化数据，便于搜索和 AI 理解站点。')
  for (const [check, name, file] of [['robots', 'robots.txt', site.robots], ['llms_txt', 'llms.txt', site.llms]] as const) {
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

/** 得分：从 100 扣，high 12、medium 5、low 2；按页面算的问题乘以 0.5 + 0.5 × 涉及页面数 / 总页面数 */
function score(found: Found[], total: number) {
  const base = { high: 12, medium: 5, low: 2 }
  let s = 100
  for (const f of found) {
    const perPage = f.pages.length > 1 || !['sitemap', 'structured_data', 'robots', 'llms_txt', 'ai_crawlers'].includes(f.check)
    s -= base[f.severity] * (perPage && total ? 0.5 + (0.5 * f.pages.length) / total : 1)
  }
  return Math.max(0, Math.round(s))
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
  const found = checks(site, false, ctx)
  const by = (s: string) => found.filter((f) => f.severity === s).length
  return { target, preview: false, pages: site.pages.length, score: score(found, site.pages.filter((p) => p.html).length), issues: { high: by('high'), medium: by('medium'), low: by('low') }, top: found.slice(0, 3).map((f) => f.title), found }
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

async function runOne(input: { channel_id?: string; max?: number; dry?: boolean }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  if (!SITE_TYPES.includes(ch.type)) throw new Error(L(ctx, '只能体检独立站渠道', 'Only site channels can be audited'))
  const startedAt = new Date().toISOString()
  const t = await target(ch, ctx)
  ctx.progress({ done: 0, message: L(ctx, `开始体检 ${t.url}${t.preview ? '（还没发布，用预览地址）' : ''}`, `Auditing ${t.url}${t.preview ? " (not published yet, using the preview URL)" : ''}`) })
  const site = await crawl(t.url, Math.min(Math.max(input.max ?? DEFAULT_MAX, 1), 200), ctx)
  const found = checks(site, t.preview, ctx)
  // 关键词的目标页面有没有用上这个词、几个页面抢一个词（_audit_keywords.ts）；出错不影响体检
  try {
    const host = hostOf(t.url)
    found.push(...(await keywordChecks(ch.id, site.pages, ctx, async (urls) => {
      const rs = await ctx.fetchAll(urls)
      return Promise.all(urls.map((u, i) => page(rs[i], u, host, ctx)))
    })))
  } catch (e: any) {
    ctx.log(L(ctx, '关键词检查没做成：', 'Keyword checks failed: ') + (e?.message ?? e))
  }
  const total = site.pages.filter((p) => p.html).length
  if (input.dry)
    return {
      target: t.url, preview: t.preview, pages: site.pages.length, score: score(found, total), found,
      // 各页概况：写内容、出问题库时也能拿来看站点讲了什么
      page_list: site.pages.map((p) => ({ url: p.url, status: p.status, title: p.title, description: p.description, h1: p.h1, text_chars: p.text_chars })),
    }

  const run = ctx.db.insert('audit_runs', {
    channel_id: ch.id, target_url: t.url, pages_checked: site.pages.length,
    score: score(found, total), issues: found.length, started_at: startedAt, finished_at: new Date().toISOString(),
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
  for (const e of existing) {
    if (!found.some((f) => f.check === e.check) && e.status !== 'ignored' && e.status !== 'fixed') {
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
