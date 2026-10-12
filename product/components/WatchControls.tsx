import { Eye, Square } from 'lucide-react'
import { cx } from './ui'
import { tr } from '../lib/i18n'

/**
 * 正在跑的、会开浏览器的操作右边的两个小按钮：打开看（眼睛：内置浏览器在 App 里打开成标签页）、停止（方块）。
 * 自检、采集按钮（RunButton watch）和发布记录、右下角的发布进度都用它，样子一致
 */
export default function WatchControls({ onShow, onStop, className }: { onShow?: () => void; onStop?: () => void; className?: string }) {
  const btn = 'inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors'
  return <span className={cx('inline-flex items-center gap-0.5', className)}>
    {onShow && <button type="button" onClick={onShow} title={tr('ui.watch_show')} aria-label={tr('ui.watch_show')} className={cx(btn, 'hover:bg-accent hover:text-foreground')}><Eye className="size-4" /></button>}
    {onStop && <button type="button" onClick={onStop} title={tr('ui.watch_stop')} aria-label={tr('ui.watch_stop')} className={cx(btn, 'hover:bg-destructive/10 hover:text-destructive')}><Square className="size-3.5 fill-current" /></button>}
  </span>
}
