import { useEffect, useId, useRef, useState, type ComponentProps } from 'react'
import { Check, ChevronDown, ExternalLink, Globe, Loader2 } from 'lucide-react'
import { getTask, openChat, runLocal, runTask } from '../../lib/shuttle'
import { useAIReady, useOnboarding, type OnboardingData, type SiteOption } from '../../lib/onboarding'
import { websiteURL } from '../../local/_onboarding'
import { tr } from '../../lib/i18n'
import type { WizardScreen } from './types'
import { Button, Field, Notice, cx, inputCls } from '../ui'

const key = (s: SiteOption) => `${s.project_id}/${s.site_id}`
const companyFacts = ['name', 'business', 'cooperation', 'keywords', 'customer_types', 'positioning', 'markets', 'advantages', 'company_role', 'buyer_concerns', 'profile', 'audience'] as const
const hasCompanyFacts = (profile: OnboardingData['profile']) => companyFacts.some((field) => !!profile[field]?.trim())
const ConnectSite = ({ ctx, onDone, onBusyChange, onCanContinueChange, onChat, module = 'onboarding', task = 'trade-onboarding' }: ComponentProps<WizardScreen> & { module?: string; task?: string }) => {
  const { data, error: loadError, load } = useOnboarding(ctx.rev, false, module)
  const [sites, setSites] = useState<SiteOption[] | null>(null)
  // 连了 creght 才有站点下拉；没连（或还在读）只是一个网址输入框，不出现 creght 的字样
  const [connected, setConnected] = useState(false)
  // 助手能不能跑：不能跑（没配模型）时不启动解析，选好网站直接进简报手填
  const { ready: aiReady, check: checkAI } = useAIReady()
  const [picked, setPicked] = useState<SiteOption | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [preview, setPreview] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')
  const [sitesError, setSitesError] = useState('')
  const [saving, setSaving] = useState(false)
  const [forceRefresh, setForceRefresh] = useState(false)
  const restored = useRef(false)
  const mounted = useRef(true)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const loadSites = () => {
    setSitesError('')
    runLocal<{ connected: boolean; list: SiteOption[] }>('onboarding.sites', {}).then((r) => { setConnected(r.connected); setSites(r.list) }).catch((e: Error) => { setConnected(true); setSites([]); setSitesError(e.message) })
  }
  useEffect(loadSites, [])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (restored.current || q || !data) return
    if (data.website_url) { setQ(data.website_url); restored.current = true; return }
    if (data.channel && !sites) return
    const s = sites?.find((s) => s.site_id === data.channel?.site_id && s.project_id === data.channel?.project_id)
    if (s) { setPicked(s); setQ(s.site_name) }
    restored.current = true
  }, [data, sites, q])
  const typedURL = picked ? '' : websiteURL(q)
  const sameSelection = picked
    ? data?.channel?.project_id === picked.project_id && data?.channel?.site_id === picked.site_id
    : !!typedURL && data?.website_url === typedURL
  const hasBrief = !!data && hasCompanyFacts(data.profile)
  useEffect(() => { onCanContinueChange?.(!!picked || !!typedURL) }, [onCanContinueChange, picked, typedURL])
  useEffect(() => {
    if (!picked) { setPreview(typedURL); setPreviewing(false); return }
    let alive = true
    setPreview(picked.preview_url); setPreviewing(true)
    runLocal<{ url: string }>(`${module}.preview`, picked).then((r) => { if (alive) setPreview(r.url) }).catch((e: Error) => { if (alive) setError(e.message) }).finally(() => { if (alive) setPreviewing(false) })
    return () => { alive = false }
  }, [picked, typedURL])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const filtered = (sites || []).filter((s) => !q.trim() || (picked && q === picked.site_name) || `${s.site_name} ${s.project_name} ${s.preview_url}`.toLowerCase().includes(q.trim().toLowerCase()))
  const choose = (s: SiteOption) => { setPicked(s); setQ(s.site_name); setForceRefresh(false); setOpen(false); setError('') }
  const save = async () => {
    if ((!picked && !typedURL) || saving) return false
    setSaving(true); onBusyChange?.(true); setError('')
    try {
      const selected = picked
        ? await runLocal<OnboardingData>(`${module}.selectSite`, { project_id: picked.project_id, site_id: picked.site_id, refresh: forceRefresh })
        : await runLocal<OnboardingData>(`${module}.selectURL`, { url: typedURL, refresh: forceRefresh })
      if (!(await checkAI())) { if (mounted.current) onDone(); return }
      const refresh = selected.company_refresh || (selected.company_status === 'failed' && hasCompanyFacts(selected.profile))
      const hasResult = ['done', 'needs_review'].includes(selected.company_status) && (!refresh || selected.company_draft !== null)
      if (!hasResult) {
        const matching = (run: { input?: { revision?: number; stage?: string; refresh?: boolean } }) => run.input?.revision === selected.revision && run.input?.stage === 'company'
        const active = (await getTask(task)).running.find(matching)
        if (active && !!active.input?.refresh !== refresh) throw new Error(tr('onboarding.analysis_running'))
        const chatId = active?.chat_id || (await runTask(task, { revision: selected.revision, stage: 'company', refresh })).chat_id
        // 解析画面上的「查看对话」；跑起来就在右侧打开这段对话（和别的交给助手的按钮一样），过程看得见
        if (chatId) { onChat?.(chatId); openChat(chatId) }
        let missing = 0
        // 等网站资料写回后再展示简报，避免用户先看到空表单。
        while (mounted.current) {
          const current = await runLocal<OnboardingData>(`${module}.get`, {})
          if (current.revision !== selected.revision) throw new Error(tr('onboarding.site_changed'))
          if (refresh ? current.company_status === 'needs_review' && current.company_draft !== null : ['done', 'needs_review'].includes(current.company_status)) break
          const info = await getTask(task)
          // 重试失败状态时，旧的 failed 不能被误认为本次任务已结束。
          if (current.company_status === 'failed' && (selected.company_status !== 'failed' || info.last?.chat_id === chatId)) break
          const running = info.running.some(matching)
          if (!running && info.last && matching(info.last) && (!chatId || info.last.chat_id === chatId)) {
            throw new Error(info.last.error || tr('onboarding.extract_stopped'))
          }
          if (!running && ++missing >= 3) throw new Error(tr('onboarding.extract_stopped'))
          if (running) missing = 0
          await new Promise((resolve) => window.setTimeout(resolve, 2000))
        }
      }
      if (mounted.current) onDone()
    }
    catch (e) { if (mounted.current) setError((e as Error).message); return false }
    finally { if (mounted.current) setSaving(false); onBusyChange?.(false) }
  }
  return <div className="space-y-4">
    <Field label={tr('onboarding.site_label')}>
      {!connected ? <input aria-label={tr('onboarding.site_label')} autoComplete="off" value={q} disabled={saving} placeholder={tr('onboarding.site_placeholder')} className={inputCls} onChange={(e) => { setQ(e.target.value); setPicked(null); setForceRefresh(false) }} /> : <div ref={root} className="relative">
        <div className="relative">
          <input role="combobox" aria-label={tr('onboarding.site_label')} aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined} autoComplete="off" value={q} disabled={saving} placeholder={tr('onboarding.site_search')} className={cx(inputCls, 'pr-10')} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setPicked(null); setForceRefresh(false); setOpen(true); setActive(0) }} onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Tab') setOpen(false)
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((n) => Math.max(0, Math.min(filtered.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1)))) }
            if (e.key === 'Enter' && open) {
              if (typedURL) { e.preventDefault(); setOpen(false) }
              else if (filtered[active]) { e.preventDefault(); choose(filtered[active]) }
            }
          }} />
          <button type="button" aria-label={tr('onboarding.site_list')} tabIndex={-1} disabled={saving} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground" onClick={() => setOpen((v) => !v)}><ChevronDown className="size-4" /></button>
        </div>
        {open && <div id={listId} role="listbox" aria-label={tr('onboarding.site_list')} className="absolute top-full z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl">
          {typedURL && <p className="break-all p-3 text-sm text-primary-text">{tr('onboarding.use_url', { url: typedURL })}</p>}
          {sites === null ? <p className="flex gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tr('onboarding.loading_sites')}</p> : !filtered.length ? !typedURL && <p className="p-3 text-sm text-muted-foreground">{tr(sites.length ? 'onboarding.no_match' : 'onboarding.no_sites')}</p> : filtered.map((s, i) => <button key={key(s)} id={`${listId}-${i}`} type="button" role="option" aria-selected={picked ? key(s) === key(picked) : false} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(s)} className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent', active === i && 'bg-accent')}>
            <Globe className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.site_name}</span><span className="block truncate text-xs text-muted-foreground">{s.project_name} · {s.preview_url}</span></span>{picked && key(s) === key(picked) && <Check className="size-4 text-primary-text" />}
          </button>)}
        </div>}
      </div>}
    </Field>
    {aiReady && sameSelection && (hasBrief || data?.company_status === 'needs_review' || data?.company_status === 'done') && <label className="flex cursor-pointer items-start gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={forceRefresh} disabled={saving} onChange={(e) => setForceRefresh(e.target.checked)} className="mt-0.5 size-4 accent-primary" /><span>{tr('onboarding.reparse_site')}</span></label>}
    {aiReady && !sameSelection && hasBrief && (picked || typedURL) && <p className="text-xs leading-relaxed text-muted-foreground">{tr('onboarding.new_site_reparse')}</p>}
    {error && <Notice tone="error">{error}</Notice>}
    {loadError && <Notice tone="error">{loadError}<Button variant="ghost" size="sm" onClick={load}>{tr('onboarding.retry')}</Button></Notice>}
    {sitesError && <Notice><p>{tr('onboarding.sites_unavailable')}</p><Button variant="ghost" size="sm" onClick={loadSites}>{tr('onboarding.retry')}</Button></Notice>}
    {preview && <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate text-muted-foreground">{previewing ? tr('onboarding.loading_preview') : preview}</span><a href={preview} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-primary-text">{tr('onboarding.open_site')}<ExternalLink className="size-3" /></a></div>
      <iframe key={preview} title={tr('onboarding.site_preview')} src={preview} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" className="h-72 w-full bg-white" />
      <p className="px-3 py-2 text-xs text-muted-foreground">{tr('onboarding.preview_hint')}</p>
    </div>}
    <form id="trade-onboarding-site" onSubmit={(event) => { event.preventDefault(); void save() }} />
  </div>
}
export default ConnectSite
