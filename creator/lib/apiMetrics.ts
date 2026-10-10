import { numLocale, tr } from './i18n'

export type ApiMetricState = { checked_at: string; available: string[]; warnings: { key: string; name: string; message: string }[] }
export function apiMetricState(row: { facebook_api_metrics?: string }): ApiMetricState | null {
  try {
    const state = JSON.parse(row.facebook_api_metrics || 'null')
    return state && Array.isArray(state.available) && Array.isArray(state.warnings) ? state : null
  } catch { return null }
}
export function metricUnavailable(row: { facebook_api_metrics?: string }, key: string): boolean {
  const state = apiMetricState(row)
  return !!state && !state.available.includes(key)
}
export function metricText(row: { facebook_api_metrics?: string; metrics_at?: string; views?: number; likes?: number; comments?: number; collects?: number; shares?: number }, key: 'views' | 'likes' | 'comments' | 'collects' | 'shares'): string {
  if (metricUnavailable(row, key)) return tr('facebook_connect.metric_unavailable')
  return row.metrics_at ? (row[key] ?? 0).toLocaleString(numLocale()) : '—'
}
