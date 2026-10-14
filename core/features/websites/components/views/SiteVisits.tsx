import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import SiteOverview from '../SiteOverview'
import SitePicker from '../SitePicker'
import { Button, Notice, PageHeader, RangeToggle } from '../ui'
import { isSite } from '../../lib/shuttle'
import { hostOf } from '../../lib/format'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

/** 网站访问：Creght 网站的访问统计（原来放在「网站和账号」页）；WordPress 没有访问统计，指到谷歌排名的 GA4 */
export default function SiteVisits({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const sites = ctx.channels.filter(isSite)
  const channel = sites.find((c) => c.id === params.channel) ?? sites.find((c) => c.type === 'creght_site') ?? sites[0]
  const [days, setDays] = useState(ctx.days)

  if (!channel)
    return (
      <div className="space-y-6">
        <PageHeader title={tr('nav.site')} desc={tr('site_visits.desc')} />
        <Notice>{tr('site_visits.no_site')}</Notice>
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader title={tr('nav.site')} desc={tr('site_visits.desc')} />
      {/* 网站和时间段粘在顶部，往下看数据时也能随时换；写法和社交媒体「数据表现」那一行一样（-top-4 -mx 抵掉滚动区的内边距） */}
      <div className="sticky -top-4 -mx-4 -mt-3 px-4 md:-mx-6 md:px-6 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <SitePicker sites={sites} value={channel.id} onChange={(v) => setParam('channel', v)} />
          {channel.preview_url && (
            <a href={channel.preview_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:text-primary-text">
              {hostOf(channel.preview_url)} <ArrowUpRight className="size-[13px]" />
            </a>
          )}
        </div>
        {channel.type === 'creght_site' && <RangeToggle value={days} onChange={setDays} options={[7, 30, 90].map((n) => ({ value: n, label: tr('common.last_days', { n }) }))} />}
      </div>
      {channel.type === 'creght_site' && channel.project_id && channel.site_id ? (
        <SiteOverview key={channel.id} site={`${channel.project_id}/${channel.site_id}`} days={days} />
      ) : (
        <Notice>
          <p>{tr('channels.wp_no_stats')}</p>
          <Button variant="outline" size="sm" onClick={() => ctx.go('search', { channel: channel.id, tab: 'ga4' })}>{tr('search.tab_ga4')}</Button>
        </Notice>
      )}
    </div>
  )
}
