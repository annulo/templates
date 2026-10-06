import { useEffect, useMemo, useState } from 'react'
import TrendChart from './charts/TrendChart'
import { Notice, Panel, Segmented, Skeleton } from './ui'
import { dbList, runLocal, type Channel, type SocialDaily } from '../lib/shuttle'
import { fmtNum } from '../lib/format'
import { tr } from '../lib/i18n'

type Metric = 'views' | 'likes' | 'comments' | 'collects' | 'shares'
const METRICS: { key: Metric; label: string }[] = [
  { key: 'views', get label() { return tr('social_ov.m_views') } },
  { key: 'likes', get label() { return tr('social_ov.m_likes') } },
  { key: 'comments', get label() { return tr('social_ov.m_comments') } },
  { key: 'collects', get label() { return tr('social_ov.m_collects') } },
  { key: 'shares', get label() { return tr('social_ov.m_shares') } },
]

/** 本机时区的日期 YYYY-MM-DD（和采集时记的日期一致） */
function localDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}


/**
 * 社媒账号的数据（社交媒体页「数据表现」，账号名、登录、采集在它上面的账号卡片里）。数字由社媒插件的本机函数 social/stats.summary 算（助手用的也是它，两边一致）：
 * 时间段里「涨了多少」= 期末 − 期初；采集是从某天才开始记的，期初之前没有记录时显示累计值，不把累计当成增量。
 * 按天趋势用 social_daily 在页面上画。
 */
export default function SocialOverview({ channel, days }: { channel: Channel; days: number }) {
  const [view, setView] = useState<Summary | null>(null)
  const [daily, setDaily] = useState<SocialDaily[]>([])
  const [error, setError] = useState('')
  const [metric, setMetric] = useState<Metric | 'followers'>('views')
  useEffect(() => {
    dbList('social_daily')
      .then((ds) => setDaily(ds.filter((d) => d.channel_id === channel.id).sort((a, b) => a.date.localeCompare(b.date))))
      .catch((e) => setError(e.message))
  }, [channel.id])

  // 期初按浏览器的本地日期算，和采集时记的日期一致
  const start = localDay(new Date(Date.now() - (days - 1) * 86400_000))
  useEffect(() => {
    setView(null)
    setError('')
    runLocal<Summary>('social/stats.summary', { channel_id: channel.id, days, start })
      .then(setView)
      .catch((e) => setError(e.message))
  }, [channel.id, days, start])

  // 按天趋势：每天比前一次采集涨了多少（粉丝看每天的总数），跟着上面选的天数。至少两天的记录才画
  const trend = useMemo(() => {
    const ds = daily.slice(-(days + 1))
    if (ds.length < 2) return null
    const pts = ds.slice(1).map((d, i) => ({
      day: d.date.replace(/-/g, ''),
      value: metric === 'followers' ? d.followers ?? 0 : Math.max(0, (Number(d[metric]) || 0) - (Number(ds[i][metric]) || 0)),
    }))
    return pts
  }, [daily, metric, days])

  const label = metric === 'followers' ? tr('social_ov.followers') : METRICS.find((m) => m.key === metric)!.label
  return (
    <div className="space-y-4">

      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : view === null ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat label={tr('social_ov.published_days', { days })} value={view.published} />
            {/* 一直显示：期初前没记录时显示从第一天记录起的变化，标签里写明从哪天起；一天都没记过显示 — */}
            <Stat label={view.has_base || !view.followers_since ? tr('social_ov.followers_gain') : tr('social_ov.followers_gain_since', { date: view.followers_since.slice(5).replace('-', '/') })} value={view.followers_gain} signed />
            {METRICS.map((m) => (
              <Stat key={m.key} label={view.has_base ? tr('social_ov.new_metric', { m: m.label }) : m.label} value={view.totals[m.key]} signed={view.has_base} />
            ))}
          </div>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            {view.note}
            {view.pending ? tr('social_ov.pending', { n: view.pending }) : ''}
          </p>

          {trend && (
            <Panel
              title={tr('social_ov.daily_title', { m: metric === 'followers' ? label : tr('social_ov.daily_new', { m: label }), n: days })}
              aside={<Segmented value={metric} onChange={setMetric} options={[...METRICS.slice(0, 4).map((m) => ({ value: m.key, label: m.label })), { value: 'followers', label: tr('social_ov.followers') }]} />}
            >
              <TrendChart days={trend.map((t) => t.day)} series={[{ name: metric === 'followers' ? label : tr('social_ov.daily_new', { m: label }), color: 'var(--series-1)', values: trend.map((t) => t.value) }]} height={200} label={tr('social_ov.trend_label', { m: label })} />
              {/* 采集是从某天才开始记的：不说清楚，用户会以为图只画了几天是坏了 */}
              {trend.length < days && <p className="mt-2 text-[11px] text-muted-foreground">{tr('social_ov.daily_short', { date: daily[0].date, n: trend.length, days })}</p>}
            </Panel>
          )}
          {!trend && <Notice>{tr('social_ov.daily_none')}</Notice>}

        </>
      )}
    </div>
  )
}

// social/stats.summary 的返回（plugins/social/local/stats.ts）
type Counts = Record<Metric, number>
type Summary = {
  start: string
  has_base: boolean
  note: string
  published: number
  pending: number
  followers: number | null
  followers_gain: number | null
  followers_since: string | null
  totals: Counts
  top: { id: string; title: string; post_url?: string; published_at?: string; views: number; likes: number; comments: number; collects: number; shares: number; gain: Counts | null }[]
}

function Stat({ label, value, signed }: { label: string; value: number | null; signed?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-background px-4 py-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums">
        {value == null ? '—' : <>{signed && value > 0 ? '+' : ''}{fmtNum(value)}</>}
      </div>
    </div>
  )
}
