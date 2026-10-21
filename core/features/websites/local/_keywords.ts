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

export type Bucket = 'quick_win' | 'ranking' | 'unchecked'

/**
 * 分桶（只看事实：GSC 里这个词本站排第几、有多少曝光）：
 * 排在前 3 是 ranking；排在 4~30 且曝光 ≥ 10 是 quick_win（已经有页面在排，补一补能往前挪）；其余（没数据、排得太后、曝光太少）是 unchecked。
 * 第二期查 Google 搜索结果页后，unchecked 再分成 open（前 10 里有弱位置）和 hard（大站霸屏）。
 */
export function bucketOf(k: { gsc_impressions?: number; gsc_position?: number }): Bucket {
  const imp = k.gsc_impressions ?? 0
  const pos = k.gsc_position ?? 0
  if (!imp || !pos) return 'unchecked'
  if (pos <= 3) return 'ranking'
  if (pos <= 30 && imp >= 10) return 'quick_win'
  return 'unchecked'
}

/** 机会分：快赢的按曝光乘离首页远近（4~10 位最值，11~20 次之，21~30 再次）；其余按曝光。只用来在同一桶里排序 */
export function scoreOf(k: { gsc_impressions?: number; gsc_position?: number }, bucket: Bucket): number {
  const imp = k.gsc_impressions ?? 0
  if (bucket !== 'quick_win') return imp
  const pos = k.gsc_position ?? 99
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
