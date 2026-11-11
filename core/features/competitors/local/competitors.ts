import { L } from './_i18n'
import { profile, projectBrief } from './_ai'
import { originsJson } from '../lib/origins'

// 手机上也能看、能标已读、能删：只用 ctx.db
export const cloud = ['list', 'markSeen', 'remove', 'pause', 'reports', 'suggestContext', 'saveSuggestions', 'reject', 'week', 'analysisContext']

// 要读外网的：手机上点了转给电脑上开着的 Annulo 跑
export const remote = ['scan', 'add', 'toTopic', 'pages', 'accept']

// 竞品监控：每天读一次竞品网站的 sitemap，盯它新上了哪些产品页、博客、落地页。
//
// 第一次读完算「基线」：那时已有的页面只记个指纹（competitors.known，省得几千个页面都写进表），
// 之后新出现的才写进 competitor_pages（is_new），页面上标「新」，能一键转成选题。
// 竞品名单：起步向导确认过的竞品（onboarding.competitors）每次 scan 开头带过来，也能手动加。
// 用户还没有竞品（或想多找几家）时，「AI 推荐竞品」交给助手按任务 tasks/competitor-suggest.md 找：
// 它读项目资料、产品、AI 搜索里引用到的别家域名、谷歌搜索词，自己联网搜、打开官网核实，存成 status=suggested 的竞品，用户点「加进监控」才开始读。
//
//   competitors.list({})                       竞品列表 + 新发现（最近 200 条）+ AI 推荐、等用户确认的（suggestions）
//   competitors.suggestContext({})             给助手找竞品用：项目资料、产品、自己的网站、已经有的（含不要的）、AI 搜索里引用的别家域名、谷歌搜索词
//   competitors.saveSuggestions({ items })     助手找到的候选：[{ url, name, kind, reason, evidence? }]，已经有的域名跳过
//   competitors.accept({ id })、competitors.reject({ id })   推荐的加进监控（马上读一次）/ 不要（记着，下次不再推荐）
//   competitors.add({ url, name? })            手动加一个竞品（加完马上读一次）
//   competitors.scan({ id? })                  读 sitemap（定时任务每天一次；id 只读这一个）
//   competitors.pages({ id, kind?, limit? })   现在 sitemap 里的页面（按类型），给助手做总览、规格对比用
//   competitors.toTopic({ page_id })           新发现转成选题（读一下页面标题）
//   competitors.markSeen({ ids? })             标成看过（不给 ids 就是全部）
//   competitors.pause({ id, paused })、competitors.remove({ id })
//   competitors.saveReport({ title, body, competitor_ids? })   助手写的竞品分析存档（research_findings，kind=competitor_report）
//   competitors.reports({ limit? })            最近的竞品分析
//   competitors.week({ days? })                这几天各家新上了什么（周报「竞品本周动向」用）
//   competitors.analysisContext({ id })        拆解一家的打法（风格卡 playbooks，任务 analyze-reference）要读的：现有内容概况、最近更新的页面、新发现
//
// 每次读完：最近更新的 RECENT 个页面读出标题和描述，存在 competitors.recent（加进监控马上就有东西看，不用等新页面）；
// 新发现的页面一次最多读 META_PER_SCAN 个标题和描述（之后转选题、出选题、写周报都用得上），读不到的只有网址。
//
//   命令行：annulo run competitors.scan --input '{}'

const MAX_SITEMAPS = 30
const MAX_URLS = 8000
const MAX_NEW_PER_SCAN = 300 // 改版、换域名时一下冒出几千个「新页面」，只记前这么多
const META_PER_SCAN = 30 // 一次最多给几个新页面读标题、描述
const RECENT = 10 // 最近更新的几个页面（按 sitemap 的 lastmod）

type Competitor = {
  id: string; name: string; url: string; host: string; reason?: string; source?: string; status?: string; kind?: string; evidence?: string
  sitemaps?: string; pages_total?: number; counts?: string; baseline_at?: string; scanned_at?: string; error?: string
  known?: string; recent?: string; created_at?: string; updated_at?: string
}
type Page = { id: string; competitor_id: string; url: string; kind: string; title?: string; description?: string; lastmod?: string; first_seen: string; last_seen?: string; is_new?: boolean; seen?: boolean; topic_id?: string }

const nowISO = () => new Date().toISOString()
const parse = <T,>(v: unknown, d: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : ((v as T) ?? d)
  } catch {
    return d
  }
}

export function hostOf(u: string): string {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** 网址的指纹（FNV-1a 32 位）：基线页面只存这个 */
export function fp(u: string): string {
  const s = u.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/**
 * 多语言站同一页的几个语言版本（/jp/x、/de/x、/zh-tw/x 和 /x）算一页：去掉打头的语言段、查询参数和末尾的 /。
 * 「最近更新」和一次检查里的新发现按它去重，不然一个新产品出好几条
 */
export function pageKey(u: string): string {
  try {
    const x = new URL(u)
    const path = x.pathname.toLowerCase().replace(/\/+$/, '')
    return x.hostname.replace(/^www\./, '') + (path.replace(/^\/[a-z]{2}(?:[-_][a-z]{2,4})?(?=\/)/, '') || '/')
  } catch {
    return u
  }
}
/** 同一页的几个语言版本里挑哪个：没有语言段的、英文的优先 */
const localeRank = (u: string) => {
  const seg = (() => {
    try {
      return new URL(u).pathname.split('/')[1]?.toLowerCase() ?? ''
    } catch {
      return ''
    }
  })()
  return /^[a-z]{2}(?:[-_][a-z]{2,4})?$/.test(seg) ? (/^en\b/.test(seg) ? 1 : 2) : 0
}

/** 按网址猜页面类型 */
export function kindOf(u: string): 'product' | 'blog' | 'landing' | 'other' {
  let path = ''
  try {
    path = new URL(u).pathname.toLowerCase()
  } catch {
    return 'other'
  }
  if (/\/(products?|items?|shop|store|catalog|catalogue|goods|p)\/|-p-\d|\/product-/.test(path)) return 'product'
  if (/\/(blog|blogs|news|articles?|posts?|insights?|resources?|knowledge|guides?|cases?|case-stud(y|ies)|faq|learn|stories)(\/|$)/.test(path)) return 'blog'
  const depth = path.split('/').filter(Boolean).length
  if (depth <= 1 || /\/(solutions?|industr(y|ies)|applications?|landing|lp|services?|oem|odm)(\/|$)/.test(path)) return 'landing'
  return 'other'
}

/** 从 sitemap XML 里取 <loc>（和 lastmod）；是 sitemap 索引就返回子 sitemap */
export function parseSitemap(xml: string): { index: boolean; urls: { loc: string; lastmod?: string }[] } {
  const index = /<sitemapindex[\s>]/i.test(xml)
  const urls: { loc: string; lastmod?: string }[] = []
  const re = index ? /<sitemap>([\s\S]*?)<\/sitemap>/gi : /<url>([\s\S]*?)<\/url>/gi
  for (const m of xml.matchAll(re)) {
    const loc = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/i.exec(m[1])?.[1]
    if (!loc) continue
    const lastmod = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(m[1])?.[1]
    urls.push({ loc: loc.replace(/&amp;/g, '&'), lastmod })
  }
  return { index, urls }
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

type Got = { status: number; text: string; error?: string }

/** 读一个地址：返回状态码和内容，连不上 status 是 0（error 写原因），不抛错 */
async function get(u: string): Promise<Got> {
  try {
    const r = await fetch(u, { headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xml,text/xml,*/*' } })
    return { status: r.status, text: r.ok ? await r.text() : '' }
  } catch (e: any) {
    return { status: 0, text: '', error: String(e?.message ?? e) }
  }
}

/** 页面的标题和描述（og: 的优先，没有用 <title>、meta description）；读不到返回空的 */
async function metaOf(u: string, ctx: any): Promise<{ title: string; description: string }> {
  const g = await get(u)
  if (!g.text || !ctx.html) return { title: '', description: '' }
  let doc: any
  try {
    doc = ctx.html(g.text)
  } catch {
    return { title: '', description: '' }
  }
  const attr = (sel: string) => String(doc.find(sel)[0]?.attrs?.content ?? '').trim()
  const title = attr('meta[property="og:title"]') || String(doc.find('title')[0]?.text ?? '').trim()
  const description = attr('meta[name="description"]') || attr('meta[property="og:description"]')
  return { title: title.slice(0, 200), description: description.slice(0, 400) }
}

/** 被网站防火墙拦了（403、429、503）或者连不上：可以换用户的浏览器试 */
const blocked = (g: Got) => g.status === 0 || g.status === 403 || g.status === 429 || g.status === 503

/** 官网能打开的那个地址：照用户填的，不行换 www. / 去掉 www.，再不行试 http（有的站裸域名的证书是坏的） */
async function pickBase(c: Competitor): Promise<{ base: string; robots: Got; tried: string[] }> {
  const given = new URL(/^https?:\/\//i.test(c.url) ? c.url : 'https://' + c.url)
  const host = given.hostname
  const other = host.startsWith('www.') ? host.slice(4) : 'www.' + host
  const tried: string[] = []
  let first: { base: string; robots: Got } | null = null
  for (const base of [`https://${host}`, `https://${other}`, `http://${host}`, `http://${other}`]) {
    const robots = await get(base + '/robots.txt')
    tried.push(`${base}（${robots.status || robots.error?.replace(/^.*?：/, '') || 'error'}）`)
    // robots.txt 没有（404）也算这个地址能打开
    if (robots.status && !blocked(robots)) return { base, robots, tried }
    first ||= { base, robots }
  }
  return { ...first!, tried }
}

/**
 * 用户自己的 Chrome（Annulo 插件）读几个地址：真浏览器能过大部分防火墙。窗口开在用户屏幕上，只在用户手动点时用。
 * 插件按网站授权：open 要带上网址，没授权过的网站插件会弹「允许 Annulo 操作这个网站」，这次运行等用户点（最多 10 分钟）。
 * 第一个地址都读不了就抛错（原因交给上面写进报错）；后面的读不了跳过，error 里记第一个原因。
 */
async function viaBrowser(ctx: any, urls: string[]): Promise<{ got: Map<string, string>; error?: string }> {
  const got = new Map<string, string>()
  if (!ctx.browser?.open || !urls.length) return { got }
  ctx.progress?.({ message: L(ctx, `用你的浏览器读 ${hostOf(urls[0])}：第一次会在 Chrome 里问能不能让 Annulo 操作这个网站，点「允许」`, `Reading ${hostOf(urls[0])} in your browser: the first time, Chrome asks whether Annulo may operate on this site; click "Allow"`) })
  let b: any
  try {
    b = await ctx.browser.open({ profile: '@user', url: urls[0] })
  } catch (e: any) {
    throw new Error(L(ctx, `没法用你的浏览器读（${String(e?.message ?? e).slice(0, 300)}）。要在 Chrome 里装 Annulo 插件、开着 Chrome，并允许 Annulo 操作 ${hostOf(urls[0])}`, `Couldn't read it with your browser (${String(e?.message ?? e).slice(0, 300)}). Install the Annulo extension in Chrome, keep Chrome open and allow Annulo on ${hostOf(urls[0])}`))
  }
  let error: string | undefined
  try {
    for (const [k, u] of urls.entries()) {
      try {
        if (k > 0) await b.goto(u)
        got.set(u, await b.html())
      } catch (e: any) {
        error ||= String(e?.message ?? e).slice(0, 300)
      }
    }
  } finally {
    await b.close?.()
  }
  return { got, error }
}

/** 读完一个站的全部 sitemap（索引展开），返回页面。browser：被拦时可以用用户的浏览器读 */
async function crawl(c: Competitor, ctx: any, browser = false): Promise<{ sitemaps: string[]; urls: { loc: string; lastmod?: string }[]; base: string; via?: string }> {
  const { base, robots, tried } = await pickBase(c)
  const baseHost = hostOf(base)
  const listed = [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1])
  // 优先读官网这个域名的（robots.txt 里常常还列着帮助中心子域名、各国站点的 sitemap）；
  // 这个域名下一个都没有、写的全在别的域名上（同一家公司换了域名），就信它写的
  const ownHost = (u: string) => [c.host, baseHost].includes(hostOf(u))
  let roots = [...new Set(listed)].filter(ownHost)
  if (!roots.length) roots = [...new Set(listed)]
  if (!roots.length) roots = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap/sitemap.xml'].map((p) => base + p)
  const allowed = new Set([c.host, baseHost, ...roots.map(hostOf)])
  const keep = (u: string) => allowed.has(hostOf(u))

  const queue = [...roots]
  const done = new Set<string>()
  const failed: string[] = []
  const urls = new Map<string, { loc: string; lastmod?: string }>()
  let via: string | undefined
  let browserError: string | undefined
  const take = (sm: string, xml: string) => {
    const { index, urls: found } = parseSitemap(xml)
    for (const u of found) {
      if (!keep(u.loc)) continue
      if (index) queue.push(u.loc)
      else if (!/\.(jpe?g|png|gif|webp|pdf|mp4)$/i.test(u.loc)) urls.set(u.loc, u)
    }
    return found.length > 0
  }
  while (queue.length && done.size < MAX_SITEMAPS && urls.size < MAX_URLS) {
    const sm = queue.shift()!
    if (done.has(sm)) continue
    done.add(sm)
    const g = await get(sm)
    if (g.text && take(sm, g.text)) continue
    if (blocked(g)) failed.push(sm)
  }
  // 服务器读被拦了：用户点的时候换用户的浏览器读（读到的索引里的子 sitemap 也用浏览器读）
  if (!urls.size && failed.length && browser) {
    ctx.progress?.({ message: L(ctx, `「${c.name}」拦截了自动读取，改用你的浏览器读…`, `"${c.name}" blocks automated reads; using your browser…`) })
    let pending = failed.slice(0, MAX_SITEMAPS)
    for (let round = 0; round < 3 && pending.length && urls.size < MAX_URLS; round++) {
      const before = new Set(queue)
      let got: Map<string, string>
      try {
        const r = await viaBrowser(ctx, pending)
        got = r.got
        browserError ||= r.error
      } catch (e: any) {
        throw new Error(L(ctx, `网站拦截了自动读取（${failed[0]}）；`, `The site blocks automated reads (${failed[0]}); `) + e.message)
      }
      for (const [sm, xml] of got) take(sm, xml)
      pending = queue.filter((u) => !before.has(u) && !done.has(u)).slice(0, MAX_SITEMAPS)
      pending.forEach((u) => done.add(u))
    }
    if (urls.size) via = 'browser'
  }
  if (!urls.size) {
    const why = failed.length
      ? browser
        ? L(ctx, `网站拦截了自动读取（${failed[0]}），用你的浏览器也没读到${browserError ? `：${browserError}` : '页面列表（可能要先过人机验证）。在浏览器里打开这个地址看看'}`, `The site blocks automated reads (${failed[0]}), and your browser couldn't read it either${browserError ? `: ${browserError}` : ' (it may need a human check first). Try opening that address in your browser'}`)
        : L(ctx, `网站拦截了自动读取（${failed[0]}）。点「立即检查」，会改用你自己的浏览器读`, `The site blocks automated reads (${failed[0]}). Click "Check now" to read it with your own browser`)
      : robots.status
        ? L(ctx, `没找到网站地图（sitemap）：robots.txt 里没写，常见的位置也没有。这个站读不了页面列表`, `No sitemap found: robots.txt lists none and the usual locations are empty, so the page list can't be read`)
        : L(ctx, `打不开这个网站：${tried.join('、')}`, `Couldn't open this site: ${tried.join(', ')}`)
    throw new Error(why)
  }
  return { sitemaps: roots, urls: [...urls.values()].slice(0, MAX_URLS), base, via }
}

/** 起步向导确认的竞品带过来（按域名去重，已经在的不动） */
function importOnboarding(ctx: any): number {
  let rows: any[] = []
  try {
    rows = ctx.db.query('onboarding', { limit: 10 }).list
  } catch {
    return 0
  }
  const have = new Set((ctx.db.query('competitors', { limit: 1000 }).list as Competitor[]).map((c) => c.host))
  let added = 0
  for (const r of rows) {
    for (const c of parse<{ url: string; name: string; reason?: string }[]>(r.competitors, [])) {
      const host = hostOf(c.url)
      if (!host || have.has(host)) continue
      have.add(host)
      ctx.db.insert('competitors', { name: c.name || host, url: c.url, host, reason: c.reason ?? '', source: 'onboarding', status: 'active', created_at: nowISO(), updated_at: nowISO() })
      added++
    }
  }
  return added
}

function publicCompetitor(c: Competitor, pages: Page[]) {
  const mine = pages.filter((p) => p.competitor_id === c.id)
  const { known, ...rest } = c
  return { ...rest, sitemaps: parse<string[]>(c.sitemaps, []), counts: parse<Record<string, number>>(c.counts, {}), recent: parse<Recent[]>(c.recent, []), new_total: mine.length, new_unseen: mine.filter((p) => !p.seen).length, new_week: mine.filter((p) => Date.parse(p.first_seen) > Date.now() - 7 * 86400_000).length }
}

/** 推荐了还没确认的、用户说不要的：不读、不算在盯 */
const watching = (c: Competitor) => c.status !== 'suggested' && c.status !== 'rejected'

export function list(_: unknown, ctx: any) {
  const rows: Competitor[] = ctx.db.query('competitors', { limit: 200 }).list
  const comps = rows.filter(watching)
  const pages: Page[] = ctx.db.query('competitor_pages', { where: { is_new: true }, limit: 1000 }).list
  pages.sort((a, b) => b.first_seen.localeCompare(a.first_seen))
  const suggestions = rows.filter((c) => c.status === 'suggested').map(({ known, ...c }) => c)
  return { competitors: comps.map((c) => publicCompetitor(c, pages)), discoveries: pages.slice(0, 200), suggestions }
}

export async function add(input: { url: string; name?: string }, ctx: any) {
  // 用户手动加的：读不到时可以用用户的浏览器读
  const host = hostOf(String(input?.url ?? ''))
  if (!host || !host.includes('.')) throw new Error(L(ctx, '网址不对：写竞品官网，比如 example.com', 'Invalid address: enter the competitor website, e.g. example.com'))
  const exist = (ctx.db.query('competitors', { where: { host }, limit: 1 }).list as Competitor[])[0]
  // AI 推荐过、或者以前点了不要的：直接加进监控
  if (exist && !watching(exist)) return accept({ id: exist.id }, ctx)
  if (exist) throw new Error(L(ctx, `已经在盯「${exist.name}」了`, `Already watching "${exist.name}"`))
  // 地址照用户填的存（带不带 www、http 还是 https 都留着，读的时候先试它）；host 去掉 www 只用来去重
  const given = String(input.url).trim()
  const url = /^https?:\/\//i.test(given) ? given.replace(/\/+$/, '') : 'https://' + given.replace(/\/+$/, '')
  const shown = new URL(url).hostname
  const row = ctx.db.insert('competitors', { name: String(input.name ?? '').trim() || shown, url, host, source: 'manual', status: 'active', created_at: nowISO(), updated_at: nowISO() })
  const r = await scan({ id: row.id, browser: true }, ctx)
  return { id: row.id, ...r }
}

// browser：被网站拦了时改用用户自己的浏览器读（页面上点「立即检查」「加竞品」时传；每天的定时检查不传，不在用户屏幕上开窗口）
export async function scan(input: { id?: string; browser?: boolean }, ctx: any) {
  const imported = input?.id ? 0 : importOnboarding(ctx)
  let comps: Competitor[] = ctx.db.query('competitors', { limit: 200 }).list
  comps = comps.filter((c) => (input?.id ? c.id === input.id : c.status !== 'paused' && watching(c)))
  let found = 0
  const errors: string[] = []
  for (const [i, c] of comps.entries()) {
    ctx.progress?.({ done: i, total: comps.length, message: L(ctx, `在读「${c.name}」的网站地图…`, `Reading the sitemap of "${c.name}"…`) })
    try {
      const { sitemaps, urls } = await crawl(c, ctx, !!input?.browser)
      const known = new Set(parse<string[]>(c.known, []))
      const baseline = !c.baseline_at
      const t = nowISO()
      let added = 0
      let metas = 0
      const keys = new Set<string>()
      // 同一页的几个语言版本：没有语言段的、英文的先记
      for (const u of [...urls].sort((a, b) => localeRank(a.loc) - localeRank(b.loc))) {
        const f = fp(u.loc)
        if (known.has(f)) continue
        known.add(f)
        if (baseline || added >= MAX_NEW_PER_SCAN) continue
        const key = pageKey(u.loc)
        if (keys.has(key)) continue
        keys.add(key)
        // 新页面读出标题和描述：列表上不再只有网址
        const m = metas < META_PER_SCAN ? (metas++, await metaOf(u.loc, ctx)) : { title: '', description: '' }
        ctx.db.insert('competitor_pages', { competitor_id: c.id, url: u.loc, kind: kindOf(u.loc), lastmod: u.lastmod ?? '', first_seen: t, last_seen: t, is_new: true, seen: false, ...(m.title ? { title: m.title } : {}), ...(m.description ? { description: m.description } : {}) })
        added++
      }
      found += added
      const counts: Record<string, number> = { product: 0, blog: 0, landing: 0, other: 0 }
      for (const u of urls) counts[kindOf(u.loc)]++
      const recent = await recentOf(c, urls, ctx)
      ctx.db.update('competitors', c.id, {
        sitemaps: JSON.stringify(sitemaps), pages_total: urls.length, counts: JSON.stringify(counts), known: JSON.stringify([...known]), recent: JSON.stringify(recent),
        baseline_at: c.baseline_at || t, scanned_at: t, error: '', updated_at: t,
      })
    } catch (e: any) {
      errors.push(`「${c.name}」：${e.message}`)
      ctx.db.update('competitors', c.id, { error: e.message, scanned_at: nowISO(), updated_at: nowISO() })
    }
  }
  return { competitors: comps.length, imported, new_pages: found, ...(errors.length ? { errors } : {}) }
}

type Recent = { url: string; kind: string; lastmod: string; title: string; description: string }

/** 最近更新的几个页面（按 lastmod，没有 lastmod 的站取 sitemap 里最后几个）带标题：上次读过的不重读 */
async function recentOf(c: Competitor, urls: { loc: string; lastmod?: string }[], ctx: any): Promise<Recent[]> {
  const before = new Map(parse<Recent[]>(c.recent, []).map((r) => [r.url, r]))
  const dated = urls.filter((u) => u.lastmod)
  const sorted = (dated.length ? [...dated].sort((a, b) => String(b.lastmod).localeCompare(String(a.lastmod)) || localeRank(a.loc) - localeRank(b.loc)) : [...urls].reverse())
    .filter((u) => kindOf(u.loc) !== 'other')
  // 同一页的几个语言版本只留一个（同一时间更新的里，没有语言段的、英文的排在前面）
  const seen = new Set<string>()
  const pick: { loc: string; lastmod?: string }[] = []
  for (const u of sorted) {
    if (pick.length >= RECENT) break
    const key = pageKey(u.loc)
    if (seen.has(key)) continue
    seen.add(key)
    pick.push(u)
  }
  const out: Recent[] = []
  for (const u of pick) {
    const old = before.get(u.loc)
    const m = old?.title ? old : await metaOf(u.loc, ctx)
    out.push({ url: u.loc, kind: kindOf(u.loc), lastmod: u.lastmod ?? '', title: m.title, description: m.description })
  }
  return out
}

/** 这几天各家新上了什么（周报「竞品本周动向」）：按竞品分组，带标题和类型 */
export function week(input: { days?: number }, ctx: any) {
  const days = Math.min(Math.max(Number(input?.days) || 7, 1), 31)
  const since = Date.now() - days * 86400_000
  const comps: Competitor[] = (ctx.db.query('competitors', { limit: 200 }).list as Competitor[]).filter((c) => watching(c) && c.status !== 'paused')
  const pages: Page[] = (ctx.db.query('competitor_pages', { where: { is_new: true }, limit: 1000 }).list as Page[]).filter((p) => Date.parse(p.first_seen) > since)
  return {
    days,
    competitors: comps.map((c) => {
      const mine = pages.filter((p) => p.competitor_id === c.id)
      const by: Record<string, number> = {}
      for (const p of mine) by[p.kind] = (by[p.kind] ?? 0) + 1
      return { id: c.id, name: c.name, host: c.host, new_pages: mine.length, by_kind: by, pages: mine.slice(0, 15).map((p) => ({ url: p.url, kind: p.kind, title: p.title ?? '', description: p.description ?? '', topic_id: p.topic_id ?? '' })), error: c.error ?? '' }
    }),
  }
}

/** 拆解一家竞品的打法（风格卡，任务 analyze-reference）要读的：现有内容概况、最近更新的页面、最近的新发现 */
export function analysisContext(input: { id: string }, ctx: any) {
  const c: Competitor | null = ctx.db.get('competitors', input?.id)
  if (!c) throw new Error(L(ctx, '没有这个竞品', 'No such competitor'))
  const pages: Page[] = ctx.db.query('competitor_pages', { where: { competitor_id: c.id }, limit: 1000 }).list
  pages.sort((a, b) => b.first_seen.localeCompare(a.first_seen))
  return {
    competitor: { id: c.id, name: c.name, url: c.url, host: c.host, kind: c.kind ?? '', reason: c.reason ?? '', pages_total: c.pages_total ?? 0, counts: parse<Record<string, number>>(c.counts, {}), scanned_at: c.scanned_at ?? '', error: c.error ?? '' },
    recent: parse<Recent[]>(c.recent, []),
    discoveries: pages.slice(0, 30).map((p) => ({ url: p.url, kind: p.kind, title: p.title ?? '', description: p.description ?? '', first_seen: p.first_seen })),
    ready: !!c.scanned_at && !c.error,
  }
}

export async function pages(input: { id: string; kind?: string; limit?: number; browser?: boolean }, ctx: any) {
  const c: Competitor | null = ctx.db.get('competitors', input?.id)
  if (!c) throw new Error(L(ctx, '没有这个竞品：', 'No such competitor: ') + input?.id)
  const { urls } = await crawl(c, ctx, !!input?.browser)
  const list = urls.map((u) => ({ url: u.loc, kind: kindOf(u.loc), lastmod: u.lastmod ?? '' })).filter((u) => !input.kind || u.kind === input.kind)
  list.sort((a, b) => b.lastmod.localeCompare(a.lastmod))
  return { competitor: { id: c.id, name: c.name, url: c.url }, total: list.length, pages: list.slice(0, Math.min(Math.max(input.limit ?? 300, 1), 2000)) }
}

export async function toTopic(input: { page_id: string }, ctx: any) {
  const p: Page | null = ctx.db.get('competitor_pages', input?.page_id)
  if (!p) throw new Error(L(ctx, '没有这条发现', 'No such discovery'))
  if (p.topic_id && ctx.db.get('topics', p.topic_id)) return { topic_id: p.topic_id, existed: true }
  const c: Competitor | null = ctx.db.get('competitors', p.competitor_id)
  let title = p.title ?? ''
  if (!title) {
    const page = await get(p.url)
    title = page.text ? (ctx.html(page.text).find('title')[0]?.text ?? '').trim() : ''
  }
  title ||= decodeURIComponent(p.url.replace(/\/$/, '').split('/').pop() ?? '').replace(/[-_]+/g, ' ')
  const kind = L(ctx, { product: '产品页', blog: '文章', landing: '落地页', other: '页面' }[p.kind] ?? '页面', { product: 'product page', blog: 'post', landing: 'landing page', other: 'page' }[p.kind] ?? 'page')
  const topic = ctx.db.insert('topics', {
    title: L(ctx, `对标：${title}`, `Answer to: ${title}`).slice(0, 200),
    angle: L(ctx, `竞品「${c?.name ?? ''}」新上了一个${kind}：${p.url}。写一篇我们自己的：讲清楚我们的做法和优势，不照抄，用我们的产品资料。`, `Competitor "${c?.name ?? ''}" published a new ${kind}: ${p.url}. Write our own take: our approach and strengths, no copying, using our own product facts.`),
    keywords: '', source: 'competitor', status: 'idea', workspace: 'website', content_type: 'article', target_platform: 'website', created_at: nowISO(),
    origins: originsJson([{ type: 'competitor_page', id: p.id, label: title }, ...(c ? [{ type: 'competitor', id: c.id, label: c.name }] : [])]),
    ...(ctx.chat_id ? { chat_id: String(ctx.chat_id) } : {}),
  })
  ctx.db.update('competitor_pages', p.id, { title, topic_id: topic.id, seen: true })
  return { topic_id: topic.id, title: topic.title }
}

export function markSeen(input: { ids?: string[] }, ctx: any) {
  const all: Page[] = ctx.db.query('competitor_pages', { where: { seen: false }, limit: 1000 }).list
  const ids = input?.ids?.length ? new Set(input.ids) : null
  let n = 0
  for (const p of all) if (!ids || ids.has(p.id)) (ctx.db.update('competitor_pages', p.id, { seen: true }), n++)
  return { marked: n }
}

export function pause(input: { id: string; paused: boolean }, ctx: any) {
  if (!ctx.db.get('competitors', input?.id)) throw new Error(L(ctx, '没有这个竞品', 'No such competitor'))
  ctx.db.update('competitors', input.id, { status: input.paused ? 'paused' : 'active', updated_at: nowISO() })
  return { ok: true }
}

export function remove(input: { id: string }, ctx: any) {
  if (!ctx.db.get('competitors', input?.id)) throw new Error(L(ctx, '没有这个竞品', 'No such competitor'))
  for (const p of ctx.db.query('competitor_pages', { where: { competitor_id: input.id }, limit: 1000 }).list) ctx.db.delete('competitor_pages', p.id)
  ctx.db.delete('competitors', input.id)
  return { ok: true }
}

export function saveReport(input: { title: string; body: string; competitor_ids?: string[] }, ctx: any) {
  const body = String(input?.body ?? '').trim()
  if (!body) throw new Error(L(ctx, '报告是空的', 'The report is empty'))
  const title = String(input.title ?? '').trim() || L(ctx, '竞品分析', 'Competitor analysis')
  const t = nowISO()
  const comps = (input.competitor_ids ?? []).map((id) => ctx.db.get('competitors', id)).filter(Boolean).map((c: Competitor) => ({ id: c.id, name: c.name, url: c.url }))
  return ctx.db.insert('research_findings', {
    source_id: `competitors:${t.slice(0, 10)}`, source_version: 1, title, kind: 'competitor_report', interpretation: body.slice(0, 60000),
    source_snapshot: JSON.stringify({ kind: 'competitor_report', title, collected_at: t, competitors: comps }), created_at: t,
  })
}

export function reports(input: { limit?: number }, ctx: any) {
  let rows: any[] = []
  try {
    rows = ctx.db.query('research_findings', { where: { kind: 'competitor_report' }, limit: 200 }).list
  } catch {
    return []
  }
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return rows.slice(0, input?.limit ?? 10).map((r) => ({ id: r.id, title: r.title, body: r.interpretation, created_at: r.created_at, competitors: parse<any>(r.source_snapshot, {}).competitors ?? [] }))
}

// 电商平台、媒体、目录站、开发文档和代码站不算竞品（AI 回答里常引用它们）
const NOT_COMPETITOR = /(^|\.)(alibaba|aliexpress|made-in-china|globalsources|dhgate|amazon|ebay|etsy|walmart|indiamart|tradeindia|ec21|tradekey|wikipedia|youtube|reddit|quora|linkedin|facebook|instagram|twitter|x|tiktok|pinterest|medium|google|bing|yahoo|baidu|zhihu|forbes|bloomberg|reuters|thomasnet|kompass|yelp|trustpilot|g2|capterra|github|gitlab|stackoverflow|codepen|codesandbox|jsfiddle|w3schools|mozilla|npmjs)\.[a-z.]+$/

/** 给助手找竞品用的上下文（任务 tasks/competitor-suggest.md） */
export function suggestContext(_: unknown, ctx: any) {
  const all = (t: string): any[] => {
    try {
      return ctx.db.query(t, { limit: 2000 }).list
    } catch {
      return []
    }
  }
  const sites = all('channels').filter((c) => c.type === 'creght_site' || c.type === 'wordpress')
  // 自己的网站：预览地址、正式地址、Search Console 属性、起步向导里填的网址
  const own = new Set([...sites.flatMap((c) => [c.preview_url, c.live_url, c.gsc_property?.replace(/^sc-domain:/, '')]), ...all('onboarding').map((o) => o.website_url)].filter(Boolean).map((u: string) => hostOf(u)).filter(Boolean))
  const rows = all('competitors') as Competitor[]
  // AI 搜索检测里，回答引用到的别家域名（买家问 AI 时被推荐的那些）
  const geo = new Map<string, { host: string; count: number; questions: string[] }>()
  for (const r of all('geo_results')) {
    for (const d of parse<string[]>(r.competitor_domains, [])) {
      const host = hostOf(d)
      if (!host || own.has(host) || NOT_COMPETITOR.test(host)) continue
      const g = geo.get(host) ?? { host, count: 0, questions: [] }
      g.count++
      if (g.questions.length < 2 && r.question && !g.questions.includes(r.question)) g.questions.push(r.question)
      geo.set(host, g)
    }
  }
  // 谷歌上带来曝光的搜索词（不含品牌词）：拿去搜，看排在我们前面的是谁
  const queries = new Map<string, number>()
  // 搜自己的品牌只会搜到自己：去掉带项目名、自己域名主体的词
  const me = profile(ctx)
  const brands = [me.name, ...String(me.brand_terms ?? '').split(/[,，]/), ...[...own].map((h) => h.split('.')[0])].map((b) => String(b ?? '').trim().toLowerCase()).filter((b) => b.length >= 3)
  for (const p of all('search_pages'))
    for (const q of parse<{ query: string; impressions: number }[]>(p.top_queries, []))
      if (!brands.some((b) => q.query.toLowerCase().includes(b))) queries.set(q.query, (queries.get(q.query) ?? 0) + q.impressions)
  return {
    project: projectBrief(me),
    products: all('products').slice(0, 30).map((p) => ({ name: p.name, category: p.category, keywords: p.keywords })),
    own_sites: [...own],
    existing: rows.map((c) => ({ host: c.host, name: c.name, status: c.status || 'active' })),
    geo_domains: [...geo.values()].sort((a, b) => b.count - a.count).slice(0, 15),
    search_queries: [...queries].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([q]) => q),
  }
}

type Suggestion = { url: string; name?: string; kind?: string; reason?: string; evidence?: string }

/** 存助手找到的候选竞品（status=suggested）：域名已经有的（在盯的、推荐过的、不要的）、自己的网站、平台和媒体跳过 */
export function saveSuggestions(input: { items: Suggestion[] }, ctx: any) {
  const items = Array.isArray(input?.items) ? input.items.slice(0, 12) : []
  if (!items.length) throw new Error(L(ctx, '没有候选：items 至少要有一家', 'No candidates: give at least one item'))
  const known = suggestContext({}, ctx)
  const own = new Set(known.own_sites)
  const have = new Set((ctx.db.query('competitors', { limit: 1000 }).list as Competitor[]).map((c) => c.host))
  const geoHosts = new Set(known.geo_domains.map((g) => g.host))
  const added: string[] = [], skipped: string[] = []
  for (const it of items) {
    const given = String(it?.url ?? '').trim()
    const host = hostOf(given)
    if (!host || !host.includes('.') || have.has(host) || own.has(host) || NOT_COMPETITOR.test(host)) {
      skipped.push(given)
      continue
    }
    have.add(host)
    const url = /^https?:\/\//i.test(given) ? given.replace(/\/+$/, '') : 'https://' + given.replace(/\/+$/, '')
    ctx.db.insert('competitors', {
      name: String(it.name ?? '').trim() || host, url, host,
      kind: ['direct', 'brand', 'channel'].includes(String(it.kind)) ? it.kind : 'direct',
      reason: String(it.reason ?? '').trim().slice(0, 300), evidence: String(it.evidence ?? '').trim().slice(0, 500),
      source: geoHosts.has(host) ? 'geo' : 'agent', status: 'suggested', created_at: nowISO(), updated_at: nowISO(),
    })
    added.push(host)
  }
  return { added, skipped }
}

/** 推荐的竞品加进监控：马上读一次（读不到时用用户的浏览器读） */
export async function accept(input: { id: string }, ctx: any) {
  const c: Competitor | null = ctx.db.get('competitors', input?.id)
  if (!c) throw new Error(L(ctx, '没有这个竞品', 'No such competitor'))
  ctx.db.update('competitors', c.id, { status: 'active', updated_at: nowISO() })
  const r = await scan({ id: c.id, browser: true }, ctx)
  return { id: c.id, ...r }
}

/** 推荐的不要：留着这一行（status=rejected），下次不再推荐 */
export function reject(input: { id: string }, ctx: any) {
  if (!ctx.db.get('competitors', input?.id)) throw new Error(L(ctx, '没有这个竞品', 'No such competitor'))
  ctx.db.update('competitors', input.id, { status: 'rejected', updated_at: nowISO() })
  return { ok: true }
}
