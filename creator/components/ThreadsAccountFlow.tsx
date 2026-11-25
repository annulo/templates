import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { inShuttle, listChannels, listOAuthConnections, runLocal, setSecret, startOAuthConnection, type Channel as BaseChannel, type OAuthConnection } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { Badge, Button, Dialog, Notice } from './ui'
import Select from './Select'
import RunButton from './RunButton'
import OAuthAccountControls from './OAuthAccountControls'

type Channel = BaseChannel & { threads_media_host?: string; threads_auth_error?: string; api_host?: string }

const PENDING = 'THREADS_USER_TOKEN_PENDING'

/**
 * Threads 只走官方 API，两种连法：
 * - 官方授权（Annulo 有 Threads 连接时，默认）：Annulo 的连接层打开 Threads 授权页，口令存本机、到期前自动续期，插件用 ctx.oauth('threads')；
 * - 粘贴口令（用户自己的 Meta 应用）：本机函数只能读密钥，所以页面先把口令写进临时密钥，让插件问出它是哪个账号，
 *   再写进 THREADS_USER_TOKEN_<id>；口令不进表、不进函数参数。
 */
export default function ThreadsAccountFlow({ channel, onAdded }: { channel?: Channel; onAdded: () => void }) {
  const [token, setToken] = useState('')
  const [host, setHost] = useState(channel?.threads_media_host || '')
  const [sites, setSites] = useState<Channel[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const oauth = useThreadsOAuth()
  const [account, setAccount] = useState(channel?.oauth_account || '')
  useEffect(() => {
    setAccount(old => oauth.connection?.accounts.some(a => a.account === old) ? old : oauth.connection?.accounts[0]?.account || '')
  }, [oauth.connection])
  // 还没选素材库、项目里正好一个网站：默认选它（本机图片、视频都要传上去 Threads 才抓得到）
  const hostOf = (c: Channel) => JSON.stringify({ api_host: c.api_host || 'https://creght.cn', project_id: c.project_id, site_id: c.site_id })
  useEffect(() => { let live = true; listChannels().then(r => { if (!live) return; const list = r.list.filter(c => c.type === 'creght_site' && c.project_id && c.site_id); setSites(list); if (list.length === 1) setHost(h => h || hostOf(list[0])) }).catch(() => {}); return () => { live = false } }, [])
  const connect = async () => {
    const t = token.trim().replace(/^["']|["']$/g, '')
    if (!t && !channel) { setError(tr('threads_connect.token_missing')); return }
    setBusy(true); setError('')
    try {
      let who = { account_id: channel?.platform_uid || '', username: channel?.handle || '' }
      if (t) {
        await setSecret(PENDING, t)
        try { who = await runLocal('social/threads.identifyToken', { secret: PENDING }) as typeof who }
        finally { await setSecret(PENDING, 'cleared').catch(() => {}) }
        if (channel?.platform_uid && who.account_id !== channel.platform_uid) throw new Error(tr('threads_connect.wrong_account', { username: who.username }))
        await setSecret(`THREADS_USER_TOKEN_${who.account_id}`, t)
      }
      await runLocal('social/social.login', { type: 'threads', channel_id: channel?.id, mode: 'api', account_id: who.account_id, username: who.username, media_host: host })
      setToken('')
      onAdded()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const connectOAuth = async () => {
    setBusy(true); setError('')
    try {
      await runLocal('social/social.login', { type: 'threads', channel_id: channel?.id, mode: 'oauth', account, media_host: host })
      onAdded()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const field = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
  const hostPicker = <details className="text-sm" open={!!host}>
    <summary className="cursor-pointer select-none text-muted-foreground">{tr('threads_connect.host')}</summary>
    <div className="mt-2 space-y-1"><Select value={host} onChange={setHost} options={[{ value: '', label: tr('threads_connect.public_only') }, ...sites.map(c => ({ value: hostOf(c), label: c.name }))]} />
    <p className="text-xs text-muted-foreground">{tr('threads_connect.host_hint')}</p></div>
  </details>
  const paste = <>
    <p className="text-muted-foreground">{tr(channel ? 'threads_connect.renew_intro' : 'threads_connect.intro')}</p>
    <div className="flex gap-2">
      <input className={field} type="password" value={token} disabled={busy} onChange={e => setToken(e.target.value)} autoComplete="new-password" placeholder={tr(channel ? 'threads_connect.token_placeholder' : 'threads_connect.token_paste_placeholder')} />
      <Button needsShuttle disabled={busy || (!token.trim() && !channel)} onClick={connect}>{tr('threads_connect.connect')}</Button>
    </div>
    <details className="text-sm" open={!channel}>
      <summary className="cursor-pointer select-none text-muted-foreground">{tr('threads_connect.how')}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">{STEPS.map(k => <li key={k}>{tr(`threads_connect.step_${k}`)}</li>)}</ol>
      <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary-text underline"><ExternalLink className="h-3 w-3" />{tr('threads_connect.open_meta')}</a>
    </details>
    <p className="text-xs text-muted-foreground">{tr('threads_connect.token_hint')}</p>
  </>
  if (!oauth.available) return <div className="space-y-4 text-sm">
    {paste}
    {hostPicker}
    {error && <Notice tone="error">{error}</Notice>}
  </div>
  const pastedBefore = !!channel && channel.api_credential !== 'threads_oauth'
  const authorized = !!oauth.connection?.accounts.length
  const selected = oauth.connection?.accounts.find(a => a.account === account)
  const needsReconnect = selected?.needs_reconnect || !!selected?.missing_scopes?.length
  return <div className="space-y-4 text-sm">
    <p className="text-muted-foreground">{tr(pastedBefore ? 'threads_connect.oauth_switch' : 'threads_connect.oauth_intro')}</p>
    <p className="text-xs text-muted-foreground">{tr('account_authorization.project_only')}</p>
    {authorized && <Select value={account} onChange={setAccount} options={oauth.connection!.accounts.map(a => ({ value: a.account, label: a.label || a.account, sub: a.needs_reconnect ? tr('account_authorization.expired') : undefined }))} />}
    <div className="flex flex-wrap items-center gap-2">
      {authorized && !oauth.pending && <Button needsShuttle disabled={busy || needsReconnect} onClick={connectOAuth}>
        {busy && <Loader2 className="animate-spin" />}{tr(channel?.api_credential === 'threads_oauth' ? 'threads_connect.oauth_save' : channel ? 'threads_connect.oauth_use' : 'threads_connect.oauth_add')}
      </Button>}
      <Button needsShuttle variant={authorized ? 'outline' : 'default'} feedback={false} disabled={oauth.pending} onClick={() => { setError(''); oauth.start().catch(e => setError((e as Error).message)) }}>
        <ExternalLink />{tr(needsReconnect || selected?.renew_error ? 'account_authorization.reconnect' : authorized ? 'threads_connect.oauth_again' : 'threads_connect.oauth_authorize')}
      </Button>
    </div>
    {oauth.pending && <Notice>
      {tr('threads_connect.oauth_pending')}
      {oauth.url && <a href={oauth.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary-text underline">{tr('threads_connect.oauth_reopen')}</a>}
    </Notice>}
    {hostPicker}
    <p className="text-xs text-muted-foreground">{tr('threads_connect.oauth_hint')}</p>
    <OAuthAccountControls key={account} provider="threads" account={selected} onDisconnected={async () => {
      await oauth.load()
      if (channel) {
        await runLocal('social/threads.checkLogin', { channel_id: channel.id }).catch(() => {})
        onAdded()
      }
    }} />
    <details className="text-sm" open={pastedBefore && !authorized}>
      <summary className="cursor-pointer select-none text-muted-foreground">{tr('threads_connect.own_app')}</summary>
      <div className="mt-2 space-y-3">{paste}</div>
    </details>
    {error && <Notice tone="error">{error}</Notice>}
  </div>
}

/** Annulo 的 Threads 连接（设置 → 连接 里那个）：有没有、授权到一半没有；授权页在新窗口打开，回来时刷新 */
function useThreadsOAuth() {
  const [connection, setConnection] = useState<OAuthConnection | null>(null)
  const [url, setURL] = useState('')
  const started = useRef(0)
  const load = useCallback(async () => {
    if (!inShuttle()) return
    try {
      const c = (await listOAuthConnections()).find((c) => c.key === 'threads') || null
      setConnection(c)
      if (started.current && ((!c?.pending && Date.now() - started.current > 1000) || Date.now() - started.current > 10 * 60_000)) { started.current = 0; setURL('') }
    } catch { setConnection(null) }
  }, [])
  useEffect(() => {
    void load()
    const refresh = () => { void load() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [load])
  const pending = !!connection?.pending || !!url
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => { void load() }, 2000)
    return () => window.clearInterval(timer)
  }, [pending, load])
  const start = async () => {
    started.current = Date.now()
    try {
      const { auth_url } = await startOAuthConnection('threads')
      setURL(auth_url)
      window.open(auth_url, '_blank', 'noopener,noreferrer')
      await load()
    } catch (e) { started.current = 0; throw e }
  }
  return { available: !!connection?.available, connection, pending, url, start, load }
}

const STEPS = ['app', 'permissions', 'tester', 'token', 'paste'] as const

/** 账号卡片上：「官方 API」标记、检测授权、管理连接（换口令、换图片素材库） */
export function ThreadsConnectionButton({ channel, onDone }: { channel: Channel; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState(false)
  return <>
    <Badge>{tr('threads_connect.api')}</Badge>
    <RunButton inline fn="social/threads.checkLogin" input={{ channel_id: channel.id }} icon={RefreshCw} variant="ghost" onStart={() => setChecked(false)} onError={setError} onDone={r => { setChecked(!!(r as { ok?: boolean })?.ok); onDone() }}>{tr('threads_connect.check')}</RunButton>
    <Button size="sm" variant={channel.login_status === 'expired' ? 'default' : 'ghost'} onClick={() => setOpen(true)}>{tr('threads_connect.manage')}</Button>
    {error && <span className="basis-full text-xs text-destructive">{error}</span>}
    {checked && !error && <span className="basis-full text-xs text-muted-foreground">{tr('threads_connect.checked')}</span>}
    <Dialog open={open} onClose={() => setOpen(false)} title={tr('threads_connect.title')} footer={<Button variant="ghost" onClick={() => setOpen(false)}>{tr('common.close')}</Button>}>
      {open && <ThreadsAccountFlow channel={channel} onAdded={() => { setOpen(false); setError(''); onDone() }} />}
    </Dialog>
  </>
}
