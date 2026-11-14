// 文章、选题查重（不调模型，文件名以 _ 开头：只给别的文件 import）。

/** 能发文章的网站渠道 */
const SITE_TYPES = ['creght_site', 'wordpress']
//
//   主题重复：标题按词比（词按在全部标题里出现的多少加权，「table」「supplier」这种人人都有的词分量轻），加上主关键词是不是同一个；
//   段落重复：正文按段切开，按 5 个词（中文 8 个字）一组比，同一篇里重复的、和别的文章重复的段落都找出来；
//   产品引用：文章正文里提到了哪些产品（型号优先，没有型号按名称），写新文章时少用最近反复用过的。

import { contents } from './_creght'
import { htmlText, typeOf } from './_types'
import { wp } from './_wp'

/** 一篇已有的内容：网站上的文章、后台写的长文、选题 */
export type Existing = { title: string; keywords?: string; url?: string; slug?: string; source: 'site' | 'article' | 'topic'; id?: string; status?: string }
export type Match = Existing & { score: number; reason: 'same_title' | 'same_keyword' | 'similar_title' | 'related' }

const STOP = new Set(
  'a an the and or but for to of in on at by with from into vs versus is are be your our you we it its this that these those how what why which who when where best top guide complete ultimate 2023 2024 2025 2026 2027 tips ways step steps things everything need know about do does can should more most'.split(' '),
)

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** 粗略的词干：buyers → buyer、importing / imported → import、choosing / choose → choos，同一个词的不同写法算一个 */
function stem(w: string): string {
  if (/^\d+$/.test(w) || w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  let x = w
  if (x.endsWith('ing') && x.length > 5) x = x.slice(0, -3)
  else if (x.endsWith('ed') && x.length > 4) x = x.slice(0, -2)
  else if (x.endsWith('es') && x.length > 4 && /(ch|sh|x|ss)es$/.test(x)) x = x.slice(0, -2)
  else if (x.endsWith('s') && !x.endsWith('ss')) x = x.slice(0, -1)
  return x.length > 4 && x.endsWith('e') ? x.slice(0, -1) : x
}

/** 一段文字里的词：英文按单词（去掉常用虚词，取词干），中文按相邻两个字 */
export function terms(s: string): string[] {
  const out: string[] = []
  for (const w of norm(s).match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []) {
    if (/^[\u4e00-\u9fff]/.test(w)) {
      if (w.length === 1) out.push(w)
      for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2))
      continue
    }
    if (STOP.has(w) || w.length < 2) continue
    out.push(stem(w))
  }
  return [...new Set(out)]
}

/** 主关键词：keywords 里的第一个 */
const mainKeyword = (k?: string) => norm(String(k ?? '').split(/[,，、;；\n]/)[0] ?? '')

/** 标题相似度 0~1：按词加权的 Jaccard，权重是 idf（在全部标题里越少见越重） */
function weighted(a: string[], b: string[], idf: (t: string) => number) {
  const A = new Set(a)
  const B = new Set(b)
  let inter = 0
  let union = 0
  for (const t of new Set([...A, ...B])) {
    const w = idf(t)
    union += w
    if (A.has(t) && B.has(t)) inter += w
  }
  return union ? inter / union : 0
}

/**
 * 这个标题、关键词和已有的哪些重了。verdict：duplicate（同一个主题，别再写一篇）/ related（相近，可以写但要换角度、互相链接）/ ok。
 * 阈值是按外贸站的标题试出来的：0.6 以上基本是同一个问题换了说法，0.35~0.6 是同一类产品的不同问题
 */
export function overlap(title: string, keywords: string | undefined, existing: Existing[], limit = 5): { verdict: 'duplicate' | 'related' | 'ok'; similar: Match[] } {
  const mine = terms(title)
  const df = new Map<string, number>()
  for (const e of existing) for (const t of terms(e.title)) df.set(t, (df.get(t) ?? 0) + 1)
  const n = existing.length + 1
  const idf = (t: string) => Math.log(1 + n / (1 + (df.get(t) ?? 0)))
  const kw = mainKeyword(keywords)
  const nt = norm(title)
  const hits: Match[] = []
  for (const e of existing) {
    if (!e.title) continue
    if (norm(e.title) === nt) {
      hits.push({ ...e, score: 1, reason: 'same_title' })
      continue
    }
    const score = Math.round(weighted(mine, terms(e.title), idf) * 100) / 100
    if (kw && kw.length > 3 && mainKeyword(e.keywords) === kw) hits.push({ ...e, score: Math.max(score, 0.8), reason: 'same_keyword' })
    else if (score >= 0.6) hits.push({ ...e, score, reason: 'similar_title' })
    else if (score >= 0.35) hits.push({ ...e, score, reason: 'related' })
  }
  hits.sort((a, b) => b.score - a.score)
  const similar = hits.slice(0, limit)
  return { verdict: similar.some((h) => h.reason !== 'related') ? 'duplicate' : similar.length ? 'related' : 'ok', similar }
}

/** 正文的段落（纯文字）：太短的（小标题、一句话）不算 */
export function paragraphs(html: string): string[] {
  return htmlText(html)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => (/[\u4e00-\u9fff]/.test(p) ? p.length >= 30 : p.split(/\s+/).length >= 12))
}

/** 一段话按 5 个词（中文 8 个字）一组 */
function shingles(p: string): Set<string> {
  const s = norm(p).replace(/[^\p{L}\p{N}\s]/gu, ' ')
  const out = new Set<string>()
  if (/[\u4e00-\u9fff]/.test(s)) {
    const t = s.replace(/\s+/g, '')
    for (let i = 0; i + 8 <= t.length; i++) out.add(t.slice(i, i + 8))
  } else {
    const w = s.split(/\s+/).filter(Boolean)
    for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(' '))
  }
  return out
}

const short = (p: string) => (p.length > 140 ? p.slice(0, 140) + '…' : p)

/**
 * 段落重复：inside 是这一篇里互相重复的段落（第几段，从 1 数），others 是和别的文章重复的段落。
 * 一段有一半以上的 5 词组在另一段里出现过，就算重复（换几个词的套话也认得出）
 */
export function repeats(body: string, others: { id: string; title: string; body?: string }[]) {
  const mine = paragraphs(body).map((p) => ({ p, s: shingles(p) }))
  const inside: { n: number; same_as: number; text: string }[] = []
  for (let i = 0; i < mine.length; i++)
    for (let j = 0; j < i; j++) {
      if (!mine[i].s.size) continue
      let hit = 0
      for (const x of mine[i].s) if (mine[j].s.has(x)) hit++
      if (hit / mine[i].s.size >= 0.5) {
        inside.push({ n: i + 1, same_as: j + 1, text: short(mine[i].p) })
        break
      }
    }
  // 别的文章：5 词组 → 出现在哪篇，按篇数命中
  const index = new Map<string, Set<number>>()
  others.forEach((o, k) => {
    for (const p of paragraphs(String(o.body ?? ''))) for (const x of shingles(p)) (index.get(x) ?? index.set(x, new Set()).get(x)!).add(k)
  })
  const across: { n: number; article_id: string; article_title: string; text: string }[] = []
  mine.forEach(({ p, s }, i) => {
    if (!s.size) return
    const count = new Map<number, number>()
    for (const x of s) for (const k of index.get(x) ?? []) count.set(k, (count.get(k) ?? 0) + 1)
    const best = [...count].sort((a, b) => b[1] - a[1])[0]
    if (best && best[1] / s.size >= 0.5) across.push({ n: i + 1, article_id: others[best[0]].id, article_title: others[best[0]].title, text: short(p) })
  })
  return { inside, others: across }
}

/** 正文里提到了哪些产品（返回产品 id）：型号（至少 3 个字符）或名称（至少 4 个字符）出现了就算，不分大小写、按整词 */
export function mentions(text: string, products: { id: string; name?: string; model?: string }[]): string[] {
  const t = ' ' + norm(htmlText(text)) + ' '
  const has = (needle: string) => {
    const n = norm(needle)
    if (!n) return false
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return /[\u4e00-\u9fff]/.test(n) ? t.includes(n) : new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(t)
  }
  return products.filter((p) => (String(p.model ?? '').trim().length >= 3 && has(String(p.model))) || (String(p.name ?? '').trim().length >= 4 && has(String(p.name)))).map((p) => p.id)
}

/** 最近写的长文（新的在前）：查段落重复、算产品最近被用了几次 */
export function recentArticles(ctx: any, limit = 100, except?: string): any[] {
  return (ctx.db.query('articles', { order_by: 'created_at desc', limit }).list as any[]).filter((a) => a.id !== except && typeOf(a) === 'article')
}

/** 网站上已有的文章（标题、slug、地址）：查主题重复用。读不到（没配发布、MCP 没连）就是空的 */
export async function sitePosts(ch: any, ctx: any): Promise<Existing[]> {
  try {
    if (ch?.type === 'wordpress') {
      const list = await wp(ctx, ch, '/wp/v2/posts?per_page=100&_fields=slug,title,link', { auth: false })
      return (list ?? []).map((p: any) => ({ title: htmlText(String(p.title?.rendered ?? p.slug ?? '')), slug: p.slug, url: p.link, source: 'site' as const }))
    }
    if (!ch?.project_id || !ch.article_collection) return []
    const list = await contents(ctx, ch.project_id, ch.article_collection, 200)
    return list.map((c: any) => ({ title: String(c.body?.title ?? c.body?.name ?? c.slug ?? ''), slug: c.slug, keywords: c.body?.keywords, source: 'site' as const }))
  } catch {
    return []
  }
}

/** 比对的范围：网站上的文章 + 后台的长文 + 还没写的选题（不含 except 里的选题、文章自己）。同一个标题只留一份，网站上的优先 */
export async function existingFor(ctx: any, ch: any, except: { topic_id?: string; article_id?: string } = {}): Promise<Existing[]> {
  const out = new Map<string, Existing>()
  const add = (e: Existing) => {
    const k = String(e.title ?? '').trim().toLowerCase()
    if (k && !out.has(k)) out.set(k, e)
  }
  for (const e of await sitePosts(ch, ctx)) add(e)
  for (const a of recentArticles(ctx, 500, except.article_id)) add({ id: a.id, title: a.title, keywords: a.keywords, slug: a.slug, status: a.status, source: 'article' })
  for (const t of ctx.db.query('topics', { limit: 1000 }).list as any[])
    if (t.id !== except.topic_id && t.status === 'idea' && t.workspace !== 'social') add({ id: t.id, title: t.title, keywords: t.keywords, status: t.status, source: 'topic' })
  return [...out.values()]
}

/** 长文的渠道：给了用给的，没有就用能发文章的那个、再没有用第一个网站 */
export function siteFor(ctx: any, channelID?: string): any {
  const channels: any[] = (ctx.db.query('channels', { limit: 200 }).list as any[]).filter((c: any) => SITE_TYPES.includes(c.type))
  return channels.find((c: any) => c.id === channelID) ?? channels.find((c: any) => c.publish_status === 'ready') ?? channels[0] ?? null
}

