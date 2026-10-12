import { L } from './_i18n'
import { parse, type Competitor, type Onboarding } from './_onboarding'

/** 报告作为分析判断归档到调研结果；保留当时的竞品名单，不当作原始资料事实。 */
export function archiveCompetitorReport(row: Onboarding, ctx: any) {
  const report = row.research_report?.trim()
  if (!row.id || !report) return
  const sourceId = `onboarding:${row.id}:${row.revision}`
  const existing = ctx.db.query('research_findings', { where: { source_id: sourceId, kind: 'competitor_report' }, limit: 1000 }).list.find((f: any) => f.interpretation === report)
  if (existing) return existing
  const title = L(ctx, '竞品调研报告', 'Competitor research report')
  const time = new Date().toISOString()
  return ctx.db.insert('research_findings', {
    source_id: sourceId, source_version: row.revision, title, kind: 'competitor_report', interpretation: report,
    source_snapshot: JSON.stringify({ id: sourceId, title, kind: 'competitor_report', version: row.revision, collected_at: time, website_url: row.website_url, channel_id: row.channel_id, competitors: parse<Competitor[]>(row.competitors, []) }),
    created_at: time,
  })
}
