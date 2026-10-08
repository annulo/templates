import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, Upload } from 'lucide-react'
import { Button, Dialog, Notice, Skeleton, cx, inputCls } from './ui'
import { dbList, shuttleImage, type Asset, type AssetKind } from '../lib/shuttle'
import { assetTags, filterAssets, uploadAssets, type UploadItem } from '../lib/assets'
import UploadProgress from './UploadProgress'
import { usePasteFiles } from '../lib/usePasteFiles'
import { tr } from '../lib/i18n'

/** 从素材库选图片（或视频）：多选，确定后把地址交给 onPick。也能当场上传，传完直接选中 */
export default function AssetPicker({ open, kind = 'image', max, onClose, onPick }: { open: boolean; kind?: AssetKind; max?: number; onClose: () => void; onPick: (urls: string[]) => void }) {
  const [list, setList] = useState<Asset[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setPicked([])
    setUploads([])
    setList(null)
    setError('')
    dbList('assets')
      .then((l) => setList(l.filter((a) => a.kind === kind && a.url).sort((a, b) => (Date.parse(b.created_at ?? '') || 0) - (Date.parse(a.created_at ?? '') || 0))))
      .catch((e) => setError(/没有这张表|table not found/i.test(e.message) ? tr('ui.picker_empty_table') : e.message))
  }, [open, kind])

  const tags = useMemo(() => [...new Set((list ?? []).flatMap(assetTags))].sort(), [list])
  const shown = useMemo(() => filterAssets(list ?? [], { q, tag }), [list, q, tag])
  const full = max !== undefined && picked.length >= max
  const toggle = (url: string) => setPicked((p) => (p.includes(url) ? p.filter((x) => x !== url) : full ? p : [...p, url]))

  const upload = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    try {
      const done = (await uploadAssets(files, list ?? [], setUploads)).flatMap((x) => (x.asset?.url && x.asset.kind === kind ? [x.asset] : []))
      // 传完放到最前面并选中（不超过上限）
      setList((l) => [...done, ...(l ?? []).filter((a) => !done.some((d) => d.id === a.id))])
      setPicked((p) => {
        const out = [...p]
        for (const a of done) if (!out.includes(a.url!) && (max === undefined || out.length < max)) out.push(a.url!)
        return out
      })
    } finally {
      setUploading(false)
    }
  }
  // 打开时能直接粘贴截图、复制的图片：上传进资料库并选上（同上传按钮）
  usePasteFiles(open && kind === 'image' && !uploading, upload)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr('ui.picker_title')}
      width={720}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          <Button size="sm" disabled={!picked.length} onClick={() => onPick(picked)}>
            {picked.length ? tr('ui.picker_done_n', { n: picked.length }) : tr('ui.picker_done')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input className={cx(inputCls, 'h-9 pl-8')} placeholder={tr('ui.picker_search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {max !== undefined && <span className="text-xs text-muted-foreground">{tr('ui.picker_left', { n: Math.max(0, max - picked.length) })}</span>}
          <input ref={fileRef} type="file" multiple accept={kind === 'video' ? 'video/*' : 'image/*'} className="hidden" onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = '' }} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} title={tr('ui.upload_limit')}>
            <Upload />
            {uploading ? tr('ui.uploading') : tr('ui.upload')}
          </Button>
        </div>
        <UploadProgress items={uploads} />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button key={t} type="button" onClick={() => setTag(tag === t ? '' : t)} className={cx('cursor-pointer rounded-md border px-2 py-0.5 text-xs', tag === t ? 'border-primary/30 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:text-foreground')}>
                #{t}
              </button>
            ))}
          </div>
        )}
        {list === null && !error ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : list && !shown.length ? (
          <Notice>{list.length ? tr('ui.picker_no_match') : tr(kind === 'video' ? 'ui.picker_none_video' : 'ui.picker_none_image')}</Notice>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shown.map((a) => {
              const on = picked.includes(a.url!)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.url!)}
                  disabled={!on && full}
                  title={a.name}
                  className={cx('relative cursor-pointer overflow-hidden rounded-lg border-2 transition-colors disabled:cursor-default disabled:opacity-40', on ? 'border-primary' : 'border-transparent hover:border-border')}
                >
                  {a.kind === 'video' ? (
                    <video src={a.url} muted preload="metadata" className="aspect-square w-full bg-muted object-cover" />
                  ) : (
                    <img src={shuttleImage(a.url)} alt={a.name ?? ''} loading="lazy" className="aspect-square w-full bg-muted object-cover" />
                  )}
                  {on && (
                    <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3.5" />
                    </span>
                  )}
                  {a.name && <span className="absolute inset-x-0 bottom-0 truncate bg-black/45 px-1.5 py-0.5 text-left text-[10px] text-white">{a.name}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Dialog>
  )
}
