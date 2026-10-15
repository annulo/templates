import { useCallback, useEffect, useState } from 'react'
import { Bookmark, Check, Clapperboard, FileText, Loader2, MessageSquarePlus, Trash2 } from 'lucide-react'
import { typeOf } from './ArticleTypes'
import { PresetChips, PresetsDialog, pickedPreset, savePreset, usePresets } from './Presets'
import { TaskRunning, useTaskRuns } from './Task'
import { Badge, Button, Dialog, Field, Notice, cx, fmtTime, inputCls } from './ui'
import type { VideoMaking } from './views/Content'
import { tr } from '../lib/i18n'
import type { Preset } from '../lib/presets'
import { dbDelete, dbList, dbPatch, deleteLocalFile, openChat, runTask, videoSrc, type Article, type VideoVersion } from '../lib/shuttle'

// 做视频：「交给 AI → 做成视频」交给 tasks/make-video.md 照文档做一条新视频；视频文章页列出它的各个版本（video_versions），
// 在任意一版上「提修改意见」交给 tasks/revise-video.md 做一个新版本。版本、成片怎么存见 local/video.ts。

const MAKE_TASK = 'make-video'
const REVISE_TASK = 'revise-video'

/** 交给内容中心（core/components/views/Content.tsx） */
export const videoMaking: VideoMaking = { task: MAKE_TASK, Panel: VideoPanel }

function VideoPanel({ article: a, all, onChanged }: { article: Article; all: Article[]; open: (id: string) => void; onChanged: () => void }) {
  const isVideo = typeOf(a) === 'video'
  const [list, setList] = useState<VideoVersion[] | null>(null)
  const [error, setError] = useState('')
  const [revising, setRevising] = useState<VideoVersion | null | undefined>(undefined)
  const load = useCallback(() => {
    if (!isVideo) return
    dbList('video_versions')
      .then((l) => { setList(l.filter((v) => v.article_id === a.id).sort((x, y) => (Number(y.n) || 0) - (Number(x.n) || 0))); setError('') })
      .catch((e) => { setList([]); setError((e as Error).message) })
  }, [a.id, isVideo])
  const finished = () => { load(); onChanged() }
  // 照这篇文档在做的视频（make-video），或者这条视频在做的新版本（revise-video）
  const { runs } = useTaskRuns([MAKE_TASK, REVISE_TASK], (r) => r.input?.article_id === a.id, finished)
  useEffect(load, [load, a.updated_at])
  // 在做的时候常看看：video.start 一开始就建了「制作中」的那一版
  useEffect(() => {
    if (!runs.length) return
    const t = window.setInterval(load, 5000)
    return () => clearInterval(t)
  }, [runs.length, load])

  if (!isVideo) return <div className="mt-4"><TaskRunning runs={runs} title={() => tr('video.making_from_doc')} desc={tr('video.making_desc')} /></div>

  const done = (list ?? []).filter((v) => v.status === 'done' && v.file)
  const current = done.find((v) => v.file === a.video)
  const busy = runs.length > 0
  return (
    <section className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{tr('video.versions')}{list && list.length > 0 && <span className="ml-1.5 text-sm font-normal text-muted-foreground">{list.length}</span>}</h2>
        {done.length > 0
          ? <Button size="sm" needsShuttle disabled={busy} onClick={() => setRevising(current ?? done[0])}><MessageSquarePlus />{tr('video.revise')}</Button>
          : <Button size="sm" needsShuttle disabled={busy} onClick={() => setRevising(null)}><Clapperboard />{tr('video.make_first')}</Button>}
      </div>
      <TaskRunning runs={runs} title={() => tr('video.making_version')} desc={tr('video.making_desc')} />
      {error && <Notice tone="error">{error}</Notice>}
      {list && !list.length && !busy && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{tr('video.empty')}</p>}
      {list?.map((v) => <VersionCard key={v.id} v={v} all={list} article={a} articles={all} current={!!v.file && v.file === a.video} running={busy} onRevise={() => setRevising(v)} onChanged={finished} />)}
      <ReviseDialog open={revising !== undefined} base={revising ?? null} article={a} onClose={() => setRevising(undefined)} />
    </section>
  )
}

function VersionCard({ v, all, article, articles, current, running, onRevise, onChanged }: { v: VideoVersion; all: VideoVersion[]; article: Article; articles: Article[]; current: boolean; running: boolean; onRevise: () => void; onChanged: () => void }) {
  const [showDoc, setShowDoc] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const parent = v.parent_id ? all.find((x) => x.id === v.parent_id) : undefined
  // 「制作中」但已经没有在跑的任务：那次没做完（对话被停了、出错了没记下）
  const status = v.status === 'making' && !running ? 'stalled' : v.status ?? 'making'
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await f(); onChanged() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const setCurrent = () => act(() => dbPatch('articles', article.id, { video: v.file, updated_at: new Date().toISOString() }))
  // 删一个版本：成片没有别处在用（别的文章、发布记录）就连资料库里那条、本机文件一起删
  const remove = () => act(async () => {
    await dbDelete('video_versions', v.id)
    if (!v.file) return
    const posts = await dbList('social_posts').catch(() => [])
    if (articles.some((x) => x.video === v.file) || posts.some((p) => p.video === v.file)) return
    const assets = await dbList('assets').catch(() => [])
    for (const x of assets.filter((x) => x.url === v.file)) await dbDelete('assets', x.id)
    await deleteLocalFile(v.file)
  })
  const ratio = v.width && v.height ? `${v.width} / ${v.height}` : '16 / 9'
  return (
    <div className={cx('flex flex-col gap-4 rounded-xl border p-3 sm:flex-row', current ? 'border-primary/40 bg-primary/5' : 'border-border')}>
      <div className="w-full shrink-0 sm:w-56">
        {v.file && status === 'done'
          ? <video src={videoSrc(v.file)} controls preload="metadata" className="max-h-80 w-full rounded-lg bg-black object-contain" style={{ aspectRatio: ratio }} />
          : <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-muted-foreground">{status === 'making' ? <Loader2 className="size-5 animate-spin" /> : <Clapperboard className="size-5" />}</div>}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{tr('video.version_n', { n: v.n ?? '?' })}</span>
          {current && <Badge tone="primary">{tr('video.current')}</Badge>}
          {status === 'making' && <Badge tone="warn">{tr('video.s_making')}</Badge>}
          {status === 'failed' && <Badge tone="bad">{tr('video.s_failed')}</Badge>}
          {status === 'stalled' && <Badge tone="bad">{tr('video.s_stalled')}</Badge>}
          <span className="text-xs text-muted-foreground">{fmtTime(v.finished_at || v.created_at)}</span>
          {parent && <span className="text-xs text-muted-foreground">{tr('video.based_on', { n: parent.n ?? '?' })}</span>}
          {v.duration ? <span className="text-xs text-muted-foreground">{tr('video.seconds', { n: Math.round(v.duration) })}{v.width && v.height ? ` · ${v.width}×${v.height}` : ''}</span> : null}
        </div>
        <p className="line-clamp-3 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]" title={v.prompt}>{v.prompt?.trim() || <span className="text-muted-foreground">{tr('video.no_prompt')}</span>}</p>
        {v.notes && <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground" title={v.notes}>{v.notes}</p>}
        {(status === 'failed' || status === 'stalled') && <p className="text-xs text-destructive">{v.error || tr('video.stalled_hint')}</p>}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {status === 'done' && !current && <Button size="sm" variant="outline" disabled={busy} onClick={setCurrent}><Check />{tr('video.set_current')}</Button>}
          {status === 'done' && <Button size="sm" variant="outline" needsShuttle disabled={running} onClick={onRevise}><MessageSquarePlus />{tr('video.revise_this')}</Button>}
          {v.doc_snapshot && <Button size="sm" variant="ghost" onClick={() => setShowDoc((x) => !x)}><FileText />{showDoc ? tr('video.hide_doc') : tr('video.show_doc')}</Button>}
          <Button size="sm" variant="ghost" disabled={busy || current || status === 'making'} title={current ? tr('video.del_current') : undefined}
            onClick={() => (confirmDel ? remove() : setConfirmDel(true))} className="text-muted-foreground hover:text-destructive"><Trash2 />{confirmDel ? tr('video.del_confirm') : tr('video.del')}</Button>
        </div>
        {showDoc && <pre className="max-h-72 overflow-y-auto rounded-lg bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{v.doc_snapshot}</pre>}
        {err && <Notice tone="error">{err}</Notice>}
      </div>
    </div>
  )
}

/** 提修改意见：在 base 这一版上改（没有 base 是照文档做第一版），写一句意见或点一个预设，交给助手做新版本 */
function ReviseDialog({ open, base, article, onClose }: { open: boolean; base: VideoVersion | null; article: Article; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [managing, setManaging] = useState(false)
  const [starting, setStarting] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const { presets, error: loadErr, reload } = usePresets(open, 'video_version', true)
  useEffect(() => { if (open) { setNote(''); setMsg(''); setErr('') } }, [open])
  const picked = pickedPreset(presets, 'video', note)
  const start = async () => {
    setStarting(true); setErr('')
    try {
      const r = await runTask(REVISE_TASK, { article_id: article.id, ...(base ? { version_id: base.id } : {}), note: note.trim() })
      openChat(r.chat_id)
      onClose()
    } catch (e) { setErr((e as Error).message) } finally { setStarting(false) }
  }
  const save = async () => {
    setErr(''); setMsg('')
    try { await savePreset('video_version', 'video', note); await reload(); setMsg(tr('article.preset_saved')) } catch (e) { setErr((e as Error).message) }
  }
  return <Dialog open={open} onClose={onClose} width={600} title={base ? tr('video.revise_title', { n: base.n ?? '?' }) : tr('video.make_first')} footer={<>
    <Button variant="ghost" onClick={onClose}>{tr('common.cancel')}</Button>
    <Button needsShuttle onClick={start} disabled={starting}>{starting ? <Loader2 className="animate-spin" /> : <Clapperboard />}{base ? tr('video.revise_go') : tr('video.make_go')}</Button>
  </>}>
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{base ? tr('video.revise_hint', { n: base.n ?? '?' }) : tr('video.make_hint')}</p>
      {base && <PresetChips presets={presets} picked={picked} onPick={(p: Preset) => { setNote(p.prompt); setMsg('') }} onManage={() => setManaging(true)} emptyText={tr('video.presets_empty')} />}
      <Field label={base ? tr('video.revise_note') : tr('video.make_note')}>
        <textarea autoFocus value={note} onChange={(e) => { setNote(e.target.value); setMsg('') }} rows={5} className={cx(inputCls, 'py-2')} placeholder={base ? tr('presets.revise_ph') : tr('article.make_video_ph')} />
      </Field>
      {base && <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!note.trim() || !!picked} onClick={save}><Bookmark />{picked ? tr('article.preset_exists') : tr('video.preset_save')}</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>}
      {(err || loadErr) && <Notice tone="error">{err || loadErr}</Notice>}
    </div>
    <PresetsDialog open={managing} target="video_version" presets={presets ?? []} onClose={() => setManaging(false)} onChanged={reload} />
  </Dialog>
}
