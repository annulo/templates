// AI 引用分：长文好不好被 AI 读懂、愿不愿意原样引用。设计见仓库根目录 docs/ai-citation-score.md。
// 纯规则、不调模型：每一项都是从正文 HTML 机械数出来的事实，分数只是它们的加总；页面（core/components/AiScore.tsx）和本机函数 aeo.article 共用这一份。
//
//   scoreArticle({ title, summary, body }, { terms, hosts })
//     terms：品牌词、产品名、型号（公司资料和产品目录里的），段落里出现了算「具体」
//     hosts：自己网站的域名，链接指向它们算内链，其余 http(s) 链接算外部引用
//   → null（正文是空的）或 { score, grade, lang, checks, blocks, weakest }

export type AeoGrade = 'A' | 'B' | 'C' | 'D' | 'F'
export type AeoLang = 'zh' | 'en'
export type AeoCheckKey = 'title' | 'summary' | 'lead' | 'depth' | 'headings' | 'questions' | 'lists' | 'data' | 'external' | 'internal'
export type AeoDim = 'length' | 'standalone' | 'structure' | 'data' | 'specific'
export type AeoCheck = { key: AeoCheckKey; ok: boolean; value: number }
export type AeoBlock = { n: number; kind: 'p' | 'list' | 'table'; heading: string; text: string; score: number; miss: AeoDim[] }
export type AeoResult = { score: number; grade: AeoGrade; lang: AeoLang; checks: AeoCheck[]; blocks: AeoBlock[]; weakest: AeoBlock[] }

/** 每一项的名字和说明：页面和本机函数都用，改规则时一起改 */
type Text = { zh: [string, string]; en: [string, string] }
export const AEO_CHECK_TEXT: Record<AeoCheckKey, Text> = {
  title: { zh: ['标题具体', '中文 10–35 字 / 英文 20–70 字符，说清这篇讲什么'], en: ['Specific title', '20–70 characters (10–35 CJK characters), saying what the article covers'] },
  summary: { zh: ['有摘要', '20–160 字，搜索结果和 AI 摘要常用它'], en: ['Has a summary', '20–160 characters; search results and AI summaries often use it'] },
  lead: { zh: ['开头先答', '第一段 60–220 字 / 30–90 词，直接回答标题的问题'], en: ['Answer first', 'The first paragraph is 30–90 words and answers the title directly'] },
  depth: { zh: ['内容够长', '正文 1200 字 / 600 词以上'], en: ['Enough depth', 'At least 600 words (1200 CJK characters)'] },
  headings: { zh: ['有小标题', '至少 3 个 H2 / H3，分出层次'], en: ['Has subheadings', 'At least 3 H2 / H3 headings'] },
  questions: { zh: ['有问答', '至少一个小标题是买家会问的问题（以问号结尾，或 什么 / 如何 / 哪 / What / How 开头）'], en: ['Has Q&A', 'At least one subheading is a question buyers ask (ends with ?, or starts with What / How / Which…)'] },
  lists: { zh: ['有列表或表格', '参数、步骤、对比放进列表或表格，AI 最容易整块引用'], en: ['Has a list or table', 'Put specs, steps and comparisons in lists or tables; AI quotes them whole'] },
  data: { zh: ['有具体数据', '至少 5 处数字带单位、认证或型号'], en: ['Has concrete data', 'At least 5 numbers with units, certifications or model numbers'] },
  external: { zh: ['有外部引用', '至少一条链接指向外站（标准、认证机构、行业资料）'], en: ['Cites sources', 'At least one link to another site (standards, certifiers, industry sources)'] },
  internal: { zh: ['有内链', '至少一条链接指向自己网站的其他页面'], en: ['Has internal links', 'At least one link to another page on your own site'] },
}
export const AEO_DIM_TEXT: Record<AeoDim, Text> = {
  length: { zh: ['长度合适', '一段 60–250 字 / 30–120 词，列表、表格至少 3 项；太短说不清，太长 AI 截不出来'], en: ['Right length', '30–120 words per paragraph, 3+ items per list or table; too short says little, too long is hard to quote'] },
  standalone: { zh: ['单独能看懂', '不以「这、它、此外、上述」这类指代上文的词开头'], en: ['Stands alone', "Doesn't open with words pointing back (This, It, However, As mentioned…)"] },
  structure: { zh: ['结构清楚', '是小标题下的头两段（问句小标题下都算），或者是列表 / 表格；离小标题太远的段落 AI 不知道它在答什么'], en: ['Clear structure', 'One of the first two paragraphs under a subheading (any under a question heading), or a list / table; paragraphs far from a heading lose their context'] },
  data: { zh: ['有数据', '带数字和单位、认证、型号'], en: ['Has data', 'Includes a figure with a unit, a certification or a model number'] },
  specific: { zh: ['具体不空泛', '没有「高品质、一流、领先」这类套话，并提到了具体的东西（品牌、产品、型号、数字、专有名词）'], en: ['Specific', 'No filler (high quality, leading, best price), and names something concrete (a brand, product, model, figure or proper noun)'] },
}
export const aeoCheckText = (key: AeoCheckKey, en: boolean) => AEO_CHECK_TEXT[key][en ? 'en' : 'zh']
export const aeoDimText = (key: AeoDim, en: boolean) => AEO_DIM_TEXT[key][en ? 'en' : 'zh']

export const gradeOf = (score: number): AeoGrade => (score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F')

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" }
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (_, e) => ENTITIES[e]).replace(/\s+/g, ' ').trim()
const CJK = /[㐀-鿿豈-﫿]/g
const cjkCount = (s: string) => (s.match(CJK) ?? []).length
/** 中文按字数，英文按词数 */
const sizeOf = (s: string, lang: AeoLang) => (lang === 'zh' ? s.replace(/\s/g, '').length : s.split(/\s+/).filter(Boolean).length)

const QUESTION = /([?？]\s*$)|^(what|how|which|why|when|where|who|can|does|do|is|are|should|will)\b|^(什么|如何|怎么|怎样|哪|为什么|为何|是否|能否|可以|多少|多久|有没有)/i
const POINTER_EN = /^(this|that|these|those|it|its|they|them|their|such|also|however|moreover|furthermore|additionally|besides|so|and|but|as (mentioned|noted|shown|discussed)|above|below)\b/i
const POINTER_ZH = /^(这|那|它|其|此|该|上述|如上|以上|此外|另外|而且|但是|但|因此|所以|同时|总之|总而言之)/
const FLUFF = /\b(high[- ]quality|top[- ]quality|best price|competitive price|leading (manufacturer|supplier|company)|world[- ]class|one[- ]stop|cutting[- ]edge|state[- ]of[- ]the[- ]art|excellent service|customer satisfaction|wide range of)\b|高品质|高质量|一流|领先|优质服务|性价比高|价格优惠|品质卓越|行业领先|一站式|全方位|专业团队/gi
const UNIT = /\d[\d,.]*\s?(%|mm|cm|km|m|μm|kg|g|t|tons?|lbs?|pcs|pieces|sets|units|containers?|days?|weeks?|months?|years?|hours?|hrs?|h|°c|°f|v|w|kw|kwh|mah|mpa|bar|psi|rpm|usd|us\$|\$|€|元|天|周|个月|年|小时|件|个|台|套|只|吨|公斤|千克|克|毫米|厘米|米|伏|瓦|千瓦)(?![a-z])/gi
const CERT = /\b(CE|ISO\s?\d{3,5}|RoHS|REACH|FDA|UL|ETL|FCC|SGS|BSCI|GMC|EN\s?\d{2,5}|ASTM\s?[A-Z]?\d+|IP\d{2}|MOQ|FOB|CIF|EXW|OEM|ODM)\b/g
const MODEL = /\b[A-Z]{1,5}-?\d{2,}[A-Z0-9-]*\b/g
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length
const facts = (s: string) => count(s, UNIT) + count(s, CERT) + count(s, MODEL)
/** 有没有点名具体的东西：数字、拉丁字母的名字（中文里）、句中大写开头的词（英文里，句首的不算） */
const named = (s: string, lang: AeoLang) => /\d/.test(s) || (lang === 'zh' ? /[A-Za-z]{2,}/.test(s) : /[^.!?:]\s+[A-Z][A-Za-z0-9]+/.test(s))

type Raw = { tag: string; html: string }
const BLOCK = /<(h[1-6]|p|ul|ol|table|blockquote)\b[^>]*>/gi

/** 按顺序取出顶层的块（标题、段落、列表、表格、引用）；嵌在里面的不重复取，外面包的 div、section 直接穿过 */
function blocksOf(html: string): Raw[] {
  const out: Raw[] = []
  BLOCK.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = BLOCK.exec(html))) {
    const tag = m[1].toLowerCase()
    const same = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
    same.lastIndex = m.index + m[0].length
    let depth = 1
    let end = html.length
    let n: RegExpExecArray | null
    while ((n = same.exec(html))) {
      depth += n[1] ? -1 : 1
      if (!depth) { end = n.index; break }
    }
    out.push({ tag, html: html.slice(m.index + m[0].length, end) })
    // 从这个块的结束标签后面接着找（没闭合就到头了）
    BLOCK.lastIndex = depth ? html.length : same.lastIndex
  }
  return out
}

const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } }

/** 公司资料、产品目录里的品牌词、产品名、型号，和自己网站的域名：给 scoreArticle 的 terms、hosts */
export function aeoOptions(profile: any, products: any[]): { terms: string[]; hosts: string[] } {
  const split = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.flatMap(split)
    const s = String(v ?? '').trim()
    if (!s) return []
    if (/^\[/.test(s)) { try { return split(JSON.parse(s)) } catch {} }
    return s.split(/[,，;；、\n]+/)
  }
  const terms = [profile?.name, profile?.brand_terms, ...(products ?? []).flatMap((p) => [p?.name, p?.model])].flatMap(split).map((x) => x.trim()).filter((x) => x.length >= 2)
  const hosts = [profile?.website_url, profile?.source_url].map((u) => hostOf(String(u ?? ''))).filter(Boolean)
  return { terms: [...new Set(terms)].slice(0, 200), hosts: [...new Set(hosts)] }
}

export function scoreArticle(a: { title?: string; summary?: string; body?: string }, opts: { terms?: string[]; hosts?: string[] } = {}): AeoResult | null {
  const body = String(a.body ?? '')
  const raws = blocksOf(body)
  const all = text(body)
  if (!all) return null
  const plain = all.replace(/\s/g, '')
  const lang: AeoLang = cjkCount(all) > plain.length * 0.3 ? 'zh' : 'en'
  const terms = (opts.terms ?? []).map((t) => t.toLowerCase())
  const hosts = opts.hosts ?? []

  // 段落：每块记下它上面最近的小标题
  const blocks: AeoBlock[] = []
  const headings: string[] = []
  let heading = ''
  let since = 0 // 这个小标题下面第几段
  let intro = '' // 以冒号结尾、引出下面列表或表格的那句：并进列表，不单独算一段
  for (const [i, r] of raws.entries()) {
    if (/^h[1-6]$/.test(r.tag)) {
      heading = text(r.html)
      since = 0
      if (r.tag !== 'h1') headings.push(heading)
      continue
    }
    const kind = r.tag === 'table' ? 'table' : r.tag === 'ul' || r.tag === 'ol' ? 'list' : 'p'
    if (kind === 'p' && /[:：]$/.test(text(r.html)) && /^(ul|ol|table)$/.test(raws[i + 1]?.tag ?? '')) { intro = text(r.html); continue }
    const t = kind === 'p' ? text(r.html) : [intro, text(r.html)].filter(Boolean).join(' ')
    intro = ''
    // 图片说明、一两个字的段落不算段落
    if (kind === 'p' && sizeOf(t, lang) < (lang === 'zh' ? 15 : 8)) continue
    since++
    const items = kind === 'table' ? count(r.html, /<tr\b/gi) : kind === 'list' ? count(r.html, /<li\b/gi) : 0
    const size = sizeOf(t, lang)
    const lower = t.toLowerCase()
    const hasData = facts(t) > 0
    const hasTerm = terms.some((x) => lower.includes(x))
    const pass: Record<AeoDim, boolean> = {
      length: kind === 'p' ? (lang === 'zh' ? size >= 60 && size <= 250 : size >= 30 && size <= 120) : items >= 3,
      standalone: kind !== 'p' || !(lang === 'zh' ? POINTER_ZH : POINTER_EN).test(t),
      structure: kind !== 'p' || QUESTION.test(heading) || (!!heading && since <= 2),
      data: hasData,
      specific: count(t, FLUFF) === 0 && (hasData || hasTerm || named(t, lang)),
    }
    const miss = (Object.keys(pass) as AeoDim[]).filter((k) => !pass[k])
    blocks.push({ n: blocks.length + 1, kind, heading, text: t, score: (5 - miss.length) * 20, miss })
  }

  const paras = blocks.filter((b) => b.kind === 'p')
  const lead = paras[0] ? sizeOf(paras[0].text, lang) : 0
  const title = String(a.title ?? '').trim()
  const titleSize = [...title].length
  const summary = String(a.summary ?? '').trim().length
  const size = sizeOf(all, lang)
  const links = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1].trim())
  const absolute = links.filter((u) => /^https?:\/\//i.test(u))
  const own = (u: string) => { const h = hostOf(u); return !!h && hosts.some((x) => h === x || h.endsWith('.' + x)) }
  const external = absolute.filter((u) => !own(u)).length
  const internal = links.filter((u) => /^\/(?!\/)/.test(u) || own(u)).length
  const factCount = facts(all)
  const checks: AeoCheck[] = [
    { key: 'title', ok: lang === 'zh' ? titleSize >= 10 && titleSize <= 35 : titleSize >= 20 && titleSize <= 70, value: titleSize },
    { key: 'summary', ok: summary >= 20 && summary <= 160, value: summary },
    { key: 'lead', ok: lang === 'zh' ? lead >= 60 && lead <= 220 : lead >= 30 && lead <= 90, value: lead },
    { key: 'depth', ok: lang === 'zh' ? size >= 1200 : size >= 600, value: size },
    { key: 'headings', ok: headings.length >= 3, value: headings.length },
    { key: 'questions', ok: headings.some((h) => QUESTION.test(h)), value: headings.filter((h) => QUESTION.test(h)).length },
    { key: 'lists', ok: blocks.some((b) => b.kind !== 'p'), value: blocks.filter((b) => b.kind !== 'p').length },
    { key: 'data', ok: factCount >= 5, value: factCount },
    { key: 'external', ok: external >= 1, value: external },
    { key: 'internal', ok: internal >= 1, value: internal },
  ]

  // 整篇 = 段落分（开头三段权重加倍）× 0.6 + 整篇检查 × 0.4；没有段落时只看整篇检查
  const checkScore = (checks.filter((c) => c.ok).length / checks.length) * 100
  const weights = blocks.map((_, i) => (i < 3 ? 2 : 1))
  const wsum = weights.reduce((s, w) => s + w, 0)
  const blockScore = wsum ? blocks.reduce((s, b, i) => s + b.score * weights[i], 0) / wsum : 0
  const score = Math.round(wsum ? blockScore * 0.6 + checkScore * 0.4 : checkScore)
  const weakest = blocks.filter((b) => b.score < 80).sort((x, y) => x.score - y.score || x.n - y.n).slice(0, 3)
  return { score, grade: gradeOf(score), lang, checks, blocks, weakest }
}
