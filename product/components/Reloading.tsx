import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cx } from './ui'
import { tr } from '../lib/i18n'

/** 换时间段、筛选这类重新取数时：旧数据留着变淡、不能点，上面浮一个「加载中…」，不会整块闪成骨架 */
export default function Reloading({ loading, children, className }: { loading: boolean; children: ReactNode; className?: string }) {
  return (
    <div className="relative" aria-busy={loading}>
      <div className={cx('transition-opacity', loading && 'pointer-events-none opacity-50', className)}>{children}</div>
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 z-10 flex justify-center">
          <div className="sticky top-24 mt-12 inline-flex h-8 items-center gap-2 self-start rounded-full border border-border bg-background px-3 text-xs text-muted-foreground shadow-sm">
            <Loader2 className="size-3.5 animate-spin" /> {tr('common.loading')}
          </div>
        </div>
      )}
    </div>
  )
}
