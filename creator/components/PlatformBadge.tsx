import { PLATFORMS, type Platform } from '../lib/social'
import { cn } from '../lib/utils'

/** 平台徽标：一个带平台颜色的小方块（不放各家的 logo 文件，换主题也不用改） */
export function PlatformBadge({ type, className }: { type: Platform | string; className?: string }) {
  const m = PLATFORMS[type as Platform]
  return (
    <span className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white', className)} style={{ background: m?.color ?? '#6b7280' }}>
      {m?.mark ?? '?'}
    </span>
  )
}
