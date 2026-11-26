import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, ChevronDown, ExternalLink, Image, Loader2, Plus, RefreshCw } from 'lucide-react'
import { inShuttle, listChannels, listOAuthConnections, runLocal, shuttleImage, type Channel, type OAuthConnection } from '../lib/shuttle'
import { authorizeConnections, managedConnections } from '../lib/managedConnections'
import { continueOAuthReturn, finishOAuthReturn, readOAuthReturn, startProjectOAuth, watchOAuthCompletion, type OAuthProvider } from '../lib/oauthReturn'
import { authorizationReady, authorizationTarget, defaultResources, instagramResources, resourceKey, selectAuthorization, type AuthorizationChannel, type AuthorizationResource } from '../lib/socialAuthorization'
import { bindReturnedAuthorization } from '../lib/socialAuthorizationReturn'
import { tr } from '../lib/i18n'
import { InstagramLogo, ThreadsLogo, FacebookLogo } from './BrandIcons'
import { Button, cx, Notice } from './ui'
import Select from './Select'
import OAuthAccountControls from './OAuthAccountControls'
import type { Choose } from './ChooseAccounts'

const platforms = { instagram: { label: 'Instagram', icon: InstagramLogo }, threads: { label: 'Threads', icon: ThreadsLogo }, facebook: { label: 'Facebook', icon: FacebookLogo } }
export const socialAuthorizationProviders: OAuthProvider[] = ['instagram', 'threads', 'facebook']

/** One UI contract; provider-specific reads/writes still use the existing Social plugin. */
export default function SocialAuthorizationFlow({ provider, channel, onAdded, onBack }: {
  provider: OAuthProvider; channel?: AuthorizationChannel; onAdded: () => void; onBack?: () => void;
}) {
  const [resume] = useState(() => readOAuthReturn(provider))
  const autoReturn = resume?.status === 'connected'
  const [returnBusy, setReturnBusy] = useState(autoReturn)
  const autoStarted = useRef(false)
  const addedRef = useRef(onAdded)
  addedRef.current = onAdded
  const cancelled = useRef(resume?.status === 'failed')
  const [returnFailed, setReturnFailed] = useState(!!cancelled.current)
  const target = authorizationTarget(provider, channel)
  const selectingExisting = useRef(!!channel)
  const [connection, setConnection] = useState<OAuthConnection>()
  const [account, setAccount] = useState(resume?.account || target?.instagram_connection_id || target?.oauth_account || '')
  const accountRef = useRef(account)
  const [resources, setResources] = useState<AuthorizationResource[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [choose, setChoose] = useState<Choose>()
  const [checked, setChecked] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const [authURL, setAuthURL] = useState('')
  const started = useRef(0)
  const request = useRef(0)
  const [step, setStep] = useState<1 | 2>(resume?.status === 'connected' ? 2 : 1)
  const [host, setHost] = useState(channel?.instagram_media_host || channel?.threads_media_host || resume?.mediaHost || '')
  const [sites, setSites] = useState<Channel[]>([])
  const hostOf = (c: Channel & { api_host?: string }) => JSON.stringify({ api_host: c.api_host || 'https://creght.cn', project_id: c.project_id, site_id: c.site_id })
  useEffect(() => { let live = true; listChannels().then(r => {
    if (!live) return
    const list = r.list.filter(c => c.type === 'creght_site' && c.project_id && c.site_id)
    setSites(list); if (list.length === 1) setHost(h => h || hostOf(list[0]))
  }).catch(() => {}); return () => { live = false } }, [])

  const load = useCallback(async (preferred?: string) => {
    if (preferred) selectingExisting.current = true
    const id = ++request.current
    setLoading(true); setError(''); setResources([]); setChoose(undefined)
    try {
      if (!inShuttle()) throw new Error(tr('social_authorization.local_only'))
      const c = (await listOAuthConnections()).find(c => c.key === provider)
      if (id !== request.current) return
      setConnection(c)
      const exact = !!preferred || !!resume?.account || !!target?.instagram_connection_id || !!target?.oauth_account
      const next = selectAuthorization(c?.accounts || [], preferred || accountRef.current, exact)
      accountRef.current = next; setAccount(next)
      if (started.current && ((!c?.pending && Date.now() - started.current > 1000) || Date.now() - started.current > 10 * 60_000)) { started.current = 0; setAuthURL('') }
      if (!c?.available || c.pending || !next) {
        if (exact && c?.available && !c.pending && !next) throw new Error(tr('social_authorization.source_missing'))
        return
      }
      const a = c.accounts.find(a => a.account === next)
      if (!authorizationReady(a)) return
      if (cancelled.current) { setStep(1); return }
      if (!selectingExisting.current && !preferred && !resume) { setStep(1); return }
      let rows: AuthorizationResource[] = []
      let pages: Choose | undefined
      if (provider === 'instagram') rows = instagramResources(await managedConnections(provider), next, target)
      else if (provider === 'threads') rows = [{ key: resourceKey(next, next), id: next, account: next, name: a?.label || target?.name || tr('social_authorization.account_fallback', { platform: platforms[provider].label }) }]
      else {
        const result = await runLocal('social/social.login', { type: provider, mode: 'api', account: next, channel_id: target?.id }) as { choose?: Choose }
        pages = result?.choose
        if (!pages || pages.type !== 'facebook' || pages.profile !== 'api' || pages.uid !== next || !Array.isArray(pages.pages)) throw new Error(tr('social_authorization.invalid_resources'))
        rows = pages.pages.map(p => ({ key: resourceKey(next, p.id), id: p.id, account: next, name: p.name, avatar: p.avatar, added: p.added }))
      }
      if (id !== request.current) return
      setChoose(pages); setResources(rows)
      setSelected(old => defaultResources(rows, old, target))
      setStep(2)
    } catch (e) { if (id === request.current) setError((e as Error).message) }
    finally { if (id === request.current) { setLoaded(true); setLoading(false) } }
  }, [provider, target?.id, target?.instagram_user_id, resume?.account, resume?.status])
  useEffect(() => {
    if (autoReturn) return
    void load()
    const refresh = () => { if (!savingRef.current) void load() }
    window.addEventListener('focus', refresh)
    return () => { request.current++; window.removeEventListener('focus', refresh) }
  }, [load, autoReturn])
  useEffect(() => {
    if (!connection?.pending && !authURL) return
    const timer = window.setInterval(() => { if (!savingRef.current) void load() }, 2000)
    return () => window.clearInterval(timer)
  }, [connection?.pending, authURL, load])

  const authorize = async () => {
    if (savingRef.current) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      cancelled.current = false; selectingExisting.current = !!channel; setReturnFailed(false)
      const { auth_url } = await startProjectOAuth(provider, { channelId: target?.id, mediaHost: host })
      started.current = Date.now(); setAuthURL(auth_url)
      window.open(auth_url, '_blank', 'noopener,noreferrer')
      await load()
    } catch (e) { setError((e as Error).message) }
    finally { savingRef.current = false; setSaving(false) }
  }
  const bind = async () => {
    if (savingRef.current || loading) return
    const rows = resources.filter(r => selected.includes(r.key))
    if (!rows.length || rows.some(r => r.account !== account) || (provider !== 'facebook' && rows.length !== 1)) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      let result: { id?: string; ids?: string[] }
      if (provider === 'facebook') {
        if (!choose || choose.uid !== account) throw new Error(tr('social_authorization.invalid_resources'))
        result = await runLocal('social/social.addChosen', { choose, profile_selected: false, page_ids: rows.map(r => r.id) }) as typeof result
      } else result = await runLocal('social/social.login', provider === 'instagram'
        ? { type: provider, channel_id: target?.id, mode: 'managed', connection_id: account, asset_id: rows[0].id, media_host: host }
        : { type: provider, channel_id: target?.id, mode: 'oauth', account, media_host: host }) as typeof result
      if (!result?.id && !result?.ids?.length) throw new Error(tr('social_authorization.bind_failed'))
      finishOAuthReturn(); onAdded()
    } catch (e) { setError((e as Error).message) }
    finally { savingRef.current = false; setSaving(false) }
  }
  const completeReturn = useCallback(async (retry = false) => {
    setReturnBusy(true); setError('')
    try {
      const completed = await continueOAuthReturn(provider, result => bindReturnedAuthorization(result, () => readOAuthReturn(provider)?.nonce === result.nonce), retry)
      if (!completed) throw new Error(tr('social_authorization.retry_hint'))
      finishOAuthReturn(); addedRef.current()
    } catch (e) { setError((e as Error).message) }
    finally { setReturnBusy(false) }
  }, [provider])
  useEffect(() => {
    if (autoReturn && !autoStarted.current) { autoStarted.current = true; void completeReturn() }
  }, [autoReturn, completeReturn])
  useEffect(() => watchOAuthCompletion(() => { finishOAuthReturn(); addedRef.current() }), [])
  const active = connection?.accounts.find(a => a.account === account)
  const ready = authorizationReady(active)
  const pending = !!connection?.pending || !!authURL
  const busy = loading || saving
  const label = platforms[provider].label
  const Icon = platforms[provider].icon
  if (autoReturn) return <div className="space-y-4 p-6 text-sm" aria-live="polite">
    <div className="flex items-center gap-2 font-medium"><Icon size={24} />{label}</div>
    {returnBusy ? <div role="status" className="flex items-center gap-2 py-6"><Loader2 className="size-4 animate-spin" />{tr('social_authorization.adding')}</div> : <>
      <Notice tone="error">{error || tr('social_authorization.bind_failed')}</Notice>
      <p className="text-muted-foreground">{tr('social_authorization.retry_hint')}</p>
      <Button feedback={false} onClick={() => completeReturn(true)}>{tr('social_authorization.retry_add')}</Button>
    </>}
  </div>
  return <div className="flex min-h-0 flex-1 flex-col text-sm">
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
      <ol aria-label={tr('social_authorization.steps')} className="flex items-center gap-3 py-1 text-xs sm:text-sm">
        {(['authorize', 'confirm', 'complete'] as const).map((s, i) => <li key={s} aria-current={step === i + 1 ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
          <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium', step === i + 1 ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>{step > i + 1 ? <Check className="size-3.5" /> : i + 1}</span>
          <span className={cx('leading-snug', step === i + 1 ? 'font-medium text-primary' : 'text-muted-foreground')}>{tr('social_authorization.step_' + s)}</span>
          {i < 2 && <span className="ml-1 h-px min-w-2 flex-1 bg-border" />}
        </li>)}
      </ol>
      <div className="flex items-center gap-2 text-sm font-medium"><Icon size={24} /><span>{label}</span></div>
      {returnFailed && <Notice tone="error">{tr('account_authorization.return_failed')}</Notice>}
      {channel && !target && <Notice>{tr('social_authorization.legacy_separate')}</Notice>}
      {!loaded ? <div role="status" className="flex items-center gap-2 py-6 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tr('social_authorization.loading')}</div> : !connection?.available ? <Notice>{tr('social_authorization.unavailable', { platform: label })}</Notice> : step === 1 ? <div className="space-y-4 py-2">
        <h3 className="text-lg font-semibold">{tr('social_authorization.authorize_title', { platform: label })}</h3>
        <p className="leading-relaxed text-muted-foreground">{tr('social_authorization.authorize_hint', { platform: label })}</p>
        {ready && <Button variant="outline" disabled={busy} onClick={() => { cancelled.current = false; setReturnFailed(false); void load(account) }}>{tr('social_authorization.use_existing')}</Button>}
      </div> : <div className="space-y-4">
        {ready && !loading && !error && <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" />{tr('social_authorization.authorized')}</span>}
        <div><h3 className="text-lg font-semibold">{tr('social_authorization.confirm_title')}</h3><p className="mt-1 text-xs text-muted-foreground">{tr('social_authorization.type_' + provider)}</p></div>
        {(connection.accounts.length > 1 || !ready) && <Select value={account} onChange={value => { accountRef.current = value; setSelected([]); void load(value) }} options={connection.accounts.map((a, i) => ({ value: a.account, label: a.label || tr('social_authorization.connection_fallback', { platform: label, n: i + 1 }), sub: authorizationReady(a) ? undefined : tr('account_authorization.reconnect') }))} />}
        {loading ? <div role="status" className="flex items-center gap-2 py-3 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tr('social_authorization.loading')}</div> : <ul role={provider === 'facebook' ? 'group' : 'radiogroup'} aria-label={tr('social_authorization.confirm_title')} className="space-y-2" onKeyDown={e => {
          if (provider === 'facebook' || saving || !resources.length || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
          e.preventDefault()
          const index = Math.max(0, resources.findIndex(r => selected.includes(r.key)))
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? resources.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1) + resources.length) % resources.length
          setSelected([resources[next].key]); e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
        }}>
          {resources.map(r => <li key={r.key}><button type="button" role={provider === 'facebook' ? 'checkbox' : 'radio'} aria-checked={selected.includes(r.key)} disabled={saving} onClick={() => setSelected(old => provider === 'facebook' ? old.includes(r.key) ? old.filter(k => k !== r.key) : [...old, r.key] : [r.key])} className={cx('flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', selected.includes(r.key) ? 'border-primary/35 bg-primary/[0.02]' : 'border-border hover:bg-accent')}>
            {r.avatar ? <img src={shuttleImage(r.avatar)} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted"><Icon size={20} /></span>}
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{r.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{label} · {tr('social_authorization.kind_' + provider)}{r.added ? ` · ${tr('choose_accounts.added')}` : ''}</span></span>
            <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-full border', selected.includes(r.key) ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>{selected.includes(r.key) && <Check className="size-3.5" />}</span>
          </button></li>)}
        </ul>}
        {!loading && ready && !resources.length && !error && <Notice>{tr('social_authorization.empty_' + provider)}</Notice>}
        <Button variant="ghost" className="-ml-3 text-primary" disabled={busy || pending} feedback={false} onClick={authorize}><Plus />{tr(target || (active && !ready) ? 'account_authorization.reconnect' : 'social_authorization.another')}</Button>
        {provider !== 'facebook' && <details className="border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium"><Image className="size-4" /><span className="flex-1">{tr('social_authorization.host')}</span><ChevronDown className="size-4 text-muted-foreground" /></summary>
          <div className="mt-3 space-y-2"><Select value={host} onChange={setHost} options={[{ value: '', label: tr('social_authorization.public_only') }, ...sites.map(c => ({ value: hostOf(c), label: c.name }))]} /><p className="text-xs leading-relaxed text-muted-foreground">{tr('social_authorization.host_hint', { platform: label })}</p></div>
        </details>}
        {target && <div className="space-y-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
            setChecked(false); setError('')
            try { const result = await runLocal(`social/${provider}.checkLogin`, { channel_id: target.id }) as { ok?: boolean }; setChecked(!!result?.ok) }
            catch (e) { setError((e as Error).message) }
          }}><RefreshCw />{tr('instagram_connect.check')}</Button>
          {checked && !error && <p className="text-xs text-muted-foreground">{tr('instagram_connect.checked')}</p>}
          <OAuthAccountControls provider={provider} account={active} onDisconnected={async () => {
          setSelected([]); setStep(1)
          await runLocal(`social/${provider}.checkLogin`, { channel_id: target.id }).catch(() => {})
          await load()
          }} />
        </div>}
      </div>}
      {pending && <Notice>{tr('social_authorization.pending')}{authURL && <a className="ml-1 underline" href={authURL} target="_blank" rel="noopener noreferrer">{tr('social_authorization.reopen')}</a>}</Notice>}
      {active && !ready && <Notice>{tr(active.missing_scopes?.length ? 'account_authorization.missing' : 'account_authorization.expired')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {(error || (loaded && (!connection?.available || !ready))) && <Button variant="ghost" disabled={busy} onClick={() => { void load() }}><RefreshCw />{tr('social_authorization.refresh')}</Button>}
      {/insufficient_scope|creght isn't connected|creght: reconnect required|还没连接 creght|重新连接 creght/.test(error) && <Button variant="outline" disabled={busy} onClick={async () => { try { const { verify_url } = await authorizeConnections(); window.open(verify_url, '_blank', 'noopener,noreferrer') } catch (e) { setError((e as Error).message) } }}>{tr('instagram_managed.product_consent')}</Button>}
    </div>
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-4">
      {step === 2 || onBack ? <Button variant="outline" disabled={saving} onClick={() => { if (step === 2) { setStep(1); setError('') } else onBack?.() }}>{tr('social_authorization.back')}</Button> : <span />}
      <Button needsShuttle disabled={busy || !connection?.available || (step === 2 && (!ready || !selected.length || !!error || pending)) || (step === 1 && pending)} feedback={false} onClick={step === 1 ? authorize : bind}>
        {saving && <Loader2 className="size-4 animate-spin" />}{tr(step === 1 ? 'social_authorization.continue' : target ? 'social_authorization.save' : 'social_authorization.add')}{step === 2 && selected.length > 1 ? `（${selected.length}）` : ''}
      </Button>
    </div>
  </div>
}
