// Publish collected observations to the customer's delivery console through the
// existing Creght MCP connection. Google credentials never enter this payload.
import { mcpName, hostOf } from './_creght'

type Row = Record<string, any>
const TABLE = 'delivery_sync'
const metric = (r: Row) => ({ clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0, ctr: Number(r.ctr) || 0, position: Number(r.position) || 0 })
const iso = () => new Date().toISOString()
const message = (e: any) => String(e?.message || e || 'Sync failed').slice(0, 500)
function rows(ctx: any, table: string, channel: string) {
  return ctx.db.query(table, { where: { channel_id: channel }, limit: 1000 }).list as Row[]
}
function reportID() { return 'annulo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) }

/** Only a configured Creght site is a delivery target; arbitrary URLs cannot receive reports. */
export function queueReport(ctx: any, ch: Row, report: Row) {
  if (ch.type !== 'creght_site' || !ch.project_id || !ch.site_id) return null
  const key = `${ch.id}:${report.kind}:${report.engine || ''}`
  const old = ctx.db.query(TABLE, { where: { key }, limit: 1 }).list[0]
  const body = { key, channel_id: ch.id, target_project: ch.project_id, target_site: ch.site_id, target_host: ch.api_host || hostOf(ctx, ch.project_id), report_id: reportID(), payload: JSON.stringify(report), status: 'pending', collected_at: report.collected_at, error: '', attempts: 0 }
  if (old) { ctx.db.update(TABLE, old.id, body); return old.id }
  return ctx.db.insert(TABLE, body).id
}
function sameOrigin(raw: unknown, origin: string) {
  try { const u = new URL(String(raw)); return u.origin === origin && !u.username && !u.password && !u.hash && !u.search } catch { return false }
}
function prepare(row: Row, origin: string): Row {
  const input = JSON.parse(row.payload)
  if (input.site_url && input.site_url !== origin) throw new Error('Website domain changed; collect a new report before syncing')
  // Exact allowlist: no account email, OAuth token, API key, provider config,
  // private prompts or operator notes are exported by this collector.
  const report: Row = { report_id: row.report_id, kind: input.kind, collected_at: input.collected_at, site_url: origin }
  if (input.kind === 'google-search') {
    if (!input.site_url) throw new Error('Report has no verified website origin; collect again after reconnecting Creght')
    const pages = (input.pages || []).filter((p: Row) => sameOrigin(p.url, origin))
    Object.assign(report, { property: input.property, period_start: input.period_start, period_end: input.period_end,
      summary: input.summary, daily: input.daily, pages: pages.slice(0, 1000), queries: input.queries,
      truncated: !!input.truncated || pages.length !== (input.pages || []).length })
  } else if (input.kind === 'google-index') {
    const all = input.inspections || []
    const inspections = all.filter((p: Row) => sameOrigin(p.url, origin))
    Object.assign(report, { property: input.property, inspections: inspections.slice(0, 1000), failed: input.failed || 0,
      truncated: !!input.truncated || inspections.length !== all.length })
  } else if (input.kind === 'ai-visibility') {
    const samples = (input.samples || []).map((s: Row) => {
      const links = (s.cited_urls || []).filter((u: string) => sameOrigin(u, origin)).slice(0, 30)
      return { question: s.question, kind: s.kind, answer_excerpt: s.answer_excerpt, cited: links.length > 0,
        mentioned: !!s.mentioned || !!s.cited, cited_urls: links, ...(s.evidence_url ? { evidence_url: s.evidence_url } : {}) }
    })
    Object.assign(report, { engine: input.engine, model: input.model, language: input.language || 'und', samples,
      failed: input.failed || 0, truncated: !!input.truncated })
  } else throw new Error('Unsupported report kind')
  return report
}

/** The platform chooses the same primary origin used by the mounted console. */
export async function deliveryOrigin(ctx: any, ch: Row): Promise<string> {
  if (ch.type !== 'creght_site' || !ch.project_id || !ch.site_id) return ''
  const server = mcpName(ctx, ch.api_host || hostOf(ctx, ch.project_id))
  const site = await ctx.mcp(server, 'site_status', { project_id: ch.project_id, site_id: ch.site_id })
  if (!site?.published || !site.live_url) throw new Error('Publish the website before syncing reports')
  return new URL(site.report_url || site.live_url).origin
}

/** Retry the latest snapshot for each stream. Failure never discards local data. */
export async function flushReports(ctx: any, ch: Row) {
  if (ch.type !== 'creght_site' || !ch.project_id || !ch.site_id) return { skipped: true }
  const queue = rows(ctx, TABLE, ch.id).filter(r => r.status !== 'synced' && !(ch.gsc_link_disabled && String(r.key).includes(':google-'))).slice(0, 20)
  if (!queue.length) return { synced: 0, failed: 0 }
  const server = mcpName(ctx, ch.api_host || hostOf(ctx, ch.project_id))
  let origin: string
  try {
    origin = await deliveryOrigin(ctx, ch)
  } catch (e) {
    for (const row of queue) ctx.db.update(TABLE, row.id, { status: 'failed', error: message(e), attempted_at: iso(), attempts: (row.attempts || 0) + 1 })
    return { synced: 0, failed: queue.length }
  }
  let synced = 0, failed = 0
  for (const row of queue) {
    try {
      if (row.target_project !== ch.project_id || row.target_site !== ch.site_id || row.target_host !== (ch.api_host || hostOf(ctx, ch.project_id)))
        throw new Error('Report target changed; collect a new report before syncing')
      const report = prepare(row, origin)
      const ack = await ctx.mcp(server, 'site_report_sync', { project_id: ch.project_id, site_id: ch.site_id, report })
      if (!ack?.id || !ack.received_at) throw new Error('Report acknowledgement missing')
      // Another collection may have replaced this outbox row while awaiting I/O.
      if (ctx.db.get(TABLE, row.id)?.report_id === row.report_id)
        ctx.db.update(TABLE, row.id, { status: 'synced', error: '', synced_at: ack.received_at, remote_id: ack.id, attempted_at: iso(), attempts: (row.attempts || 0) + 1 })
      synced++
    } catch (e) {
      if (ctx.db.get(TABLE, row.id)?.report_id === row.report_id)
        ctx.db.update(TABLE, row.id, { status: 'failed', error: message(e), attempted_at: iso(), attempts: (row.attempts || 0) + 1 })
      ctx.log?.('Delivery report sync pending: ' + message(e))
      failed++
    }
  }
  return { synced, failed }
}
export async function publishSearch(ctx: any, ch: Row, data: Row) {
  const id = queueReport(ctx, ch, { kind: 'google-search', collected_at: iso(), ...data })
  return id ? flushReports(ctx, ch) : { skipped: true }
}
export async function publishIndex(ctx: any, ch: Row, failed = 0) {
  if (!ch.gsc_property || ch.gsc_link_disabled) return { skipped: true }
  const items = rows(ctx, 'index_status', ch.id).filter(p => p.inspected_at)
  const inspections = items.map(p => ({ url: p.page, state: p.state, coverage: p.coverage || '', verdict: p.verdict || '',
    google_canonical: p.google_canonical || '', user_canonical: p.user_canonical || '', last_crawl: p.last_crawl || '', inspected_at: p.inspected_at }))
  const id = queueReport(ctx, ch, { kind: 'google-index', collected_at: iso(), property: ch.gsc_property, inspections, failed, truncated: items.length >= 1000 })
  return id ? flushReports(ctx, ch) : { skipped: true }
}
export async function publishAI(ctx: any, ch: Row, runID: string) {
  const run = ctx.db.get('geo_runs', runID)
  if (!run?.finished_at) return { skipped: true }
  const all = ctx.db.query('geo_results', { where: { channel_id: ch.id, run_id: runID }, limit: 1000 }).list as Row[]
  // Retried answers for a question supersede older answers within the run.
  const latest = new Map<string, Row>()
  for (const r of [...all].sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)))) latest.set(r.question_id || r.question, r)
  const parse = (raw: string, fallback: any) => { try { return JSON.parse(raw || '') } catch { return fallback } }
  const summary = parse(run.summary, {})
  const items = [...latest.values()]
  const samples = items.slice(0, 100).map(p => ({ question: String(p.question || '').slice(0, 2000), kind: p.kind === 'facts' ? 'facts' : 'recommend',
    answer_excerpt: String(p.answer_excerpt || '').slice(0, 800), cited: !!p.cited, mentioned: !!p.mentioned,
    cited_urls: parse(p.cited_urls, []), ...(p.evidence_url ? { evidence_url: p.evidence_url } : {}) }))
  const id = queueReport(ctx, ch, { kind: 'ai-visibility', collected_at: run.finished_at, engine: run.engine, model: run.model || '', language: 'und',
    samples, failed: summary.failed?.length || 0, truncated: items.length > 100 || all.length >= 1000 })
  return id ? flushReports(ctx, ch) : { skipped: true }
}
export { metric }
