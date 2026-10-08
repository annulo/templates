import { useRef, useState } from 'react'
import { HardDrive, Loader2, Plus } from 'lucide-react'
import AssetPicker from './AssetPicker'
import { Button, Notice } from './ui'
import { uploadLocalFile, videoSrc } from '../lib/shuttle'
import { tr } from '../lib/i18n'

/** 视频：从资料库选，或上传这台电脑上的视频（存成 local:<name>，发布时由这台电脑直接传给平台） */
export default function VideoField({ video, onChange }: { video: string; onChange: (v: string) => void }) {
  const [picking, setPicking] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const upload = async (f?: File) => {
    if (!f) return
    setErr('')
    setProgress(0)
    try {
      const r = await uploadLocalFile(f, setProgress)
      onChange(r.ref)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setProgress(null)
    }
  }
  const busy = progress != null
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm leading-none font-medium">
          {tr('social.f_video')}
          {video.startsWith('local:') && <span className="ml-2 text-xs font-normal text-muted-foreground">{tr('social.local_file')}</span>}
        </span>
        <div className="flex gap-1">
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <HardDrive />}
            {busy ? tr('social.uploading_pct', { n: Math.round((progress ?? 0) * 100) }) : tr('social.upload_local')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)} disabled={busy}>
            <Plus />
            {video ? tr('social.change_video') : tr('social.pick_video')}
          </Button>
        </div>
      </div>
      {video ? <video src={videoSrc(video)} controls className="max-h-48 w-full rounded-md border border-border bg-black" /> : <span className="text-xs text-muted-foreground">{tr('social.no_video')}</span>}
      {err && <Notice tone="error">{err}</Notice>}
      <span className="text-xs leading-relaxed text-muted-foreground">{tr('social.local_hint')}</span>
      <AssetPicker open={picking} kind="video" max={1} onClose={() => setPicking(false)} onPick={(urls) => { if (urls[0]) onChange(urls[0]); setPicking(false) }} />
    </div>
  )
}
