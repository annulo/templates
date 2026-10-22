import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button, Dialog, Notice } from './ui'
import { tr } from '../lib/i18n'

/** 导出的图长边最多这么多像素：封面用不着更大，原图很大时文件也不会太大 */
const MAX_SIDE = 2160

/**
 * 把一张图裁成固定比例（视频封面：小红书、抖音 3:4，B站 4:3……）。取景框按比例固定，图在框后面拖动、缩放（滑块或滚轮），
 * 图总是铺满取景框，不会露出空白。「用这张」按原图分辨率导出取景框里的那块（长边超过 MAX_SIDE 才缩小），JPEG。
 * 只管裁，存到哪由调用的地方定（onDone 拿到图片）。
 */
export default function ImageCropper({ open, src, ratio, title, onClose, onDone }: {
  open: boolean
  src: string
  /** [宽, 高] */
  ratio: [number, number]
  title?: string
  onClose: () => void
  onDone: (image: Blob, size: { width: number; height: number }) => Promise<void>
}) {
  const box = useRef<HTMLDivElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [view, setView] = useState({ w: 0, h: 0 })
  // zoom 1 是正好铺满取景框；x、y 是图片左上角相对取景框的位置（像素，≤ 0）
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setImg(null); setLoadErr(''); setErr(''); setZoom(1)
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => setImg(i)
    i.onerror = () => setLoadErr(tr('crop.load_failed'))
    i.src = src
  }, [open, src])
  // 取景框的大小跟着弹窗宽度变
  useEffect(() => {
    const el = box.current
    if (!open || !el) return
    const fit = () => setView({ w: el.clientWidth, h: el.clientHeight })
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, !!img])

  const base = img && view.w ? Math.max(view.w / img.naturalWidth, view.h / img.naturalHeight) : 0
  const scale = base * zoom
  const clamp = (x: number, y: number, s = scale) => img ? {
    x: Math.min(0, Math.max(view.w - img.naturalWidth * s, x)),
    y: Math.min(0, Math.max(view.h - img.naturalHeight * s, y)),
  } : { x: 0, y: 0 }
  // 图片加载好、取景框量好以后居中
  useEffect(() => {
    if (!img || !base) return
    setPos(clamp((view.w - img.naturalWidth * base) / 2, (view.h - img.naturalHeight * base) / 2, base))
  }, [img, base])
  /** 缩放时取景框中心对着的那一点不动 */
  const zoomTo = (z: number) => {
    const next = Math.min(4, Math.max(1, z))
    if (!img || !base) return setZoom(next)
    const cx = (view.w / 2 - pos.x) / scale, cy = (view.h / 2 - pos.y) / scale
    const s = base * next
    setZoom(next)
    setPos(clamp(view.w / 2 - cx * s, view.h / 2 - cy * s, s))
  }
  const onDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (d) setPos(clamp(d.px + e.clientX - d.x, d.py + e.clientY - d.y))
  }

  const done = async () => {
    if (!img || !scale) return
    setBusy(true); setErr('')
    try {
      const sx = -pos.x / scale, sy = -pos.y / scale, sw = view.w / scale, sh = view.h / scale
      const k = Math.min(1, MAX_SIDE / Math.max(sw, sh))
      const width = Math.round(sw * k), height = Math.round(sh * k)
      const c = document.createElement('canvas')
      c.width = width; c.height = height
      const g = c.getContext('2d')!
      g.fillStyle = '#000'
      g.fillRect(0, 0, width, height)
      g.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error(tr('crop.export_failed'))
      await onDone(blob, { width, height })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const [a, b] = ratio
  return <Dialog open={open} onClose={onClose} width={600} title={title ?? tr('crop.title', { ratio: `${a}:${b}` })} footer={<>
    <Button variant="ghost" size="sm" onClick={onClose}>{tr('common.cancel')}</Button>
    <Button size="sm" disabled={!img || busy} onClick={() => void done()}>{busy ? <Loader2 className="animate-spin" /> : <Check />}{tr('crop.use')}</Button>
  </>}>
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{tr('crop.hint')}</p>
      {loadErr ? <Notice tone="error">{loadErr}</Notice> : <div className="flex justify-center rounded-lg bg-muted/40 p-2">
        {/* 取景框：宽最多铺满，高最多半屏，按比例算出另一边 */}
        <div ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
          onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
          className="relative cursor-grab touch-none overflow-hidden rounded-md bg-black select-none active:cursor-grabbing"
          style={{ aspectRatio: `${a} / ${b}`, width: `min(100%, calc(50vh * ${a / b}))` }}>
          {img ? <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
            style={{ width: img.naturalWidth, height: img.naturalHeight, transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }} />
            : <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-white/70" />}
          {/* 三分线：对齐主体用 */}
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">{Array.from({ length: 9 }, (_, i) => <span key={i} className="border-[0.5px] border-white/25" />)}</div>
        </div>
      </div>}
      <div className="flex items-center gap-2">
        <button type="button" aria-label={tr('crop.zoom_out')} onClick={() => zoomTo(zoom / 1.2)} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><ZoomOut className="size-4" /></button>
        <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label={tr('crop.zoom')} className="min-w-0 flex-1 accent-primary" />
        <button type="button" aria-label={tr('crop.zoom_in')} onClick={() => zoomTo(zoom * 1.2)} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><ZoomIn className="size-4" /></button>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  </Dialog>
}
