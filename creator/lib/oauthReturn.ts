import { startOAuthConnection } from './shuttle'

export type OAuthProvider = 'instagram' | 'threads' | 'facebook'
type Intent = { nonce: string; provider: OAuthProvider; at: number; channelId?: string; mediaHost?: string; handled?: boolean }
export type OAuthReturn = Intent & { account: string; status: string }
const key = 'annulo.project-account-oauth:'
const intentKey = (nonce: string) => key + nonce
const params = ['oauth_intent', 'connection_provider', 'connection_account', 'connection_status']
const providers = ['instagram', 'threads', 'facebook']
let activeNonce = ''

/** 只保存添加意图，不保存授权码、binding 或 token；存储随项目源隔离。 */
export async function startProjectOAuth(provider: OAuthProvider, context: { channelId?: string; mediaHost?: string } = {}) {
  const intent: Intent = { ...context, provider, nonce: crypto.randomUUID(), at: Date.now() }
  const to = new URL(location.href)
  to.search = ''
  to.hash = ''
  to.searchParams.set('view', 'channels')
  to.searchParams.set('oauth_intent', intent.nonce)
  localStorage.setItem(intentKey(intent.nonce), JSON.stringify(intent))
  activeNonce = intent.nonce
  try { return await startOAuthConnection(provider, to.pathname + to.search) }
  catch (error) { localStorage.removeItem(intentKey(intent.nonce)); if (activeNonce === intent.nonce) activeNonce = ''; throw error }
}

export function readOAuthReturn(provider?: OAuthProvider): OAuthReturn | undefined {
  try {
    const q = new URL(location.href).searchParams
    const intent = JSON.parse(localStorage.getItem(intentKey(q.get('oauth_intent') || '')) || 'null') as Intent | null
    if (!intent || !providers.includes(intent.provider) || intent.nonce !== q.get('oauth_intent') || q.get('connection_provider') !== intent.provider || (provider && provider !== intent.provider) || Date.now() - intent.at > 15 * 60_000 || intent.at > Date.now()) return
    const status = q.get('connection_status') || ''
    if (!['connected', 'failed'].includes(status)) return
    return { ...intent, account: q.get('connection_account') || '', status }
  } catch { return }
}

/** 刷新或两个窗口同时返回时只自动执行一次。失败后保留界面，由用户明确重试。 */
export async function continueOAuthReturn(provider: OAuthProvider, run: (result: OAuthReturn) => Promise<void>) {
  if (!navigator.locks) return // 不支持锁的浏览器仍可在恢复的界面手动添加
  const nonce = readOAuthReturn(provider)?.nonce
  if (!nonce) return
  await navigator.locks.request(intentKey(nonce), async () => {
    const result = readOAuthReturn(provider)
    if (!result || result.handled || result.status !== 'connected' || !result.account) return
    localStorage.setItem(intentKey(result.nonce), JSON.stringify({ nonce: result.nonce, provider: result.provider, at: result.at, channelId: result.channelId, mediaHost: result.mediaHost, handled: true }))
    await run(result)
  })
}

export function finishOAuthReturn() {
  const to = new URL(location.href)
  const nonce = to.searchParams.get('oauth_intent') || activeNonce
  if (!nonce) return
  localStorage.removeItem(intentKey(nonce))
  if (activeNonce === nonce) activeNonce = ''
  for (const name of params) to.searchParams.delete(name)
  history.replaceState(history.state, '', to.pathname + to.search + to.hash)
}
