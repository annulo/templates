import { L } from './_i18n'

export function json<T>(value: unknown, fallback: T): T {
  try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback) as T } catch { return fallback }
}
export const now = () => new Date().toISOString()
export function requireRow(ctx: any, table: string, id: string) {
  const row = ctx.db.get(table, id)
  if (!row) throw new Error(L(ctx, '记录不存在，请刷新后重试', 'Record not found. Refresh and try again.'))
  return row
}
export function findingSnapshot(ctx: any, id: string) {
  const f = requireRow(ctx, 'research_findings', id)
  const s = ctx.db.get('research_sources', f.source_id)
  const source = json(f.source_snapshot, null) || (s ? { id: s.id, title: s.title, kind: s.kind, url: s.url, file_name: s.file_name, collected_at: s.collected_at, version: f.source_version || s.version } : { id: f.source_id, title: L(ctx, '原始资料已移除', 'Source removed'), version: f.source_version })
  return { finding_id: f.id, title: f.title, kind: f.kind, fact: f.fact, quote: f.quote, interpretation: f.interpretation, suggestion: f.suggestion, source }
}
export function refsFor(ctx: any, type: string, id: string) {
  return ctx.db.query('content_references', { where: { target_type: type, target_id: id, kind: 'finding' }, limit: 1000 }).list
}
export function evidenceFor(ctx: any, topic: any, articleId?: string) {
  const brief: any = json(topic?.brief, {})
  const refs = [...(topic ? refsFor(ctx, 'topic', topic.id) : []), ...(articleId ? refsFor(ctx, 'article', articleId) : [])]
  const seen = new Set<string>()
  const findings = refs.filter((r: any) => { if (seen.has(r.finding_id)) return false; seen.add(r.finding_id); return true }).map((r: any) => json(r.snapshot, {}))
  const ids: string[] = brief.product_ids || []
  // 灵感来源（产品运营的灵感库选进来的）：选入时的快照
  const sourceRefs = [
    ...(topic ? ctx.db.query('content_references', { where: { target_type: 'topic', target_id: topic.id, kind: 'source' }, limit: 1000 }).list : []),
    ...(articleId ? ctx.db.query('content_references', { where: { target_type: 'article', target_id: articleId, kind: 'source' }, limit: 1000 }).list : []),
  ]
  const sourceIds = new Set<string>()
  const sources = sourceRefs.filter((r: any) => { if (sourceIds.has(r.source_id)) return false; sourceIds.add(r.source_id); return true }).map((r: any) => json(r.snapshot, {} as any))
  // 产品的事实字段按行业不同（外贸：型号、规格、起订量、交期、认证；产品运营：功能、能力边界、案例、来源），表里没有的字段是空的、不进快照
  const products = ids.map((id) => ctx.db.get('products', id)).filter((p: any) => p && p.status !== 'hidden').map((p: any) => ({
    id: p.id, name: p.name, model: p.model, summary: p.summary, audience: p.audience, features: p.features, limitations: p.limitations,
    specs: p.specs, moq: p.moq, price: p.price, lead_time: p.lead_time, certs: p.certs, proof: p.proof, source_url: p.source_url, verified_at: p.verified_at, url: p.url,
  }))
  return { captured_at: now(), brief, findings, sources, products }
}
