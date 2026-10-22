// 选题出处的取数和校验（本机函数共用，设计见仓库根目录 docs/content-origins.md）。下划线开头：不是给 annulo run 调的函数。

import { L } from './_i18n'
import { originsJson, originsOf, type Origin } from '../lib/origins'

/** 出处种类 → 记录所在的表；search_query 没有表（id 就是搜索词） */
const TABLE: Record<string, string> = {
  geo_question: 'geo_questions',
  keyword: 'keywords',
  competitor_page: 'competitor_pages',
  competitor: 'competitors',
  inspiration_source: 'research_sources',
  opportunity: 'growth_opportunities',
  campaign: 'campaigns',
  marketing_plan: 'marketing_plans',
}

const labelOf = (row: any) => String(row.question ?? row.keyword ?? row.title ?? row.name ?? row.url ?? '').trim()

function get(ctx: any, table: string, id: string) {
  try {
    return ctx.db.get(table, id)
  } catch {
    return null // 这个模板没有这张表
  }
}

/** 查实助手给的出处（每条的记录都要在），补上 label 快照；不认识的种类、找不到的记录直接报错，别让断了的链接进表 */
export function checkOrigins(ctx: any, list: unknown): Origin[] {
  const out: Origin[] = []
  for (const o of Array.isArray(list) ? list : []) {
    const type = String(o?.type ?? '')
    const id = String(o?.id ?? '').trim()
    if (!id) continue
    if (type === 'search_query') {
      out.push({ type, id, label: id })
      continue
    }
    if (!TABLE[type]) throw new Error(L(ctx, '不认识的出处种类：', 'Unknown origin type: ') + type)
    const row = get(ctx, TABLE[type], id)
    if (!row) throw new Error(L(ctx, `出处记录不存在（${type}）：`, `Origin record not found (${type}): `) + id)
    out.push({ type, id, label: String(o?.label ?? '').trim() || labelOf(row), ...(row.channel_id ? { channel_id: row.channel_id } : {}) })
  }
  return out
}

/** AI 搜索问题的 id → 出处 */
export const questionOrigins = (ctx: any, ids: unknown) => checkOrigins(ctx, (Array.isArray(ids) ? ids : []).map((id) => ({ type: 'geo_question', id })))

/** 选题已经有了（标题重复）：把这次的出处并进去，不另建，这样出处那边也能找到它。返回有没有新加 */
export function mergeOrigins(ctx: any, topic: any, add: Origin[]) {
  if (!add.length) return false
  const before = originsOf(topic)
  const next = originsJson(before, add)
  if (JSON.parse(next || '[]').length === before.length) return false
  ctx.db.update('topics', topic.id, { origins: next })
  return true
}

/**
 * 没被引用的问题（question_ids 指定就只取这几个）：从 AI 搜索出选题时给助手。
 * 口径和 AI 搜索页的「写成选题」一样：启用的推荐类问题，问过，每个 AI 最新一次的回答都没引用本站
 */
export function uncitedQuestions(ctx: any, channelId: string, ids?: string[]) {
  let qs: any[] = ctx.db.query('geo_questions', { where: { channel_id: channelId }, limit: 200 }).list
  if (ids?.length) qs = qs.filter((q) => ids.includes(q.id))
  else {
    const results: any[] = ctx.db.query('geo_results', { where: { channel_id: channelId }, limit: 5000 }).list
    const latest = new Map<string, any>() // 问题|AI → 最新一次
    for (const r of results) {
      const k = `${r.question_id}|${r.engine || ''}`
      if (!latest.has(k) || String(r.created_at) > String(latest.get(k).created_at)) latest.set(k, r)
    }
    const asked = new Set<string>()
    const cited = new Set<string>()
    for (const r of latest.values()) (asked.add(r.question_id), r.cited && cited.add(r.question_id))
    qs = qs.filter((q) => q.status !== 'paused' && q.intent !== 'brand' && asked.has(q.id) && !cited.has(q.id))
  }
  let topics: any[] = []
  try {
    topics = ctx.db.query('topics', { limit: 2000 }).list
  } catch {}
  // 已经写成选题的标出来（topic_titles），助手别再出一个重复的
  return qs.map((q) => {
    const done = topics.filter((t) => t.status !== 'dropped' && originsOf(t).some((o) => o.type === 'geo_question' && o.id === q.id))
    return { id: q.id, question: q.question, intent: q.intent, keywords: q.keywords, ...(done.length ? { topic_titles: done.map((t) => t.title) } : {}) }
  })
}
