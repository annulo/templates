import { useCallback, useEffect, useState } from 'react'
import { Check, Pencil, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import { ARTICLE_TYPES, TYPE_META, TypeBadge, type ArticleType } from './ArticleTypes'
import { Button, Dialog, Field, Notice, Segmented, cx, inputCls } from './ui'
import { tr } from '../lib/i18n'
import { mergePresets, presetLabel, type Preset, type PresetRow, type PresetTarget } from '../lib/presets'
import { dbCreate, dbDelete, dbList, dbPatch } from '../lib/shuttle'

/** 读 AI 预设（rewrite_presets 表 + 模板自带的），合成一个列表。video：项目能做视频时才有做视频的默认预设 */
export function usePresets(open: boolean, target: PresetTarget, video: boolean) {
  const [rows, setRows] = useState<PresetRow[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => dbList('rewrite_presets').then((l) => { setRows(l as PresetRow[]); setError('') }).catch((e) => { setRows([]); setError((e as Error).message) }), [])
  useEffect(() => { if (open) void load() }, [open, load])
  return { presets: rows ? mergePresets(rows, { target, video }) : null, error, reload: load }
}

/** 一排预设按钮：点一下把类型和要求填进去；当前选中的打勾 */
export function PresetChips({ presets, picked, onPick, onManage, emptyText }: { presets: Preset[] | null; picked?: Preset; onPick: (p: Preset) => void; onManage: () => void; emptyText: string }) {
  return <div role="group" className="grid gap-2">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm leading-none font-medium">{tr('article.presets')}</span>
      <button type="button" onClick={onManage} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Settings2 className="size-3.5" />{tr('article.presets_manage')}</button>
    </div>
    {presets === null ? <span className="text-xs text-muted-foreground">…</span> : !presets.length ? <span className="text-xs leading-relaxed text-muted-foreground">{emptyText}</span>
      : <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">{presets.map((p) => {
        const on = picked?.key === p.key
        const Icon = TYPE_META[p.type]?.icon
        return <button key={p.key} type="button" onClick={() => onPick(p)} title={`${TYPE_META[p.type]?.label} · ${p.prompt}`}
          className={cx('inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs', on ? 'border-primary/50 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}>
          {on ? <Check className="size-3.5 shrink-0" /> : Icon && <Icon className="size-3.5 shrink-0" />}<span className="max-w-60 truncate">{presetLabel(p)}</span>
        </button>
      })}</div>}
  </div>
}

/** 现在的要求是不是某个预设（类型和要求都没改过） */
export const pickedPreset = (presets: Preset[] | null, type: ArticleType, prompt: string) => (presets ?? []).find((p) => p.type === type && p.prompt.trim() === prompt.trim())

/** 把这次的要求存成一条预设 */
export async function savePreset(target: PresetTarget, type: ArticleType, prompt: string) {
  const t = new Date().toISOString()
  await dbCreate('rewrite_presets', { type, prompt: prompt.trim(), target, created_at: t, updated_at: t } as any)
}

type Draft = { preset?: Preset; type: ArticleType; name: string; prompt: string }

/**
 * 管理预设：列出这一类（target）的全部，每条能改名字、类型、要求，能删；模板自带的改过能「恢复默认」。
 * 视频版本的预设类型固定是视频，不给选。
 */
export function PresetsDialog({ open, target, presets, onClose, onChanged }: { open: boolean; target: PresetTarget; presets: Preset[]; onClose: () => void; onChanged: () => Promise<unknown> }) {
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
    const d = { type: editing.type, name: editing.name.trim(), prompt: editing.prompt.trim(), target, updated_at: now() }
    const p = editing.preset
    if (p?.row) await dbPatch('rewrite_presets', p.row.id, d as any)
    else await dbCreate('rewrite_presets', { ...d, ...(p?.builtin ? { builtin: p.builtin } : {}), created_at: now() } as any)
  }).then((ok) => { if (ok) setEditing(null) })
  // 删模板自带的：存一行 hidden 记下来（不然下次又出现）
  const remove = (p: Preset) => run(async () => {
    if (!p.builtin) return p.row && dbDelete('rewrite_presets', p.row.id)
    if (p.row) return dbPatch('rewrite_presets', p.row.id, { hidden: true, updated_at: now() } as any)
    return dbCreate('rewrite_presets', { type: p.type, prompt: p.prompt, target, builtin: p.builtin, hidden: true, created_at: now(), updated_at: now() } as any)
  })
  const reset = (p: Preset) => run(async () => p.row && dbDelete('rewrite_presets', p.row.id))

  const form = (d: Draft) => <div className="space-y-3 rounded-lg border border-primary/40 p-3">
    <Field label={tr('presets.name')} hint={tr('presets.name_hint')}>
      <input autoFocus value={d.name} onChange={(e) => setEditing({ ...d, name: e.target.value })} className={inputCls} />
    </Field>
    {target === 'article' && <Field group label={tr('presets.type')}>
      <Segmented<ArticleType> value={d.type} onChange={(t) => setEditing({ ...d, type: t })} options={ARTICLE_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label }))} />
    </Field>}
    <Field label={tr('presets.prompt')}>
      <textarea rows={4} value={d.prompt} onChange={(e) => setEditing({ ...d, prompt: e.target.value })} placeholder={target === 'video_version' ? tr('presets.revise_ph') : tr(`article.rewrite_ph_${d.type}`)} className={cx(inputCls, 'py-2')} />
    </Field>
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{tr('common.cancel')}</Button><Button size="sm" disabled={busy || !d.prompt.trim()} onClick={save}><Check />{tr('common.save')}</Button></div>
  </div>

  const icon = 'cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground'
  return <Dialog open={open} onClose={onClose} title={tr('article.presets_manage')} width={600} footer={<Button size="sm" variant="outline" onClick={onClose}>{tr('common.close')}</Button>}>
    <div className="space-y-2">
      {!presets.length && !editing && <p className="text-sm text-muted-foreground">{tr('article.presets_none')}</p>}
      {presets.map((p) => editing?.preset?.key === p.key ? <div key={p.key}>{form(editing)}</div>
        : <div key={p.key} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
          <TypeBadge type={p.type} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            {p.name && <div className="text-sm font-medium">{p.name}{p.builtin && <span className="ml-2 text-xs font-normal text-muted-foreground">{p.changed ? tr('presets.builtin_changed') : tr('presets.builtin_tag')}</span>}</div>}
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{p.prompt}</div>
          </div>
          {p.changed && <button type="button" disabled={busy} onClick={() => reset(p)} aria-label={tr('presets.reset')} title={tr('presets.reset')} className={icon}><RotateCcw className="size-3.5" /></button>}
          <button type="button" disabled={busy} onClick={() => setEditing({ preset: p, type: p.type, name: p.name, prompt: p.prompt })} aria-label={tr('article.preset_edit')} title={tr('article.preset_edit')} className={icon}><Pencil className="size-3.5" /></button>
          <button type="button" disabled={busy} onClick={() => remove(p)} aria-label={tr('article.preset_delete')} title={tr('article.preset_delete')} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button>
        </div>)}
      {editing && !editing.preset ? form(editing) : <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ type: target === 'video_version' ? 'video' : 'post', name: '', prompt: '' })}><Plus />{tr('article.preset_new')}</Button>}
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  </Dialog>
}
