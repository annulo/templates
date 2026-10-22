// serp 共用的东西：结果的格式、错误码、按域名给结果分类。
// 来自 https://github.com/annulo/references 的 serp/。

/** 页面里取到的原始条目（extract 的返回，也是 fixtures/ 存的格式） */
export type Raw = { url: string; items: { href: string; title: string; snippet: string; ad: boolean }[]; ads: number }

/** 一条自然结果 */
export type Result = { position: number; url: string; domain: string; title: string; snippet?: string }

/**
 * 出错时 throw 的 Error 带 code：
 * - captcha：Google 要人机验证（查太快、太多），停下，让用户在那个 Chrome 里搜一次做完验证，过一会儿再查；
 * - consent：Cookie 同意页（欧盟地区），用户点一次就好；
 * - changed：页面和这份代码对不上了（Google 改版），照 MAINTAIN.md 排查。
 */
export type ErrorCode = 'captcha' | 'consent' | 'changed'

export function fail(code: ErrorCode, message: string): never {
  const e: any = new Error(`[${code}] ${message}`)
  e.code = code
  throw e
}

/**
 * 结果网站的类型（只按域名，事实层面）：
 * - b2b：B2B 平台的商品页（Alibaba、Made-in-China…）；
 * - marketplace：零售电商（Amazon、eBay…）；
 * - forum：论坛、问答、UGC（Reddit、Quora…）；
 * - social：社媒、视频（YouTube、Facebook、LinkedIn、Pinterest…）；
 * - reference：百科、词典；
 * - site：其它网站（独立站、品牌官网、媒体）。
 * 列表不全：常见的外贸、电商、内容平台。要加照着格式往里加。
 */
export const KINDS: Record<string, string[]> = {
  b2b: ['alibaba.com', 'made-in-china.com', 'globalsources.com', 'indiamart.com', 'tradeindia.com', 'ec21.com', 'dhgate.com', '1688.com', 'tradekey.com', 'thomasnet.com', 'europages.com', 'kompass.com', 'exportersindia.com', 'directindustry.com', 'tradewheel.com', 'hktdc.com'],
  marketplace: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au', 'ebay.com', 'walmart.com', 'etsy.com', 'aliexpress.com', 'temu.com', 'target.com', 'homedepot.com', 'lowes.com', 'bestbuy.com', 'wayfair.com', 'shein.com', 'mercadolibre.com'],
  forum: ['reddit.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com', 'medium.com', 'answers.com', 'tripadvisor.com'],
  social: ['youtube.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'x.com', 'twitter.com'],
  reference: ['wikipedia.org', 'wikihow.com', 'britannica.com', 'merriam-webster.com', 'investopedia.com'],
}

/** 域名 → 类型（子域名也算：en.wikipedia.org → reference） */
export function kindOf(domain: string): string {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '')
  for (const [kind, list] of Object.entries(KINDS)) if (list.some((x) => d === x || d.endsWith('.' + x))) return kind
  return 'site'
}
