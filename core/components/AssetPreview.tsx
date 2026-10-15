import { useState } from 'react'
import { ExternalLink, FileAudio, FileCode, FileText, File as FileIcon } from 'lucide-react'
import { Button, cx } from './ui'
import { tr } from '../lib/i18n'
import { fileSrc, mimeOf, openFile } from '../lib/files'
import { shuttleImage } from '../lib/shuttle'

/**
 * 资料库里一个文件的预览，按类型（mime）显示：视频、图片直接放，音频给播放器，网页、PDF 这类给一个文件块和「打开」
 * （网页用系统浏览器打开，不在页面里嵌）。资料库卡片和文章页的产物（artifacts）共用。
 */
export function AssetPreview({ a, onZoom, className }: { a: { url?: string; mime?: string; kind?: string; name?: string }; onZoom?: () => void; className?: string }) {
  const mime = mimeOf(a)
  const src = fileSrc(a.url)
  // className 换掉默认的 4:3（比如产物列表用 16:9）
  const box = cx('w-full', className ?? 'aspect-[4/3]')
  if (mime.startsWith('video/')) return <video src={src} controls preload="metadata" className={cx(box, 'bg-black object-contain')} />
  if (mime.startsWith('image/'))
    return onZoom
      ? <button type="button" onClick={onZoom} aria-label={a.name ?? ''} className={cx(box, 'block cursor-zoom-in bg-muted')}><img src={a.url?.startsWith('local:') ? src : shuttleImage(a.url)} alt={a.name ?? ''} loading="lazy" className="size-full object-cover" /></button>
      : <img src={a.url?.startsWith('local:') ? src : shuttleImage(a.url)} alt={a.name ?? ''} loading="lazy" className={cx(box, 'bg-muted object-contain')} />
  return <FileBlock a={a} mime={mime} className={box} audio={mime.startsWith('audio/') ? src : ''} />
}

function FileBlock({ a, mime, className, audio }: { a: { url?: string; name?: string }; mime: string; className: string; audio: string }) {
  const [err, setErr] = useState('')
  const html = mime === 'text/html'
  const Icon = html ? FileCode : audio ? FileAudio : mime.startsWith('text/') || mime === 'application/pdf' ? FileText : FileIcon
  const open = async () => {
    setErr('')
    try { await openFile(a.url) } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className={cx(className, 'flex flex-col items-center justify-center gap-2 bg-muted/60 p-3 text-center')}>
      <Icon className="size-6 text-muted-foreground" />
      <span className="line-clamp-2 max-w-full text-xs font-medium [overflow-wrap:anywhere]">{a.name || mime}</span>
      {audio && <audio src={audio} controls preload="metadata" className="w-full" />}
      <Button size="sm" variant="outline" onClick={open}><ExternalLink />{html ? tr('files.open_browser') : tr('files.open')}</Button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  )
}
