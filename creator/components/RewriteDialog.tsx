import { useEffect, useState } from 'react'
import { Bookmark, Check, Loader2, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { ARTICLE_TYPES, TYPE_META, TypeBadge, TypePicker, typeOf, type ArticleType } from './ArticleTypes'
import { Button, Dialog, Field, Notice, Segmented, cx, inputCls } from './ui'
import { tr } from '../lib/i18n'
import { dbCreate, dbDelete, dbList, dbPatch, type Article, type RewritePreset } from '../lib/shuttle'

/** 任务 id（tasks/rewrite-article.md）：把一篇文章改写成选的类型，另存一篇新的 */
export const REWRITE_TASK = 'rewrite-article'

/**
 * 改写：选改成哪种类型、写这次的要求，交给助手另写一篇（原文不动）。
 * 常用的要求存成「改写预设」（rewrite_presets 表：类型 + 要求），下次点一下就填好；预设能改、能删。
 */
export default function RewriteDialog({ open, article, starting, error, onClose, onStart }: { open: boolean; article: Article; starting: boolean; error: string; onClose: () => void; onStart: (type: ArticleType, note: string) => void }) {
  const from = typeOf(article)
  const [type, setType] = useState<ArticleType>(from === 'article' ? 'post' : 'article')
  const [note, setNote] = useState('')
  const [presets, setPresets] = useState<RewritePreset[] | null>(null)
  const [editing, setEditing] = useState<{ id: string; type: ArticleType; prompt: string } | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = () => dbList('rewrite_presets').then((l) => setPresets(l.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))))).catch((e) => { setPresets([]); setErr((e as Error).message) })
  useEffect(() => { if (open) { setType(from === 'article' ? 'post' : 'article'); setNote(''); setEditing(null); setMsg(''); setErr(''); void load() } }, [open])

  // 当前选中的预设：要求还是它的原文、类型也没换。改了要求或类型就不算选中了
  const picked = (presets ?? []).find((p) => p.type === type && p.prompt.trim() === note.trim())
  const saved = !!picked
  const usePreset = (p: RewritePreset) => { setType(p.type); setNote(p.prompt); setEditing(null); setMsg('') }
  const run = async (f: () => Promise<unknown>, done?: string) => {
    setErr(''); setMsg('')
    try { await f(); await load(); if (done) setMsg(done) } catch (e) { setErr((e as Error).message) }
  }
  const savePreset = () => run(() => { const t = new Date().toISOString(); return dbCreate('rewrite_presets', { type, prompt: note.trim(), created_at: t, updated_at: t }) }, tr('article.preset_saved'))
  const updatePreset = () => editing && run(async () => { await dbPatch('rewrite_presets', editing.id, { type: editing.type, prompt: editing.prompt.trim(), updated_at: new Date().toISOString() }); setEditing(null) })

  return <Dialog open={open} onClose={onClose} title={tr('article.rewrite_title')} width={640} footer={<>
    <Button variant="ghost" onClick={onClose}>{tr('common.cancel')}</Button>
    <Button needsShuttle onClick={() => onStart(type, note.trim())} disabled={starting || !note.trim()}>{starting ? <Loader2 className="animate-spin" /> : <Sparkles />}{tr('article.rewrite_go', { type: TYPE_META[type].label })}</Button>
  </>}>
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{tr('article.rewrite_hint', { title: article.title })}</p>
      {/* 先挑预设：点一下类型和要求都填好；没有合适的再自己选类型、写要求 */}
      <Field group label={tr('article.presets')} hint={tr('article.presets_hint')}>
        {presets === null ? <span className="text-xs text-muted-foreground">…</span> : !presets.length ? <span className="text-xs text-muted-foreground">{tr('article.presets_empty')}</span>
          : <div className="max-h-56 space-y-1.5 overflow-y-auto">{presets.map((p) => editing?.id === p.id
            ? <div key={p.id} className="space-y-2 rounded-lg border border-primary/40 p-2">
              <Segmented<ArticleType> value={editing.type} onChange={(t) => setEditing({ ...editing, type: t })} options={ARTICLE_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label }))} />
              <textarea autoFocus rows={3} value={editing.prompt} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} className={cx(inputCls, 'py-2')} />
              <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X />{tr('common.cancel')}</Button><Button size="sm" disabled={!editing.prompt.trim()} onClick={updatePreset}><Check />{tr('common.save')}</Button></div>
            </div>
            : <div key={p.id} className={cx('group flex items-start gap-2 rounded-lg border px-3 py-2', picked?.id === p.id ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-accent/50')}>
              <button type="button" onClick={() => usePreset(p)} className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left" title={tr('article.preset_use')}>
                <TypeBadge type={p.type} className="mt-0.5" />
                <span className="min-w-0 flex-1 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{p.prompt}</span>
                {picked?.id === p.id && <Check className="mt-0.5 size-4 shrink-0 text-primary-text" />}
              </button>
              <button type="button" onClick={() => setEditing({ id: p.id, type: p.type, prompt: p.prompt })} aria-label={tr('article.preset_edit')} title={tr('article.preset_edit')} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Pencil className="size-3.5" /></button>
              <button type="button" onClick={() => run(() => dbDelete('rewrite_presets', p.id))} aria-label={tr('article.preset_delete')} title={tr('article.preset_delete')} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button>
            </div>)}</div>}
      </Field>
      <Field group label={tr('article.rewrite_to')}><TypePicker value={type} onChange={(t) => { if (picked) setNote(''); setType(t); setEditing(null) }} exclude={from} /></Field>
      <Field label={tr('article.rewrite_note')} hint={tr('article.rewrite_note_hint')}>
        <textarea value={note} onChange={(e) => { setNote(e.target.value); setMsg('') }} rows={4} className={cx(inputCls, 'py-2')} placeholder={tr(`article.rewrite_ph_${type}`)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!note.trim() || saved} onClick={savePreset}><Bookmark />{saved ? tr('article.preset_exists') : tr('article.preset_save', { type: TYPE_META[type].label })}</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
      {(err || error) && <Notice tone="error">{err || error}</Notice>}
    </div>
  </Dialog>
}
