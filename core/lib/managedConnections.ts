import { markShuttle, shuttleMissing, ShuttleUnavailable } from './remote'
import { tr } from './i18n'

export type ManagedConnection = {
  id: string; grant_id: string; login_method: string; status: string;
  needs_reconnect?: boolean; scopes?: string[] | null;
  assets: { id: string; name: string; kind: string; status: string }[];
}
async function request<T>(path: string, method = 'GET'): Promise<T> {
  if (shuttleMissing()) throw new ShuttleUnavailable(tr('meta.err.not_from_shuttle'))
  let response: Response
  try { response = await fetch('/_shuttle/api/' + path, { method, headers: { 'X-Shuttle': '1' } }) }
  catch { throw new ShuttleUnavailable(tr('meta.err.no_shuttle')) }
  if (!response.headers.get('x-shuttle')) { markShuttle(false); throw new ShuttleUnavailable(tr('meta.err.not_from_shuttle')) }
  markShuttle(true)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || tr('meta.err.req_failed', { status: response.status }))
  return body as T
}
export const managedConnections = (provider: string) => request<{list: ManagedConnection[]}>(`settings/connections/${encodeURIComponent(provider)}/assets`).then(r => r.list)
/** 只断开当前项目中指定的账号／托管连接，绝不省略 account。 */
export const disconnectOAuthConnection = (provider: string, id: string) => {
  if (!id) throw new Error(tr('account_authorization.select_account'))
  return request(`settings/connections/${encodeURIComponent(provider)}?account=${encodeURIComponent(id)}`, 'DELETE')
}
// 兼容已有项目自定义页面的旧引用。
export const disconnectManagedConnection = disconnectOAuthConnection
export const authorizeConnections = () => request<{verify_url: string}>('login?connections=1', 'POST')
