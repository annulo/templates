// 外贸起步的数据与执行结果；不记录“向导做到第几步”。
export type StageStatus = 'idle' | 'running' | 'done' | 'failed' | 'needs_review'
export type Competitor = { url: string; name: string; reason?: string }
export type CompanyDraft = Partial<Record<'name' | 'positioning' | 'business' | 'advantages' | 'company_role' | 'cooperation' | 'customer_types' | 'markets' | 'buyer_concerns' | 'keywords', string>>
export type Onboarding = {
  id?: string; key: string; revision: number; channel_id: string; website_url: string; details_saved_at?: string
  competitors: string; competitors_confirmed: boolean; candidates: string
  company_status: StageStatus; company_note: string; company_draft: string; company_refresh: boolean
  // 旧项目的历史策略字段，仅作升级兼容，不再生成或展示。
  strategy_status: StageStatus; strategy_report: string; strategy_note: string
  audit_status: StageStatus; audit_result: string; audit_note: string
  research_status: StageStatus; research_report: string; research_note: string
}
export const parse = <T>(value: string | undefined, fallback: T): T => { try { return JSON.parse(value || '') } catch { return fallback } }
export function onboarding(ctx: any): Onboarding {
  const row = ctx.db.query('onboarding', { where: { key: 'trade' }, limit: 1 }).list[0]
  return { key: 'trade', revision: 0, channel_id: '', website_url: '', competitors: '[]', competitors_confirmed: false, candidates: '[]', company_status: 'idle', company_note: '', company_draft: '', company_refresh: false, strategy_status: 'idle', strategy_report: '', strategy_note: '', audit_status: 'idle', audit_result: '', audit_note: '', research_status: 'idle', research_report: '', research_note: '', ...row }
}
/** 输入网址时可省略 https://；搜索站点名称时不当作网址。 */
export function websiteURL(value: string): string {
  const raw = value.trim()
  const explicit = /^[a-z][a-z\d+.-]*:/i.test(raw)
  if (!explicit && !/^[^\s/]+\.[^\s/]+(?:\/|$)/.test(raw)) return ''
  try {
    const u = new URL(explicit ? raw : `https://${raw}`)
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || u.username || u.password) return ''
    u.hash = ''
    return u.href
  } catch { return '' }
}
export function write(ctx: any, patch: Partial<Onboarding>) {
  const row = onboarding(ctx)
  const next = { ...patch, updated_at: new Date().toISOString() }
  return row.id ? ctx.db.update('onboarding', row.id, next) : ctx.db.insert('onboarding', { ...row, ...next, created_at: new Date().toISOString() })
}
