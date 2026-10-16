import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { MessageSquareText, ChevronDown, ChevronLeft, ChevronRight, File, FileText, Film, Folder as FolderIcon, FolderOpen, FolderPlus, ExternalLink, FilePlus, Image as ImageIcon, LayoutGrid, ListTree, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import RichEditor from './RichEditor'
import { Button, Notice, Segmented, cx, inputCls } from './ui'
import { filesOf } from '../lib/files'
import { isEn, useT } from '../lib/i18n'
import { askInNewChat, composeInChat, dbList, openChat, runLocal, type Article } from '../lib/shuttle'
import { refOf } from '../lib/refs'
import { TaskRunning, useTaskRuns } from './Task'

// 内容文件夹（docs/content-model.md）：一条内容的稿子、脚本、文案、视频都是它文件夹里的文件，可以分目录。
// 文件夹在项目的工作目录里（本机 ~/Annulo/<项目名>/内容/<名字>），读写走本机函数 local/folder.ts（Annulo 的 ctx.fs），
// 图片、视频直接用 /_annulo/work-files/<路径> 显示。默认网格（所有文件铺平），可以切成树；文本在页面里改，md 用富文本编辑器。
// 打开时还没有文件夹就建一个，老文章的稿子、正文、配图、视频、产物搬进去（表里的留着不动）。
// AI 在对话里改文件不经过表，没有推送：看得见时每 4 秒重读。发布在 FolderPublish.tsx：挑这次发成什么、用哪些文件。

export type Entry = { path: string; dir: boolean; size: number; mtime: number }
type Call = <T>(fn: string, input?: Record<string, unknown>) => Promise<T>

export const TEXT = /\.(md|markdown|txt|json|ya?ml|csv|srt|vtt|html?|css|tsx?|jsx?|py|sh)$/i
export const VIDEO = /\.(mp4|mov|webm|m4v)$/i
export const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i
export const MD = /\.(md|markdown)$/i
/** 稿子：最外层的 稿子.md（英文界面建的是 brief.md） */
export const isDraft = (p: string) => p === '稿子.md' || p === 'brief.md'

export const base = (p: string) => p.split('/').pop() ?? p
export const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const fmtSize = (n: number) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
/** 工作目录里的文件给 <img>、<video> 的地址（Annulo 能力版本 46） */
export const workSrc = (p: string) => '/_shuttle/work-files/' + p.split('/').map(encodeURIComponent).join('/')

function iconOf(e: Entry, open: boolean) {
  if (e.dir) return open ? FolderOpen : FolderIcon
  if (VIDEO.test(e.path)) return Film
  if (IMAGE.test(e.path)) return ImageIcon
  if (TEXT.test(e.path)) return FileText
  return File
}

export default function Folder({ article: a, onChanged }: { article: Article; onChanged: () => void }) {
  const { t } = useT('folder')
  const id = a.id
  const [state, setState] = useState<{ dir: string; path: string; entries: Entry[]; can_open?: boolean } | null>(null)
  const [error, setError] = useState('')
  const [sel, setSel] = useState('')
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({})
  // 默认网格，可以切成树；记在这台电脑上
  const [view, setView] = useState<'grid' | 'tree'>(() => { try { return localStorage.getItem('folder:view') === 'tree' ? 'tree' : 'grid' } catch { return 'grid' } })
  const switchView = (v: 'grid' | 'tree') => { setView(v); try { localStorage.setItem('folder:view', v) } catch {} }
  const [creating, setCreating] = useState(false)
  const call: Call = (fn, input = {}) => runLocal(`folder.${fn}`, { article_id: id, ...input })

  // 继续对话：回到改这条内容的那段对话（folder.create / write 记的 chat_id）；没有就用老产物上记的；都没有新开一段
  const [assetChat, setAssetChat] = useState('')
  useEffect(() => {
    dbList('assets').then((l) => {
      const mine = (l as unknown as { article_id?: string; chat_id?: string; created_at?: string }[]).filter((x) => x.article_id === id && x.chat_id).sort((x, y) => String(y.created_at ?? '').localeCompare(String(x.created_at ?? '')))
      setAssetChat(mine[0]?.chat_id ?? '')
    }).catch(() => {})
  }, [id])
  const chat = String((a as Article & { chat_id?: string }).chat_id ?? '') || assetChat
  const [asking, setAsking] = useState(false)
  const continueChat = async () => {
    if (chat) { openChat(chat); return }
    // 还没有对话：新开一段，输入框里放这条内容的引用，用户说要改什么再发
    if (composeInChat(`${refOf('articles', id)} `)) return
    setAsking(true)
    try { const r = await askInNewChat(t('ask_prompt', { ref: refOf('articles', id), title: a.title }), t('ask_title', { title: a.title })); openChat(r.chat_id) } catch (e) { setError((e as Error).message) } finally { setAsking(false) }
  }
  const { runs } = useTaskRuns(['work-on-content', 'work-on-article'], (r) => r.input?.article_id === id, () => { void load(); onChanged() })

  const load = useCallback(async () => {
    try { setState(await runLocal('folder.list', { article_id: id })); setError('') } catch (e) { setError((e as Error).message) }
  }, [id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!state || state.dir || creating) return
    setCreating(true)
    void (async () => {
      try { await call('create'); await moveOld(a, call); await load(); onChanged() } catch (e) { setError((e as Error).message) } finally { setCreating(false) }
    })()
  }, [state])
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 4000)
    return () => clearInterval(timer)
  }, [load])

  const entries = state?.entries ?? []
  const children = useMemo(() => {
    const m: Record<string, Entry[]> = {}
    for (const e of entries) (m[parent(e.path)] ??= []).push(e)
    for (const k in m) m[k].sort((x, y) => Number(y.dir) - Number(x.dir) || x.path.localeCompare(y.path, 'zh'))
    return m
  }, [entries])
  const isOpen = (p: string) => openDirs[p] ?? true
  const selected = entries.find((e) => e.path === sel)
  // 网格：不分目录，所有文件铺平；稿子排第一，其余最近改的在前
  const files = useMemo(() => entries.filter((e) => !e.dir).sort((x, y) => Number(isDraft(y.path)) - Number(isDraft(x.path)) || y.mtime - x.mtime), [entries])
  // 只有一个文件：直接打开它
  const only = files.length === 1 ? files[0].path : ''
  useEffect(() => { if (only && !sel) setSel(only) }, [only, sel])
  // 新建的位置：选中的是目录就建在里面，是文件就建在它旁边
  const here = selected ? (selected.dir ? selected.path : parent(selected.path)) : ''

  const [adding, setAdding] = useState<'file' | 'dir' | null>(null)
  const [newName, setNewName] = useState('')
  const startAdd = (k: 'file' | 'dir') => { setAdding(k); setNewName(k === 'file' ? t('new_file_default') : '') }
  const add = async () => {
    const name = newName.trim()
    if (!name || !adding) return
    const p = here ? `${here}/${name}` : name
    setError('')
    try { await call(adding === 'file' ? 'write' : 'mkdir', adding === 'file' ? { path: p, text: '' } : { path: p }); await load(); setSel(p); setAdding(null) } catch (e) { setError((e as Error).message) }
  }

  if (!state || !state.dir) {
    return (
      <section className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        {error ? <Notice tone="error">{error}</Notice> : <><Loader2 className="size-4 animate-spin" />{t('preparing')}</>}
      </section>
    )
  }
  const viewer = (e: Entry) => <Viewer key={e.path + e.mtime} root={state.path} canOpen={!!state.can_open} e={e} kids={children[e.path] ?? []} call={call} reload={load} onSelect={setSel} />

  const row = (e: Entry, depth: number) => {
    const Icon = iconOf(e, isOpen(e.path))
    return (
      <div key={e.path}>
        <div className={cx('flex items-center gap-1 rounded-md pr-1 text-sm', sel === e.path ? 'bg-primary/10 text-primary-text' : 'hover:bg-muted')} style={{ paddingLeft: 4 + depth * 14 }}>
          <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 text-left" onClick={() => { setSel(e.path); if (e.dir) setOpenDirs((o) => ({ ...o, [e.path]: !isOpen(e.path) })) }}>
            {e.dir ? (isOpen(e.path) ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />) : <span className="w-3.5 shrink-0" />}
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{base(e.path)}</span>
          </button>
        </div>
        {e.dir && isOpen(e.path) && (children[e.path] ?? []).map((k) => row(k, depth + 1))}
      </div>
    )
  }

  return (
    <section className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          {/* 路径只在本机版显示：服务端部署是服务器上的目录，用户用不上 */}
          {state.can_open && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={state.dir}>{state.dir.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)/, '~')}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" needsShuttle disabled={asking} onClick={() => void continueChat()} title={chat ? t('continue_hint') : t('ask_hint')}>{asking ? <Loader2 className="animate-spin" /> : <MessageSquareText />}{chat ? t('continue') : t('ask')}</Button>
          <Button size="sm" variant="outline" onClick={() => startAdd('file')}><FilePlus />{t('new_file')}</Button>
          {view === 'tree' && <Button size="sm" variant="outline" onClick={() => startAdd('dir')}><FolderPlus />{t('new_dir')}</Button>}
          {state.can_open && <Button size="sm" variant="ghost" onClick={() => void call('open', {}).catch((e) => setError((e as Error).message))}><FolderOpen />{t('open_folder')}</Button>}
          <Button size="sm" variant="ghost" onClick={() => void load()} aria-label={t('refresh')} title={t('refresh')}><RefreshCw /></Button>
          <div className="flex rounded-md border border-border p-0.5">
            <button type="button" title={t('view_grid')} aria-pressed={view === 'grid'} onClick={() => switchView('grid')} className={cx('cursor-pointer rounded p-1', view === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}><LayoutGrid className="size-4" /></button>
            <button type="button" title={t('view_tree')} aria-pressed={view === 'tree'} onClick={() => switchView('tree')} className={cx('cursor-pointer rounded p-1', view === 'tree' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}><ListTree className="size-4" /></button>
          </div>
        </div>
      </div>
      <TaskRunning runs={runs} title={() => t('running')} desc={t('running_desc')} />
      {adding && (
        <form className="flex flex-wrap items-center gap-1.5" onSubmit={(ev) => { ev.preventDefault(); void add() }}>
          <span className="text-sm text-muted-foreground">{t(adding === 'file' ? 'new_file_in' : 'new_dir_in', { where: here ? t('in_dir', { dir: here }) : t('in_root') })}</span>
          <input autoFocus value={newName} placeholder={adding === 'file' ? (view === 'grid' ? t('new_file_ph_grid') : t('new_file_ph')) : t('new_dir_ph')} onChange={(ev) => setNewName(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Escape') setAdding(null) }} className={cx(inputCls, 'h-8 w-64')} />
          <Button size="sm" type="submit" disabled={!newName.trim()}>{t('create')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>{t('cancel')}</Button>
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {view === 'grid' ? (
        <div className="min-h-[360px] overflow-hidden rounded-lg border border-border">
          {selected && !selected.dir
            ? <>
                {files.length > 1 && <div className="border-b border-border bg-muted/30 px-2 py-1.5"><button type="button" onClick={() => setSel('')} className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-sm hover:bg-muted"><ChevronLeft className="size-4" />{t('all_files')}</button></div>}
                {viewer(selected)}
              </>
            : files.length ? <Grid root={state.path} files={files} onSelect={setSel} /> : <p className="p-4 text-sm text-muted-foreground">{t('empty_grid')}</p>}
        </div>
      ) : (
        <div className="grid min-h-[360px] grid-cols-1 overflow-hidden rounded-lg border border-border md:grid-cols-[240px_1fr]">
          <div className="max-h-[640px] overflow-auto border-b border-border p-1.5 md:border-r md:border-b-0">
            {entries.length ? (children[''] ?? []).map((e) => row(e, 0)) : <p className="p-3 text-xs text-muted-foreground">{t('empty_tree')}</p>}
          </div>
          <div className="min-w-0">{selected ? viewer(selected) : <p className="p-4 text-sm text-muted-foreground">{t('pick_one')}</p>}</div>
        </div>
      )}
    </section>
  )
}

/** 一个文件或目录：上面一排是名字（双击改名）和操作，下面按类型看 / 改 */
function Viewer({ root, canOpen, e, kids, call, reload, onSelect }: { root: string; canOpen: boolean; e: Entry; kids: Entry[]; call: Call; reload: () => Promise<void>; onSelect: (p: string) => void }) {
  const { t } = useT('folder')
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const run = async (f: () => Promise<unknown>) => {
    setError('')
    try { await f() } catch (err) { setError((err as Error).message) }
  }
  const rename = (name: string) => run(async () => {
    setRenaming(false)
    const n = name.trim()
    const to = parent(e.path) ? `${parent(e.path)}/${n}` : n
    if (!n || to === e.path) return
    await call('rename', { path: e.path, to }); onSelect(to); await reload()
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {renaming
            ? <RenameInput value={base(e.path)} onDone={(v) => void rename(v)} onCancel={() => setRenaming(false)} />
            : <span className="min-w-0 cursor-text truncate rounded px-1 text-sm font-medium hover:bg-muted" title={t('rename_hint')} onDoubleClick={() => setRenaming(true)}>{e.path}</span>}
          {!e.dir && <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(e.size)}</span>}
        </div>
        {/* 服务端部署（canOpen 是 false）：用户不在服务器前面，「打开」在新标签页打开预览地址，没有「在文件夹中显示」 */}
        {!e.dir && <Button size="sm" variant="ghost" onClick={() => (canOpen ? void run(() => call('open', { path: e.path })) : void window.open(workSrc(`${root}/${e.path}`), '_blank'))}><ExternalLink />{t('open')}</Button>}
        {canOpen && <Button size="sm" variant="ghost" onClick={() => void run(() => call('open', { path: e.path, reveal: true }))}><FolderOpen />{t('reveal')}</Button>}
        <Button size="sm" variant="ghost" className="text-destructive" onMouseLeave={() => setConfirmDel(false)} onClick={() => { if (!confirmDel) { setConfirmDel(true); return } void run(async () => { await call('remove', { path: e.path }); onSelect(''); await reload() }) }}><Trash2 />{confirmDel ? t('delete_confirm') : t('delete')}</Button>
      </div>
      {error && <div className="p-3"><Notice tone="error">{error}</Notice></div>}
      <div className="min-h-0 flex-1">
        {e.dir ? <DirView kids={kids} onSelect={onSelect} />
          : TEXT.test(e.path) ? <TextEditor root={root} path={e.path} call={call} reload={reload} />
          : VIDEO.test(e.path) || IMAGE.test(e.path) ? <MediaView src={workSrc(`${root}/${e.path}`)} video={VIDEO.test(e.path)} />
          : <p className="p-4 text-sm text-muted-foreground">{t('cant_view')}</p>}
      </div>
    </div>
  )
}

/** 原地改名的输入框：回车、失焦就存，Esc 取消；文件名默认选中扩展名前面那段 */
export function RenameInput({ value, onDone, onCancel, className }: { value: string; onDone: (v: string) => void; onCancel: () => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : value.length)
  }, [])
  const finish = (v: string | null) => { if (done.current) return; done.current = true; if (v === null) onCancel(); else onDone(v) }
  return (
    <input ref={ref} defaultValue={value} onBlur={(ev) => finish(ev.target.value)}
      onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); finish(ev.currentTarget.value) } if (ev.key === 'Escape') finish(null) }}
      className={cx(inputCls, 'h-8 min-w-0 flex-1', className)} />
  )
}

/** 老文章搬进文件夹：稿子 → 稿子.md，正文 → 文案.md（title、tags 头），配图 → 配图/，视频 → 根目录，产物 → 产物/<名字>/。只搬本机文件（local:） */
async function moveOld(a: Article, call: Call) {
  const x = a as Article & { body?: string; tags?: string; images?: string; video?: string; draft?: string }
  const en = isEn()
  const ext = (u: string) => u.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? ''
  const put = (url: string, to: string) => (url.startsWith('local:') ? call('importLocal', { url, to }).catch(() => {}) : Promise.resolve())
  const has = (html: string) => !!html.replace(/<[^>]*>/g, '').trim() || /<(img|video)\b/i.test(html)
  const m = await import('../lib/mdhtml')
  const draft = String(x.draft ?? '')
  if (has(draft)) await call('write', { path: en ? 'brief.md' : '稿子.md', text: m.htmlToMd(draft) })
  const body = String(x.body ?? '')
  if (has(body)) {
    let tags: string[] = []
    try { tags = JSON.parse(x.tags || '[]') } catch {}
    const text = /<[a-z][^>]*>/i.test(body) ? m.htmlToMd(body) : body.trim() + '\n'
    await call('write', { path: en ? 'copy.md' : '文案.md', text: `---\ntitle: ${a.title ?? ''}\ntags: ${tags.join(', ')}\n---\n\n${text}` })
  }
  let imgs: string[] = []
  try { imgs = JSON.parse(x.images || '[]') } catch {}
  for (const [i, u] of imgs.entries()) await put(u, `${en ? 'images' : '配图'}/${i + 1}${ext(u)}`)
  if (x.video) await put(x.video, `${en ? 'video' : '视频'}${ext(x.video)}`)
  const assets = (await dbList('assets')) as unknown as { id: string; article_id?: string; name?: string; title?: string; files?: string; url?: string; mime?: string }[]
  for (const s of assets.filter((y) => y.article_id === a.id)) {
    const dir = `${en ? 'artifacts' : '产物'}/${String(s.title || s.name || s.id).replace(/[\/\\:*?"<>|]/g, ' ').trim().slice(0, 40)}`
    for (const [i, f] of filesOf(s).entries()) await put(f.url, `${dir}/${f.name ? f.name.replace(/[\/\\]/g, ' ') : String(i + 1)}${f.name && ext(f.name) ? '' : ext(f.url)}`)
  }
}

/** 网格：所有文件铺平，图片、视频显示缩略图，名字下面写在哪个目录里；点开看或改 */
function Grid({ root, files, onSelect }: { root: string; files: Entry[]; onSelect: (p: string) => void }) {
  const { t } = useT('folder')
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3 p-3">
      {files.map((k) => {
        const Icon = iconOf(k, false)
        const src = workSrc(`${root}/${k.path}`)
        return (
          <button key={k.path} type="button" onClick={() => onSelect(k.path)} title={k.path} className="flex cursor-pointer flex-col gap-1.5 rounded-lg p-1.5 text-left hover:bg-muted">
            <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
              {VIDEO.test(k.path)
                ? <div className="relative size-full"><video src={`${src}?v=${k.mtime}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" /><Film className="absolute right-1.5 bottom-1.5 size-4 text-white drop-shadow" /></div>
                : IMAGE.test(k.path) ? <img src={`${src}?v=${k.mtime}`} alt="" loading="lazy" className="size-full object-cover" />
                : <Icon className="size-10 text-muted-foreground" strokeWidth={1.25} />}
            </div>
            <div className="min-w-0 px-0.5">
              <div className="truncate text-sm">{base(k.path)}{isDraft(k.path) && <span className="ml-1.5 rounded bg-primary/10 px-1 py-px text-[10px] text-primary-text">{t('draft_badge')}</span>}</div>
              <div className="truncate text-[11px] text-muted-foreground">{parent(k.path) ? `${parent(k.path)} · ` : ''}{fmtSize(k.size)}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function DirView({ kids, onSelect }: { kids: Entry[]; onSelect: (p: string) => void }) {
  const { t } = useT('folder')
  return (
    <div className="space-y-2 p-4 text-sm">
      {kids.length ? kids.map((k) => { const I = iconOf(k, false); return <button key={k.path} type="button" onClick={() => onSelect(k.path)} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted"><I className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{base(k.path)}</span>{!k.dir && <span className="text-xs text-muted-foreground">{fmtSize(k.size)}</span>}</button> }) : <p className="text-muted-foreground">{t('empty_dir')}</p>}
    </div>
  )
}

/** 文本文件：md 默认用富文本编辑器改（存回去还是 md），能切到「源码」；别的文本是等宽文本框。切换和保存在同一排 */
type Bar = { dirty: boolean; saving: boolean; save: () => void }
function TextEditor({ root, path, call, reload }: { root: string; path: string; call: Call; reload: () => Promise<void> }) {
  const { t } = useT('folder')
  const [raw, setRaw] = useState(!MD.test(path))
  const [bar, setBar] = useState<Bar>({ dirty: false, saving: false, save: () => {} })
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-2">
        {MD.test(path) && <div title={bar.dirty ? t('save_first') : undefined} className={cx(bar.dirty && 'pointer-events-none opacity-50')}>
          <Segmented value={raw ? 'raw' : 'rich'} onChange={(v) => setRaw(v === 'raw')} options={[{ value: 'rich', label: t('rich') }, { value: 'raw', label: t('source') }]} />
        </div>}
        <div className="ml-auto flex items-center gap-2">
          {bar.dirty && <span className="text-xs text-muted-foreground">{t('unsaved')}</span>}
          <Button size="sm" disabled={!bar.dirty || bar.saving} onClick={bar.save}>{bar.saving ? <Loader2 className="animate-spin" /> : null}{t('save')}</Button>
        </div>
      </div>
      {raw ? <RawText key="raw" path={path} call={call} reload={reload} onBar={setBar} /> : <RichMd key="rich" root={root} path={path} call={call} reload={reload} onBar={setBar} />}
    </div>
  )
}

/** 编辑器把「改没改、在不在存、怎么存」交给上面那排按钮 */
function useBar(onBar: (b: Bar) => void, dirty: boolean, saving: boolean, save: () => Promise<void>) {
  const ref = useRef(save)
  ref.current = save
  useEffect(() => onBar({ dirty, saving, save: () => void ref.current() }), [dirty, saving])
}

const saveKey = (ev: KeyboardEvent, save: () => Promise<void>) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); void save() } }

function RawText({ path, call, reload, onBar }: { path: string; call: Call; reload: () => Promise<void>; onBar: (b: Bar) => void }) {
  const [text, setText] = useState<string | null>(null)
  const [savedText, setSavedText] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    call<{ text: string }>('read', { path }).then((r) => { setText(r.text); setSavedText(r.text) }).catch((e) => setError((e as Error).message))
  }, [path])
  const dirty = text !== null && text !== savedText
  const save = async () => {
    if (text === null) return
    setSaving(true); setError('')
    try { await call('write', { path, text }); setSavedText(text); await reload() } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  useBar(onBar, dirty, saving, save)
  if (error) return <div className="p-3"><Notice tone="error">{error}</Notice></div>
  if (text === null) return <div className="p-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
  return <textarea value={text} onChange={(ev) => setText(ev.target.value)} onKeyDown={(ev) => saveKey(ev, save)} spellCheck={false} className="m-3 min-h-[480px] flex-1 resize-y rounded-md border border-border bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-primary/50" />
}

const isRelative = (src: string) => !!src && !/^(https?:|data:|local:|blob:|\/)/i.test(src)
export const joinPath = (dir: string, p: string) => {
  const out: string[] = []
  for (const x of (dir ? dir + '/' + p : p).split('/')) { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x) }
  return out.join('/')
}

/**
 * md 用富文本编辑器改：读进来 md → HTML，相对路径的图片、视频换成工作目录的预览地址；
 * 存的时候换回相对路径，编辑器里新插的本机文件（上传、从资料库选）复制进 md 旁边的「图」目录，再 HTML → md 写回去
 */
function RichMd({ root, path, call, reload, onBar }: { root: string; path: string; call: Call; reload: () => Promise<void>; onBar: (b: Bar) => void }) {
  const { t } = useT('folder')
  const [html, setHtml] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const back = useRef<Record<string, string>>({})
  // 编辑器加载时会把内容规范化一次（触发 onChange）：第一次拿到的当作没改过的样子
  const baseline = useRef<string | null>(null)
  const dir = parent(path)
  useEffect(() => {
    void (async () => {
      try {
        const m = await import('../lib/mdhtml')
        const { text } = await call<{ text: string }>('read', { path })
        setHtml(m.mapSrc(m.mdToHtml(text), (src) => {
          if (!isRelative(src)) return src
          // marked 会把地址编码（中文、空格），文件里存的是原样的路径
          const plain = decodeURI(src)
          const url = workSrc(`${root}/${joinPath(dir, plain)}`)
          back.current[url] = plain
          return url
        }))
      } catch (e) { setError((e as Error).message) }
    })()
  }, [path])
  const save = async () => {
    if (html === null) return
    setSaving(true); setError('')
    try {
      const m = await import('../lib/mdhtml')
      // 新插进来的本机文件：复制进 md 旁边的「图/」
      for (const src of new Set(m.srcsOf(html))) {
        if (!src.startsWith('local:') || back.current[src]) continue
        const to = `${t('images_dir')}/${src.slice(6)}`
        await call('importLocal', { url: src, to: joinPath(dir, to) })
        back.current[src] = to
      }
      await call('write', { path, text: m.htmlToMd(m.mapSrc(html, (s) => (back.current[s] ? back.current[s].replace(/ /g, '%20') : s))) })
      baseline.current = html
      setDirty(false)
      await reload()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  useBar(onBar, dirty, saving, save)
  if (error) return <div className="p-3"><Notice tone="error">{error}</Notice></div>
  if (html === null) return <div className="p-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
  return (
    <div className="p-3" onKeyDown={(ev) => saveKey(ev, save)}>
      <RichEditor value={html} placeholder={isDraft(path) ? t('draft_placeholder') : undefined} onChange={(h) => { setHtml(h); if (baseline.current === null) baseline.current = h; else setDirty(h !== baseline.current) }} />
    </div>
  )
}

function MediaView({ src, video }: { src: string; video: boolean }) {
  return <div className="flex justify-center bg-black/40 p-3">{video ? <video src={src} controls className="max-h-[520px] max-w-full rounded" /> : <img src={src} alt="" className="max-h-[520px] max-w-full rounded object-contain" />}</div>
}
