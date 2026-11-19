import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { listOAuthConnections, runLocal, startOAuthConnection } from '../lib/shuttle'
import { authorizeConnections, disconnectManagedConnection, managedConnections, type ManagedConnection } from '../lib/managedConnections'
import { tr } from '../lib/i18n'
import { Button, Notice } from './ui'
import Select from './Select'

type Account = { id: string; instagram_user_id?: string; instagram_connection_id?: string }
export default function InstagramManagedFlow({ channel, onAdded }: { channel?: Account; onAdded: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState(false)
  const [connections, setConnections] = useState<ManagedConnection[]>([])
  const [selection, setSelection] = useState('')
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [authURL, setAuthURL] = useState('')
  const started = useRef(0)
  const load = useCallback(async () => {
    try {
      const provider = (await listOAuthConnections()).find(c => c.key === 'instagram')
      setAvailable(!!provider?.available); setPending(!!provider?.pending)
      if (provider?.available) setConnections(await managedConnections('instagram'))
      if (started.current && ((!provider?.pending && Date.now() - started.current > 1000) || Date.now() - started.current > 10 * 60_000)) { started.current = 0; setAuthURL('') }
    } catch (e) { setError((e as Error).message) }
    finally { setLoaded(true) }
  }, [])
  useEffect(() => { void load(); const focus = () => { void load() }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus) }, [load])
  useEffect(() => { if (!pending && !authURL) return; const timer = window.setInterval(() => { void load() }, 2500); return () => window.clearInterval(timer) }, [pending, authURL, load])
  const options = connections.filter(c => c.status === 'active' && !c.needs_reconnect).flatMap(c => c.assets.filter(a => a.status === 'active' && (!channel || a.id === channel.instagram_user_id)).map(a => ({ value: `${c.id}|${a.id}`, label: `@${a.name}`, sub: a.id })))
  useEffect(() => { setSelection(old => options.some(o => o.value === old) ? old : options[0]?.value || '') }, [JSON.stringify(options)])
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const authorize = () => act(async () => {
    const { auth_url } = await startOAuthConnection('instagram')
    started.current = Date.now(); setAuthURL(auth_url); window.open(auth_url, '_blank', 'noopener,noreferrer'); await load()
  })
  const bind = () => act(async () => {
    const [connection_id, asset_id] = selection.split('|')
    const result = await runLocal('social/social.login', { type: 'instagram', channel_id: channel?.id, mode: 'managed', connection_id, asset_id }) as { id?: string }
    if (result?.id) onAdded()
  })
  const disconnect = () => act(async () => {
    if (!channel?.instagram_connection_id) return
    await disconnectManagedConnection('instagram', channel.instagram_connection_id)
    await runLocal('social/instagram.checkLogin', { channel_id: channel.id }).catch(() => {})
    onAdded()
  })
  return <div className="space-y-3">
    <p className="text-muted-foreground">{tr('instagram_managed.description')}</p>
    {!loaded ? <Loader2 className="size-4 animate-spin" /> : !available ? <Notice>{tr('instagram_managed.unavailable')}</Notice> : <>
      {!!options.length && <Select value={selection} onChange={setSelection} options={options} />}
      <div className="flex flex-wrap gap-2">
        {selection && <Button disabled={busy} onClick={bind}>{tr('instagram_managed.bind')}</Button>}
        <Button variant={selection ? 'outline' : 'default'} disabled={busy || pending} onClick={authorize}><ExternalLink />{tr('instagram_managed.authorize')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { void load() }}><RefreshCw />{tr('instagram_managed.refresh')}</Button>
      </div>
      {(pending || authURL) && <Notice>{tr('instagram_managed.pending')}{authURL && <a className="ml-1 underline" href={authURL} target="_blank" rel="noopener noreferrer">{tr('instagram_managed.reopen')}</a>}</Notice>}
      <Notice>{tr('instagram_managed.preview')}</Notice>
      {channel?.instagram_connection_id && <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{tr('instagram_managed.disconnect_hint')}</p>
        <Button variant="outline" disabled={busy} onClick={disconnect}>{tr('instagram_managed.disconnect')}</Button>
      </div>}
    </>}
    {error && <Notice tone="error">{error}</Notice>}
    {/insufficient_scope|creght isn't connected|creght: reconnect required|还没连接 creght|重新连接 creght/.test(error) && <Button disabled={busy} variant="outline" onClick={() => act(async () => {
      const { verify_url } = await authorizeConnections(); setAuthURL(verify_url); window.open(verify_url, '_blank', 'noopener,noreferrer')
    })}>{tr('instagram_managed.product_consent')}</Button>}
  </div>
}
