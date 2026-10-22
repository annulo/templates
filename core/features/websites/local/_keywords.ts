// 关键词挖掘的纯函数（文件名以 _ 开头：不作为可调用的函数，只给 keywords.ts import；测试在 publish/tests/keywords.test.mjs）。
// 设计见 docs/keywords.md。

/**
 * 拼在种子词后面去拉联想的修饰词（助手没按写法给 modifiers 时用）：
 * trade 是外贸 B2B 买家找供应商的说法，general 是通用的对比、选型、价格。
 */
export const MODIFIERS: Record<'trade' | 'general', Record<'en' | 'zh', string[]>> = {
  trade: {
    en: ['manufacturer', 'supplier', 'factory', 'wholesale', 'oem', 'custom', 'price', 'for', 'vs', 'how to'],
    zh: ['厂家', '供应商', '批发', '定制', '价格', '多少钱', '哪家好', '怎么选'],
  },
  general: {
    en: ['best', 'for', 'vs', 'alternative', 'pricing', 'how to', 'tool', 'free'],
    zh: ['推荐', '哪个好', '怎么用', '价格', '对比', '替代', '免费'],
  },
}

/** 去重用的写法：小写、空白合成一个 */
export const normKey = (s: string) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** 联想接口的返回：Google（client=firefox）和 Bing（osjson）都是 [原词, [联想词…]] */
export function parseSuggest(text: string): string[] {
  try {
    const j = JSON.parse(text)
    return Array.isArray(j?.[1]) ? j[1].map((s: unknown) => String(s ?? '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

export function suggestUrl(engine: 'google' | 'bing', q: string, lang: string, country: string): string {
  const e = encodeURIComponent(q)
  if (engine === 'google') return `https://suggestqueries.google.com/complete/search?client=firefox&hl=${encodeURIComponent(lang)}&gl=${encodeURIComponent(country)}&q=${e}`
  return `https://api.bing.com/osjson.aspx?query=${e}&market=${encodeURIComponent(`${lang}-${country.toUpperCase()}`)}`
}

/** 一个词值不值得留：不太长、不太短、不是纯数字和符号 */
export function usable(q: string): boolean {
  const s = normKey(q)
  if (s.length < 3 || s.length > 80) return false
  if (s.split(' ').length > 8) return false
  // 至少有一个不是数字、空白、ASCII 标点的字符（本机函数的运行环境不支持正则的 \p{L}）
  return s.replace(/[\d\s!-\/:-@[-`{-~]/g, '').length > 0
}

/** 种子词：逗号、顿号、换行分开，去重，保持顺序 */
export function splitTerms(...texts: (string | undefined)[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of texts)
    for (const part of String(t ?? '').split(/[,，、;；\n]/)) {
      const s = part.trim()
      const k = normKey(s)
      if (s && usable(s) && !seen.has(k)) (seen.add(k), out.push(s))
    }
  return out
}

export type Bucket = 'quick_win' | 'ranking' | 'open' | 'mixed' | 'hard' | 'unchecked'

/** 查 Google 结果页时记下的事实（keywords.serp 写）：我们排第几（前 10 里没有是 0），前 10 里弱位置、强站各几个 */
export type SerpFacts = { serp_at?: string; serp_position?: number; serp_weak?: number; serp_strong?: number }

/**
 * 分桶，只看事实，GSC 优先（是本站真实的平均排名）：
 * - GSC：排在前 3 是 ranking；排在 4~30 且曝光 ≥ 10 是 quick_win（已经有页面在排，补一补能往前挪）；
 * - 没有 GSC 数据、查过 Google 结果页的：我们在前 3 是 ranking、在 4~10 是 quick_win；不在前 10 的看前 10 都是谁：
 *   弱位置（论坛问答、社媒、B2B 平台的商品页）≥ 3 个是 open（Google 找不到像样的专门页面，新写一篇有机会）；
 *   弱位置 ≤ 1 个、强站（零售电商、百科）≥ 4 个是 hard；其余 mixed；
 * - 都没有是 unchecked。
 */
export function bucketOf(k: { gsc_impressions?: number; gsc_position?: number } & SerpFacts): Bucket {
  const imp = k.gsc_impressions ?? 0
  const pos = k.gsc_position ?? 0
  if (imp && pos) {
    if (pos <= 3) return 'ranking'
    if (pos <= 30 && imp >= 10) return 'quick_win'
  }
  if (!k.serp_at) return 'unchecked'
  const sp = k.serp_position ?? 0
  if (sp && sp <= 3) return 'ranking'
  if (sp) return 'quick_win'
  if ((k.serp_weak ?? 0) >= 3) return 'open'
  if ((k.serp_weak ?? 0) <= 1 && (k.serp_strong ?? 0) >= 4) return 'hard'
  return 'mixed'
}

/** 结果网站的类型里哪些算弱位置、哪些算强站（类型见 _serp_common.ts 的 kindOf） */
export const WEAK_KINDS = ['forum', 'social', 'b2b']
export const STRONG_KINDS = ['marketplace', 'reference']

const hostOf = (u: string) => {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}
const sameSite = (domain: string, list: string[]) => list.some((d) => d && (domain === d || domain.endsWith('.' + d) || d.endsWith('.' + domain)))

/** 本站的域名：GSC 属性（sc-domain: 或网址）、访问地址、GSC 里出现过的页面 */
export function ownDomains(...urls: (string | undefined)[]): string[] {
  return [...new Set(urls.map((u) => hostOf(String(u ?? '').replace(/^sc-domain:/, ''))).filter(Boolean))]
}

/**
 * 一次 Google 结果页 → 存进 keywords 的事实：我们排第几、弱位置和强站各几个、前 10 条（类型里本站标 ours、在盯的竞品标 competitor）。
 * results 是参考代码 serp.ts 的结果（带 kind）。
 */
export function serpFacts(results: { position: number; url: string; domain: string; kind: string; title: string }[], ours: string[], competitors: string[]) {
  let position = 0, weak = 0, strong = 0
  const top = results.slice(0, 10).map((r) => {
    const kind = sameSite(r.domain, ours) ? 'ours' : sameSite(r.domain, competitors) ? 'competitor' : r.kind
    if (kind === 'ours' && !position) position = r.position
    if (WEAK_KINDS.includes(kind)) weak++
    if (STRONG_KINDS.includes(kind)) strong++
    return { p: r.position, domain: r.domain, kind, title: String(r.title ?? '').slice(0, 120), url: r.url }
  })
  return { serp_position: position, serp_weak: weak, serp_strong: strong, serp_results: JSON.stringify(top) }
}

/** 排名历史：每天一条（同一天后来的覆盖前面的），最多留 26 条（半年的每周） */
export function pushRank(history: string | undefined, entry: { d: string; p: number; s: 'gsc' | 'serp' }): string {
  let list: { d: string; p: number; s: string }[] = []
  try {
    list = JSON.parse(history || '[]')
  } catch {}
  list = list.filter((x) => !(x.d === entry.d && x.s === entry.s))
  list.push(entry)
  list.sort((a, b) => a.d.localeCompare(b.d))
  return JSON.stringify(list.slice(-26))
}

/** 机会分：快赢的按曝光乘离首页远近（4~10 位最值，11~20 次之，21~30 再次）；新机会按弱位置多少；其余按曝光。只用来在同一桶里排序 */
export function scoreOf(k: { gsc_impressions?: number; gsc_position?: number } & SerpFacts, bucket: Bucket): number {
  const imp = k.gsc_impressions ?? 0
  if (bucket === 'open') return 100 + (k.serp_weak ?? 0) * 10 // 弱位置越多越好做
  if (bucket !== 'quick_win') return imp
  const pos = k.gsc_position || k.serp_position || 99
  const w = pos <= 10 ? 1 : pos <= 20 ? 0.7 : 0.4
  return Math.round(imp * w)
}

export type GscRow = { keys: string[]; clicks: number; impressions: number; position: number }

/**
 * GSC 的 query 和 query+page 两组行 → 每个词（小写）的曝光、点击、平均排名、曝光最多的页面。
 * 排名用 query 维度的（按页面拆开后每页各有排名，不好合）；页面取 query+page 里曝光最多的。
 */
export function gscByKeyword(byQuery: GscRow[], byQueryPage: GscRow[]) {
  const out = new Map<string, { impressions: number; clicks: number; position: number; page: string; pageImp: number }>()
  for (const r of byQuery) {
    const k = normKey(r.keys[0])
    if (k) out.set(k, { impressions: r.impressions, clicks: r.clicks, position: Math.round(r.position * 10) / 10, page: '', pageImp: 0 })
  }
  for (const r of byQueryPage) {
    const v = out.get(normKey(r.keys[0]))
    if (v && r.impressions > v.pageImp) (v.page = r.keys[1], v.pageImp = r.impressions)
  }
  return out
}

/** 合并来源列表：'suggest,gsc' + 'agent' → 'suggest,gsc,agent' */
export function mergeSources(a: string | undefined, b: string): string {
  const list = String(a ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const s of b.split(',').map((x) => x.trim()).filter(Boolean)) if (!list.includes(s)) list.push(s)
  return list.join(',')
}
