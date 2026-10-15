import { useCallback, useEffect, useState } from 'react'
import { Check, Clapperboard, FileText, Loader2, MessageSquareText, Trash2 } from 'lucide-react'
import { typeOf } from './ArticleTypes'
import { TaskRunning, useTaskRuns } from './Task'
import { Badge, Button, Notice, cx, fmtTime } from './ui'
import type { VideoMaking } from './views/Content'
import { tr } from '../lib/i18n'
import { askInNewChat, dbDelete, dbList, dbPatch, deleteLocalFile, openChat, videoSrc, type Article, type VideoVersion } from '../lib/shuttle'

// 做视频：「交给 AI → 做成视频」交给 tasks/make-video.md 照文档做一条新视频（新任务，新开对话）；视频文章页列出它的各个版本（video_versions）。
// 要改就回到做它的那段对话接着说（「继续对话」），每改一次存一个新版本，不在页面上弹框收意见、不新开对话（AGENTS.md「接着改 AI 做出来的东西」）。
// 那段对话找不到（老数据）时才新开一段，按 tasks/revise-video.md 先问要改什么。版本、成片怎么存见 local/video.ts。

const MAKE_TASK = 'make-video'

/** 交给内容中心（core/components/views/Content.tsx） */
export const videoMaking: VideoMaking = { task: MAKE_TASK, Panel: VideoPanel }

function VideoPanel({ article: a, all, onChanged }: { article: Article; all: Article[]; open: (id: string) => void; onChanged: () => void }) {
  const isVideo = typeOf(a) === 'video'
  const [list, setList] = useState<VideoVersion[] | null>(null)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(false)
  const load = useCallback(() => {
    if (!isVideo) return
    dbList('video_versions')
      .then((l) => { setList(l.filter((v) => v.article_id === a.id).sort((x, y) => (Number(y.n) || 0) - (Number(x.n) || 0))); setError('') })
      .catch((e) => { setList([]); setError((e as Error).message) })
  }, [a.id, isVideo])
  const finished = () => { load(); onChanged() }
  // 照这篇文档正在做的视频（make-video 任务那一轮）
  const { runs } = useTaskRuns([MAKE_TASK], (r) => r.input?.article_id === a.id, finished)
  useEffect(load, [load, a.updated_at])
  // 有版本在做（任务那一轮，或者在对话里接着改）时常看看：video.start 一开始就建了「制作中」的那一版
  const making = (list ?? []).some((v) => v.status === 'making')
  useEffect(() => {
    if (!runs.length && !making) return
    const t = window.setInterval(finished, 5000)
    return () => clearInterval(t)
  }, [runs.length, making, load])

  if (!isVideo) return <div className="mt-4"><TaskRunning runs={runs} title={() => tr('video.making_from_doc')} desc={tr('video.making_desc')} /></div>

  const current = (list ?? []).find((v) => v.file && v.file === a.video)
  // 接着改：回到做当前版的对话；当前版没记对话就用最近一个记了的
  const chat = current?.chat_id || (list ?? []).find((v) => v.chat_id)?.chat_id
  // 找不到原来的对话：新开一段，先问要改什么（tasks/revise-video.md）
  const askNew = async () => {
    setAsking(true); setError('')
    try {
      const n = current?.n ?? list?.[0]?.n
      const r = await askInNewChat(tr('video.ask_new_text', { title: a.title, id: a.id, n: n ?? '?' }), tr('video.ask_new_title', { title: a.title }))
      openChat(r.chat_id)
    } catch (e) { setError((e as Error).message) } finally { setAsking(false) }
  }
  return (
    <section className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{tr('video.versions')}{list && list.length > 0 && <span className="ml-1.5 text-sm font-normal text-muted-foreground">{list.length}</span>}</h2>
          {list && list.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{chat ? tr('video.continue_hint') : tr('video.ask_new_hint')}</p>}
        </div>
        {list && list.length > 0 && (chat
          ? <Button size="sm" needsShuttle onClick={() => openChat(chat)}><MessageSquareText />{tr('video.continue')}</Button>
          : <Button size="sm" variant="outline" needsShuttle disabled={asking} onClick={askNew}>{asking ? <Loader2 className="animate-spin" /> : <MessageSquareText />}{tr('video.ask_new')}</Button>)}
      </div>
      <TaskRunning runs={runs} title={() => tr('video.making_version')} desc={tr('video.making_desc')} />
      {error && <Notice tone="error">{error}</Notice>}
      {list && !list.length && !runs.length && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{tr('video.empty')}</p>}
      {list?.map((v) => <VersionCard key={v.id} v={v} all={list} article={a} articles={all} current={!!v.file && v.file === a.video} onChanged={finished} />)}
    </section>
  )
}

function VersionCard({ v, all, article, articles, current, onChanged }: { v: VideoVersion; all: VideoVersion[]; article: Article; articles: Article[]; current: boolean; onChanged: () => void }) {
  const [showDoc, setShowDoc] = useState(false)
  // 要求、说明默认收成几行，长的点「展开」看全
  const [full, setFull] = useState(false)
  const long = (v.prompt?.length ?? 0) > 120 || (v.notes?.length ?? 0) > 80
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const parent = v.parent_id ? all.find((x) => x.id === v.parent_id) : undefined
  // 「制作中」超过一小时还没好：那次没做完（对话被停了、出错了没记下）
  const stalled = v.status === 'making' && Date.now() - (Date.parse(v.created_at || '') || 0) > 3600_000
  const status = stalled ? 'stalled' : v.status ?? 'making'
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
          : status === 'making'
            // 正在做：说清楚是 AI 在做、能去看过程，不要只有一个转圈（像加载不出来）
            ? <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 text-center">
              <Clapperboard className="size-5 animate-pulse text-primary-text" />
              <span className="text-xs font-medium text-primary-text">{tr('video.making_n', { n: v.n ?? '?' })}</span>
              {v.chat_id && <button type="button" onClick={() => openChat(v.chat_id!)} className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{tr('video.watch')}</button>}
            </div>
            : <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-muted-foreground"><Clapperboard className="size-5" /></div>}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{tr('video.version_n', { n: v.n ?? '?' })}</span>
          {current && <Badge tone="primary">{tr('video.current')}</Badge>}
          {status === 'making' && <Badge tone="primary"><Loader2 className="size-3 animate-spin" />{tr('video.s_making')}</Badge>}
          {status === 'failed' && <Badge tone="bad">{tr('video.s_failed')}</Badge>}
          {status === 'stalled' && <Badge tone="bad">{tr('video.s_stalled')}</Badge>}
          <span className="text-xs text-muted-foreground">{fmtTime(v.finished_at || v.created_at)}</span>
          {parent && <span className="text-xs text-muted-foreground">{tr('video.based_on', { n: parent.n ?? '?' })}</span>}
          {v.duration ? <span className="text-xs text-muted-foreground">{tr('video.seconds', { n: Math.round(v.duration) })}{v.width && v.height ? ` · ${v.width}×${v.height}` : ''}</span> : null}
        </div>
        <p className={cx('text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]', !full && 'line-clamp-3')}>{v.prompt?.trim() || <span className="text-muted-foreground">{tr('video.no_prompt')}</span>}</p>
        {v.notes && <p className={cx('text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]', !full && 'line-clamp-2')}>{v.notes}</p>}
        {long && <button type="button" onClick={() => setFull((x) => !x)} className="cursor-pointer text-xs text-primary-text hover:underline">{full ? tr('video.collapse') : tr('video.expand')}</button>}
        {(status === 'failed' || status === 'stalled') && <p className="text-xs text-destructive">{v.error || tr('video.stalled_hint')}</p>}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {status === 'done' && !current && <Button size="sm" variant="outline" disabled={busy} onClick={setCurrent}><Check />{tr('video.set_current')}</Button>}
          {v.chat_id && <Button size="sm" variant="ghost" onClick={() => openChat(v.chat_id!)}><MessageSquareText />{tr('video.open_chat')}</Button>}
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
