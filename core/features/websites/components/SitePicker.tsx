import { Globe } from 'lucide-react'
import { CHANNEL_TYPES } from '../lib/channels'
import Select from './Select'
import type { Channel } from '../lib/shuttle'
import { hostOf } from '../lib/format'
import { tr } from '../lib/i18n'

/**
 * 选看哪个网站：放在页头下面单独一行（网站再多也只占一格，不和页头的说明、按钮挤）。只有一个网站时不显示。
 */
export default function SitePicker({ sites, value, onChange }: { sites: Channel[]; value: string; onChange: (id: string) => void }) {
  if (sites.length < 2) return null
  return (
    <div className="flex w-fit max-w-full items-center gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{tr('ui.site')}</span>
      <Select
        variant="inline"
        title={tr('ui.site')}
        ariaLabel={tr('ui.pick_site')}
        value={value}
        onChange={onChange}
        className="max-w-72"
        options={sites.map((s) => {
          // 图标按渠道类型：Creght 网站是 Creght 的标，WordPress 是地球
          const Icon = CHANNEL_TYPES[s.type]?.icon ?? Globe
          return { value: s.id, label: s.name, sub: s.preview_url ? hostOf(s.preview_url) : undefined, icon: <Icon size={14} className="size-3.5" /> }
        })}
      />
    </div>
  )
}
