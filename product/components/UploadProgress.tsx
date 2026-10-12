import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { cx } from './ui'
import type { UploadItem } from '../lib/assets'
import { tr } from '../lib/i18n'

/** 上传进度：每个文件一行，失败的写原因 */
export default function UploadProgress({ items, className }: { items: UploadItem[]; className?: string }) {
  if (!items.length) return null
  const done = items.filter((x) => x.status === 'done').length
  return (
    <div className={cx('rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs', className)}>
      <div className="mb-1 font-medium text-muted-foreground">
        {tr('ui.uploading_n', { done, total: items.length })}
      </div>
      <ul className="space-y-1">
        {items.map((x, i) => (
          <li key={i} className="flex min-w-0 items-start gap-1.5">
            {x.status === 'done' ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : x.status === 'failed' ? (
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            ) : (
              <Loader2 className={cx('mt-0.5 size-3.5 shrink-0 text-muted-foreground', x.status === 'uploading' && 'animate-spin')} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{x.name}</span>
              {x.error && <span className="block text-destructive">{x.error}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
