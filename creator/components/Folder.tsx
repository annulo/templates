import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, File, FileText, Film, Folder as FolderIcon, FolderOpen, FolderPlus, ExternalLink, FilePlus, Eye, Image as ImageIcon, LayoutGrid, Pencil, ListTree, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import RichEditor from './RichEditor'
import { Button, Notice, Segmented, cx, inputCls } from './ui'
import { fileSrc, filesOf } from '../lib/files'
import { isEn, useT } from '../lib/i18n'
import { dbList, runLocal, type Article } from '../lib/shuttle'
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
  // 右键菜单（网格、树里的文件和文件夹）和就地改名
  const [menu, setMenu] = useState<{ e: Entry; x: number; y: number } | null>(null)
  // 树的左栏宽度：拖中间那条线调，记在这台电脑上
  const [treeW, setTreeW] = useState(() => { try { return Number(localStorage.getItem('folder:tree-w')) || 260 } catch { return 260 } })
  const dragTree = (ev: PointerEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const x0 = ev.clientX, w0 = treeW
    let w = w0
    const move = (m: globalThis.PointerEvent) => { w = Math.max(180, Math.min(560, w0 + m.clientX - x0)); setTreeW(w) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); try { localStorage.setItem('folder:tree-w', String(w)) } catch {} }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const [renaming, setRenaming] = useState('')
  const call: Call = (fn, input = {}) => runLocal(`folder.${fn}`, { article_id: id, ...input })

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
  const onMenu = (ev: MouseEvent, e: Entry) => { ev.preventDefault(); setMenu({ e, x: ev.clientX, y: ev.clientY }) }
  const act = (f: () => Promise<unknown>) => { void f().then(() => load()).catch((err) => setError((err as Error).message)) }
  const renameTo = (e: Entry, name: string) => {
    setRenaming('')
    const n = name.trim()
    const to = parent(e.path) ? `${parent(e.path)}/${n}` : n
    if (!n || to === e.path) return
    act(async () => { await call('rename', { path: e.path, to }); if (sel === e.path || sel.startsWith(e.path + '/')) setSel(to + sel.slice(e.path.length)) })
  }
  const nameOf = (e: Entry, className?: string, lines?: 1 | 2) => renaming === e.path
    ? <RenameInput value={base(e.path)} onDone={(v) => renameTo(e, v)} onCancel={() => setRenaming('')} className={className} />
    : <span className="flex min-w-0 flex-1"><MidName text={base(e.path)} lines={lines} /></span>
  const viewer = (e: Entry) => <Viewer key={e.path} root={state.path} canOpen={!!state.can_open} e={e} kids={children[e.path] ?? []} call={call} reload={load} onSelect={setSel} />

  const row = (e: Entry, depth: number) => {
    const Icon = iconOf(e, isOpen(e.path))
    return (
      <div key={e.path}>
        <div onContextMenu={(ev) => onMenu(ev, e)} className={cx('flex items-center gap-1 rounded-md pr-1 text-sm', sel === e.path || menu?.e.path === e.path ? 'bg-primary/10 text-primary-text' : 'hover:bg-muted')} style={{ paddingLeft: 4 + depth * 12 }}>
          {/* 改名时不能是 button：输入框放在 button 里，按空格会点到按钮 */}
          {renaming === e.path ? <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1"><span className="w-3.5 shrink-0" />{nameOf(e, 'h-6')}</div> : <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 text-left" onClick={() => { setSel(e.path); if (e.dir) setOpenDirs((o) => ({ ...o, [e.path]: !isOpen(e.path) })) }}>
            {e.dir ? (isOpen(e.path) ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />) : <span className="w-3.5 shrink-0" />}
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            {nameOf(e, 'h-6')}
          </button>}
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
        <div className="min-h-[360px] overflow-clip rounded-lg border border-border">
          {selected
            ? <>
                {/* 面包屑：全部文件 / 目录 / 目录，点哪一级回到哪一级（目录显示里面的东西）；文件名在下面看文件的那一栏 */}
                {(files.length > 1 || parent(selected.path)) && <div className="flex min-w-0 flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5 text-sm">
                  <button type="button" onClick={() => setSel('')} className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"><ChevronLeft className="size-4" />{t('all_files')}</button>
                  {crumbs(selected.dir ? selected.path : parent(selected.path)).map((c) => <span key={c} className="flex min-w-0 items-center gap-0.5"><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /><button type="button" onClick={() => setSel(c)} className={cx('max-w-48 cursor-pointer truncate rounded px-1.5 py-0.5 hover:bg-muted', c === selected.path && 'font-medium')}>{base(c)}</button></span>)}
                </div>}
                {viewer(selected)}
              </>
            : files.length ? <Grid root={state.path} files={files} onSelect={setSel} onMenu={onMenu} active={menu?.e.path} renaming={renaming} nameOf={nameOf} /> : <p className="p-4 text-sm text-muted-foreground">{t('empty_grid')}</p>}
        </div>
      ) : (
        <div className="grid min-h-[360px] grid-cols-1 overflow-clip rounded-lg border border-border md:grid-cols-[var(--tree-w)_1fr]" style={{ '--tree-w': `${treeW}px` } as CSSProperties}>
          <div className="relative max-h-[640px] overflow-auto border-b border-border p-1.5 md:border-r md:border-b-0">
            <div onPointerDown={dragTree} title={t('drag_width')} className="absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize hover:bg-primary/30 md:block" />
            {entries.length ? (children[''] ?? []).map((e) => row(e, 0)) : <p className="p-3 text-xs text-muted-foreground">{t('empty_tree')}</p>}
          </div>
          <div className="min-w-0">{selected ? viewer(selected) : <p className="p-4 text-sm text-muted-foreground">{t('pick_one')}</p>}</div>
        </div>
      )}
      {menu && <FileMenu e={menu.e} x={menu.x} y={menu.y} canOpen={!!state.can_open} onClose={() => setMenu(null)}
        onOpen={() => setSel(menu.e.path)}
        onRename={() => setRenaming(menu.e.path)}
        onSystemOpen={() => act(() => call('open', { path: menu.e.path }))}
        onReveal={() => act(() => call('open', { path: menu.e.path, reveal: true }))}
        onDelete={() => act(async () => { await call('remove', { path: menu.e.path }); if (sel === menu.e.path || sel.startsWith(menu.e.path + '/')) setSel('') })} />}
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
            : <span className="min-w-0 cursor-text truncate rounded px-1 text-sm font-medium hover:bg-muted" title={t('rename_hint')} onDoubleClick={() => setRenaming(true)}>{base(e.path)}</span>}
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
          : TEXT.test(e.path) ? <TextEditor root={root} path={e.path} mtime={e.mtime} call={call} reload={reload} />
          : VIDEO.test(e.path) || IMAGE.test(e.path) ? <MediaView src={`${workSrc(`${root}/${e.path}`)}?v=${e.mtime}`} video={VIDEO.test(e.path)} />
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
/**
 * 放不下时省略中间、留住结尾（扩展名和它前面几个字，比如「问助手 5 秒（hyp…试看）.mp4」）：同名只差结尾的几个版本也分得清。
 * 按这一格的宽度量字（canvas measureText）：放得下就整个显示（lines=2 时最多两行，按字折行），放不下就从中间删字换成「…」。完整名字在 title 里
 */
function MidName({ text, lines = 1, keep = 4 }: { text: string; lines?: 1 | 2; keep?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(text)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const w = el.parentElement?.clientWidth ?? el.clientWidth
      if (!w) return
      const ctx = (MidName as unknown as { c?: CanvasRenderingContext2D }).c ??= document.createElement('canvas').getContext('2d')!
      ctx.font = getComputedStyle(el).font
      // 两行时按字折行，第二行行尾留一点余量
      const room = w * lines - (lines > 1 ? 8 : 2)
      if (ctx.measureText(text).width <= room) { setShown(text); return }
      const ext = text.match(/\.[^.\s]{1,8}$/)?.[0] ?? ''
      const tail = text.slice(-Math.min(text.length - 1, ext.length + keep))
      let lo = 0, hi = text.length - tail.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (ctx.measureText(text.slice(0, mid) + '…' + tail).width <= room) lo = mid
        else hi = mid - 1
      }
      setShown(text.slice(0, lo) + '…' + tail)
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [text, lines, keep])
  return <span ref={ref} title={text} className={cx('min-w-0', lines > 1 ? 'line-clamp-2 break-all' : 'truncate')}>{shown}</span>
}

function Grid({ root, files, onSelect, onMenu, active, renaming, nameOf }: { root: string; files: Entry[]; onSelect: (p: string) => void; onMenu: (ev: MouseEvent, e: Entry) => void; active?: string; renaming: string; nameOf: (e: Entry, className?: string, lines?: 1 | 2) => ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3 p-3">
      {files.map((k) => {
        const Icon = iconOf(k, false)
        const src = workSrc(`${root}/${k.path}`)
        // 改名时不能是 button：输入框放在 button 里，按空格会点到按钮
        const Tag = renaming === k.path ? 'div' : 'button'
        return (
          <Tag key={k.path} {...(Tag === 'button' ? { type: 'button' as const, onClick: () => onSelect(k.path) } : {})} onContextMenu={(ev: MouseEvent) => onMenu(ev, k)} title={k.path}
            className={cx('flex cursor-pointer flex-col gap-1.5 rounded-lg p-1.5 text-left hover:bg-muted', active === k.path && 'bg-muted')}>
            <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
              {VIDEO.test(k.path)
                ? <div className="relative size-full"><video src={`${src}?v=${k.mtime}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" /><Film className="absolute right-1.5 bottom-1.5 size-4 text-white drop-shadow" /></div>
                : IMAGE.test(k.path) ? <img src={`${src}?v=${k.mtime}`} alt="" loading="lazy" className="size-full object-cover" />
                : <Icon className="size-10 text-muted-foreground" strokeWidth={1.25} />}
            </div>
            <div className="min-w-0 px-0.5">
              <div className="flex text-sm leading-snug">{nameOf(k, 'h-7 text-sm', 2)}</div>
              <div className="flex text-[11px] text-muted-foreground"><span className="shrink-0">{fmtSize(k.size)}</span>{parent(k.path) && <><span className="shrink-0 px-1">·</span><span className="flex min-w-0 flex-1"><MidName text={parent(k.path)} keep={6} /></span></>}</div>
            </div>
          </Tag>
        )
      })}
    </div>
  )
}

/**
 * 文件、文件夹的右键菜单：打开、重命名、用系统程序打开、在文件夹中显示、删除（再点一次才删，进废纸篓）。
 * 点外面、按 Esc、滚动就收起；贴着鼠标出现，放不下就往左、往上挪
 */
function FileMenu({ e, x, y, canOpen, onClose, onOpen, onRename, onSystemOpen, onReveal, onDelete }: { e: Entry; x: number; y: number; canOpen: boolean; onClose: () => void; onOpen: () => void; onRename: () => void; onSystemOpen: () => void; onReveal: () => void; onDelete: () => void }) {
  const { t } = useT('folder')
  const ref = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState(false)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4)), top: Math.max(4, Math.min(y, window.innerHeight - el.offsetHeight - 4)) })
  }, [x, y])
  useEffect(() => {
    const away = (ev: Event) => { if (!ref.current?.contains(ev.target as Node)) onClose() }
    const esc = (ev: globalThis.KeyboardEvent) => { if (ev.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away, true)
    document.addEventListener('contextmenu', away, true)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('blur', onClose)
    return () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('contextmenu', away, true); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', onClose, true); window.removeEventListener('blur', onClose) }
  }, [])
  const item = (label: string, Icon: typeof File, run: () => void, danger?: boolean) => (
    <button type="button" onClick={() => { run(); onClose() }} className={cx('flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent', danger && 'text-destructive')}><Icon className="size-4 shrink-0" />{label}</button>
  )
  return (
    <div ref={ref} role="menu" style={pos} onContextMenu={(ev) => ev.preventDefault()} className="fixed z-50 min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
      {item(t('open'), e.dir ? FolderOpen : Eye, onOpen)}
      {item(t('rename'), Pencil, onRename)}
      {canOpen && !e.dir && item(t('open_system'), ExternalLink, onSystemOpen)}
      {canOpen && item(t('reveal'), FolderOpen, onReveal)}
      <div className="my-1 h-px bg-border" />
      {confirm
        ? item(t('delete_confirm'), Trash2, onDelete, true)
        : <button type="button" onClick={() => setConfirm(true)} className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent"><Trash2 className="size-4 shrink-0" />{t('delete')}</button>}
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

/**
 * 文本文件：md 默认用富文本编辑器改（存回去还是 md），能切到「源码」；别的文本是等宽文本框。切换和保存在同一排。
 * 编辑器只按路径挂载（保存不重新加载）；文件在别处改了（mtime 变了）由编辑器自己重读，见 useExternal
 */
type Bar = { dirty: boolean; saving: boolean; save: () => void }
function TextEditor({ root, path, mtime, call, reload }: { root: string; path: string; mtime: string | number; call: Call; reload: () => Promise<void> }) {
  const { t } = useT('folder')
  const [raw, setRaw] = useState(!MD.test(path))
  const [bar, setBar] = useState<Bar>({ dirty: false, saving: false, save: () => {} })
  // 「富文本 / 源码」和保存这排吸在页面顶栏下面（--page-top，内容页给的），编辑器的工具条再吸在这排下面（--sticky-top）。
  // 外面的框用 overflow-clip 不用 overflow-hidden：hidden 会让 sticky 失效
  const [barH, setBarH] = useState(0)
  const barObserver = useRef<ResizeObserver | null>(null)
  const barRef = useCallback((el: HTMLDivElement | null) => {
    barObserver.current?.disconnect()
    if (!el) return
    setBarH(el.offsetHeight)
    barObserver.current = new ResizeObserver(() => setBarH(el.offsetHeight))
    barObserver.current.observe(el)
  }, [])
  return (
    <div className="flex h-full flex-col" style={{ '--sticky-top': `calc(var(--page-top, 0px) + ${barH}px)` } as CSSProperties}>
      <div ref={barRef} className="sticky top-[var(--page-top,0px)] z-20 flex items-center gap-2 bg-background px-3 py-2">
        {MD.test(path) && <div title={bar.dirty ? t('save_first') : undefined} className={cx(bar.dirty && 'pointer-events-none opacity-50')}>
          <Segmented value={raw ? 'raw' : 'rich'} onChange={(v) => setRaw(v === 'raw')} options={[{ value: 'rich', label: t('rich') }, { value: 'raw', label: t('source') }]} />
        </div>}
        <div className="ml-auto flex items-center gap-2">
          {bar.dirty && <span className="text-xs text-muted-foreground">{t('unsaved')}</span>}
          <Button size="sm" disabled={!bar.dirty || bar.saving} onClick={bar.save}>{bar.saving ? <Loader2 className="animate-spin" /> : null}{t('save')}</Button>
        </div>
      </div>
      {raw ? <RawText key="raw" path={path} mtime={mtime} call={call} reload={reload} onBar={setBar} /> : <RichMd key="rich" root={root} path={path} mtime={mtime} call={call} reload={reload} onBar={setBar} />}
    </div>
  )
}

/** 编辑器把「改没改、在不在存、怎么存」交给上面那排按钮 */
function useBar(onBar: (b: Bar) => void, dirty: boolean, saving: boolean, save: () => Promise<void>) {
  const ref = useRef(save)
  ref.current = save
  useEffect(() => onBar({ dirty, saving, save: () => void ref.current() }), [dirty, saving])
}

const FRONT = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/

/**
 * 文件在别处改了（AI 在对话里改、用别的程序改）：mtime 变了就重读，和上次读到 / 存进去的一样就不管（自己刚存的）；
 * 不一样时，没改过直接换成新的，改过了提示用户，让他选丢掉自己的修改载入新的、还是接着改（存的时候覆盖）
 */
function useExternal(path: string, mtime: string | number, call: Call, dirty: boolean, apply: (text: string) => void) {
  const last = useRef<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const first = useRef(true)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    if (first.current) { first.current = false; return }
    call<{ text: string }>('read', { path }).then((r) => {
      if (r.text === last.current) return
      if (dirtyRef.current) setPending(r.text)
      else { last.current = r.text; apply(r.text) }
    }).catch(() => {})
  }, [mtime])
  const notice = pending === null ? null : <ExternalNotice onLoad={() => { last.current = pending; apply(pending); setPending(null) }} onKeep={() => setPending(null)} />
  return { last, notice, clear: () => setPending(null) }
}

function ExternalNotice({ onLoad, onKeep }: { onLoad: () => void; onKeep: () => void }) {
  const { t } = useT('folder')
  return (
    <div className="px-3 pt-2"><Notice tone="info">
      <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1">{t('changed_outside')}</span>
        <Button size="sm" variant="outline" onClick={onLoad}>{t('changed_load')}</Button>
        <Button size="sm" variant="ghost" onClick={onKeep}>{t('changed_keep')}</Button>
      </div>
    </Notice></div>
  )
}

const saveKey = (ev: KeyboardEvent, save: () => Promise<void>) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); void save() } }

function RawText({ path, mtime, call, reload, onBar }: { path: string; mtime: string | number; call: Call; reload: () => Promise<void>; onBar: (b: Bar) => void }) {
  const [text, setText] = useState<string | null>(null)
  const [savedText, setSavedText] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const dirty = text !== null && text !== savedText
  const ext = useExternal(path, mtime, call, dirty, (x) => { setText(x); setSavedText(x) })
  useEffect(() => {
    call<{ text: string }>('read', { path }).then((r) => { ext.last.current = r.text; setText(r.text); setSavedText(r.text) }).catch((e) => setError((e as Error).message))
  }, [path])
  const save = async () => {
    if (text === null) return
    setSaving(true); setError('')
    try { await call('write', { path, text }); ext.last.current = text; ext.clear(); setSavedText(text); await reload() } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  useBar(onBar, dirty, saving, save)
  if (error) return <div className="p-3"><Notice tone="error">{error}</Notice></div>
  if (text === null) return <div className="p-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
  return <>{ext.notice}<textarea value={text} onChange={(ev) => setText(ev.target.value)} onKeyDown={(ev) => saveKey(ev, save)} spellCheck={false} className="m-3 min-h-[480px] flex-1 resize-y rounded-md border border-border bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-primary/50" /></>
}

/** 'A/B/C' → ['A', 'A/B', 'A/B/C'] */
const crumbs = (dir: string) => (dir ? dir.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')) : [])

const isRelative = (src: string) => !!src && !/^(https?:|data:|local:|blob:|\/)/i.test(src)
export const joinPath = (dir: string, p: string) => {
  const out: string[] = []
  for (const x of (dir ? dir + '/' + p : p).split('/')) { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x) }
  return out.join('/')
}

/**
 * md 用富文本编辑器直接改（官方的 @tiptap/markdown，components/rich/mdExtensions.ts）：读进来、存回去都是 md，不经过 HTML。
 * 相对路径的图片、视频存的还是相对路径，只在显示时换成工作目录的预览地址（resolveSrc）；
 * 编辑器里新插的本机文件（上传、从资料库选）存的时候复制进 md 旁边的「图」目录，md 里换成相对路径
 */
function RichMd({ root, path, mtime, call, reload, onBar }: { root: string; path: string; mtime: string | number; call: Call; reload: () => Promise<void>; onBar: (b: Bar) => void }) {
  const { t } = useT('folder')
  const [md, setMd] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // 没改过的样子：编辑器建好时报的第一份（规范化后的）md，或者上次存进去的。比的时候不管末尾空白：
  // 编辑器会在末尾的表格、视频后面自动补一个空段落，导出来多两个换行
  const baseline = useRef<string | null>(null)
  const dir = parent(path)
  // 换内容（别处改了文件）要让编辑器重新挂载：它只在挂载时读 value
  const [ver, setVer] = useState(0)
  // 开头的 --- 头（文案的 title、tags）不进编辑器：富文本会把它当成分隔线和标题。原样留着，存的时候接回去，在源码里改
  const [front, setFront] = useState('')
  // 编辑器的 Markdown、表格、任务列表扩展：第三方包只在浏览器里有，动态加载
  const [exts, setExts] = useState<unknown[] | null>(null)
  const resolveSrc = (src: string) => (isRelative(src) ? workSrc(`${root}/${joinPath(dir, decodeURI(src))}`) : fileSrc(src))
  const show = async (text: string) => {
    const x = await import('./rich/mdExtensions')
    const fm = text.match(FRONT)?.[0] ?? ''
    baseline.current = null
    setDirty(false)
    setFront(fm)
    setExts(x.default)
    setVer((v) => v + 1)
    setMd(text.slice(fm.length))
  }
  const ext = useExternal(path, mtime, call, dirty, (x) => void show(x))
  useEffect(() => {
    void (async () => {
      try {
        const { text } = await call<{ text: string }>('read', { path })
        ext.last.current = text
        await show(text)
      } catch (e) { setError((e as Error).message) }
    })()
  }, [path])
  const save = async () => {
    if (md === null) return
    setSaving(true); setError('')
    try {
      // 新插进来的本机文件：复制进 md 旁边的「图/」，md 里换成相对路径（空格写成 %20，不然 md 的图片地址断开）
      let body = md
      for (const src of new Set(md.match(/local:[^\s)"]+/g) ?? [])) {
        const to = `${t('images_dir')}/${src.slice(6)}`
        await call('importLocal', { url: src, to: joinPath(dir, to) })
        body = body.split(`](${src})`).join(`](${to.replace(/ /g, '%20')})`).split(`"${src}"`).join(`"${to}"`)
      }
      const text = (front ? front.replace(/\n*$/, '\n\n') : '') + (body.trim() ? body.replace(/\n*$/, '\n') : '')
      await call('write', { path, text })
      ext.last.current = text
      ext.clear()
      baseline.current = md.trimEnd()
      setDirty(false)
      if (body !== md) await show(text)
      await reload()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  useBar(onBar, dirty, saving, save)
  if (error) return <div className="p-3"><Notice tone="error">{error}</Notice></div>
  if (md === null || !exts) return <div className="p-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
  return (
    <div className="px-3 pb-3" onKeyDown={(ev) => saveKey(ev, save)}>
      {ext.notice}
      {front && <pre title={t('front_hint')} className="mb-2 overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">{front.trim()}</pre>}
      <RichEditor key={ver} markdown extensions={exts} resolveSrc={resolveSrc} value={md} placeholder={isDraft(path) ? t('draft_placeholder') : undefined}
        onChange={(v) => { setMd(v); if (baseline.current === null) baseline.current = v.trimEnd(); else setDirty(v.trimEnd() !== baseline.current) }} />
    </div>
  )
}

function MediaView({ src, video }: { src: string; video: boolean }) {
  return <div className="flex justify-center bg-black/40 p-3">{video ? <video src={src} controls className="max-h-[520px] max-w-full rounded" /> : <img src={src} alt="" className="max-h-[520px] max-w-full rounded object-contain" />}</div>
}
