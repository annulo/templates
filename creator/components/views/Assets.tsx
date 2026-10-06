import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Copy, FileText, Pencil, Plus, Search, Trash2, Upload, Video } from 'lucide-react'
import { Badge, Button, Dialog, Field, Notice, PageHeader, Segmented, Skeleton, cx, fmtTime, inputCls } from '../ui'
import { dbCreate, dbDelete, dbList, dbPatch, shuttleImage, type Asset, type AssetKind } from '../../lib/shuttle'
import { ACCEPT_UPLOAD, ASSET_KINDS, assetTags, filterAssets, kindOfUrl, nameOfUrl, splitTags, uploadAssets, type UploadItem } from '../../lib/assets'
import UploadProgress from '../UploadProgress'
import Lightbox from '../Lightbox'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

type KindFilter = '' | AssetKind

/** 素材库：图片、视频的地址和文字素材，存在 assets 表。写社媒笔记时「从素材库选」读这里 */
export default function Assets({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const kind: KindFilter = (['image', 'video', 'text'] as string[]).includes(params.kind) ? (params.kind as AssetKind) : ''
  const tag = params.tag ?? ''
  const [q, setQ] = useState('')
  const [list, setList] = useState<Asset[] | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Asset | null>(null)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    dbList('assets')
      .then((l) => setList([...l].sort((a, b) => (Date.parse(b.created_at ?? '') || 0) - (Date.parse(a.created_at ?? '') || 0))))
      .catch((e) => {
        if (/没有这张表|table not found/i.test(e.message)) setList([])
        else setError(e.message)
      })
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': 0, image: 0, video: 0, text: 0 }
    for (const a of list ?? []) {
      c['']++
      c[a.kind] = (c[a.kind] ?? 0) + 1
    }
    return c
  }, [list])
  const tags = useMemo(() => [...new Set((list ?? []).flatMap(assetTags))].sort(), [list])
  const shown = useMemo(() => filterAssets(list ?? [], { q, kind, tag }), [list, q, kind, tag])

  const upload = async (files: File[]) => {
    if (!files.length || uploading) return
    setUploading(true)
    try {
      await uploadAssets(files, list ?? [], setUploads)
    } finally {
      setUploading(false)
      load()
    }
  }
  // 把文件拖到页面上任意位置就上传
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragging(true)
  }
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    setDragging(false)
    upload([...e.dataTransfer.files].filter((f) => /^(image|video)\//.test(f.type)))
  }

  return (
    <div className={cx('relative space-y-6', dragging && 'rounded-xl outline-2 outline-offset-8 outline-primary/60 outline-dashed')} onDragOver={onDragOver} onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)} onDrop={onDrop}>
      <PageHeader
        title={tr('assets.title')}
        desc={tr('assets.desc')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" multiple accept={ACCEPT_UPLOAD} className="hidden" onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = '' }} />
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} title={tr('assets.upload_title')}>
              <Upload />
              {uploading ? tr('ui.uploading') : tr('ui.upload')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus />
              {tr('assets.add')}
            </Button>
          </div>
        }
      />
      <UploadProgress items={uploads} />
      {error && <Notice tone="error">{error}</Notice>}
      {ctx.offline && <Notice>{tr('assets.offline')}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<KindFilter>
          value={kind}
          onChange={(v) => setParam('kind', v)}
          options={[
            { value: '', label: tr('assets.f_all', { n: counts[''] }) },
            { value: 'image', label: tr('assets.f_image', { n: counts.image }) },
            { value: 'video', label: tr('assets.f_video', { n: counts.video }) },
            { value: 'text', label: tr('assets.f_text', { n: counts.text }) },
          ]}
        />
        <div className="relative min-w-48 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cx(inputCls, 'h-9 pl-8')} placeholder={tr('assets.search_ph')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => setParam('tag', tag === t ? '' : t)} className={cx('cursor-pointer rounded-md border px-2 py-0.5 text-xs', tag === t ? 'border-primary/30 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:text-foreground')}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {list === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
          ))}
        </div>
      ) : !list.length ? (
        <Notice>{tr('assets.empty')}</Notice>
      ) : !shown.length ? (
        <Notice>{tr('assets.no_match')}</Notice>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((a) => (
            <AssetCard key={a.id} a={a} disabled={false} onEdit={() => setEditing(a)} onChanged={load} onTag={(t) => setParam('tag', t)} />
          ))}
        </div>
      )}

      <AddDialog open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load() }} />
      <EditDialog a={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />
    </div>
  )
}

function AssetCard({ a, disabled, onEdit, onChanged, onTag }: { a: Asset; disabled: boolean; onEdit: () => void; onChanged: () => void; onTag: (t: string) => void }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const tags = assetTags(a)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a.kind === 'text' ? a.text ?? '' : a.url ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setErr(tr('assets.copy_failed'))
    }
  }
  const del = async () => {
    try {
      await dbDelete('assets', a.id)
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
      return false
    }
  }
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
      {a.kind === 'text' ? (
        <div className="flex aspect-[4/3] flex-col gap-2 bg-muted/60 p-3">
          <FileText className="size-4 text-muted-foreground" />
          <p className="line-clamp-5 text-xs leading-relaxed whitespace-pre-line">{a.text}</p>
        </div>
      ) : a.kind === 'video' ? (
        <div className="relative">
          <video src={a.url} controls preload="metadata" className="aspect-[4/3] w-full bg-black object-contain" />
          <Video className="pointer-events-none absolute top-2 left-2 size-4 text-white drop-shadow" />
        </div>
      ) : (
        <button type="button" onClick={() => setZoom(true)} aria-label={a.name || ASSET_KINDS[a.kind]} className="block w-full cursor-zoom-in bg-muted">
          <img src={shuttleImage(a.url)} alt={a.name ?? ''} loading="lazy" className="aspect-[4/3] w-full object-cover" />
        </button>
      )}
      {zoom && a.url && <Lightbox src={a.url} alt={a.name ?? ''} onClose={() => setZoom(false)} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium" title={a.name}>
            {a.name || ASSET_KINDS[a.kind]}
          </span>
          {a.source === 'agent' && <Badge>{tr('assets.by_agent')}</Badge>}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 text-xs text-primary-text">
            {tags.map((t) => (
              <button key={t} type="button" className="cursor-pointer hover:underline" onClick={() => onTag(t)}>
                #{t}
              </button>
            ))}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground">{fmtTime(a.created_at)}</div>
        {err && <div className="text-xs text-destructive">{err}</div>}
        <div className="mt-auto flex items-center gap-0.5 pt-1">
          <Button variant="ghost" size="icon-sm" title={a.kind === 'text' ? tr('assets.copy_text') : tr('assets.copy_url')} onClick={copy}>
            <Copy className={cx(copied && 'text-emerald-600')} />
          </Button>
          <Button variant="ghost" size="icon-sm" title={tr('assets.edit_title')} onClick={onEdit} disabled={disabled}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cx('ml-auto', confirmDel ? 'text-destructive hover:text-destructive' : 'text-muted-foreground')}
            disabled={disabled}
            onMouseLeave={() => setConfirmDel(false)}
            onClick={() => (confirmDel ? del() : setConfirmDel(true))}
            title={tr('assets.delete_title')}
          >
            <Trash2 />
            {confirmDel ? tr('common.confirm_delete') : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 添加素材：贴地址（一行一个，可以一次贴多个）或者写一段文字 */
function AddDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'url' | 'text'>('url')
  const [urls, setUrls] = useState('')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!open) return
    setUrls('')
    setName('')
    setText('')
    setTags('')
    setErr('')
  }, [open])

  const lines = urls.split(/\s+/).map((s) => s.trim()).filter(Boolean)
  const bad = lines.filter((u) => !/^https:\/\/[^\s]+$/i.test(u))
  const ok = mode === 'url' ? lines.length > 0 && !bad.length : text.trim().length > 0

  const save = async () => {
    setBusy(true)
    setErr('')
    const now = new Date().toISOString()
    const tagJson = JSON.stringify(splitTags(tags))
    try {
      if (mode === 'text') {
        await dbCreate('assets', { kind: 'text', name: name.trim() || [...text.trim()].slice(0, 20).join(''), text: text.trim(), tags: tagJson, source: 'manual', created_at: now })
      } else {
        for (const u of lines) {
          await dbCreate('assets', { kind: kindOfUrl(u), url: u, name: lines.length === 1 && name.trim() ? name.trim() : nameOfUrl(u), tags: tagJson, source: 'url', created_at: now })
        }
      }
      onDone()
    } catch (e) {
      setErr((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr('assets.add')}
      width={560}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          <Button successLabel={tr('ui.saved')} size="sm" onClick={save} disabled={!ok || busy}>
            {mode === 'url' && lines.length > 1 ? tr('assets.add_n', { n: lines.length }) : tr('common.add')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented<'url' | 'text'>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'url', label: tr('assets.mode_url') },
            { value: 'text', label: tr('assets.mode_text') },
          ]}
        />
        {mode === 'url' ? (
          <Field label={tr('assets.url')} hint={tr('assets.url_hint')}>
            <textarea className={cx(inputCls, 'min-h-28 py-2 font-mono text-xs', bad.length > 0 && 'border-destructive')} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://…/cover.jpg" />
          </Field>
        ) : (
          <Field label={tr('assets.content')} hint={tr('assets.content_hint')}>
            <textarea className={cx(inputCls, 'min-h-32 py-2')} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        {bad.length > 0 && <div className="text-xs text-destructive">{tr('assets.not_https', { list: bad.slice(0, 3).join(', ') })}</div>}
        {(mode === 'text' || lines.length <= 1) && (
          <Field label={tr('assets.name')} hint={tr('assets.name_hint')}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label={tr('assets.tags')} hint={tr('assets.tags_hint')}>
          <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {err && <Notice tone="error">{err}</Notice>}
      </div>
    </Dialog>
  )
}

function EditDialog({ a, onClose, onDone }: { a: Asset | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!a) return
    setName(a.name ?? '')
    setTags(assetTags(a).join(' '))
    setText(a.text ?? '')
    setErr('')
  }, [a?.id])
  const save = async () => {
    if (!a) return
    try {
      await dbPatch('assets', a.id, { name: name.trim(), tags: JSON.stringify(splitTags(tags)), ...(a.kind === 'text' ? { text: text.trim() } : {}) })
      onDone()
    } catch (e) {
      setErr((e as Error).message)
      return false
    }
  }
  return (
    <Dialog
      open={!!a}
      onClose={onClose}
      title={tr('assets.edit')}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          <Button successLabel={tr('ui.saved')} size="sm" onClick={save}>
            {tr('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={tr('assets.name')}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {a?.kind === 'text' && (
          <Field label={tr('assets.content')}>
            <textarea className={cx(inputCls, 'min-h-32 py-2')} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        <Field label={tr('assets.tags')} hint={tr('assets.tags_hint_short')}>
          <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {err && <Notice tone="error">{err}</Notice>}
      </div>
    </Dialog>
  )
}
