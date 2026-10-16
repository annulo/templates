import { useEffect, useRef, useState } from 'react'
import { ArrowRightLeft, Bookmark, Copy, Loader2, Sparkles, Wand2 } from 'lucide-react'
import { TYPE_META, TypePicker, typeOf, type ArticleType } from './ArticleTypes'
import { PresetChips, PresetsDialog, pickedPreset, savePreset, usePresets } from './Presets'
import { Button, Dialog, Field, Notice, Segmented, cx, inputCls } from './ui'
import { tr } from '../lib/i18n'
import { fitsType, type Preset, type PresetMode } from '../lib/presets'
import type { Article } from '../lib/shuttle'

/** 任务 id（tasks/rewrite-article.md）：把一篇文章改写成选的类型，另存一篇新的 */
export const REWRITE_TASK = 'rewrite-article'

/**
 * 交给 AI（docs/artifacts.md「交给 AI」），两种做法：
 *   在这篇上做（onWork，项目有「在这篇上做」的任务时才有）：写这篇的正文、做产物挂在这篇上，照 Prompt 做；
 *   另写一篇（onStart）：选改成哪种类型、写这次的要求，交给助手另写一篇（原文不动）。「转换」不经过 AI，只按类型换格式（onConvert）。
 * 常用的要求存成「AI 预设」（core/lib/presets.ts，模板也自带几条）：点一下就填好，改、删、加在「管理预设」里。
 */
export default function RewriteDialog({ open, article, starting, error, onClose, onStart, onConvert, onWork, initialMode, initialNote, initialPreset }: {
  open: boolean
  article: Article
  starting: boolean
  error: string
  onClose: () => void
  onStart: (type: ArticleType, note: string) => void
  onConvert: (type: ArticleType) => Promise<void>
  /** 在这篇上做：交给项目的「在这篇上做」任务，note 是这次的要求。不传就只有「另写一篇」 */
  onWork?: (note: string) => Promise<void>
  initialMode?: PresetMode
  initialNote?: string
  /** 打开时预先选上这条模板自带的预设（它的 builtin id，比如稿子的「AI 写成正文」是 from_draft） */
  initialPreset?: string
}) {
  const from = typeOf(article)
  const here = !!onWork
  const [mode, setMode] = useState<PresetMode>(here ? 'here' : 'new')
  const [type, setType] = useState<ArticleType>(from === 'article' ? 'post' : 'article')
  const [note, setNote] = useState('')
  const [managing, setManaging] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // 弹出来、换做法、点了预设后光标都在要求框里（放在末尾），直接就能写
  const box = useRef<HTMLTextAreaElement>(null)
  const focusBox = () => setTimeout(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }, 0)
  useEffect(() => { if (open) focusBox() }, [open])
  const { presets, error: loadErr, reload } = usePresets(open, here)
  const list = (presets ?? []).filter((p) => p.mode === mode && fitsType(p, from))
  useEffect(() => {
    if (!open) return
    setMode(initialMode ?? (here ? 'here' : 'new')); setType(from === 'article' ? 'post' : 'article'); setNote(initialNote ?? ''); setMsg(''); setErr('')
  }, [open])

  // 预先选的预设：读到列表后填进去（用户改过它就用改过的）
  useEffect(() => {
    if (!open || !initialPreset || !presets) return
    const p = presets.find((x) => x.builtin === initialPreset)
    if (p) { setMode(p.mode); setNote(p.prompt) }
  }, [open, initialPreset, !!presets])
  const picked = pickedPreset(presets, mode, type, note)
  const usePreset = (p: Preset) => { if (p.mode === 'new') setType(p.type); setNote(p.prompt); setMsg(''); focusBox() }
  const save = async () => {
    setErr(''); setMsg('')
    try { await savePreset(mode, mode === 'here' ? from : type, note); await reload(); setMsg(tr('article.preset_saved')) } catch (e) { setErr((e as Error).message) }
  }
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await f() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const working = starting || busy

  return <Dialog open={open} onClose={onClose} title={tr('article.ai_title')} width={640} footer={<>
    <Button variant="ghost" onClick={onClose}>{tr('common.cancel')}</Button>
    {mode === 'new' && <Button variant="outline" onClick={() => run(() => onConvert(type))} disabled={working} title={type === from ? undefined : tr('article.convert_hint')}>{type === from ? <Copy /> : <ArrowRightLeft />}{type === from ? tr('article.copy_go') : tr('article.convert_go')}</Button>}
    {mode === 'here'
      ? <Button needsShuttle onClick={() => run(() => onWork!(note.trim()))} disabled={working || !note.trim()}>{working ? <Loader2 className="animate-spin" /> : <Wand2 />}{tr('article.work_go')}</Button>
      : <Button needsShuttle onClick={() => onStart(type, note.trim())} disabled={working}>{working ? <Loader2 className="animate-spin" /> : <Sparkles />}{tr('article.rewrite_go', { type: TYPE_META[type].label })}</Button>}
  </>}>
    <div className="space-y-4">
      {here && <Segmented<PresetMode> value={mode} onChange={(m) => { setMode(m); setNote(''); setMsg(''); focusBox() }} options={[{ value: 'here', label: tr('presets.mode_here') }, { value: 'new', label: tr('presets.mode_new') }]} />}
      <p className="text-sm text-muted-foreground">{mode === 'here' ? tr('article.work_hint', { title: article.title }) : tr('article.rewrite_hint', { title: article.title })}</p>
      <PresetChips presets={list} picked={picked} onPick={usePreset} onManage={() => setManaging(true)} emptyText={tr('article.presets_empty')} />
      {mode === 'new' && <Field group label={tr('article.rewrite_to')}><TypePicker value={type} onChange={(t) => { if (picked) setNote(''); setType(t) }} /></Field>}
      <Field label={mode === 'here' ? tr('article.work_note') : tr('article.rewrite_note')} hint={mode === 'here' ? tr('article.work_note_hint') : tr('article.rewrite_note_hint')}>
        <textarea ref={box} value={note} onChange={(e) => { setNote(e.target.value); setMsg('') }} rows={mode === 'here' ? 5 : 4} className={cx(inputCls, 'py-2')} placeholder={mode === 'here' ? tr('presets.here_ph') : tr(`article.rewrite_ph_${type}`)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!note.trim() || !!picked} onClick={save}><Bookmark />{picked ? tr('article.preset_exists') : mode === 'here' ? tr('article.preset_save_here') : tr('article.preset_save', { type: TYPE_META[type].label })}</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
      {(err || error || loadErr) && <Notice tone="error">{err || error || loadErr}</Notice>}
    </div>
    <PresetsDialog open={managing} presets={presets ?? []} here={here} onClose={() => setManaging(false)} onChanged={reload} />
  </Dialog>
}
