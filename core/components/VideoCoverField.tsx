import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Upload, X } from 'lucide-react'
import AssetPicker from './AssetPicker'
import UploadProgress from './UploadProgress'
import { Button, Field, Notice } from './ui'
import { uploadAssets, type UploadItem } from '../lib/assets'
import { dbList, type Asset } from '../lib/shuttle'
import { usePasteFiles } from '../lib/usePasteFiles'
import { tr } from '../lib/i18n'

/** A single cover stored in the Library. Failed replacements keep the previous cover. */
export default function VideoCoverField({ value, onChange, onUploadingChange }: {
  value: string; onChange: (url: string) => void; onUploadingChange?: (busy: boolean) => void
}) {
  const [picking, setPicking] = useState(false), [uploading, setUploading] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([]), [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const uploadingRef = useRef(false)
  const upload = async (files: File[]) => {
    if (!files.length || uploadingRef.current) return
    const chosen = files[0]
    if (!chosen.type.startsWith('image/')) { setError(tr('article.image_required')); return }
    uploadingRef.current = true
    setError(''); setUploading(true); onUploadingChange?.(true)
    try {
      const existing = await dbList('assets').catch(() => [] as Asset[])
      const result = await uploadAssets([chosen], existing, setUploads)
      if (result[0]?.asset?.url) { onChange(result[0].asset.url); setUploads([]) }
    } catch (e) { setError((e as Error).message) }
    finally { uploadingRef.current = false; setUploading(false); onUploadingChange?.(false) }
  }
  usePasteFiles(!picking && !uploading, upload)
  return <Field group label={tr('article.video_cover')} hint={tr('article.video_cover_hint')}>
    <div className="space-y-3">
      {value && <div className="relative w-fit">
        <img src={value} alt={tr('article.video_cover')} className="max-h-56 max-w-full rounded-lg border border-border object-contain" />
        <Button size="icon-sm" variant="secondary" disabled={uploading} aria-label={tr('article.remove_cover')} title={tr('article.remove_cover')}
          className="absolute top-2 right-2" onClick={() => onChange('')}><X /></Button>
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={e => { void upload([...(e.target.files || [])]); e.target.value = '' }} />
        <Button variant="outline" size="sm" disabled={uploading} onClick={() => file.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}{uploading ? tr('ui.uploading') : value ? tr('article.replace_cover') : tr('ui.upload')}
        </Button>
        <Button variant="outline" size="sm" disabled={uploading} onClick={() => setPicking(true)}><ImagePlus />{tr('social.pick_assets')}</Button>
        <span className="text-xs text-muted-foreground">{tr('article.paste_hint')}</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <UploadProgress items={uploads} />
    </div>
    <AssetPicker onUploadingChange={onUploadingChange} open={picking} kind="image" max={1} onClose={() => setPicking(false)} onPick={urls => { if (urls[0]) onChange(urls[0]); setPicking(false) }} />
  </Field>
}
