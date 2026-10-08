import { useEffect, useState } from 'react'
import { Bookmark, Check, Loader2, Pencil, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { ARTICLE_TYPES, TYPE_META, TypeBadge, TypePicker, typeOf, type ArticleType } from './ArticleTypes'
import { Button, Dialog, Field, Notice, Segmented, cx, inputCls } from './ui'
import { tr } from '../lib/i18n'
import { dbCreate, dbDelete, dbList, dbPatch, type Article, type RewritePreset } from '../lib/shuttle'

/** 任务 id（tasks/rewrite-article.md）：把一篇文章改写成选的类型，另存一篇新的 */
export const REWRITE_TASK = 'rewrite-article'

const byCreated = (l: RewritePreset[]) => l.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))

/**
 * 改写：选改成哪种类型、写这次的要求，交给助手另写一篇（原文不动）。
 * 常用的要求存成「改写预设」（rewrite_presets 表：类型 + 要求）：这里只挑（点一下类型和要求都填好），改、删、加在「管理预设」弹窗里。
 */
export default function RewriteDialog({ open, article, starting, error, onClose, onStart }: { open: boolean; article: Article; starting: boolean; error: string; onClose: () => void; onStart: (type: ArticleType, note: string) => void }) {
  const from = typeOf(article)
  const [type, setType] = useState<ArticleType>(from === 'article' ? 'post' : 'article')
  const [note, setNote] = useState('')
  const [presets, setPresets] = useState<RewritePreset[] | null>(null)
  const [managing, setManaging] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = () => dbList('rewrite_presets').then((l) => setPresets(byCreated(l))).catch((e) => { setPresets([]); setErr((e as Error).message) })
  useEffect(() => { if (open) { setType(from === 'article' ? 'post' : 'article'); setNote(''); setMsg(''); setErr(''); void load() } }, [open])

  // 当前选中的预设：要求还是它的原文、类型也没换。改了要求或类型就不算选中了
  const picked = (presets ?? []).find((p) => p.type === type && p.prompt.trim() === note.trim())
  const usePreset = (p: RewritePreset) => { setType(p.type); setNote(p.prompt); setMsg('') }
  const savePreset = async () => {
    setErr(''); setMsg('')
    try {
      const t = new Date().toISOString()
      await dbCreate('rewrite_presets', { type, prompt: note.trim(), created_at: t, updated_at: t })
      await load()
      setMsg(tr('article.preset_saved'))
    } catch (e) { setErr((e as Error).message) }
  }

  return <Dialog open={open} onClose={onClose} title={tr('article.rewrite_title')} width={640} footer={<>
    <Button variant="ghost" onClick={onClose}>{tr('common.cancel')}</Button>
    <Button needsShuttle onClick={() => onStart(type, note.trim())} disabled={starting}>{starting ? <Loader2 className="animate-spin" /> : <Sparkles />}{tr('article.rewrite_go', { type: TYPE_META[type].label })}</Button>
  </>}>
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{tr('article.rewrite_hint', { title: article.title })}</p>
      {/* 先挑预设：点一下类型和要求都填好；没有合适的再自己选类型、写要求 */}
      <div role="group" className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm leading-none font-medium">{tr('article.presets')}</span>
          <button type="button" onClick={() => setManaging(true)} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Settings2 className="size-3.5" />{tr('article.presets_manage')}</button>
        </div>
        {presets === null ? <span className="text-xs text-muted-foreground">…</span> : !presets.length ? <span className="text-xs leading-relaxed text-muted-foreground">{tr('article.presets_empty')}</span>
          : <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">{presets.map((p) => {
            const on = picked?.id === p.id
            const Icon = TYPE_META[p.type]?.icon
            return <button key={p.id} type="button" onClick={() => usePreset(p)} title={`${TYPE_META[p.type]?.label} · ${p.prompt}`}
              className={cx('inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs', on ? 'border-primary/50 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}>
              {on ? <Check className="size-3.5 shrink-0" /> : Icon && <Icon className="size-3.5 shrink-0" />}<span className="max-w-60 truncate">{p.prompt}</span>
            </button>
          })}</div>}
      </div>
      <Field group label={tr('article.rewrite_to')}><TypePicker value={type} onChange={(t) => { if (picked) setNote(''); setType(t) }} exclude={from} /></Field>
      {/* 改写要求选填：不填就按目标类型的常规写法改（tasks/rewrite-article.md） */}
      <Field label={tr('article.rewrite_note')} hint={tr('article.rewrite_note_hint')}>
        <textarea value={note} onChange={(e) => { setNote(e.target.value); setMsg('') }} rows={4} className={cx(inputCls, 'py-2')} placeholder={tr(`article.rewrite_ph_${type}`)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!note.trim() || !!picked} onClick={savePreset}><Bookmark />{picked ? tr('article.preset_exists') : tr('article.preset_save', { type: TYPE_META[type].label })}</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
      {(err || error) && <Notice tone="error">{err || error}</Notice>}
    </div>
    <PresetsDialog open={managing} presets={presets ?? []} onClose={() => setManaging(false)} onChanged={load} />
  </Dialog>
}

type Draft = { id: string; type: ArticleType; prompt: string }

/** 管理改写预设：列出全部，每条能改类型和要求、删除；也能新建一条 */
function PresetsDialog({ open, presets, onClose, onChanged }: { open: boolean; presets: RewritePreset[]; onClose: () => void; onChanged: () => Promise<unknown> }) {
  // 正在改的那条；id 为空是新建
  const [editing, setEditing] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setEditing(null); setErr('') } }, [open])
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await f(); await onChanged(); return true } catch (e) { setErr((e as Error).message); return false } finally { setBusy(false) }
  }
  const save = () => editing && run(async () => {
    const t = new Date().toISOString()
    if (editing.id) await dbPatch('rewrite_presets', editing.id, { type: editing.type, prompt: editing.prompt.trim(), updated_at: t })
    else await dbCreate('rewrite_presets', { type: editing.type, prompt: editing.prompt.trim(), created_at: t, updated_at: t })
  }).then((ok) => { if (ok) setEditing(null) })

  const form = (d: Draft) => <div className="space-y-3 rounded-lg border border-primary/40 p-3">
    <Field group label={tr('article.rewrite_to')}>
      <Segmented<ArticleType> value={d.type} onChange={(t) => setEditing({ ...d, type: t })} options={ARTICLE_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label }))} />
    </Field>
    <Field label={tr('article.preset_prompt')}>
      <textarea autoFocus rows={3} value={d.prompt} onChange={(e) => setEditing({ ...d, prompt: e.target.value })} placeholder={tr(`article.rewrite_ph_${d.type}`)} className={cx(inputCls, 'py-2')} />
    </Field>
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{tr('common.cancel')}</Button><Button size="sm" disabled={busy || !d.prompt.trim()} onClick={save}><Check />{tr('common.save')}</Button></div>
  </div>

  return <Dialog open={open} onClose={onClose} title={tr('article.presets_manage')} width={600} footer={<Button size="sm" variant="outline" onClick={onClose}>{tr('common.close')}</Button>}>
    <div className="space-y-2">
      {!presets.length && !editing && <p className="text-sm text-muted-foreground">{tr('article.presets_none')}</p>}
      {presets.map((p) => editing?.id === p.id ? <div key={p.id}>{form(editing)}</div>
        : <div key={p.id} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
          <TypeBadge type={p.type} className="mt-0.5" />
          <span className="min-w-0 flex-1 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{p.prompt}</span>
          <button type="button" disabled={busy} onClick={() => setEditing({ id: p.id, type: p.type, prompt: p.prompt })} aria-label={tr('article.preset_edit')} title={tr('article.preset_edit')} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Pencil className="size-3.5" /></button>
          <button type="button" disabled={busy} onClick={() => run(() => dbDelete('rewrite_presets', p.id))} aria-label={tr('article.preset_delete')} title={tr('article.preset_delete')} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button>
        </div>)}
      {editing && !editing.id ? form(editing) : <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ id: '', type: 'post', prompt: '' })}><Plus />{tr('article.preset_new')}</Button>}
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  </Dialog>
}
