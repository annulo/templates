import InstagramManagedFlow from './InstagramManagedFlow'
import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { listChannels, runLocal, setSecret, type Channel as BaseChannel } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { Badge, Button, Dialog, Notice, Segmented } from './ui'
import Select from './Select'
import RunButton from './RunButton'

type Channel = Omit<BaseChannel, 'api_credential'> & { api_credential?: string; instagram_connection_id?: string; instagram_user_id?: string; instagram_media_host?: string; instagram_auth_error?: string; api_host?: string }

export const instagramApi = (ch?: Channel) => ch?.type === 'instagram' && ch.auth_mode === 'api'

const PENDING = 'INSTAGRAM_USER_TOKEN_PENDING'

/**
 * Manual token is the main way to connect. One button opens Annulo's browser on the Meta developer dashboard:
 * the person logs in and approves, the browser assistant clicks the rest, and the plugin reads the token and
 * the account it belongs to. Functions can only read secrets, so the token comes back to this page once and is
 * written straight into INSTAGRAM_USER_TOKEN_<id>; it never goes into tables, inputs or state beyond this call.
 * A pasted token works too (the plugin asks Instagram which account it is).
 */
export default function InstagramAccountFlow({ channel, onAdded }: { channel?: Channel; onAdded: () => void }) {
  const renew = instagramApi(channel)
  const [mode, setMode] = useState<'api' | 'browser' | 'managed'>(channel ? channel.api_credential === 'instagram_managed' ? 'managed' : renew ? 'api' : 'browser' : 'api')
  const [token, setToken] = useState('')
  const [username, setUsername] = useState(channel?.handle || '')
  const handle = username.trim().replace(/^@/, '').toLowerCase()
  const handleOk = /^[a-z0-9._]{1,30}$/.test(handle)
  const [host, setHost] = useState(channel?.instagram_media_host || '')
  const [sites, setSites] = useState<Channel[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { let live = true; listChannels().then(r => { if (live) setSites(r.list.filter(c => c.type === 'creght_site' && c.project_id && c.site_id)) }).catch(() => {}); return () => { live = false } }, [])
  const save = async (who: { account_id: string; username: string }, value?: string) => {
    if (channel?.instagram_user_id && who.account_id !== channel.instagram_user_id) throw new Error(tr('instagram_connect.wrong_account', { username: who.username }))
    if (value) await setSecret(`INSTAGRAM_USER_TOKEN_${who.account_id}`, value)
    await runLocal('social/social.login', { type: 'instagram', channel_id: channel?.id, mode: 'api', account_id: who.account_id, username: who.username, media_host: host })
    onAdded()
  }
  const guided = async (r: unknown) => {
    const v = r as { account_id?: string; username?: string; token?: string } | null
    if (!v?.account_id || !v.username || !v.token) return
    setBusy(true); setError('')
    try { await save({ account_id: v.account_id, username: v.username }, v.token) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const pasted = async () => {
    const t = token.trim().replace(/^["']|["']$/g, '')
    if (!t && !renew) { setError(tr('instagram_connect.token_missing')); return }
    setBusy(true); setError('')
    try {
      let who = { account_id: channel?.instagram_user_id || '', username: channel?.handle || '' }
      if (t) {
        await setSecret(PENDING, t)
        try { who = await runLocal('social/instagram.identifyToken', { secret: PENDING }) as typeof who }
        finally { await setSecret(PENDING, 'cleared').catch(() => {}) }
      }
      await save(who, t || undefined)
      setToken('')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const field = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
  return <div className="space-y-4 text-sm">
    {!renew && <Segmented value={mode} onChange={setMode} options={[{ value: 'api', label: tr('instagram_managed.manual_label') }, { value: 'managed', label: tr('instagram_managed.label') }, { value: 'browser', label: tr('instagram_connect.browser') }]} />}
    {mode === 'managed' ? <InstagramManagedFlow channel={channel} onAdded={onAdded} /> : mode === 'browser' ? <RunButton watch fn="social/social.login" input={{ type: 'instagram', channel_id: channel?.id, mode: 'browser' }} onDone={r => { if ((r as any)?.id) onAdded() }}>{tr('instagram_connect.browser_login')}</RunButton> : <>
      <p className="text-muted-foreground">{tr(renew ? 'instagram_connect.renew_intro' : 'instagram_connect.intro')}</p>
      <label className="block space-y-1"><span>{tr('instagram_connect.username')}</span><input className={field} value={username} disabled={busy || !!channel} onChange={e => setUsername(e.target.value)} autoComplete="off" placeholder="yourbrand" /></label>
      {handleOk ? <RunButton watch size="default" fn="social/instagram.tokenGuide" input={{ account_id: renew ? channel?.instagram_user_id : undefined, username: handle }} icon={ExternalLink} onStart={() => setError('')} onError={setError} onDone={guided}>{tr(renew ? 'instagram_connect.renew' : 'instagram_connect.start')}</RunButton> : <Button size="default" disabled><ExternalLink className="h-4 w-4" />{tr(renew ? 'instagram_connect.renew' : 'instagram_connect.start')}</Button>}
      <p className="text-xs text-muted-foreground">{tr('instagram_connect.start_hint')}</p>
      <details className="text-sm">
        <summary className="cursor-pointer select-none text-muted-foreground">{tr('instagram_connect.have_token')}</summary>
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <input className={field} type="password" value={token} disabled={busy} onChange={e => setToken(e.target.value)} autoComplete="new-password" placeholder={tr(renew ? 'instagram_connect.token_placeholder' : 'instagram_connect.token_paste_placeholder')} />
            <Button variant="outline" needsShuttle disabled={busy || (!token.trim() && !renew)} onClick={pasted}>{tr('instagram_connect.connect')}</Button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">{MANUAL_STEPS.map(k => <li key={k}>{tr(`instagram_connect.manual_step_${k}`)}</li>)}</ol>
        </div>
      </details>
      <details className="text-sm" open={!!host}>
        <summary className="cursor-pointer select-none text-muted-foreground">{tr('instagram_connect.host')}</summary>
        <div className="mt-2 space-y-1"><Select value={host} onChange={setHost} options={[{ value: '', label: tr('instagram_connect.public_only') }, ...sites.map(c => ({ value: JSON.stringify({ api_host: c.api_host || 'https://creght.cn', project_id: c.project_id, site_id: c.site_id }), label: c.name }))]} />
        <p className="text-xs text-muted-foreground">{tr('instagram_connect.host_hint')}</p></div>
      </details>
      <p className="text-xs text-muted-foreground">{tr('instagram_connect.token_hint')}</p>
    </>}
    {error && <Notice tone="error">{error}</Notice>}
  </div>
}

const MANUAL_STEPS = ['facebook', 'register', 'app', 'account', 'token', 'paste'] as const

export function InstagramConnectionButton({ channel, onDone }: { channel: Channel; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState(false)
  return <>
    <Badge>{tr(channel.api_credential === 'instagram_managed' ? 'instagram_managed.label' : instagramApi(channel) ? 'instagram_connect.api' : 'instagram_connect.browser')}</Badge>
    {instagramApi(channel) && <RunButton inline fn="social/instagram.checkLogin" input={{ channel_id: channel.id }} icon={RefreshCw} variant="ghost" onStart={() => setChecked(false)} onError={setError} onDone={r => { setChecked(!!(r as any)?.ok); onDone() }}>{tr('instagram_connect.check')}</RunButton>}
    <Button size="sm" variant={channel.login_status === 'expired' ? 'default' : 'ghost'} onClick={() => setOpen(true)}>{tr('instagram_connect.manage')}</Button>
    {error && <span className="basis-full text-xs text-destructive">{error}</span>}
    {checked && !error && <span className="basis-full text-xs text-muted-foreground">{tr('instagram_connect.checked')}</span>}
    <Dialog open={open} onClose={() => setOpen(false)} title={tr('instagram_connect.title')} footer={<Button variant="ghost" onClick={() => setOpen(false)}>{tr('common.close')}</Button>}>
      {open && <InstagramAccountFlow channel={channel} onAdded={() => { setOpen(false); setError(''); onDone() }} />}
    </Dialog>
  </>
}
