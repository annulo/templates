import type { MouseEvent } from 'react'
import { Share2 } from 'lucide-react'
import { CHANNELS } from '../lib/edition'
import { CHANNEL_TYPES } from '../lib/channels'
import { isSocial, SOCIAL } from '../lib/social'
import { tr } from '../lib/i18n'
import type { Channel, ChannelType } from '../lib/shuttle'
import { cx } from './ui'

/** 只展示已连接的平台；尚未连接时展示本模板已开放添加的平台。 */
export default function SocialNavEntry({ channels, active, disabled, onClick }: { channels: Channel[]; active: boolean; disabled: boolean; onClick: (e: MouseEvent) => void }) {
  const connected = [...new Set(channels.filter(isSocial).map((channel) => channel.type))]
  const types: ChannelType[] = connected.length ? connected : CHANNELS.filter((type) => !!SOCIAL[type] && CHANNEL_TYPES[type]?.ready)
  return <button type="button" data-social-entry aria-current={active ? 'page' : undefined} aria-label={tr('nav.social')} disabled={disabled} onClick={onClick} className={cx('relative flex min-h-[60px] w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', active ? 'bg-primary/10 text-foreground before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-primary' : 'text-foreground hover:bg-sidebar-accent/60')}>
    <Share2 className={cx('size-5 shrink-0', active ? 'text-primary-text' : 'text-muted-foreground')} strokeWidth={1.8} />
    <span className="min-w-0 flex-1">
      <span className="block text-base font-semibold">{tr('nav.social')}</span>
      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="flex shrink-0 items-center gap-1" aria-label={types.map((type) => CHANNEL_TYPES[type].label).join(', ')}>{types.slice(0, 3).map((type) => {
          const Icon = CHANNEL_TYPES[type].icon
          return <span key={type} title={CHANNEL_TYPES[type].label} className={cx('inline-flex', type === 'linkedin' ? 'text-[#0a66c2] dark:text-[#65aaff]' : type === 'facebook' ? 'text-[#1877f2] dark:text-[#65aaff]' : type === 'youtube' ? 'text-[#e82727] dark:text-[#ff6b6b]' : 'text-foreground')}><Icon size={13} /></span>
        })}</span>
        <span className="truncate">{tr('nav.social_capabilities')}</span>
      </span>
    </span>
  </button>
}
