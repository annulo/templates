import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Clapperboard, CloudOff, CloudUpload, Laptop, File, FileText, Film, Music, Folder as FolderIcon, FolderOpen, FolderPlus, ExternalLink, FilePlus, Eye, Image as ImageIcon, LayoutGrid, Pencil, ListTree, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react'
import RichEditor from './RichEditor'
import { Button, Notice, Segmented, cx, fmtTime, inputCls } from './ui'
import { fileSrc, filesOf } from '../lib/files'
import { isEn, useT } from '../lib/i18n'
import { dbList, runLocal, uploadLocalFile, type Article } from '../lib/shuttle'
import { TaskRunning, useTaskRuns } from './Task'

// 内容文件夹（docs/content-model.md）：一条内容的稿子、脚本、文案、视频都是它文件夹里的文件，可以分目录。
// 文件夹在项目的工作目录里（本机 ~/Annulo/<项目名>/内容/<名字>），读写走本机函数 local/folder.ts（Annulo 的 ctx.fs），
// 图片、视频、音频直接用 /_annulo/work-files/<路径> 显示，PDF 在新标签页打开。默认网格（所有文件铺平），可以切成树；文本在页面里改，md 用富文本编辑器。
// 打开时还没有文件夹就建一个，老文章的稿子、正文、配图、视频、产物搬进去（表里的留着不动）。
// 表里记着文件夹、磁盘上却没有（挪走了、删了、工作目录换了）不自动建：建出来只有表里留的那几样，像是文件丢了一半。让用户去找，或者自己点重新建。
// AI 在对话里改文件不经过表，没有推送：看得见时每 4 秒重读。发布在 FolderPublish.tsx：挑这次发成什么、用哪些文件。

export type Entry = { path: string; dir: boolean; size: number; mtime: number }
/** 产物文件夹的同步状态（Annulo ctx.folders.status）：ignored 是这里按 .annuloignore 不同步的，elsewhere 是别人电脑上只在那里的 */
type LocalFile = { path: string; size: number; mtime: number }
type SyncStatus = { ignore?: string[]; ignored?: LocalFile[]; elsewhere?: { user?: string; machine: string; at: string; files: LocalFile[] }[] }
type Call = <T>(fn: string, input?: Record<string, unknown>) => Promise<T>

export const TEXT = /\.(md|markdown|txt|json|ya?ml|csv|srt|vtt|html?|css|tsx?|jsx?|py|sh)$/i
export const VIDEO = /\.(mp4|mov|webm|m4v)$/i
export const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i
export const AUDIO = /\.(mp3|m4a|wav|ogg|oga|opus|aac|flac)$/i
export const PDF = /\.pdf$/i
export const MD = /\.(md|markdown)$/i
/** 稿子：最外层的 稿子.md（英文界面建的是 brief.md） */
export const isDraft = (p: string) => p === '稿子.md' || p === 'brief.md'

export const base = (p: string) => p.split('/').pop() ?? p
export const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const fmtSize = (n: number) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
/** 工作目录里的文件给 <img>、<video> 的地址（Annulo 能力版本 46） */
export const workSrc = (p: string) => '/_shuttle/work-files/' + p.split('/').map(encodeURIComponent).join('/')

// 文件图标：形状和颜色都分开（视频用场记板、紫色，图片绿色，音频橙色，文字灰色），扫一眼就分得出，不光靠一个小图案
function iconOf(e: Entry, open: boolean) {
  if (e.dir) return open ? FolderOpen : FolderIcon
  if (VIDEO.test(e.path)) return Clapperboard
  if (IMAGE.test(e.path)) return ImageIcon
  if (AUDIO.test(e.path)) return Music
  if (TEXT.test(e.path) || PDF.test(e.path)) return FileText
  return File
}
const toneOf = (e: Entry) => e.dir ? 'text-muted-foreground' : VIDEO.test(e.path) ? 'text-violet-500 dark:text-violet-400' : IMAGE.test(e.path) ? 'text-emerald-600 dark:text-emerald-400' : AUDIO.test(e.path) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'

// sel / setSel：打开的文件或目录由内容页记在地址栏（返回按钮、返回手势一级级退）；没传就记在组件里
export default function Folder({ article: a, onChanged, sel: selProp, setSel: setSelProp }: { article: Article; onChanged: () => void; sel?: string; setSel?: (p: string, replace?: boolean) => void }) {
  const { t } = useT('folder')
  const id = a.id
  const [state, setState] = useState<{ dir: string; path: string; entries: Entry[]; can_open?: boolean; missing?: boolean; root?: string; sync?: SyncStatus | null; can_upload?: boolean; upload?: { state: string; machine?: string; error?: string } | null } | null>(null)
  const [error, setError] = useState('')
  const [selLocal, setSelLocal] = useState('')
  const sel = setSelProp ? selProp ?? '' : selLocal
  const setSel = setSelProp ?? setSelLocal
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
  const build = async () => {
    setCreating(true)
    try { await call('create'); await moveOld(a, call); await load(); onChanged() } catch (e) { setError((e as Error).message) } finally { setCreating(false) }
  }
  useEffect(() => {
    if (!state || state.dir || state.missing || creating) return
    void build()
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
  // 不同步的：文件按 Annulo 给的清单；目录里的文件全都不同步，目录也算（草稿/）
  const ignored = useMemo(() => {
    const set = new Set((state?.sync?.ignored ?? []).map((f) => f.path))
    for (const e of entries) if (e.dir) { const fs = entries.filter((x) => !x.dir && x.path.startsWith(e.path + '/')); if (fs.length && fs.every((x) => set.has(x.path))) set.add(e.path) }
    return set
  }, [entries, state?.sync])
  const hiddenDrafts = entries.filter((e) => !e.dir && /^(草稿|drafts)\//.test(e.path)).length
  // 目录默认收起，只展开当前选中的文件（或目录）所在的那一路：几十个文件的目录不会一打开就把树撑得很长
  const isOpen = (p: string) => openDirs[p] ?? (sel === p || sel.startsWith(p + '/'))
  const selected = entries.find((e) => e.path === sel)
  // 网格：不分目录，所有文件铺平；稿子排第一，其余最近改的在前
  // 中间产物（草稿/、drafts/ 里的草稿视频、草稿音频，.annuloignore 默认不同步）不进网格，树里还看得到
  const files = useMemo(() => entries.filter((e) => !e.dir && !/^(草稿|drafts)\//.test(e.path)).sort((x, y) => Number(isDraft(y.path)) - Number(isDraft(x.path)) || y.mtime - x.mtime), [entries])
  // 只有一个文件：打开时直接打开它。只自动选一次：用户按返回退回全部文件后不能又被选回去，不然退不出来
  const only = files.length === 1 ? files[0].path : ''
  // 网格里每一层（全部文件、某个目录）各记各的滚动位置：点开稿子滚到底再返回，回到点开它时的地方，不停在网格底部；
  // 打开文件时页面已经滚过了文件夹的顶，滚回文件开头。滚的是页面的滚动区（往上找第一个能滚的）
  const gridBox = useRef<HTMLDivElement>(null)
  const scrollPos = useRef<Record<string, number>>({})
  const selRef = useRef(sel)
  selRef.current = sel
  const scrollerOf = (el: HTMLElement | null): HTMLElement => {
    for (let p = el?.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY
      if (o === 'auto' || o === 'scroll') return p
    }
    return (document.scrollingElement as HTMLElement) ?? document.documentElement
  }
  const isList = !sel || !!selected?.dir
  useEffect(() => {
    if (view !== 'grid') return
    const sc = scrollerOf(gridBox.current)
    const target: HTMLElement | Window = sc === document.scrollingElement ? window : sc
    const save = () => { scrollPos.current[selRef.current] = sc.scrollTop }
    target.addEventListener('scroll', save, { passive: true })
    return () => target.removeEventListener('scroll', save)
  }, [view, !!state])
  useLayoutEffect(() => {
    const box = gridBox.current
    if (view !== 'grid' || !box) return
    const sc = scrollerOf(box)
    if (isList) {
      const y = scrollPos.current[sel]
      if (y !== undefined) sc.scrollTop = y
    } else if (box.getBoundingClientRect().top < sc.getBoundingClientRect().top) {
      box.scrollIntoView({ block: 'start' })
    }
  }, [sel])
  // 树：做成固定高度的工作区，正好是页面滚动区里顶栏（--page-top）以下的那一截；左边树、右边文件各自在里面滚，
  // 页面滚到这块就不用再滚，不会三层滚动条叠在一起。高度跟着窗口变
  const treeBox = useRef<HTMLDivElement>(null)
  const topProbe = useRef<HTMLDivElement>(null)
  const treeCol = useRef<HTMLDivElement>(null)
  const [paneH, setPaneH] = useState(0)
  useLayoutEffect(() => {
    const box = treeBox.current
    if (view !== 'tree' || !box) return
    const sc = scrollerOf(box)
    // 从这块在页面里的位置一直到窗口底边：页面没滚的时候整块就在屏幕里，不用先滚页面；
    // 位置太靠下（剩不到 360）时才改成「滚到顶栏下面时正好占满」
    const fit = () => {
      const doc = sc === document.scrollingElement
      const vt = doc ? 0 : Math.max(0, sc.getBoundingClientRect().top)
      const vb = Math.min(doc ? window.innerHeight : sc.getBoundingClientRect().bottom, window.innerHeight)
      const at = box.getBoundingClientRect().top - vt + (doc ? window.scrollY : sc.scrollTop)
      const below = vb - vt - at - 16
      setPaneH(below >= 360 ? below : Math.max(360, vb - vt - (topProbe.current?.offsetHeight ?? 0) - 12))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(sc)
    window.addEventListener('resize', fit)
    return () => { ro.disconnect(); window.removeEventListener('resize', fit) }
  }, [view, !!state?.dir, entries.length])
  // 页面怎么滚，这块露在屏幕里的部分都完整可用：外框在页面里照常占位（高 paneH），里面那块按「顶栏以下、窗口底边以上」实时裁剪，
  // 上边贴住顶栏、下边不出屏幕；往下滚去看发布记录时它从上往下变矮，两栏照常各自滚。直接改样式，不走 React（每帧都在算）
  const treeInner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = treeBox.current
    const inner = treeInner.current
    if (view !== 'tree' || !box || !inner) return
    const sc = scrollerOf(box)
    const doc = sc === document.scrollingElement
    const wide = window.matchMedia('(min-width: 768px)')
    let raf = 0
    const clip = () => {
      raf = 0
      if (!wide.matches) { inner.style.top = ''; inner.style.height = ''; inner.style.visibility = ''; return }
      const vt = doc ? 0 : Math.max(0, sc.getBoundingClientRect().top)
      const vb = Math.min(doc ? window.innerHeight : sc.getBoundingClientRect().bottom, window.innerHeight)
      const r = box.getBoundingClientRect()
      // 顶栏吸顶的位置（--page-top）是按滚动区的内容边算的，要加上滚动区的上内边距才是它在屏幕上的底边
      const pad = doc ? 0 : parseFloat(getComputedStyle(sc).paddingTop) || 0
      const top = Math.max(r.top, vt + pad + (topProbe.current?.offsetHeight ?? 0))
      const bottom = Math.min(r.bottom, vb)
      inner.style.top = `${Math.max(0, top - r.top)}px`
      inner.style.height = `${Math.max(0, bottom - top)}px`
      inner.style.visibility = bottom - top < 40 ? 'hidden' : ''
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(clip) }
    clip()
    const target: HTMLElement | Window = doc ? window : sc
    target.addEventListener('scroll', kick, { passive: true })
    window.addEventListener('resize', kick)
    wide.addEventListener('change', kick)
    const ro = new ResizeObserver(kick)
    ro.observe(box)
    return () => { cancelAnimationFrame(raf); target.removeEventListener('scroll', kick); window.removeEventListener('resize', kick); wide.removeEventListener('change', kick); ro.disconnect() }
  }, [view, !!state?.dir, paneH])
  // 选中的那项滚进树的可见区：只滚树这一栏自己，不用 scrollIntoView（它会连页面一起滚，把这块推到顶栏下面）
  useLayoutEffect(() => {
    const col = treeCol.current
    const it = col?.querySelector<HTMLElement>('[data-tree-sel]')
    if (view !== 'tree' || !col || !it) return
    const c = col.getBoundingClientRect()
    const r = it.getBoundingClientRect()
    if (r.top < c.top) col.scrollTop -= c.top - r.top + 8
    else if (r.bottom > c.bottom) col.scrollTop += r.bottom - c.bottom + 8
  }, [sel, view])
  const autoPicked = useRef(false)
  useEffect(() => {
    if (!only || autoPicked.current) return
    autoPicked.current = true
    if (!sel) setSel(only, true)
  }, [only, sel])
  // 树状视图右边不留空，默认打开一个文件，取第一个有的：上次在这条内容里打开的（每条内容各记各的，记在这台电脑上）→
  // 最外层最近改过的文件（多半是 AI 刚做出来的；不进子目录，旁白这类一堆分句音频的目录不算）→ 稿子。网格视图默认看全部文件，不自动打开
  const lastKey = `folder:last:${id}`
  useEffect(() => { if (sel) try { localStorage.setItem(lastKey, sel) } catch {} }, [sel, lastKey])
  const treePicked = useRef(false)
  useEffect(() => {
    if (view !== 'tree' || sel || treePicked.current || !entries.length) return
    treePicked.current = true
    let last = ''
    try { last = localStorage.getItem(lastKey) ?? '' } catch {}
    const top = entries.filter((e) => !e.dir && !e.path.includes('/') && !/^[.~]/.test(e.path)).sort((x, y) => y.mtime - x.mtime)
    const pick = (last && entries.some((e) => e.path === last) ? last : '') || top[0]?.path || entries.find((e) => isDraft(e.path))?.path || ''
    if (pick) setSel(pick, true)
  }, [view, sel, entries, lastKey])
  // 新建的位置：选中的是目录就建在里面，是文件就建在它旁边
  const here = selected ? (selected.dir ? selected.path : parent(selected.path)) : ''

  const [adding, setAdding] = useState<'file' | 'dir' | null>(null)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState('')
  const startAdd = (k: 'file' | 'dir') => { setAdding(k); setAddError(''); setNewName(k === 'file' ? t('new_file_default') : '') }
  const add = async () => {
    const name = newName.trim()
    if (!name || !adding) return
    const p = here ? `${here}/${name}` : name
    setAddError('')
    try { await call(adding === 'file' ? 'write' : 'mkdir', adding === 'file' ? { path: p, text: '' } : { path: p }); await load(); setSel(p); setAdding(null) } catch (e) { setAddError((e as Error).message) }
  }

  // 上传文件（按钮选、或者拖进文件夹这块）：先存到这台电脑（local:<名字>），再复制进文件夹，放在和新建一样的位置（here）。
  // 同名的不覆盖，名字后面加「 (2)」；只传了一个就打开它
  const pickRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<{ name: string; i: number; n: number; p: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const uploadFiles = async (list: File[]) => {
    if (!list.length || uploading) return
    setError('')
    const taken = new Set(entries.map((e) => e.path))
    const free = (name: string) => {
      const dot = name.lastIndexOf('.')
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
      let p = here ? `${here}/${name}` : name
      for (let k = 2; taken.has(p); k++) p = here ? `${here}/${stem} (${k})${ext}` : `${stem} (${k})${ext}`
      taken.add(p)
      return p
    }
    let last = ''
    try {
      for (const [i, f] of list.entries()) {
        setUploading({ name: f.name, i, n: list.length, p: 0 })
        const r = await uploadLocalFile(f, (p) => setUploading({ name: f.name, i, n: list.length, p }))
        if (!r.ref.startsWith('local:')) throw new Error(t('upload_need_annulo'))
        const to = free(f.name)
        await call('importLocal', { url: r.ref, to })
        last = to
      }
      await load()
      if (list.length === 1 && last) setSel(last)
    } catch (e) { setError((e as Error).message); void load() } finally { setUploading(null) }
  }
  const hasFiles = (ev: { dataTransfer: DataTransfer | null }) => !!ev.dataTransfer?.types.includes('Files')

  if (state?.missing) {
    // 本机版写出完整位置（主目录写成 ~），服务端部署只写相对工作目录的路径
    const where = state.can_open && state.root ? `${state.root}/${state.path}`.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)/, '~') : state.path
    return (
      <section className="mt-6 space-y-3">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <div>
            <p className="font-medium">{t('missing')}</p>
            <p className="mt-0.5 break-all text-xs text-muted-foreground">{where}</p>
          </div>
          <p className="text-muted-foreground">{t(state.can_upload ? 'missing_desc_server' : 'missing_desc')}</p>
          {state.upload?.state === 'failed' && <p className="text-xs text-destructive">{t('upload_failed', { machine: state.upload.machine ?? '', error: state.upload.error ?? '' })}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* 团队服务器上：文件还在电脑上没传上来，让点的人的电脑传 */}
            {state.can_upload && <Button size="sm" disabled={state.upload?.state === 'running'} onClick={() => void call('upload').then(load).catch((e) => setError((e as Error).message))}>{state.upload?.state === 'running' ? <Loader2 className="animate-spin" /> : <CloudUpload />}{state.upload?.state === 'running' ? t('uploading', { machine: state.upload.machine ?? '' }) : t('upload')}</Button>}
            {state.can_open && <Button size="sm" variant="outline" onClick={() => void call('openRoot').catch((e) => setError((e as Error).message))}><FolderOpen />{t('missing_open')}</Button>}
            <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw />{t('missing_retry')}</Button>
            <Button size="sm" variant="ghost" disabled={creating} onClick={() => void build()}>{creating ? <Loader2 className="animate-spin" /> : <FolderPlus />}{t('missing_rebuild')}</Button>
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </section>
    )
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
        <div data-tree-sel={sel === e.path || undefined} onContextMenu={(ev) => onMenu(ev, e)} className={cx('flex items-center gap-1 rounded-md pr-1 text-sm', sel === e.path || menu?.e.path === e.path ? 'bg-primary/10 text-primary-text' : 'hover:bg-muted')} style={{ paddingLeft: 4 + depth * 12 }}>
          {/* 改名时不能是 button：输入框放在 button 里，按空格会点到按钮 */}
          {renaming === e.path ? <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1"><span className="w-3.5 shrink-0" />{nameOf(e, 'h-6')}</div> : <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 text-left" onClick={() => { setSel(e.path); if (e.dir) setOpenDirs((o) => ({ ...o, [e.path]: !isOpen(e.path) })) }}>
            {e.dir ? (isOpen(e.path) ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />) : <span className="w-3.5 shrink-0" />}
            <Icon className={cx('size-4 shrink-0', toneOf(e))} />
            {nameOf(e, 'h-6')}
            {ignored.has(e.path) && (ignored.has(parent(e.path)) ? null : <LocalTag local={!!state.can_open} />)}
          </button>}
        </div>
        {e.dir && isOpen(e.path) && (children[e.path] ?? []).map((k) => row(k, depth + 1))}
      </div>
    )
  }

  return (
    <section className="relative mt-6 space-y-3"
      onDragOver={(ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); setDragging(true) }}
      onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setDragging(false) }}
      onDrop={(ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); setDragging(false); void uploadFiles([...ev.dataTransfer.files]) }}>
      {dragging && <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary-text">{t('drop_here', { where: here ? t('in_dir', { dir: here }) : t('in_root') })}</div>}
      <div ref={topProbe} aria-hidden className="pointer-events-none invisible absolute h-[var(--page-top,0px)] w-0" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          {/* 路径只在本机版显示：服务端部署是服务器上的目录，用户用不上 */}
          {state.can_open && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={state.dir}>{state.dir.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)/, '~')}</p>}
        </div>
        {/* ml-auto：路径太长、按钮折到下一行时也靠右 */}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {(['file', 'dir'] as const).filter((k) => k === 'file' || view === 'tree').map((k) => (
            <AddPopover key={k} open={adding === k} onToggle={() => (adding === k ? setAdding(null) : startAdd(k))} onClose={() => setAdding(null)}
              label={t(k === 'file' ? 'new_file' : 'new_dir')} button={k === 'file' ? <FilePlus /> : <FolderPlus />}>
              <form className="space-y-2.5" onSubmit={(ev) => { ev.preventDefault(); void add() }}>
                <div className="text-xs font-medium">{t(k === 'file' ? 'new_file_in' : 'new_dir_in', { where: here ? t('in_dir', { dir: here }) : t('in_root') })}</div>
                <input autoFocus value={newName} placeholder={k === 'file' ? (view === 'grid' ? t('new_file_ph_grid') : t('new_file_ph')) : t('new_dir_ph')} onChange={(ev) => { setNewName(ev.target.value); setAddError('') }} className={cx(inputCls, 'h-8 w-full')} />
                {addError && <p className="text-xs text-destructive">{addError}</p>}
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>{t('cancel')}</Button>
                  <Button size="sm" type="submit" disabled={!newName.trim()}>{t('create')}</Button>
                </div>
              </form>
            </AddPopover>
          ))}
          <Button size="icon-sm" variant="ghost" disabled={!!uploading} title={t('upload_files_tip', { where: here ? t('in_dir', { dir: here }) : t('in_root') })} aria-label={t('upload_files')} onClick={() => pickRef.current?.click()}>{uploading ? <Loader2 className="animate-spin" /> : <Upload />}</Button>
          <input ref={pickRef} type="file" multiple hidden onChange={(ev) => { const fs = [...(ev.target.files ?? [])]; ev.target.value = ''; void uploadFiles(fs) }} />
          {state.can_open && <Button size="icon-sm" variant="ghost" title={t('open_folder')} aria-label={t('open_folder')} onClick={() => void call('open', {}).catch((e) => setError((e as Error).message))}><FolderOpen /></Button>}
          <Button size="icon-sm" variant="ghost" onClick={() => void load()} aria-label={t('refresh')} title={t('refresh')}><RefreshCw /></Button>
          <div className="flex rounded-md border border-border p-0.5">
            <button type="button" title={t('view_grid')} aria-pressed={view === 'grid'} onClick={() => switchView('grid')} className={cx('cursor-pointer rounded p-1', view === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}><LayoutGrid className="size-4" /></button>
            <button type="button" title={t('view_tree')} aria-pressed={view === 'tree'} onClick={() => switchView('tree')} className={cx('cursor-pointer rounded p-1', view === 'tree' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}><ListTree className="size-4" /></button>
          </div>
        </div>
      </div>
      {/* 下面一行写这次交代的要求（「做个封面图，抖音和小红书的」），看得出它在做哪件事；没写要求才用通用的说明 */}
      <TaskRunning runs={runs} title={() => t('running')} desc={(r) => (typeof r.input?.note === 'string' && r.input.note.trim()) || t('running_desc')} />
      {uploading && <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 shrink-0 animate-spin" /><span className="min-w-0 truncate">{t('uploading_file', { name: uploading.name, i: uploading.i + 1, n: uploading.n, p: Math.round(uploading.p * 100) })}</span></div>}
      {error && <Notice tone="error">{error}</Notice>}
      <SyncNote sync={state.sync} local={!!state.can_open} hiddenDrafts={view === 'grid' ? hiddenDrafts : 0} onTree={() => switchView('tree')} />
      {view === 'grid' ? (
        // 手机上铺满屏幕宽（抵掉页面左右 1rem 的内边距），只留上下分隔线：一层层卡片边框会把正文挤窄
        // scroll-mt：打开文件滚回开头时停在吸顶的头部下面，不被它盖住
        // key：两个视图不复用 DOM，不然树视图直接写上去的高度（treeInner 的 style）会留在网格的面包屑上，把它撑高
        <div key="grid" ref={gridBox} className="-mx-4 min-h-[360px] scroll-mt-[var(--page-top,0px)] overflow-clip border-y border-border sm:mx-0 sm:rounded-lg sm:border">
          {selected
            ? <>
                {/* 面包屑：全部文件 / 目录 / 目录，点哪一级回到哪一级（目录显示里面的东西）；文件名在下面看文件的那一栏 */}
                {(files.length > 1 || parent(selected.path)) && <div className="flex min-w-0 flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5 text-sm">
                  <button type="button" onClick={() => setSel('')} className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-muted">{t('all_files')}</button>
                  {crumbs(selected.dir ? selected.path : parent(selected.path)).map((c) => <span key={c} className="flex min-w-0 items-center gap-0.5"><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /><button type="button" onClick={() => setSel(c)} className={cx('max-w-48 cursor-pointer truncate rounded px-1.5 py-0.5 hover:bg-muted', c === selected.path && 'font-medium')}>{base(c)}</button></span>)}
                </div>}
                {viewer(selected)}
              </>
            : files.length ? <Grid root={state.path} files={files} onSelect={setSel} onMenu={onMenu} active={menu?.e.path} renaming={renaming} nameOf={nameOf} /> : <p className="p-4 text-sm text-muted-foreground">{t('empty_grid')}</p>}
        </div>
      ) : (
        // 手机上树和文件上下叠着，照常跟页面一起滚；宽屏是固定高度的两栏（见上面 paneH），右栏里吸顶的那几排吸在右栏自己的顶上（--page-top 归零）
        <div key="tree" ref={treeBox} className="relative scroll-mt-[var(--page-top,0px)] md:h-[var(--pane-h)]" style={{ '--pane-h': `${paneH || 600}px` } as CSSProperties}>
        <div ref={treeInner} className="grid min-h-[360px] grid-cols-1 overflow-clip rounded-lg border border-border md:absolute md:inset-x-0 md:min-h-0 md:grid-cols-[var(--tree-w)_1fr] md:grid-rows-[minmax(0,1fr)]" style={{ '--tree-w': `${treeW}px` } as CSSProperties}>
          {/* 调宽度的那条：放在外框上、贴着两栏的分界线，不放进树那栏（那栏会滚，滚下去就抓不到了） */}
          <div onPointerDown={dragTree} title={t('drag_width')} className="absolute inset-y-0 z-10 hidden w-1.5 cursor-col-resize hover:bg-primary/30 md:block" style={{ left: treeW - 6 }} />
          <div ref={treeCol} className="relative max-h-[640px] overflow-auto border-b border-border p-1.5 md:h-full md:max-h-none md:border-b-0">
            {entries.length ? (children[''] ?? []).map((e) => row(e, 0)) : <p className="p-3 text-xs text-muted-foreground">{t('empty_tree')}</p>}
          </div>
          <div className="min-w-0 md:h-full md:overflow-auto md:border-l md:border-border md:[--page-top:0px]">{selected ? viewer(selected) : <p className="p-4 text-sm text-muted-foreground">{t('pick_one')}</p>}</div>
        </div>
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

/** 树里不同步的文件、目录后面的小标签：本机版是「只在本机」（不传到团队服务器、不备份），服务端部署是「不同步」（别人电脑拉不到） */
function LocalTag({ local }: { local: boolean }) {
  const { t } = useT('folder')
  return <span title={t(local ? 'local_only_tip' : 'not_synced_tip')} className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground">{local ? <Laptop className="size-2.5" /> : <CloudOff className="size-2.5" />}{t(local ? 'local_only' : 'not_synced')}</span>
}

/** 文件夹上面一行：哪些不同步；别人电脑上还有没传上来的（annulo fs pull / push 时报上来的），点开看是哪些 */
function SyncNote({ sync, local, hiddenDrafts, onTree }: { sync?: SyncStatus | null; local: boolean; hiddenDrafts: number; onTree: () => void }) {
  const { t } = useT('folder')
  const [open, setOpen] = useState(false)
  if (!sync) return null
  const size = (fs: LocalFile[]) => fmtSize(fs.reduce((n, f) => n + f.size, 0))
  const rules = (sync.ignore ?? []).filter((r) => r !== 'node_modules/').join('、')
  const here = sync.ignored ?? []
  const away = sync.elsewhere ?? []
  if (!here.length && !away.length) return null
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {here.length > 0 && <p className="flex flex-wrap items-center gap-1.5">
        {local ? <Laptop className="size-3.5 shrink-0" /> : <CloudOff className="size-3.5 shrink-0" />}
        <span>{t(local ? 'sync_here_local' : 'sync_here_server', { n: here.length, size: size(here), rules })}</span>
        {hiddenDrafts > 0 && <button type="button" onClick={onTree} className="cursor-pointer text-primary-text hover:underline">{t('sync_see_tree')}</button>}
      </p>}
      {away.map((c) => (
        <div key={(c.user ?? '') + c.machine}>
          <p className="flex flex-wrap items-center gap-1.5">
            <Laptop className="size-3.5 shrink-0" />
            <span>{t('sync_away', { who: c.user ? t('sync_who', { user: c.user, machine: c.machine }) : c.machine, n: c.files.length, size: size(c.files), time: fmtTime(c.at) })}</span>
            <button type="button" onClick={() => setOpen(!open)} className="cursor-pointer text-primary-text hover:underline">{t(open ? 'sync_hide' : 'sync_show')}</button>
          </p>
          {open && <ul className="mt-1 ml-5 space-y-0.5 font-mono text-[11px]">{c.files.slice(0, 50).map((f) => <li key={f.path} className="truncate">{f.path} <span className="text-muted-foreground/70">{fmtSize(f.size)}</span></li>)}{c.files.length > 50 && <li>…</li>}</ul>}
        </div>
      ))}
      {away.length > 0 && <p className="pl-5">{t('sync_away_hint')}</p>}
    </div>
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

  // min-h-full 不用 h-full：树的右栏是固定高度、自己滚的，容器要能跟着内容长，里面吸顶的那几排才不会滚过一屏就被带走
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {renaming
            ? <RenameInput value={base(e.path)} onDone={(v) => void rename(v)} onCancel={() => setRenaming(false)} />
            : <span className="min-w-0 cursor-text truncate rounded px-1 text-sm font-medium hover:bg-muted" title={t('rename_hint')} onDoubleClick={() => setRenaming(true)}>{base(e.path)}</span>}
          {!e.dir && <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(e.size)}</span>}
        </div>
        {/* 服务端部署（canOpen 是 false）：用户不在服务器前面，「打开」在新标签页打开预览地址，没有「在文件夹中显示」 */}
        {/* 只放图标，悬停看提示；删除点第一下才出字确认（「挪进废纸篓？」），再点才删 */}
        {!e.dir && <Button size="icon-sm" variant="ghost" title={t('open')} aria-label={t('open')} onClick={() => (canOpen ? void run(() => call('open', { path: e.path })) : void window.open(workSrc(`${root}/${e.path}`), '_blank'))}><ExternalLink /></Button>}
        {canOpen && <Button size="icon-sm" variant="ghost" title={t('reveal')} aria-label={t('reveal')} onClick={() => void run(() => call('open', { path: e.path, reveal: true }))}><FolderOpen /></Button>}
        <Button size={confirmDel ? 'sm' : 'icon-sm'} variant="ghost" className="text-destructive" title={t('delete')} aria-label={t('delete')} onMouseLeave={() => setConfirmDel(false)} onClick={() => { if (!confirmDel) { setConfirmDel(true); return } void run(async () => { await call('remove', { path: e.path }); onSelect(''); await reload() }) }}><Trash2 />{confirmDel && t('delete_confirm')}</Button>
      </div>
      {error && <div className="p-3"><Notice tone="error">{error}</Notice></div>}
      <div className="min-h-0 flex-1">
        {e.dir ? <DirView kids={kids} onSelect={onSelect} />
          : TEXT.test(e.path) ? <TextEditor root={root} path={e.path} mtime={e.mtime} call={call} reload={reload} />
          : VIDEO.test(e.path) || IMAGE.test(e.path) ? <MediaView src={`${workSrc(`${root}/${e.path}`)}?v=${e.mtime}`} video={VIDEO.test(e.path)} />
          : AUDIO.test(e.path) ? <div className="flex justify-center p-6"><audio src={`${workSrc(`${root}/${e.path}`)}?v=${e.mtime}`} controls preload="metadata" className="w-full max-w-md" /></div>
          : PDF.test(e.path) ? <div className="flex justify-center p-6"><Button variant="outline" onClick={() => void window.open(`${workSrc(`${root}/${e.path}`)}?v=${e.mtime}`, '_blank')}><ExternalLink />{t('open_tab')}</Button></div>
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
    // 文件多的时候不把发布记录挤到很下面：最多大半屏高，里面滚
    <div className="grid max-h-[min(60vh,560px)] grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3 overflow-y-auto p-3">
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
                : <Icon className={cx('size-10', toneOf(k))} strokeWidth={1.25} />}
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
      {kids.length ? kids.map((k) => { const I = iconOf(k, false); return <button key={k.path} type="button" onClick={() => onSelect(k.path)} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted"><I className={cx('size-4', toneOf(k))} /><span className="min-w-0 flex-1 truncate">{base(k.path)}</span>{!k.dir && <span className="text-xs text-muted-foreground">{fmtSize(k.size)}</span>}</button> }) : <p className="text-muted-foreground">{t('empty_dir')}</p>}
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
    <div className="flex min-h-full flex-col" style={{ '--sticky-top': `calc(var(--page-top, 0px) + ${barH}px)` } as CSSProperties}>
      <div ref={barRef} className="sticky top-[var(--page-top,0px)] z-20 flex items-center gap-2 bg-background px-4 py-1.5 sm:px-3 sm:py-2">
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

const isRelative = (src: string) => !!src && !/^(https?:|data:|local:|folder:|work:|blob:|\/)/i.test(src)
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
    // 手机上编辑器没有外框、自己带左右内边距，这里不再加一层
    <div className="sm:px-3 sm:pb-3" onKeyDown={(ev) => saveKey(ev, save)}>
      {ext.notice && <div className="px-4 sm:px-0">{ext.notice}</div>}
      {front && <pre title={t('front_hint')} className="mx-4 mb-2 overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground sm:mx-0">{front.trim()}</pre>}
      <RichEditor key={ver} markdown extensions={exts} resolveSrc={resolveSrc} value={md} placeholder={isDraft(path) ? t('draft_placeholder') : undefined}
        onChange={(v) => { setMd(v); if (baseline.current === null) baseline.current = v.trimEnd(); else setDirty(v.trimEnd() !== baseline.current) }} />
    </div>
  )
}

function MediaView({ src, video }: { src: string; video: boolean }) {
  return <div className="flex justify-center bg-black/40 p-3">{video ? <video src={src} controls className="max-h-[520px] max-w-full rounded" /> : <img src={src} alt="" className="max-h-[520px] max-w-full rounded object-contain" />}</div>
}

/** 「新建文件」「新建文件夹」图标按钮（名字在悬停提示里）：点了在按钮下面弹一个小气泡填名字（照「排期」的气泡），点外面、按 Esc 收起；不在页面里插一行表单 */
function AddPopover({ open, onToggle, onClose, label, button, children }: { open: boolean; onToggle: () => void; onClose: () => void; label: string; button: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: globalThis.MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open, onClose])
  return (
    <div ref={ref} className="relative">
      <Button size="icon-sm" variant="ghost" title={label} aria-label={label} onClick={onToggle} aria-expanded={open} className={cx(open && 'bg-muted')}>{button}</Button>
      {open && <div role="dialog" className="absolute top-full right-0 z-30 mt-2 w-80 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">{children}</div>}
    </div>
  )
}
