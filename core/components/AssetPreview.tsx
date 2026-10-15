import { useState } from 'react'
import { ExternalLink, FileAudio, FileCode, FileText, File as FileIcon, FolderOpen } from 'lucide-react'
import { cx } from './ui'
import { tr } from '../lib/i18n'
import { fileSrc, mimeOf, openFile } from '../lib/files'
import { shuttleImage } from '../lib/shuttle'

/**
 * 资料库里一个文件的预览，按类型（mime）显示：视频、图片直接放，音频给播放器，网页、PDF 这类显示一个文件块（不在页面里嵌）。
 * 打开、在访达中显示放在下面的 FileActions，和对话里的本机图片、视频同一个样子。资料库卡片和文章页的产物（artifacts）共用。
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
  const Icon = mime === 'text/html' ? FileCode : audio ? FileAudio : mime.startsWith('text/') || mime === 'application/pdf' ? FileText : FileIcon
  return (
    <div className={cx(className, 'flex flex-col items-center justify-center gap-2 bg-muted/60 p-3 text-center')}>
      <Icon className="size-6 text-muted-foreground" />
      <span className="line-clamp-2 max-w-full text-xs font-medium [overflow-wrap:anywhere]">{a.name || mime}</span>
      {audio && <audio src={audio} controls preload="metadata" className="w-full" />}
    </div>
  )
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

/**
 * 文件下面那排小按钮：「打开」用系统程序（网页用系统浏览器），「在访达中显示」。和 Annulo 对话里本机图片、视频下面的一样。
 * 网址（不是本机文件）只有「打开」，在新标签页打开
 */
export function FileActions({ url, className }: { url?: string; className?: string }) {
  const [err, setErr] = useState('')
  if (!url) return null
  const run = async (reveal: boolean) => {
    setErr('')
    try { await openFile(url, reveal) } catch (e) { setErr((e as Error).message) }
  }
  const btn = 'inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 hover:bg-muted hover:text-foreground'
  return (
    <div className={cx('flex flex-wrap items-center gap-1 text-xs text-muted-foreground', className)}>
      <button type="button" onClick={() => run(false)} title={tr('files.open_hint')} className={btn}><ExternalLink className="size-3.5" />{tr('files.open')}</button>
      {url.startsWith('local:') && <button type="button" onClick={() => run(true)} className={btn}><FolderOpen className="size-3.5" />{isMac ? tr('files.reveal_mac') : tr('files.reveal')}</button>}
      {err && <span className="w-full text-destructive">{err}</span>}
    </div>
  )
}
