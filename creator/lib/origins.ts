// 选题的出处（设计见仓库根目录 docs/content-origins.md）：一个选题是从哪些东西来的，本机函数写、页面读，两边都 import 这里。
//
// topics.origins 是 JSON 数组 [{ type, id, label }]：type 是出处的种类，id 是那张表里的记录，label 是生成时的快照（问题原文、关键词、页面标题），
// 原记录删了也看得懂。topics.chat_id 是出这个选题的对话。topics.source 照旧是粗分类（页面上的小标签）。
// 文章往回追：articles.topic_id → 选题 → origins；改写的 articles.source_id → 原文 → 选题。

export type OriginType =
  | 'geo_question' // AI 搜索的问题（geo_questions）
  | 'search_query' // 谷歌搜索词（gsc.sync，没有记录 id，id 就是搜索词）
  | 'keyword' // 关键词（keywords）
  | 'competitor_page' // 竞品新上的页面（competitor_pages）
  | 'competitor' // 竞品（competitors：竞对总览、规格对比里出的）
  | 'inspiration_source' // 灵感来源（research_sources，详细快照在 content_references kind=source）
  | 'opportunity' // 增长机会（product 的 growth_opportunities）
  | 'campaign' // 主题计划（product 的 campaigns）
  | 'marketing_plan' // 营销计划（product 的 marketing_plans）

export type Origin = { type: OriginType | string; id: string; label?: string; channel_id?: string }

const MAX = 20

function parse(value: unknown): Origin[] {
  try {
    const v = typeof value === 'string' ? JSON.parse(value || '[]') : value
    return Array.isArray(v) ? v.filter((o) => o && typeof o.type === 'string' && o.id) : []
  } catch {
    return []
  }
}

const keyOf = (o: Origin) => `${o.type}:${o.id}`

/** 合并、去重，存进 topics.origins 的字符串；一个出处都没有返回 '' */
export function originsJson(...lists: (Origin[] | undefined)[]): string {
  const seen = new Set<string>()
  const out: Origin[] = []
  for (const o of lists.flat()) {
    if (!o?.type || !o.id || seen.has(keyOf(o))) continue
    seen.add(keyOf(o))
    out.push({ type: o.type, id: String(o.id), ...(o.label ? { label: String(o.label).slice(0, 300) } : {}), ...(o.channel_id ? { channel_id: o.channel_id } : {}) })
  }
  return out.length ? JSON.stringify(out.slice(0, MAX)) : ''
}

/** 一个选题的全部出处：origins 里记的，加上老数据里各模块自己存的那几个字段（campaign_id、opportunity_id、marketing_plan_id、search_query） */
export function originsOf(t: Record<string, any> | null | undefined): Origin[] {
  if (!t) return []
  const legacy: Origin[] = []
  if (t.campaign_id) legacy.push({ type: 'campaign', id: t.campaign_id })
  if (t.opportunity_id) legacy.push({ type: 'opportunity', id: t.opportunity_id })
  if (t.marketing_plan_id) legacy.push({ type: 'marketing_plan', id: t.marketing_plan_id })
  if (t.search_query && t.source === 'search') legacy.push({ type: 'search_query', id: t.search_query, label: t.search_query })
  return JSON.parse(originsJson(parse(t.origins), legacy) || '[]')
}

/** 出自某条记录的选题（比如某个 AI 搜索问题写成了哪些选题） */
export function topicsFrom<T extends Record<string, any>>(topics: T[], type: string, id: string): T[] {
  return topics.filter((t) => originsOf(t).some((o) => o.type === type && o.id === id))
}

/** 内容列表「来源」筛选的几类：选题出处归一下，加上改写、没有选题直接写的 */
export type ContentOrigin = 'geo' | 'keyword' | 'search' | 'competitor' | 'inspiration' | 'plan' | 'topic' | 'rewrite' | 'direct'
export const CONTENT_ORIGINS: ContentOrigin[] = ['geo', 'keyword', 'search', 'competitor', 'inspiration', 'plan', 'topic', 'rewrite', 'direct']

const ORIGIN_KIND: Record<string, ContentOrigin> = {
  geo_question: 'geo', keyword: 'keyword', search_query: 'search', competitor_page: 'competitor', competitor: 'competitor',
  inspiration_source: 'inspiration', opportunity: 'plan', campaign: 'plan', marketing_plan: 'plan',
}
// 没记 origins 的老选题按 topics.source 归
const SOURCE_KIND: Record<string, ContentOrigin> = { geo: 'geo', keyword: 'keyword', search: 'search', gsc: 'search', competitor: 'competitor', research: 'inspiration', research_sources: 'inspiration', inspiration: 'inspiration', seo: 'keyword', marketing: 'plan', campaign: 'plan' }

/**
 * 一条内容（选题、文章，产品运营还有营销计划）属于哪几类来源，读的时候往回追，不存字段：
 * 改写、复制的顺着 source_id 找到原文，算「改写」也算原文的来源；有选题看它的出处，出处都没记就是「选题」（AI 出的、手动加的）；
 * 没有选题、没有计划的是「直接写」（对话里直接写的、导入的）。一个选题有几个出处就属于几类。
 */
export function contentOrigins(entry: { article?: any; topic?: any; plan?: any }, articles: any[], topics: any[]): ContentOrigin[] {
  const kinds = new Set<ContentOrigin>()
  let root = entry.article
  for (let i = 0; root?.source_id && i < 10; i++) {
    kinds.add('rewrite')
    const up = articles.find((a) => a.id === root.source_id)
    if (!up) break
    root = up
  }
  const topic = (root && root !== entry.article ? topics.find((t) => t.id === root.topic_id) : undefined) || entry.topic || (root?.topic_id ? topics.find((t) => t.id === root.topic_id) : undefined)
  if (entry.plan || root?.marketing_plan_id) kinds.add('plan')
  if (topic) {
    const before = kinds.size
    for (const o of originsOf(topic)) if (ORIGIN_KIND[o.type]) kinds.add(ORIGIN_KIND[o.type])
    if (SOURCE_KIND[topic.source]) kinds.add(SOURCE_KIND[topic.source])
    if (kinds.size === before && !kinds.has('plan')) kinds.add('topic')
  } else if (!kinds.has('plan')) kinds.add('direct')
  return CONTENT_ORIGINS.filter((k) => kinds.has(k))
}
