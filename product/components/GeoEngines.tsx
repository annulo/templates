import { useEffect, useState } from 'react'
import { Bot, Settings2 } from 'lucide-react'
import { Badge, Button, Dialog, Field, Notice, cx } from './ui'
import Select, { Combobox } from './Select'
import { openShuttleSettings, runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'

/** 一个 AI 引擎的检测设置（local/geo.ts engines()） */
export type GeoEngine = {
  engine: string
  name: string
  hint: string
  enabled: boolean
  /** Shuttle 设置 → 模型 里的服务商 id，空 = 没选 */
  provider: string
  model: string
  default_model: string
  /** 没选服务商、在用老项目的本机密钥（密钥名） */
  legacy_key: string
  ready: boolean
  reason: string
}

/** Shuttle 里配好的服务商（不含 key）；模型的 search：能不能联网搜索，null = 不知道（自己加的服务商） */
export type LLMProvider = { id: string; name: string; kind?: 'api' | 'cli'; api: string; base_url: string; builtin: boolean; ready: boolean; error: string; models: { model: string; name: string; search: boolean | null }[]; default_model?: string }

type State = { engines: GeoEngine[]; providers: LLMProvider[] }

/** 各引擎的设置和可选的服务商；改了之后 reload */
export function useGeoEngines() {
  const [data, setData] = useState<State | null>(null)
  const [error, setError] = useState('')
  const load = () =>
    runLocal<State>('geo.engines', {})
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

type Draft = { enabled: boolean; provider: string; model: string }

/** 「检测设置」弹窗：每个引擎一块，开关、用 Shuttle 里的哪个服务商、哪个模型。key 不在这里填：在 Shuttle 的 设置 → 模型 */
export function GeoEnginesDialog({ open, onClose, data, onSaved }: { open: boolean; onClose: () => void; data: State | null; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !data) return
    setDrafts(Object.fromEntries(data.engines.map((e) => [e.engine, { enabled: e.enabled, provider: e.provider, model: e.model }])))
    setError('')
  }, [open, data])

  const set = (k: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [k]: { ...d[k], ...patch } }))

  const save = async () => {
    if (!data) return
    setBusy(true)
    setError('')
    try {
      for (const e of data.engines) {
        const d = drafts[e.engine]
        if (d && (d.enabled !== e.enabled || d.provider !== e.provider || d.model.trim() !== e.model))
          await runLocal('geo.saveEngine', { engine: e.engine, enabled: d.enabled, provider: d.provider, model: d.model })
      }
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const providers = data?.providers ?? []
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={560}
      title={tr('geo.eng_title')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          <Button successLabel={tr('ui.saved')} onClick={save} disabled={busy || !data}>
            {tr('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{tr('geo.eng_desc')}</p>
          <Button variant="outline" size="sm" onClick={() => openShuttleSettings('llm')}>
            <Bot /> {tr('geo.eng_models')}
          </Button>
        </div>
        {!data ? (
          <Notice>{tr('ui.preparing')}</Notice>
        ) : (
          data.engines.map((e) => {
            const d = drafts[e.engine]
            if (!d) return null
            const p = providers.find((x) => x.id === d.provider)
            const models = p?.models ?? []
            const defModel = p?.default_model || e.default_model
            return (
              <div key={e.engine} className="space-y-3 rounded-xl border border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{e.name}</span>
                  {!d.provider && <Badge tone="warn">{tr('geo.eng_no_provider')}</Badge>}
                  {p && !p.ready && <Badge tone="bad">{tr('geo.eng_provider_bad')}</Badge>}
                </div>
                {(
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={tr('geo.eng_provider')} hint={p && !p.ready ? p.error : !d.provider && e.legacy_key ? tr('geo.eng_legacy', { key: e.legacy_key }) : p?.kind === 'cli' ? tr(p.id === 'claude-code' ? 'geo.eng_cli_claude_hint' : 'geo.eng_cli_hint') : e.hint}>
                      <Select
                        value={d.provider}
                        onChange={(v) => set(e.engine, { provider: v })}
                        placeholder={tr('geo.eng_pick_provider')}
                        title={tr('geo.eng_provider')}
                        options={[
                          { value: '', label: tr('geo.eng_none_provider'), sub: e.legacy_key ? tr('geo.eng_legacy', { key: e.legacy_key }) : undefined },
                          ...providers.map((x) => ({ value: x.id, label: x.name, sub: !x.ready ? x.error : x.kind === 'cli' ? tr(x.id === 'claude-code' ? 'geo.eng_cli_claude' : 'geo.eng_cli') : x.base_url || (x.builtin ? tr('geo.eng_builtin') : '') })),
                        ]}
                      />
                    </Field>
                    <Field label={tr('geo.eng_model')} hint={p?.builtin ? tr('geo.eng_search_only', { v: defModel }) : tr('geo.eng_default', { v: defModel })}>
                      {/* 从服务商登记的模型里选，也能直接输入没登记的；不能联网搜索的灰掉、写明原因 */}
                      <Combobox
                        value={d.model}
                        onChange={(v) => set(e.engine, { model: v })}
                        placeholder={defModel}
                        title={p?.builtin || p?.kind === 'cli' ? tr('geo.eng_search_models') : tr('geo.eng_provider_models')}
                        ariaLabel={tr('geo.eng_model')}
                        inputClassName="font-mono"
                        options={[...models]
                          .sort((a, b) => Number(b.search !== false) - Number(a.search !== false))
                          .map((m) => ({ value: m.model, label: m.name, sub: m.search === false ? tr('geo.eng_no_search') : m.name !== m.model ? m.model : undefined, disabled: m.search === false }))}
                      />
                    </Field>
                  </div>
                )}
              </div>
            )
          })
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  )
}

/** GEO 页顶部：这次检测会用哪些引擎 + 「检测设置」按钮；一个都用不了时说清楚、给入口 */
export function GeoEnginesBar({ data, error, onOpen }: { data: State | null; error: string; onOpen: () => void }) {
  const active = (data?.engines ?? []).filter((e) => e.ready)
  const none = !!data && !active.length
  // 谁在答：本机 Claude Code 测的是 Claude，不能写成 ChatGPT（和 local/geo.ts askerOf 一致）
  const asker = (e: GeoEngine) => {
    const p = data?.providers.find((x) => x.id === e.provider)
    if (p?.kind === 'cli') return tr(p.id === 'claude-code' ? 'geo.asker_claude' : 'geo.asker_codex')
    return `${e.name} · ${e.provider ? (p?.name ?? e.provider) : e.legacy_key}`
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {error ? (
        <span className="text-destructive">{error}</span>
      ) : !data ? null : active.length ? (
        <span>{active.map((e) => `${asker(e)} · ${e.model || e.default_model}`).join('、')}</span>
      ) : (
        <span className="text-amber-600 dark:text-amber-400">{tr('geo.eng_none')}</span>
      )}
      <Button variant={none ? 'outline' : 'ghost'} size="sm" onClick={onOpen} className={cx(!none && 'text-muted-foreground')}>
        <Settings2 /> {tr('geo.eng_btn')}
      </Button>
    </div>
  )
}
