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
