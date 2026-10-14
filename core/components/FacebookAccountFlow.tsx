import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { inShuttle, listOAuthConnections, startOAuthConnection, type Channel, type OAuthConnection } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { Badge, Button, Dialog, ErrorDetails, Notice, Segmented } from './ui'
import Select from './Select'
import RunButton from './RunButton'
import ChooseAccounts, { type Choose } from './ChooseAccounts'
import { apiMetricState } from '../lib/apiMetrics'

/** 授权仍由 Annulo 的连接层完成，页面只读不含 token 的连接状态并选择主页。 */
export default function FacebookAccountFlow({ channel, onAdded }: { channel?: Channel; onAdded: () => void }) {
  const [mode, setMode] = useState<'browser' | 'api'>(channel?.auth_mode === 'api' ? 'api' : 'browser')
  const [connection, setConnection] = useState<OAuthConnection | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [account, setAccount] = useState(channel?.oauth_account || '')
  const [choose, setChoose] = useState<Choose | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [authURL, setAuthURL] = useState('')
  const authStarted = useRef(0)
  const local = inShuttle()
  const page = !channel || channel.fb_kind === 'page' || !!channel.page_id

  const load = useCallback(async () => {
    if (!local) { setLoaded(true); return }
    try {
      const c = (await listOAuthConnections()).find((c) => c.key === 'facebook') || null
      setConnection(c)
      setAccount((id) => c?.accounts.some((a) => a.account === id) ? id : c?.accounts[0]?.account || '')
      if (authStarted.current && ((!c?.pending && Date.now() - authStarted.current > 1000) || Date.now() - authStarted.current > 10 * 60_000)) {
        authStarted.current = 0
        setAuthURL('')
      }
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoaded(true)
    }
  }, [local])
  useEffect(() => {
    void load()
    const refresh = () => { void load() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [load])
  useEffect(() => {
    // pending 涵盖换取、保存凭据；轮询跨过回调，connected_at 保留首次连接时间，不用于判断重连。
    if (!connection?.pending && !authURL) return
    const timer = window.setInterval(() => { void load() }, 2000)
    return () => window.clearInterval(timer)
  }, [connection?.pending, authURL, load])

  const changeMode = (value: 'browser' | 'api') => {
    setMode(value)
    setChoose(null)
    setError('')
  }
  const done = (result: unknown) => {
    // RunButton 失败时也会回调 onDone(undefined)，不能因此关弹窗或认为已添加。
    const r = result as { choose?: Choose; id?: string; ids?: string[] } | null
    if (r?.choose) setChoose(r.choose)
    else if (r?.id || r?.ids?.length) onAdded()
  }
  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      authStarted.current = Date.now()
      const { auth_url } = await startOAuthConnection('facebook')
      setAuthURL(auth_url)
      window.open(auth_url, '_blank', 'noopener,noreferrer')
      await load()
    } catch (e) {
      authStarted.current = 0
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const selected = connection?.accounts.find((a) => a.account === account)
  const incomplete = !!selected?.missing_scopes?.length
  const reconnect = !!selected?.needs_reconnect
  const official = page && (connection?.available || channel?.auth_mode === 'api')

  return <div className="space-y-4 text-sm">
    {official && <Segmented value={mode} onChange={changeMode} options={[
      { value: 'browser', label: tr('facebook_connect.browser') },
      { value: 'api', label: tr('facebook_connect.api') },
    ]} />}
    {mode === 'browser' ? <>
      <p className="text-muted-foreground">{tr('facebook_connect.browser_desc')}</p>
      {choose ? <ChooseAccounts choose={choose} onAdded={onAdded} /> :
        <RunButton watch fn="social/social.login" input={{ type: 'facebook', channel_id: channel?.id, mode: 'browser' }} onDone={done}>
          {tr('facebook_connect.browser_login')}
        </RunButton>}
    </> : <>
      <p className="text-muted-foreground">{tr('facebook_connect.api_desc')}</p>
      {!loaded ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : !local ?
        <Notice>{tr('facebook_connect.local_only')}</Notice> : !connection?.available ?
        <Notice>{tr('facebook_connect.unavailable')}</Notice> : choose ? <>
          <ChooseAccounts choose={choose} initialPageIds={channel ? [channel.page_id || channel.platform_uid || ''] : []} onAdded={onAdded} />
          <Button variant="ghost" size="sm" onClick={() => setChoose(null)}>{tr('facebook_connect.choose_again')}</Button>
        </> : <>
          {!!connection.accounts.length && <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">{tr('facebook_connect.account_label')}</div>
            <Select value={account} onChange={(id) => { setAccount(id); setChoose(null) }} options={connection.accounts.map((a) => ({
              value: a.account, label: tr('facebook_connect.account', { id: a.account }),
              sub: a.needs_reconnect ? tr('facebook_connect.expired') : a.missing_scopes?.length ? tr('facebook_connect.missing') : tr('facebook_connect.connected'),
            }))} />
          </div>}
          {(reconnect || incomplete) && <Notice>{tr(reconnect ? 'facebook_connect.expired' : 'facebook_connect.missing')}</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            {selected && !reconnect && !incomplete && <RunButton fn="social/social.login" input={{ type: 'facebook', channel_id: channel?.id, mode: 'api', account }} onDone={done}>
              {tr('facebook_connect.list_pages')}
            </RunButton>}
            <Button variant={selected && !reconnect && !incomplete ? 'outline' : 'default'} size="sm" feedback={false} onClick={connect} disabled={busy || connection.pending}>
              {busy ? <Loader2 className="animate-spin" /> : <ExternalLink />}
              {tr(selected && (reconnect || incomplete) ? 'facebook_connect.reconnect' : selected ? 'facebook_connect.another' : 'facebook_connect.authorize')}
            </Button>
          </div>
          {(connection.pending || authURL) && <Notice>
            {tr('facebook_connect.pending')}
            {authURL && <a href={authURL} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary-text underline">{tr('facebook_connect.reopen')}</a>}
          </Notice>}
          {!connection.accounts.length && !connection.pending && <p className="text-xs text-muted-foreground">{tr('facebook_connect.authorize_hint')}</p>}
          <Button variant="ghost" size="sm" onClick={() => { void load() }}><RefreshCw />{tr('facebook_connect.refresh')}</Button>
        </>}
    </>}
    {error && mode === 'api' && <ErrorDetails message={error} />}
  </div>
}

/** 账号卡片上的入口：连接方式切换确认在弹窗中完成，账号 id 和已有帖子保持不变。 */
export function FacebookConnectionButton({ channel, onDone }: { channel: Channel; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  return <>
    <Badge>{tr(channel.auth_mode === 'api' ? 'facebook_connect.api' : 'facebook_connect.browser')}</Badge>
    <Button size="sm" variant={channel.login_status === 'expired' ? 'default' : 'ghost'} onClick={() => setOpen(true)}>{tr('facebook_connect.manage')}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={tr('facebook_connect.title')} footer={<Button variant="ghost" onClick={() => setOpen(false)}>{tr('common.close')}</Button>}>
      <FacebookAccountFlow channel={channel} onAdded={() => { setOpen(false); onDone() }} />
    </Dialog>
  </>
}

export function ApiMetricsNotice({ channel }: { channel: Channel }) {
  const state = apiMetricState(channel)
  if (channel.type !== 'facebook' || channel.auth_mode !== 'api' || !state) return null
  return <Notice>
    <p>{state.warnings.length ? tr('facebook_connect.metrics_limited', { metrics: state.warnings.map((w) => w.name).join('、') }) : tr('facebook_connect.metrics_available')}</p>
    <p className="mt-1 text-xs">{tr('facebook_connect.metrics_unsupported')}</p>
  </Notice>
}
