import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, Globe, Loader2, Plug, Settings2 } from 'lucide-react'
import { Badge, Button, Dialog, Field, Notice, cx } from './ui'
import Select, { Combobox } from './Select'
import { openShuttleSettings, runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'

/** 一个 AI 引擎的检测设置（local/geo.ts engines()） */
export type GeoEngine = {
  engine: string
  /** api：用 Annulo 里配的服务商调接口；web：在用户自己的 Chrome 里问网页版 */
  kind: 'api' | 'web'
  name: string
  /** 引擎卡片上的一句话：谁在用、要准备什么 */
  desc: string
  hint: string
  /** 网页版的地址 */
  url: string
  enabled: boolean
  /** Annulo 设置 → 模型 里的服务商 id，空 = 没选（只有接口引擎有） */
  provider: string
  model: string
  default_model: string
  /** 没选服务商、在用老项目的本机密钥（密钥名） */
  legacy_key: string
  ready: boolean
  reason: string
  /** 网页版：这个网站在哪个 Chrome 用户里允许过；最近一次「试一下」 */
  granted: string
  tested_at: string
  test_error: string
  test_profile: string
}

/** Annulo 里配好的服务商（不含 key）；模型的 search：能不能联网搜索，null = 不知道（自己加的服务商） */
export type LLMProvider = { id: string; name: string; kind?: 'api' | 'cli'; api: string; base_url: string; builtin: boolean; ready: boolean; error: string; models: { model: string; name: string; search: boolean | null }[]; default_model?: string }

/** chrome：用户 Chrome 里连着的 Annulo 插件；null = 这个版本的 Annulo 不能操作用户的 Chrome */
export type EnginesState = { engines: GeoEngine[]; providers: LLMProvider[]; chrome: { id: string; name: string; email: string }[] | null }

/** 各引擎的设置和可选的服务商；改了之后 reload */
export function useGeoEngines() {
  const [data, setData] = useState<EnginesState | null>(null)
  const [error, setError] = useState('')
  const load = () =>
    runLocal<EnginesState>('geo.engines', {})
      .then((r) => {
        setData(r)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
  useEffect(() => {
    load()
  }, [])
  return { data, error, reload: load }
}

/** 打开 / 关掉一个引擎；网页版打开时马上问一句试试（第一次会在 Chrome 里弹授权窗口），结果存在引擎上 */
function useToggle(onChanged: () => void) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const toggle = async (e: GeoEngine, on: boolean) => {
    setBusy(e.engine)
    setError('')
    try {
      await runLocal('geo.saveEngine', { engine: e.engine, enabled: on })
      onChanged()
      if (on && e.kind === 'web') await runLocal('geo.testEngine', { engine: e.engine })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy('')
      onChanged()
    }
  }
  const test = async (e: GeoEngine) => {
    setBusy(e.engine)
    setError('')
    try {
      await runLocal('geo.testEngine', { engine: e.engine })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy('')
      onChanged()
    }
  }
  return { busy, error, toggle, test }
}

/** 网页版引擎现在怎么样：要先做什么（更新 Annulo、装插件、登录），或者试过能用 */
function WebStatus({ e, chrome, busy, onTest }: { e: GeoEngine; chrome: EnginesState['chrome']; busy: boolean; onTest: () => void }) {
  if (busy)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-primary-text">
        <Loader2 className="size-3.5 animate-spin" /> {tr('geo.eng_testing')}
      </span>
    )
  // 用不了：为什么，旁边给去处理的入口
  if (!e.ready)
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
        {e.reason}
        {chrome !== null && (
          <Button size="sm" variant="outline" onClick={() => openShuttleSettings('browser')}>
            <Plug /> {tr('geo.eng_open_browser')}
          </Button>
        )}
      </span>
    )
  if (e.test_error)
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs text-destructive">
        <span className="min-w-0">{e.test_error.replace(/^\[\w+\]\s*/, '')}</span>
        {/^\[login\]/.test(e.test_error) && e.url && (
          <a href={e.url} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
            {tr('geo.eng_go_login')}
          </a>
        )}
        <Button size="sm" variant="outline" onClick={onTest}>
          {tr('geo.eng_test_again')}
        </Button>
      </span>
    )
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {e.tested_at ? (
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" /> {tr('geo.eng_test_ok', { who: e.test_profile || e.granted || 'Chrome' })}
        </span>
      ) : e.granted ? (
        <span>{tr('geo.eng_granted', { who: e.granted })}</span>
      ) : (
        <span>{tr('geo.eng_not_tested')}</span>
      )}
      <Button size="sm" variant="ghost" onClick={onTest} className="text-muted-foreground">
        {tr('geo.eng_test')}
      </Button>
    </span>
  )
}

/** 开关 */
function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx('relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50', on ? 'bg-primary' : 'bg-muted-foreground/30')}
    >
      <span className={cx('inline-block size-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  )
}

/**
 * 「检测设置」弹窗：每个 AI 一行，开关改了马上存（网页版打开时马上试一句）。
 * 接口引擎打开后选用 Annulo 里的哪个服务商、哪个模型（key 不在这里填：在 Annulo 的 设置 → 模型）
 */
export function GeoEnginesDialog({ open, onClose, data, onSaved }: { open: boolean; onClose: () => void; data: EnginesState | null; onSaved: () => void }) {
  const t = useToggle(onSaved)
  const [drafts, setDrafts] = useState<Record<string, { provider: string; model: string }>>({})
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open || !data) return
    setDrafts(Object.fromEntries(data.engines.filter((e) => e.kind === 'api').map((e) => [e.engine, { provider: e.provider, model: e.model }])))
    setError('')
  }, [open, data])

  // 接口引擎的服务商、模型：选了就存
  const saveApi = async (e: GeoEngine, patch: { provider?: string; model?: string }) => {
    setDrafts((d) => ({ ...d, [e.engine]: { ...d[e.engine], ...patch } }))
    setSaving(e.engine)
    setError('')
    try {
      await runLocal('geo.saveEngine', { engine: e.engine, ...patch })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving('')
    }
  }

  const providers = data?.providers ?? []
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={620}
      title={tr('geo.eng_title')}
      footer={
        <Button onClick={onClose} feedback={false}>
          {tr('common.close')}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-muted-foreground">{tr('geo.eng_desc2')}</p>
        {!data ? (
          <Notice>{tr('ui.preparing')}</Notice>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border">
            {data.engines.map((e) => {
              const d = drafts[e.engine]
              const p = providers.find((x) => x.id === d?.provider)
              const models = p?.models ?? []
              const defModel = p?.default_model || e.default_model
              return (
                <div key={e.engine} className="space-y-2.5 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{e.kind === 'web' ? <Globe className="size-4" /> : <Bot className="size-4" />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {e.name}
                        <Badge>{e.kind === 'web' ? tr('geo.eng_kind_web') : tr('geo.eng_kind_api')}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{e.desc}</p>
                    </div>
                    <Switch on={e.enabled} disabled={t.busy === e.engine || (e.kind === 'web' && data.chrome === null)} onChange={(v) => t.toggle(e, v)} label={e.name} />
                  </div>
                  {e.enabled && e.kind === 'web' && (
                    <div className="pl-10">
                      <WebStatus e={e} chrome={data.chrome} busy={t.busy === e.engine} onTest={() => t.test(e)} />
                    </div>
                  )}
                  {e.kind === 'web' && !e.enabled && data.chrome === null && <p className="pl-10 text-xs text-amber-600 dark:text-amber-400">{e.reason}</p>}
                  {e.enabled && e.kind === 'api' && d && (
                    <div className="grid gap-3 pl-10 sm:grid-cols-2">
                      <Field label={tr('geo.eng_provider')} hint={p && !p.ready ? p.error : p?.kind === 'cli' ? tr(p.id === 'claude-code' ? 'geo.eng_cli_claude_hint' : 'geo.eng_cli_hint') : !e.ready ? e.reason : e.hint}>
                        <Select
                          value={d.provider}
                          onChange={(v) => saveApi(e, { provider: v })}
                          placeholder={tr('geo.eng_pick_provider')}
                          title={tr('geo.eng_provider')}
                          options={[
                            { value: '', label: tr('geo.eng_none_provider') },
                            ...providers.map((x) => ({ value: x.id, label: x.name, sub: !x.ready ? x.error : x.kind === 'cli' ? tr(x.id === 'claude-code' ? 'geo.eng_cli_claude' : 'geo.eng_cli') : x.base_url || (x.builtin ? tr('geo.eng_builtin') : '') })),
                          ]}
                        />
                      </Field>
                      <Field label={tr('geo.eng_model')} hint={p?.builtin ? tr('geo.eng_search_only', { v: defModel }) : tr('geo.eng_default', { v: defModel })}>
                        {/* 从服务商登记的模型里选，也能直接输入没登记的；不能联网搜索的灰掉、写明原因 */}
                        {/* 输入完离开时存（选下拉项也会触发） */}
                        <div onBlur={() => d.model.trim() !== e.model && saveApi(e, { model: d.model.trim() })}>
                        <Combobox
                          value={d.model}
                          onChange={(v) => setDrafts((x) => ({ ...x, [e.engine]: { ...x[e.engine], model: v } }))}
                          placeholder={defModel}
                          title={p?.builtin || p?.kind === 'cli' ? tr('geo.eng_search_models') : tr('geo.eng_provider_models')}
                          ariaLabel={tr('geo.eng_model')}
                          inputClassName="font-mono"
                          options={[...models]
                            .sort((a, b) => Number(b.search !== false) - Number(a.search !== false))
                            .map((m) => ({ value: m.model, label: m.name, sub: m.search === false ? tr('geo.eng_no_search') : m.name !== m.model ? m.model : undefined, disabled: m.search === false }))}
                        />
                        </div>
                      </Field>
                      {saving === e.engine && (
                        <span className="text-xs text-muted-foreground">
                          <Loader2 className="mr-1 inline size-3 animate-spin" />
                          {tr('geo.eng_saving')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => openShuttleSettings('llm')}>
            <Bot /> {tr('geo.eng_models')}
          </Button>
          {data?.chrome !== null && (
            <Button variant="outline" size="sm" onClick={() => openShuttleSettings('browser')}>
              <Plug /> {tr('geo.eng_open_browser')}
            </Button>
          )}
        </div>
        {(error || t.error) && <Notice tone="error">{error || t.error}</Notice>}
      </div>
    </Dialog>
  )
}

/** GEO 页顶部：检测会问哪些 AI + 「检测设置」按钮；一个都没开时说清楚 */
export function GeoEnginesBar({ data, error, onOpen }: { data: EnginesState | null; error: string; onOpen: () => void }) {
  const on = (data?.engines ?? []).filter((e) => e.enabled)
  const none = !!data && !on.length
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {error ? (
        <span className="text-destructive">{error}</span>
      ) : !data ? null : on.length ? (
        <span className="flex flex-wrap items-center gap-x-2">
          {on.map((e) => (
            <span key={e.engine} className={cx(!e.ready && 'text-amber-600 dark:text-amber-400')} title={e.ready ? undefined : e.reason}>
              {e.name}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-amber-600 dark:text-amber-400">{tr('geo.eng_none2')}</span>
      )}
      <Button variant={none ? 'outline' : 'ghost'} size="sm" onClick={onOpen} className={cx(!none && 'text-muted-foreground')}>
        <Settings2 /> {tr('geo.eng_btn')}
      </Button>
    </div>
  )
}
