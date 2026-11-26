import { startProjectOAuth, readOAuthReturn, continueOAuthReturn, finishOAuthReturn } from '../lib/oauthReturn'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { inShuttle, listChannels, listOAuthConnections, runLocal, type Channel as BaseChannel, type OAuthConnection } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { Badge, Button, Dialog, Notice } from './ui'
import Select from './Select'
import RunButton from './RunButton'
import OAuthAccountControls from './OAuthAccountControls'

type Channel = BaseChannel & { threads_media_host?: string; threads_auth_error?: string; api_host?: string }

/** Threads connects through the project's official authorization. Existing records keep their history. */
export default function ThreadsAccountFlow({ channel, onAdded }: { channel?: Channel; onAdded: () => void }) {
  const resume = readOAuthReturn('threads')
  const [host, setHost] = useState(channel?.threads_media_host || resume?.mediaHost || '')
  const [sites, setSites] = useState<Channel[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const oauth = useThreadsOAuth(channel?.id, host)
  const [account, setAccount] = useState(resume?.account || channel?.oauth_account || '')
  useEffect(() => {
    setAccount(old => oauth.connection?.accounts.some(a => a.account === old) ? old : oauth.connection?.accounts[0]?.account || '')
  }, [oauth.connection])
  // 还没选素材库、项目里正好一个网站：默认选它（本机图片、视频都要传上去 Threads 才抓得到）
  const hostOf = (c: Channel) => JSON.stringify({ api_host: c.api_host || 'https://creght.cn', project_id: c.project_id, site_id: c.site_id })
  useEffect(() => { let live = true; listChannels().then(r => { if (!live) return; const list = r.list.filter(c => c.type === 'creght_site' && c.project_id && c.site_id); setSites(list); if (list.length === 1) setHost(h => h || hostOf(list[0])) }).catch(() => {}); return () => { live = false } }, [])
  const connectOAuth = async () => {
    setBusy(true); setError('')
    try {
      await runLocal('social/social.login', { type: 'threads', channel_id: channel?.id, mode: 'oauth', account, media_host: host })
      onAdded()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => {
    const selected = oauth.connection?.accounts.find(a => a.account === resume?.account)
    if (!selected || selected.needs_reconnect || selected.missing_scopes?.length || oauth.pending) return
    void continueOAuthReturn('threads', async r => {
      setBusy(true); setError('')
      try { await runLocal('social/social.login', { type: 'threads', channel_id: channel?.id, mode: 'oauth', account: r.account, media_host: r.mediaHost || host }); onAdded() }
      catch (e) { setError((e as Error).message) } finally { setBusy(false) }
    }).catch(e => setError((e as Error).message))
  }, [oauth.connection, oauth.pending])
  const hostPicker = <details className="text-sm" open={!!host}>
    <summary className="cursor-pointer select-none text-muted-foreground">{tr('threads_connect.host')}</summary>
    <div className="mt-2 space-y-1"><Select value={host} onChange={setHost} options={[{ value: '', label: tr('threads_connect.public_only') }, ...sites.map(c => ({ value: hostOf(c), label: c.name }))]} />
    <p className="text-xs text-muted-foreground">{tr('threads_connect.host_hint')}</p></div>
  </details>
  if (!oauth.loaded) return <Loader2 className="size-4 animate-spin" />
  if (!oauth.available) return <div className="space-y-4 text-sm">
    <Notice tone={oauth.error ? 'error' : undefined}>{oauth.error || tr('threads_connect.unavailable')}</Notice>
    <Button variant="outline" onClick={() => { void oauth.load() }}><RefreshCw />{tr('threads_connect.oauth_refresh')}</Button>
  </div>
  const pastedBefore = !!channel && channel.api_credential !== 'threads_oauth'
  const authorized = !!oauth.connection?.accounts.length
  const selected = oauth.connection?.accounts.find(a => a.account === account)
  const needsReconnect = selected?.needs_reconnect || !!selected?.missing_scopes?.length
  return <div className="space-y-4 text-sm">
    {resume?.status === 'failed' && <Notice tone="error">{tr('account_authorization.return_failed')}</Notice>}
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
    {(error || oauth.error) && <Notice tone="error">{error || oauth.error}</Notice>}
  </div>
}

/** Project connection status; authorization opens in a new window and refreshes on return. */
function useThreadsOAuth(channelId?: string, mediaHost?: string) {
  const [connection, setConnection] = useState<OAuthConnection | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [url, setURL] = useState('')
  const started = useRef(0)
  const load = useCallback(async () => {
    if (!inShuttle()) { setLoaded(true); return }
    try {
      const c = (await listOAuthConnections()).find((c) => c.key === 'threads') || null
      setConnection(c)
      setError('')
      if (started.current && ((!c?.pending && Date.now() - started.current > 1000) || Date.now() - started.current > 10 * 60_000)) { started.current = 0; setURL('') }
    } catch (e) { setConnection(null); setError((e as Error).message) }
    finally { setLoaded(true) }
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
      const { auth_url } = await startProjectOAuth('threads', { channelId, mediaHost })
      setURL(auth_url)
      window.open(auth_url, '_blank', 'noopener,noreferrer')
      await load()
    } catch (e) { started.current = 0; throw e }
  }
  return { available: !!connection?.available, loaded, error, connection, pending, url, start, load }
}

/** 账号卡片上：「官方 API」标记、检测授权、管理连接（重新授权、换图片素材库） */
export function ThreadsConnectionButton({ channel, onDone }: { channel: Channel; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState(false)
  return <>
    <Badge>{tr(channel.api_credential === 'threads_oauth' ? 'threads_connect.api' : 'account_authorization.legacy')}</Badge>
    <RunButton inline fn="social/threads.checkLogin" input={{ channel_id: channel.id }} icon={RefreshCw} variant="ghost" onStart={() => setChecked(false)} onError={setError} onDone={r => { setChecked(!!(r as { ok?: boolean })?.ok); onDone() }}>{tr('threads_connect.check')}</RunButton>
    <Button size="sm" variant={channel.login_status === 'expired' ? 'default' : 'ghost'} onClick={() => setOpen(true)}>{tr('threads_connect.manage')}</Button>
    {error && <span className="basis-full text-xs text-destructive">{error}</span>}
    {checked && !error && <span className="basis-full text-xs text-muted-foreground">{tr('threads_connect.checked')}</span>}
    <Dialog open={open} onClose={() => { finishOAuthReturn(); setOpen(false) }} title={tr('threads_connect.title')} footer={<Button variant="ghost" onClick={() => { finishOAuthReturn(); setOpen(false) }}>{tr('common.close')}</Button>}>
      {open && <ThreadsAccountFlow channel={channel} onAdded={() => { finishOAuthReturn(); setOpen(false); setError(''); onDone() }} />}
    </Dialog>
  </>
}
