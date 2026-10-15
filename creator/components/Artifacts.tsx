import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, MessageSquareText, Pencil, Trash2 } from 'lucide-react'
import { typeOf } from './ArticleTypes'
import { AssetGroup, CopyRef } from './AssetPreview'
import Lightbox from './Lightbox'
import { TaskRunning, useTaskRuns } from './Task'
import { Badge, Button, Notice, cx, fmtTime, inputCls } from './ui'
import type { AIWork } from './views/Content'
import { tr } from '../lib/i18n'
import { deleteLocalFile, filesOf } from '../lib/files'
import { refOf } from '../lib/refs'
import { useTables } from '../lib/useTables'
import { parseList } from '../local/_types'
import { askInNewChat, dbDelete, dbList, dbPatch, openChat, type Article, type Asset } from '../lib/shuttle'

// 产物（artifacts，creator/docs/artifacts.md）：AI 在一篇文章上做出来的东西（一条视频、小红书的 6 张图、一个网页…）就是资料库里的一条，带 article_id，
// 可以是一组文件（files）。文章页列出这篇的产物，最新的在前；一组显示成当前这个 + 一排缩略图（core/components/AssetPreview.tsx）。
// 「交给 AI → 在这篇上做」交给 tasks/work-on-article.md（新任务，新开对话）。要改就回到做它的那段对话接着说（「继续对话」），
// 整组重做存新的、只改一个改原来那组（assets.replace），不在页面上弹框收意见（AGENTS.md「接着改 AI 做出来的东西」）；那段对话找不到才新开一段。
// 每个产物有备注（assets.note），和资料库里显示的是同一条。「用这个」按文章类型：视频是发布用这个，图文是用作配图。

const WORK_TASK = 'work-on-article'

/** 交给内容中心（core/components/views/Content.tsx） */
export const aiWork: AIWork = { task: WORK_TASK, Panel: Artifacts }

/** 这组用在这篇上了没有：视频文章的视频在组里；图文的配图就是组里的图（按顺序） */
function inUse(a: Article, x: Asset) {
  const files = filesOf(x)
  const t = typeOf(a)
  if (t === 'video') return !!a.video && files.some((f) => f.url === a.video)
  if (t === 'post') {
    const imgs = files.filter((f) => f.mime.startsWith('image/')).map((f) => f.url)
    return imgs.length > 0 && JSON.stringify(parseList(a.images)) === JSON.stringify(imgs)
  }
  return false
}

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
  // 这篇正在「在这篇上做」的（任务那一轮）
  const { runs } = useTaskRuns([WORK_TASK], (r) => r.input?.article_id === a.id, changed)
  useEffect(load, [load])
  // 资料库变了（助手在对话里存了新产物、改了备注…）就重读：Annulo 写表就推 db:changed（能力版本 44）
  useTables(['assets'], load)

  const items = list ?? []
  if (!items.length) return runs.length ? <div className="mt-4"><TaskRunning runs={runs} title={() => tr('artifacts.working')} desc={tr('artifacts.making_desc')} /></div> : null

  const current = items.find((x) => inUse(a, x))
  // 接着改：回到做正在用的那个的对话；没有就用最近一个记了对话的
  const chat = current?.chat_id || items.find((x) => x.chat_id)?.chat_id
  // 找不到原来的对话：新开一段，先问要改什么（tasks/work-on-article.md 第 5 步）
  const askNew = async () => {
    setAsking(true); setError('')
    try {
      const r = await askInNewChat(tr('artifacts.ask_new_text', { ref: refOf('articles', a.id), title: a.title }), tr('artifacts.ask_new_title', { title: a.title }))
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
      <TaskRunning runs={runs} title={() => tr('artifacts.working')} desc={tr('artifacts.making_desc')} />
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
  const [zoom, setZoom] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (!editing) setNote(x.note ?? '') }, [x.note])
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await f(); onChanged(); return true } catch (e) { setErr((e as Error).message); return false } finally { setBusy(false) }
  }
  const files = filesOf(x)
  const t = typeOf(article)
  const video = files.find((f) => f.mime.startsWith('video/'))
  const images = files.filter((f) => f.mime.startsWith('image/')).map((f) => f.url)
  // 用这个：视频文章取组里的视频；图文把组里的图按顺序换成配图
  const use = t === 'video' && video ? { label: tr('artifacts.use_video'), patch: { video: video.url } }
    : t === 'post' && images.length ? { label: tr('artifacts.use_images', { n: images.length }), patch: { images: JSON.stringify(images) } }
    : null
  const saveNote = () => act(() => dbPatch('assets', x.id, { note: note.trim() })).then((ok) => ok && setEditing(false))
  // 删一个产物：从资料库删掉；文件没有别处在用（别的文章、发布记录）就连本机文件一起删
  const remove = () => act(async () => {
    await dbDelete('assets', x.id)
    const posts = await dbList('social_posts').catch(() => [])
    const used = (u: string) => articles.some((o) => o.video === u || parseList(o.images).includes(u)) || posts.some((p) => p.video === u || parseList(p.images).includes(u))
    for (const f of files) if (!used(f.url)) await deleteLocalFile(f.url)
  })
  return (
    <div className={cx('flex flex-col gap-4 rounded-xl border p-3 sm:flex-row', current ? 'border-primary/40 bg-primary/5' : 'border-border')}>
      <div className="w-full shrink-0 sm:w-56">
        <AssetGroup a={x} table="assets" id={x.id} className="aspect-video overflow-hidden rounded-lg" onZoom={setZoom} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {current && <Badge tone="primary">{tr('artifacts.in_use')}</Badge>}
          {files.length > 1 && <span className="text-xs text-muted-foreground">{tr('artifacts.n_files', { n: files.length })}</span>}
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
          {use && !current && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => dbPatch('articles', article.id, { ...use.patch, updated_at: new Date().toISOString() }))}><Check />{use.label}</Button>}
          {!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil />{tr('artifacts.edit_note')}</Button>}
          {x.chat_id && <Button size="sm" variant="ghost" onClick={() => openChat(x.chat_id!)}><MessageSquareText />{tr('artifacts.open_chat')}</Button>}
          {files.length > 1 && <CopyRef refs={[refOf('assets', x.id)]} label={tr('artifacts.copy_ref_all')} className="h-8 px-2.5 text-sm" />}
          <Button size="sm" variant="ghost" disabled={busy || current} title={current ? tr('artifacts.del_in_use') : undefined}
            onClick={() => (confirmDel ? remove() : setConfirmDel(true))} className="text-muted-foreground hover:text-destructive"><Trash2 />{confirmDel ? tr('artifacts.del_confirm') : tr('artifacts.del')}</Button>
        </div>
        {err && <Notice tone="error">{err}</Notice>}
      </div>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom('')} />}
    </div>
  )
}
