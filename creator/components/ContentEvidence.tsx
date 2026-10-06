import { useState } from 'react'
import { Save, Sparkles } from 'lucide-react'
import { runLocal, type Topic, type WritingBrief } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { Button, Dialog, Field, Notice, inputCls } from './ui'
import type { Ctx } from './views/types'

const r = (key: string) => tr('brief.' + key)
const parse = <T,>(value: string | undefined, fallback: T): T => { try { return JSON.parse(value || '') } catch { return fallback } }

export function WritingBriefDialog({ ctx, topic, onClose, onChanged, onWrite }: { ctx: Ctx; topic: Topic; onClose: () => void; onChanged: () => void; onWrite: () => void }) {
  const [draft, setDraft] = useState({ title: topic.title, angle: topic.angle || '', keywords: topic.keywords || '' })
  const [brief, setBrief] = useState<WritingBrief>(() => parse(topic.brief, { language: '', channels: '', product_ids: [] }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const change = (key: keyof WritingBrief, value: string) => setBrief({ ...brief, [key]: value })
  const save = async (write = false) => {
    setBusy(true); setError('')
    try { await runLocal('content.saveBrief', { topic_id: topic.id, ...draft, brief }); onChanged(); onClose(); if (write) onWrite(); return true } catch (e) { setError((e as Error).message); return false } finally { setBusy(false) }
  }
  return <Dialog open onClose={() => !busy && onClose()} title={r('brief')} width={760} footer={<><Button variant="outline" disabled={busy} onClick={onClose}>{tr('common.cancel')}</Button><Button fn="content.saveBrief" variant="outline" disabled={busy || !draft.title.trim()} onClick={() => save()}><Save />{tr('common.save')}</Button><Button fn="content.saveBrief" needsShuttle disabled={busy || !draft.title.trim()} onClick={() => save(true)}><Sparkles />{r('save_and_write')}</Button></>}>
    <div className="space-y-4">{error && <Notice tone="error">{error}</Notice>}<div className="space-y-4">
      {(['title', 'angle', 'keywords'] as const).map((key) => <Field key={key} label={r('brief_' + key)}><input aria-label={r('brief_' + key)} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className={inputCls} /></Field>)}
      <div className="grid gap-4 sm:grid-cols-2">{(['audience', 'buyer_question'] as const).map((key) => <Field key={key} label={r('brief_' + key)}><textarea aria-label={r('brief_' + key)} rows={2} value={brief[key] || ''} onChange={(e) => change(key, e.target.value)} className={`${inputCls} py-2`} /></Field>)}</div>
      <Field label={r('brief_outline')}><textarea aria-label={r('brief_outline')} rows={5} value={brief.outline || ''} onChange={(e) => change('outline', e.target.value)} className={`${inputCls} py-2`} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">{(['language', 'channels'] as const).map((key) => <Field key={key} label={r('brief_' + key)}><input aria-label={r('brief_' + key)} value={brief[key] || ''} onChange={(e) => change(key, e.target.value)} className={inputCls} /></Field>)}</div>
      {(['cta', 'gaps'] as const).map((key) => <Field key={key} label={r('brief_' + key)} hint={key === 'gaps' ? r('gaps_hint') : undefined}><textarea aria-label={r('brief_' + key)} rows={2} value={brief[key] || ''} onChange={(e) => change(key, e.target.value)} className={`${inputCls} py-2`} /></Field>)}
    </div></div>
  </Dialog>
}
