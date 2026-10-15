import { useEffect, useState } from 'react'
import { ArrowRightLeft, Bookmark, Clapperboard, Copy, Loader2, Sparkles } from 'lucide-react'
import { TYPE_META, TypePicker, typeOf, type ArticleType } from './ArticleTypes'
import { PresetChips, PresetsDialog, pickedPreset, savePreset, usePresets } from './Presets'
import { Button, Dialog, Field, Notice, cx, inputCls } from './ui'
import { tr } from '../lib/i18n'
import type { Preset } from '../lib/presets'
import type { Article } from '../lib/shuttle'

/** 任务 id（tasks/rewrite-article.md）：把一篇文章改写成选的类型，另存一篇新的 */
export const REWRITE_TASK = 'rewrite-article'

/**
 * 交给 AI：选产出哪种类型、写这次的要求（Prompt），交给助手另做一篇（原文不动）。
 * 常用的要求存成「AI 预设」（core/lib/presets.ts：类型 + 要求，模板也自带几条）：这里点一下类型和要求都填好，改、删、加在「管理预设」弹窗里。
 * 「转换」不经过 AI，内容不动、只按类型换格式（onConvert，core/local/convert.ts）。
 * videoTask：项目能做视频（creator 的 tasks/make-video.md）时传，选视频就是真的做一条视频（onStart 由调用方交给那个任务），
 * 不传时改成视频只写标题和简介。
 */
export default function RewriteDialog({ open, article, starting, error, onClose, onStart, onConvert, videoTask }: { open: boolean; article: Article; starting: boolean; error: string; onClose: () => void; onStart: (type: ArticleType, note: string) => void; onConvert: (type: ArticleType) => Promise<void>; videoTask?: string }) {
  const from = typeOf(article)
  const video = !!videoTask
  const first: ArticleType = video && from !== 'video' ? 'video' : from === 'article' ? 'post' : 'article'
  const [type, setType] = useState<ArticleType>(first)
  const [note, setNote] = useState('')
  const [managing, setManaging] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [converting, setConverting] = useState(false)
  const { presets, error: loadErr, reload } = usePresets(open, 'article', video)
  const making = video && type === 'video'
  const convert = async () => {
    setConverting(true); setErr('')
    try { await onConvert(type) } catch (e) { setErr((e as Error).message) } finally { setConverting(false) }
  }
  useEffect(() => { if (open) { setType(first); setNote(''); setMsg(''); setErr('') } }, [open])
  // 打开时默认选上「做成视频」这类模板自带的预设，要求直接填好
  useEffect(() => {
    if (!open || note || !presets) return
    const def = presets.find((p) => p.builtin && p.type === type)
    if (def) setNote(def.prompt)
  }, [open, presets])

  const picked = pickedPreset(presets, type, note)
  const usePreset = (p: Preset) => { setType(p.type); setNote(p.prompt); setMsg('') }
  const save = async () => {
    setErr(''); setMsg('')
    try { await savePreset('article', type, note); await reload(); setMsg(tr('article.preset_saved')) } catch (e) { setErr((e as Error).message) }
  }

  return <Dialog open={open} onClose={onClose} title={tr('article.rewrite_title')} width={640} footer={<>
    <Button variant="ghost" onClick={onClose}>{tr('common.cancel')}</Button>
    {/* 同类型没有可转的，按钮就是「复制」；做视频没有「转换」 */}
    {!making && <Button variant="outline" onClick={convert} disabled={converting || starting} title={type === from ? undefined : tr('article.convert_hint')}>{converting ? <Loader2 className="animate-spin" /> : type === from ? <Copy /> : <ArrowRightLeft />}{type === from ? tr('article.copy_go') : tr('article.convert_go')}</Button>}
    <Button needsShuttle onClick={() => onStart(type, note.trim())} disabled={starting || converting}>{starting ? <Loader2 className="animate-spin" /> : making ? <Clapperboard /> : <Sparkles />}{making ? tr('article.make_video_go') : tr('article.rewrite_go', { type: TYPE_META[type].label })}</Button>
  </>}>
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{making ? tr('article.make_video_hint', { title: article.title }) : tr('article.rewrite_hint', { title: article.title })}</p>
      <PresetChips presets={presets} picked={picked} onPick={usePreset} onManage={() => setManaging(true)} emptyText={tr('article.presets_empty')} />
      <Field group label={tr('article.rewrite_to')}><TypePicker value={type} onChange={(t) => { if (picked) setNote(''); setType(t) }} exclude={video ? undefined : from} /></Field>
      {/* 要求选填：不填就按目标类型的常规写法改（tasks/rewrite-article.md）、按平台的常规做视频（tasks/make-video.md） */}
      <Field label={tr('article.rewrite_note')} hint={making ? tr('article.make_video_note_hint') : tr('article.rewrite_note_hint')}>
        <textarea value={note} onChange={(e) => { setNote(e.target.value); setMsg('') }} rows={making ? 6 : 4} className={cx(inputCls, 'py-2')} placeholder={making ? tr('article.make_video_ph') : tr(`article.rewrite_ph_${type}`)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!note.trim() || !!picked} onClick={save}><Bookmark />{picked ? tr('article.preset_exists') : tr('article.preset_save', { type: TYPE_META[type].label })}</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
      {(err || error || loadErr) && <Notice tone="error">{err || error || loadErr}</Notice>}
    </div>
    <PresetsDialog open={managing} target="article" presets={presets ?? []} onClose={() => setManaging(false)} onChanged={reload} />
  </Dialog>
}
