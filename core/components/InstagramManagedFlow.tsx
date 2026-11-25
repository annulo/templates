import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { listChannels, listOAuthConnections, runLocal, startOAuthConnection, type Channel, type OAuthConnection } from '../lib/shuttle'
import { authorizeConnections, managedConnections, type ManagedConnection } from '../lib/managedConnections'
import { tr } from '../lib/i18n'
import { Button, Notice } from './ui'
import Select from './Select'
import OAuthAccountControls from './OAuthAccountControls'

type Account = { id: string; instagram_user_id?: string; instagram_connection_id?: string; instagram_media_host?: string }
export default function InstagramManagedFlow({ channel, onAdded }: { channel?: Account; onAdded: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState(false)
  const [connections, setConnections] = useState<ManagedConnection[]>([])
  const [authorization, setAuthorization] = useState<OAuthConnection>()
  const [selection, setSelection] = useState('')
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [authURL, setAuthURL] = useState('')
  const started = useRef(0)
  // 本机图片、视频要先传到一个网站的素材库，Instagram 才抓得到；项目里正好一个网站就默认选它
  const [host, setHost] = useState(channel?.instagram_media_host || '')
  const [sites, setSites] = useState<Channel[]>([])
  const hostOf = (c: Channel & { api_host?: string }) => JSON.stringify({ api_host: c.api_host || 'https://creght.cn', project_id: c.project_id, site_id: c.site_id })
  useEffect(() => { let live = true; listChannels().then(r => { if (!live) return; const list = r.list.filter(c => c.type === 'creght_site' && c.project_id && c.site_id); setSites(list); if (list.length === 1) setHost(h => h || hostOf(list[0])) }).catch(() => {}); return () => { live = false } }, [])
  const load = useCallback(async () => {
    try {
      const provider = (await listOAuthConnections()).find(c => c.key === 'instagram')
      setAuthorization(provider)
      setAvailable(!!provider?.available); setPending(!!provider?.pending)
      if (provider?.available) setConnections(await managedConnections('instagram'))
      if (started.current && ((!provider?.pending && Date.now() - started.current > 1000) || Date.now() - started.current > 10 * 60_000)) { started.current = 0; setAuthURL('') }
    } catch (e) { setError((e as Error).message) }
    finally { setLoaded(true) }
  }, [])
  useEffect(() => { void load(); const focus = () => { void load() }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus) }, [load])
  useEffect(() => { if (!pending && !authURL) return; const timer = window.setInterval(() => { void load() }, 2500); return () => window.clearInterval(timer) }, [pending, authURL, load])
  const options = connections.flatMap(c => c.assets.filter(a => !channel || a.id === channel.instagram_user_id).map(a => ({ value: `${c.id}|${a.id}`, label: `@${a.name}`, sub: c.status !== 'active' || c.needs_reconnect || a.status !== 'active' ? tr('account_authorization.expired') : a.id })))
  for (const a of authorization?.accounts || []) {
    if (!channel && !options.some(o => o.value.startsWith(a.account + '|'))) options.push({ value: a.account + '|', label: a.label || a.account, sub: tr('account_authorization.reconnect') })
  }
  useEffect(() => { setSelection(old => options.some(o => o.value === old) ? old : options[0]?.value || '') }, [JSON.stringify(options)])
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const authorize = () => act(async () => {
    const { auth_url } = await startOAuthConnection('instagram')
    started.current = Date.now(); setAuthURL(auth_url); window.open(auth_url, '_blank', 'noopener,noreferrer'); await load()
  })
  const bind = () => act(async () => {
    const [connection_id, asset_id] = selection.split('|')
    const result = await runLocal('social/social.login', { type: 'instagram', channel_id: channel?.id, mode: 'managed', connection_id, asset_id, media_host: host }) as { id?: string }
    if (result?.id) onAdded()
  })
  const connectionID = channel?.instagram_connection_id || selection.split('|')[0]
  const [selectedConnection, selectedAsset] = selection.split('|')
  const canBind = connections.some(c => c.id === selectedConnection && c.status === 'active' && !c.needs_reconnect && c.assets.some(a => a.id === selectedAsset && a.status === 'active'))
  return <div className="space-y-3">
    <p className="text-muted-foreground">{tr('instagram_managed.description')}</p>
    <p className="text-xs text-muted-foreground">{tr('account_authorization.project_only')}</p>
    {!loaded ? <Loader2 className="size-4 animate-spin" /> : !available ? <Notice>{tr('instagram_managed.unavailable')}</Notice> : <>
      {!!options.length && <Select value={selection} onChange={setSelection} options={options} />}
      {!!options.length && <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{tr('instagram_managed.host')}</div>
        <Select value={host} onChange={setHost} options={[{ value: '', label: tr('instagram_managed.public_only') }, ...sites.map(c => ({ value: hostOf(c), label: c.name }))]} />
        <p className="text-xs text-muted-foreground">{tr('instagram_managed.host_hint')}</p>
      </div>}
      <div className="flex flex-wrap gap-2">
        {selection && <Button disabled={busy || !canBind} onClick={bind}>{tr('instagram_managed.bind')}</Button>}
        <Button variant={selection ? 'outline' : 'default'} disabled={busy || pending} onClick={authorize}><ExternalLink />{tr('instagram_managed.authorize')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { void load() }}><RefreshCw />{tr('instagram_managed.refresh')}</Button>
      </div>
      {(pending || authURL) && <Notice>{tr('instagram_managed.pending')}{authURL && <a className="ml-1 underline" href={authURL} target="_blank" rel="noopener noreferrer">{tr('instagram_managed.reopen')}</a>}</Notice>}
      <Notice>{tr('instagram_managed.preview')}</Notice>
      <OAuthAccountControls key={connectionID} provider="instagram" account={authorization?.accounts.find(a => a.account === connectionID)} onDisconnected={async () => {
        await load()
        if (channel) {
          await runLocal('social/instagram.checkLogin', { channel_id: channel.id }).catch(() => {})
          onAdded()
        }
      }} />
    </>}
    {error && <Notice tone="error">{error}</Notice>}
    {/insufficient_scope|creght isn't connected|creght: reconnect required|还没连接 creght|重新连接 creght/.test(error) && <Button disabled={busy} variant="outline" onClick={() => act(async () => {
      const { verify_url } = await authorizeConnections(); setAuthURL(verify_url); window.open(verify_url, '_blank', 'noopener,noreferrer')
    })}>{tr('instagram_managed.product_consent')}</Button>}
  </div>
}
