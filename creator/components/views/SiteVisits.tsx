import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import SiteOverview from '../SiteOverview'
import SitePicker from '../SitePicker'
import Ga4Panel from '../Ga4Panel'
import { CustomRange, DAY, RANGES, localDate, rangeOptions } from './Search'
import { Notice, PageHeader, RangeToggle, Segmented } from '../ui'
import { isSite, runLocal, type Channel } from '../../lib/shuttle'
import { hostOf, siteURL } from '../../lib/format'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

/** 页面上模板加的标签（产品运营的「转化数据」），放在 GA4 后面 */
export type SiteTab = { value: string; label: string; render: (channel: Channel) => ReactNode }

/**
 * 网站访问：访问数据都在这一页。Creght 网站有平台的访问统计；GA4（原来在谷歌排名页）每种网站都能接；
 * 模板还能加自己的标签（extraTabs）。老链接 search?tab=ga4 由外壳转到这里的 tab=ga4。
 */
export default function SiteVisits({ ctx, params, setParam, extraTabs = [] }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void; extraTabs?: SiteTab[] }) {
  const sites = ctx.channels.filter(isSite)
  const channel = sites.find((c) => c.id === params.channel) ?? sites.find((c) => c.type === 'creght_site') ?? sites[0]
  const [days, setDays] = useState(ctx.days)
  const url = siteURL(channel)
  const stats = channel?.type === 'creght_site' && !!channel.project_id && !!channel.site_id
  const extra = extraTabs.find((t) => t.value === params.tab)
  const tab = extra ? extra.value : params.tab === 'ga4' || !stats ? 'ga4' : 'visits'
  // GA4：近 7/30/90 天或自定义（ga4_days 是老链接里的参数）
  const ga4Choice = RANGES.includes(params.ga4_range) ? params.ga4_range : ['7', '30', '90'].includes(params.ga4_days) ? params.ga4_days : '30'
  const ga4Days = ga4Choice === 'custom' ? 30 : Number(ga4Choice)
  const today = localDate(Date.now())
  const ga4Start = params.ga4_start || localDate(Date.now() - 29 * DAY)
  const ga4End = params.ga4_end || today

  // 正式地址存在渠道表里（live_url）：打开时读一次发布状态，绑了新域名、刚发布的，表里的不一样就重拉渠道
  useEffect(() => {
    if (channel?.type !== 'creght_site') return
    runLocal<{ state: string; live_url?: string }>('channels.access', { id: channel.id })
      .then((r) => { if (r.state === 'ok' && (r.live_url ?? '') !== (channel.live_url ?? '')) ctx.reloadChannels() })
      .catch(() => {})
  }, [channel?.id])

  if (!channel)
    return (
      <div className="space-y-6">
        <PageHeader title={tr('nav.site')} desc={tr('site_visits.desc')} />
        <Notice>{tr('site_visits.no_site')}</Notice>
      </div>
    )

  const options = [
    ...(stats ? [{ value: 'visits', label: tr('site_visits.tab_visits') }] : []),
    { value: 'ga4', label: tr('search.tab_ga4') },
    ...extraTabs.map((t) => ({ value: t.value, label: t.label })),
  ]
  return (
    <div className="space-y-6">
      <PageHeader title={tr('nav.site')} desc={tr(tab === 'ga4' ? 'search.ga4_desc' : 'site_visits.desc')} actions={options.length > 1 && <Segmented value={tab} onChange={(v) => setParam('tab', v === 'visits' ? '' : v)} options={options} />} />
      {/* 网站和时间段粘在顶部，往下看数据时也能随时换；写法和社交媒体「数据表现」那一行一样（-top-4 -mx 抵掉滚动区的内边距） */}
      <div className="sticky -top-4 -mx-4 -mt-3 px-4 md:-mx-6 md:px-6 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[var(--page-bg,var(--background))] py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <SitePicker sites={sites} value={channel.id} onChange={(v) => setParam('channel', v)} />
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:text-primary-text">
              {hostOf(url)} <ArrowUpRight className="size-[13px]" />
            </a>
          )}
        </div>
        {tab === 'visits' && <RangeToggle value={days} onChange={setDays} options={[7, 30, 90].map((n) => ({ value: n, label: tr('common.last_days', { n }) }))} />}
        {tab === 'ga4' && channel.ga4_property && <RangeToggle value={ga4Choice} onChange={(value) => setParam('ga4_range', value)} options={rangeOptions()} />}
      </div>
      {tab === 'ga4' && channel.ga4_property && ga4Choice === 'custom' && <CustomRange key="ga4" start={ga4Start} end={ga4End} max={today} onApply={(start, end) => { setParam('ga4_start', start); setParam('ga4_end', end) }} />}
      {extra ? (
        <div key={`${extra.value}-${channel.id}`}>{extra.render(channel)}</div>
      ) : tab === 'visits' ? (
        <SiteOverview key={channel.id} site={`${channel.project_id}/${channel.site_id}`} days={days} base={url} />
      ) : (
        <Ga4Panel key={channel.id} channel={channel} days={ga4Days} start={ga4Choice === 'custom' ? ga4Start : undefined} end={ga4Choice === 'custom' ? ga4End : undefined} onLinked={() => ctx.reloadChannels()} />
      )}
    </div>
  )
}
