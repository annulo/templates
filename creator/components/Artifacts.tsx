import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, MessageSquareText, Pencil, Trash2 } from 'lucide-react'
import { typeOf } from './ArticleTypes'
import { AssetPreview, FileActions } from './AssetPreview'
import { TaskRunning, useTaskRuns } from './Task'
import { Badge, Button, Notice, cx, fmtTime, inputCls } from './ui'
import type { VideoMaking } from './views/Content'
import { tr } from '../lib/i18n'
import { useTables } from '../lib/useTables'
import { mimeOf } from '../lib/files'
import { askInNewChat, dbDelete, dbList, dbPatch, deleteLocalFile, openChat, type Article, type Asset } from '../lib/shuttle'

// 产物（artifacts）：AI 给一篇文章做出来的东西（视频、图片、网页、音频…）就是资料库里的一条，带 article_id；文章页列出这篇的产物，最新的在前，
// 按类型（mime）显示（core/components/AssetPreview.tsx：网页用系统浏览器打开）。
// 「交给 AI → 做成视频」交给 tasks/make-video.md 照文档做一条新视频（新任务，新开对话）。要改就回到做它的那段对话接着说（「继续对话」），
// 每改一次存一个新的，不在页面上弹框收意见、不新开对话（AGENTS.md「接着改 AI 做出来的东西」）；那段对话找不到才新开一段。
// 每个产物有备注（assets.note），和资料库里显示的是同一条。存产物见 local/assets.ts。

const MAKE_TASK = 'make-video'

/** 交给内容中心（core/components/views/Content.tsx） */
export const videoMaking: VideoMaking = { task: MAKE_TASK, Panel: Artifacts }

function Artifacts({ article: a, all, onChanged }: { article: Article; all: Article[]; open: (id: string) => void; onChanged: () => void }) {
  const [list, setList] = useState<Asset[] | null>(null)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(false)
  const load = useCallback(() => {
    dbList('assets')
      .then((l) => { setList(l.filter((x) => x.article_id === a.id).sort((x, y) => String(y.created_at ?? '').localeCompare(String(x.created_at ?? '')))); setError('') })
      .catch((e) => { setList([]); setError((e as Error).message) })
  }, [a.id])
  const changed = () => { load(); onChanged() }
  // 照这篇文档正在做的视频（make-video 任务那一轮）
  const { runs } = useTaskRuns([MAKE_TASK], (r) => r.input?.article_id === a.id, changed)
  useEffect(load, [load])
  // 资料库变了（助手在对话里存了新产物、改了备注…）就重读：Annulo 写表就推 db:changed（能力版本 44）
  useTables(['assets'], load)

  const items = list ?? []
  if (!items.length) return runs.length ? <div className="mt-4"><TaskRunning runs={runs} title={() => tr('artifacts.making_from_doc')} desc={tr('artifacts.making_desc')} /></div> : null

  const current = items.find((x) => x.url && x.url === a.video)
  // 接着改：回到做发布用的那个的对话；它没记对话就用最近一个记了的
  const chat = current?.chat_id || items.find((x) => x.chat_id)?.chat_id
  // 找不到原来的对话：新开一段，先问要改什么（tasks/make-video.md 第 5 步）
  const askNew = async () => {
    setAsking(true); setError('')
    try {
      const r = await askInNewChat(tr('artifacts.ask_new_text', { title: a.title, id: a.id }), tr('artifacts.ask_new_title', { title: a.title }))
      openChat(r.chat_id)
    } catch (e) { setError((e as Error).message) } finally { setAsking(false) }
  }
  return (
    <section className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{tr('artifacts.title')}<span className="ml-1.5 text-sm font-normal text-muted-foreground">{items.length}</span></h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{chat ? tr('artifacts.continue_hint') : tr('artifacts.ask_new_hint')}</p>
        </div>
        {chat
          ? <Button size="sm" needsShuttle onClick={() => openChat(chat)}><MessageSquareText />{tr('artifacts.continue')}</Button>
          : <Button size="sm" variant="outline" needsShuttle disabled={asking} onClick={askNew}>{asking ? <Loader2 className="animate-spin" /> : <MessageSquareText />}{tr('artifacts.ask_new')}</Button>}
      </div>
      <TaskRunning runs={runs} title={() => tr('artifacts.making_from_doc')} desc={tr('artifacts.making_desc')} />
      {error && <Notice tone="error">{error}</Notice>}
      {items.map((x) => <ArtifactCard key={x.id} x={x} article={a} articles={all} current={x === current} onChanged={changed} />)}
    </section>
  )
}

function ArtifactCard({ x, article, articles, current, onChanged }: { x: Asset; article: Article; articles: Article[]; current: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(x.note ?? '')
  const [full, setFull] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await f(); onChanged(); return true } catch (e) { setErr((e as Error).message); return false } finally { setBusy(false) }
  }
  const canUse = typeOf(article) === 'video' && mimeOf(x).startsWith('video/') && !current
  const use = () => act(() => dbPatch('articles', article.id, { video: x.url, updated_at: new Date().toISOString() }))
  const saveNote = () => act(() => dbPatch('assets', x.id, { note: note.trim() })).then((ok) => ok && setEditing(false))
  // 删一个产物：从资料库删掉；文件没有别处在用（别的文章、发布记录）就连本机文件一起删
  const remove = () => act(async () => {
    await dbDelete('assets', x.id)
    const posts = await dbList('social_posts').catch(() => [])
    if (articles.some((o) => o.video === x.url) || posts.some((p) => p.video === x.url)) return
    await deleteLocalFile(x.url)
  })
  return (
    <div className={cx('flex flex-col gap-4 rounded-xl border p-3 sm:flex-row', current ? 'border-primary/40 bg-primary/5' : 'border-border')}>
      <div className="w-full shrink-0 sm:w-56 [&>:first-child]:overflow-hidden [&>:first-child]:rounded-lg">
        <AssetPreview a={x} className="aspect-video" />
        <FileActions url={x.url} className="mt-1" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {current && <Badge tone="primary">{tr('artifacts.in_use')}</Badge>}
          <span className="text-xs text-muted-foreground">{fmtTime(x.created_at)}</span>
        </div>
        {editing ? (
          <div className="space-y-2">
            <textarea autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('artifacts.note_ph')} className={cx(inputCls, 'py-2 text-sm')} />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={saveNote}><Check />{tr('common.save')}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setNote(x.note ?? ''); setEditing(false) }}>{tr('common.cancel')}</Button>
            </div>
          </div>
        ) : x.note?.trim() ? (
          <div>
            <p className={cx('text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]', !full && 'line-clamp-4')}>{x.note}</p>
            {x.note.length > 160 && <button type="button" onClick={() => setFull((v) => !v)} className="cursor-pointer text-xs text-primary-text hover:underline">{full ? tr('artifacts.collapse') : tr('artifacts.expand')}</button>}
          </div>
        ) : <p className="text-sm text-muted-foreground">{tr('artifacts.no_note')}</p>}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {canUse && <Button size="sm" variant="outline" disabled={busy} onClick={use}><Check />{tr('artifacts.use')}</Button>}
          {!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil />{tr('artifacts.edit_note')}</Button>}
          {x.chat_id && <Button size="sm" variant="ghost" onClick={() => openChat(x.chat_id!)}><MessageSquareText />{tr('artifacts.open_chat')}</Button>}
          <Button size="sm" variant="ghost" disabled={busy || current} title={current ? tr('artifacts.del_in_use') : undefined}
            onClick={() => (confirmDel ? remove() : setConfirmDel(true))} className="text-muted-foreground hover:text-destructive"><Trash2 />{confirmDel ? tr('artifacts.del_confirm') : tr('artifacts.del')}</Button>
        </div>
        {err && <Notice tone="error">{err}</Notice>}
      </div>
    </div>
  )
}
