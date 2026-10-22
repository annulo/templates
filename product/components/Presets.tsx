import { useCallback, useEffect, useState } from 'react'
import { Check, Pencil, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import { ARTICLE_TYPES, TYPE_META, TypeBadge, type ArticleType } from './ArticleTypes'
import { Button, Dialog, Field, Notice, Segmented, cx, inputCls } from './ui'
import { tr } from '../lib/i18n'
import { mergePresets, presetLabel, type Preset, type PresetMode, type PresetRow } from '../lib/presets'
import { dbCreate, dbDelete, dbList, dbPatch } from '../lib/shuttle'

/** 读 AI 预设（rewrite_presets 表 + 模板自带的），合成一个列表。here：项目能「在这篇上做」时才有那一类 */
export function usePresets(open: boolean, here: boolean) {
  const [rows, setRows] = useState<PresetRow[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => dbList('rewrite_presets').then((l) => { setRows(l as PresetRow[]); setError('') }).catch((e) => { setRows([]); setError((e as Error).message) }), [])
  useEffect(() => { if (open) void load() }, [open, load])
  return { presets: rows ? mergePresets(rows, { here }) : null, error, reload: load }
}

/** 一排预设按钮：点一下把要求（和类型）填进去；当前选中的打勾 */
export function PresetChips({ presets, picked, onPick, onManage, emptyText }: { presets: Preset[] | null; picked?: Preset; onPick: (p: Preset) => void; onManage: () => void; emptyText: string }) {
  return <div role="group" className="grid gap-2">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm leading-none font-medium">{tr('article.presets')}</span>
      <button type="button" onClick={onManage} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Settings2 className="size-3.5" />{tr('article.presets_manage')}</button>
    </div>
    {presets === null ? <span className="text-xs text-muted-foreground">…</span> : !presets.length ? <span className="text-xs leading-relaxed text-muted-foreground">{emptyText}</span>
      : <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">{presets.map((p) => {
        const on = picked?.key === p.key
        const Icon = p.mode === 'new' ? TYPE_META[p.type]?.icon : undefined
        return <button key={p.key} type="button" onClick={() => onPick(p)} title={p.prompt}
          className={cx('inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs', on ? 'border-primary/50 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}>
          {on ? <Check className="size-3.5 shrink-0" /> : Icon && <Icon className="size-3.5 shrink-0" />}<span className="max-w-60 truncate">{presetLabel(p)}</span>
        </button>
      })}</div>}
  </div>
}

/** 现在的要求是不是某个预设（做法、类型、要求都没改过） */
export const pickedPreset = (presets: Preset[] | null, mode: PresetMode, type: ArticleType, prompt: string, untyped = false) =>
  (presets ?? []).find((p) => p.mode === mode && (mode === 'here' || untyped || p.type === type) && p.prompt.trim() === prompt.trim())

/** 把这次的要求存成一条预设。here 的记下用在哪种文章上（types） */
export async function savePreset(mode: PresetMode, type: ArticleType, prompt: string) {
  const t = new Date().toISOString()
  await dbCreate('rewrite_presets', { mode, type, ...(mode === 'here' ? { types: JSON.stringify([type]) } : {}), prompt: prompt.trim(), created_at: t, updated_at: t } as any)
}

type Draft = { preset?: Preset; mode: PresetMode; type: ArticleType; types: ArticleType[]; name: string; prompt: string }

/**
 * 管理预设：列出全部，每条能改名字、做法、类型、要求，能删；模板自带的改过能「恢复默认」。
 * untyped：内容没有类型（自媒体的内容文件夹），不选做成哪种、用在哪些类型上，做成什么写在要求里
 */
export function PresetsDialog({ open, presets, here, untyped = false, onClose, onChanged }: { open: boolean; presets: Preset[]; here: boolean; untyped?: boolean; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setEditing(null); setErr('') } }, [open])
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await f(); await onChanged(); return true } catch (e) { setErr((e as Error).message); return false } finally { setBusy(false) }
  }
  const now = () => new Date().toISOString()
  const save = () => editing && run(async () => {
    const d = { mode: editing.mode, type: editing.mode === 'here' ? editing.types[0] ?? 'article' : editing.type, types: editing.mode === 'here' ? JSON.stringify(editing.types) : '', name: editing.name.trim(), prompt: editing.prompt.trim(), updated_at: now() }
    const p = editing.preset
    if (p?.row) await dbPatch('rewrite_presets', p.row.id, d as any)
    else await dbCreate('rewrite_presets', { ...d, ...(p?.builtin ? { builtin: p.builtin } : {}), created_at: now() } as any)
  }).then((ok) => { if (ok) setEditing(null) })
  // 删模板自带的：存一行 hidden 记下来（不然下次又出现）
  const remove = (p: Preset) => run(async () => {
    if (!p.builtin) return p.row && dbDelete('rewrite_presets', p.row.id)
    if (p.row) return dbPatch('rewrite_presets', p.row.id, { hidden: true, updated_at: now() } as any)
    return dbCreate('rewrite_presets', { mode: p.mode, type: p.type, prompt: p.prompt, builtin: p.builtin, hidden: true, created_at: now(), updated_at: now() } as any)
  })
  const reset = (p: Preset) => run(async () => p.row && dbDelete('rewrite_presets', p.row.id))
  const toggleType = (d: Draft, t: ArticleType) => setEditing({ ...d, types: d.types.includes(t) ? d.types.filter((x) => x !== t) : [...d.types, t] })

  const form = (d: Draft) => <div className="space-y-3 rounded-lg border border-primary/40 p-3">
    <Field label={tr('presets.name')} hint={tr('presets.name_hint')}>
      <input autoFocus value={d.name} onChange={(e) => setEditing({ ...d, name: e.target.value })} className={inputCls} />
    </Field>
    {here && !d.preset?.builtin && <Field group label={tr('presets.mode')}>
      <Segmented<PresetMode> value={d.mode} onChange={(m) => setEditing({ ...d, mode: m })} options={[{ value: 'here', label: tr('presets.mode_here') }, { value: 'new', label: tr('presets.mode_new') }]} />
    </Field>}
    {untyped ? null : d.mode === 'new'
      ? <Field group label={tr('presets.type')}>
        <Segmented<ArticleType> value={d.type} onChange={(t) => setEditing({ ...d, type: t })} options={ARTICLE_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label }))} />
      </Field>
      : <Field group label={tr('presets.types')} hint={tr('presets.types_hint')}>
        <div className="flex flex-wrap gap-1.5">{ARTICLE_TYPES.map((t) => <button key={t} type="button" onClick={() => toggleType(d, t)} className={cx('inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs', d.types.includes(t) ? 'border-primary/50 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:bg-accent')}>{d.types.includes(t) && <Check className="size-3.5" />}{TYPE_META[t].label}</button>)}</div>
      </Field>}
    <Field label={tr('presets.prompt')}>
      <textarea rows={4} value={d.prompt} onChange={(e) => setEditing({ ...d, prompt: e.target.value })} placeholder={d.mode === 'here' ? tr('presets.here_ph') : untyped ? tr('article.fork_ph') : tr(`article.rewrite_ph_${d.type}`)} className={cx(inputCls, 'py-2')} />
    </Field>
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{tr('common.cancel')}</Button><Button size="sm" disabled={busy || !d.prompt.trim()} onClick={save}><Check />{tr('common.save')}</Button></div>
  </div>

  const icon = 'cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground'
  const modeTag = (label: string) => <span className="mt-0.5 inline-flex shrink-0 items-center rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{label}</span>
  const badge = (p: Preset) => p.mode === 'here' ? modeTag(tr('presets.mode_here')) : untyped ? modeTag(tr('presets.mode_new')) : <TypeBadge type={p.type} className="mt-0.5" />
  return <Dialog open={open} onClose={onClose} title={tr('article.presets_manage')} width={600} footer={<Button size="sm" variant="outline" onClick={onClose}>{tr('common.close')}</Button>}>
    <div className="space-y-2">
      {!presets.length && !editing && <p className="text-sm text-muted-foreground">{tr('article.presets_none')}</p>}
      {presets.map((p) => editing?.preset?.key === p.key ? <div key={p.key}>{form(editing)}</div>
        : <div key={p.key} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
          {badge(p)}
          <div className="min-w-0 flex-1">
            {p.name && <div className="text-sm font-medium">{p.name}{p.builtin && <span className="ml-2 text-xs font-normal text-muted-foreground">{p.changed ? tr('presets.builtin_changed') : tr('presets.builtin_tag')}</span>}</div>}
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{p.prompt}</div>
          </div>
          {p.changed && <button type="button" disabled={busy} onClick={() => reset(p)} aria-label={tr('presets.reset')} title={tr('presets.reset')} className={icon}><RotateCcw className="size-3.5" /></button>}
          <button type="button" disabled={busy} onClick={() => setEditing({ preset: p, mode: p.mode, type: p.type, types: p.types, name: p.name, prompt: p.prompt })} aria-label={tr('article.preset_edit')} title={tr('article.preset_edit')} className={icon}><Pencil className="size-3.5" /></button>
          <button type="button" disabled={busy} onClick={() => remove(p)} aria-label={tr('article.preset_delete')} title={tr('article.preset_delete')} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button>
        </div>)}
      {editing && !editing.preset ? form(editing) : <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ mode: here ? 'here' : 'new', type: 'post', types: [], name: '', prompt: '' })}><Plus />{tr('article.preset_new')}</Button>}
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  </Dialog>
}
