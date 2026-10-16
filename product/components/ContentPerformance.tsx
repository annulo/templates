import { useEffect, useState } from 'react'
import { ArrowUpRight, Eye, Heart, MessageCircle, TrendingUp } from 'lucide-react'
import TrendChart from './charts/TrendChart'
import { GrowthReviews } from './MarketingWorkspace'
import { Panel, Segmented, Skeleton, cx } from './ui'
import { CHANNEL_TYPES } from '../lib/channels'
import { platformOf } from '../lib/social'
import { fmtDay } from '../lib/format'
import { runLocal } from '../lib/shuttle'
import { isEn, tr } from '../lib/i18n'
import { entryPosts, postsMetrics, publishedUrl, type ContentData, type ContentEntry, type PostMetrics } from '../lib/contentWorkspace'
import type { Ctx } from './views/types'

const w = (key: string, vars?: Record<string, unknown>) => tr('workspace.' + key, vars)
export const compact = (n: number) => new Intl.NumberFormat(isEn() ? 'en' : 'zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
type Metrics = ReturnType<typeof postsMetrics>
type Metric = 'views' | 'likes' | 'collects' | 'comments'
type Day = PostMetrics & { date: string }

/** 一条内容发出去以后的数据：各账号累计的浏览、点赞、评论，近 7 天浏览涨了多少（还没有每天的记录就不显示） */
export function MetricsLine({ m }: { m?: Metrics }) {
  if (!m) return null
  return <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
    <span className="inline-flex items-center gap-1" title={w('metric_views')}><Eye className="size-3.5" />{compact(m.views)}</span>
    <span className="inline-flex items-center gap-1" title={w('metric_likes')}><Heart className="size-3.5" />{compact(m.likes)}</span>
    <span className="inline-flex items-center gap-1" title={w('metric_comments')}><MessageCircle className="size-3.5" />{compact(m.comments)}</span>
    {m.gain && <span className={cx('inline-flex items-center gap-1', m.gain.views > 0 && 'text-primary-text')} title={w('metric_gain_hint')}>
      <TrendingUp className="size-3.5" />{w('metric_gain', { n: (m.gain.views > 0 ? '+' : '') + compact(m.gain.views) })}</span>}
    {m.posts > 1 && <span>{w('metric_posts', { n: m.posts })}</span>}
  </div>
}

/**
 * 内容详情里的「发布后的效果」：每个平台版本一张小图（各自的刻度：平台之间的量级差得多，画在一起小的会被压平），
 * 下面是这条内容的复盘。没发出去、也没有复盘时不显示。
 */
export default function ContentPerformance({ ctx, entry, data }: { ctx: Ctx; entry: ContentEntry; data: ContentData }) {
  const posts = entryPosts(entry, data)
  const ids = posts.map(p => p.id).join(',')
  const targets = [entry.plan?.id, entry.article?.id].filter(Boolean)
  const [days, setDays] = useState<Record<string, Day[]> | null>(null)
  const [metric, setMetric] = useState<Metric>('views')
  useEffect(() => {
    if (!ids) return
    let live = true
    runLocal<{ days: Record<string, Day[]> }>('content-workspace.performance', { post_ids: ids.split(',') })
      .then(r => live && setDays(r.days)).catch(() => live && setDays({}))
    return () => { live = false }
  }, [ids, ctx.rev])
  const account = (id: string) => data.channels.find(c => c.id === id)
  return <>
    {!!posts.length && <Panel title={w('performance')} aside={<Segmented<Metric> value={metric} onChange={setMetric} options={(['views', 'likes', 'collects', 'comments'] as const).map(k => ({ value: k, label: w('metric_short_' + k) }))} />}>
      <MetricsLine m={postsMetrics(posts, data)} />
      <div className={cx('mt-4 grid gap-4', posts.length > 1 && 'lg:grid-cols-2')}>
        {posts.map(p => {
          const a = account(p.channel_id), Icon = a && CHANNEL_TYPES[a.type as keyof typeof CHANNEL_TYPES]?.icon, url = publishedUrl(p.post_url)
          // TrendChart 的日期是 YYYYMMDD
          const rows = (days?.[p.id] || []).map(r => ({ ...r, date: r.date.replace(/-/g, '') }))
          return <section key={p.id} className="min-w-0 rounded-lg border border-border p-3" aria-label={a?.name}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {Icon && <Icon size={14} />}
              <span className="min-w-0 truncate font-medium">{a?.name || tr('content.removed_channel')}</span>
              <span className="text-xs text-muted-foreground">{platformOf(a)?.label}</span>
              {url && <a href={url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary-text">{w('open_on_platform')}<ArrowUpRight className="size-3.5" /></a>}
            </div>
            <MetricsLine m={postsMetrics([p], data)} />
            <div className="mt-3">
              {days === null ? <Skeleton className="h-32" />
                : rows.length < 2 ? <p className="flex h-[150px] items-center justify-center rounded-md bg-muted/50 px-6 text-center text-xs text-muted-foreground">{rows.length ? w('trend_one_day', { day: fmtDay(rows[0].date) }) : w('trend_none')}</p>
                : <TrendChart days={rows.map(r => r.date)} height={150} label={w('trend_label', { m: w('metric_short_' + metric) })}
                    series={[{ name: w('metric_short_' + metric), color: 'var(--series-1)', values: rows.map(r => r[metric]) }]} />}
            </div>
          </section>
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{w('performance_note')}</p>
    </Panel>}
    {!!targets.length && <GrowthReviews ctx={ctx} workspace="social" targets={targets} />}
  </>
}
