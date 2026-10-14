import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import TrendChart from './charts/TrendChart'
import BreakdownTable from './BreakdownTable'
import { Notice, Panel, Skeleton, cx } from './ui'
import { visitOverview, ShuttleUnavailable, type VisitOverview } from '../lib/shuttle'
import { fmtNum } from '../lib/format'
import { tr } from '../lib/i18n'

const device = (k: string) => (['desktop', 'mobile', 'tablet', 'bot'].includes(k) ? tr(`site.device.${k}`) : k)

/**
 * 独立站渠道的访问数据：指标（和上一周期比）、每日趋势、来源 / 页面 / 地区 / 设备。
 * 另外取一份 2 倍时长的趋势，前一半就是上一周期，用来算 PV 的涨跌。
 */
export default function SiteOverview({ site, days }: { site: string; days: number }) {
  const [data, setData] = useState<VisitOverview | null>(null)
  const [prevPV, setPrevPV] = useState<number | null>(null)
  const [error, setError] = useState<{ msg: string; offline: boolean } | null>(null)

  useEffect(() => {
    setData(null)
    setPrevPV(null)
    setError(null)
    visitOverview(site, days)
      .then(setData)
      .catch((e) => setError({ msg: e.message, offline: e instanceof ShuttleUnavailable }))
    visitOverview(site, days * 2)
      .then((d) => setPrevPV((d.trend ?? []).slice(0, Math.max(0, d.trend.length - days)).reduce((a, r) => a + r.pv_count, 0)))
      .catch(() => setPrevPV(null))
  }, [site, days])

  if (error?.offline)
    return <Notice>{tr('site.offline')}</Notice>
  if (error) return <Notice tone="error">{error.msg}</Notice>
  if (!data)
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-[86px] rounded-xl" />
          <Skeleton className="h-[86px] rounded-xl" />
          <Skeleton className="h-[86px] rounded-xl" />
        </div>
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    )
  if (!data.summary) return <Notice>{tr('site.no_data')}</Notice>

  const trend = data.trend ?? []
  const pv = data.summary.pv_count
  // 上一周期基数太小（不到 20 次）时百分比没有意义，只显示上一周期的数
  const delta = prevPV === null || prevPV < 20 ? null : (pv - prevPV) / prevPV
  const noVisits = pv === 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label={tr('site.pv')} value={pv} delta={delta} hint={prevPV !== null ? tr('site.prev', { n: fmtNum(prevPV) }) : undefined} />
        <Stat label={tr('site.uv')} value={data.summary.uv_count} hint={tr('site.uv_hint')} />
        <Stat label={tr('site.ip')} value={data.summary.ip_count} hint={pv ? tr('site.per_visitor', { n: (pv / Math.max(1, data.summary.uv_count)).toFixed(1) }) : undefined} />
      </div>

      <Panel
        title={tr('site.daily')}
        aside={
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded-full bg-series-1" />
              {tr('site.pv')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded-full bg-series-2" />
              {tr('site.uv')}
            </span>
          </div>
        }
      >
        {noVisits ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">{tr('site.no_visits')}</div>
        ) : (
          <TrendChart
            days={trend.map((r) => r.day)}
            series={[
              { name: tr('site.pv'), color: 'var(--series-1)', values: trend.map((r) => r.pv_count) },
              { name: tr('site.uv'), color: 'var(--series-2)', values: trend.map((r) => r.uv_count) },
            ]}
          />
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownTable title={tr('site.referrer')} keyLabel={tr('site.referrer_key')} rows={data.breakdowns.referrer_host} empty={tr('site.referrer_empty')} />
        <BreakdownTable title={tr('site.pages')} keyLabel={tr('site.page')} rows={data.breakdowns.url} format={(u) => u.replace(/^https?:\/\/[^/]+/, '') || '/'} />
        <BreakdownTable title={tr('site.country')} keyLabel={tr('site.region')} rows={data.breakdowns.country} />
        <BreakdownTable title={tr('site.device_t')} keyLabel={tr('site.device_t')} rows={data.breakdowns.device_type} format={device} />
      </div>
    </div>
  )
}

function Stat({ label, value, delta, hint }: { label: string; value: number; delta?: number | null; hint?: string }) {
  const up = delta !== null && delta !== undefined && delta > 0
  const down = delta !== null && delta !== undefined && delta < 0
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{fmtNum(value)}</span>
        {delta !== null && delta !== undefined && Number.isFinite(delta) && delta !== 0 && (
          <span className={cx('inline-flex items-center text-xs font-medium tabular-nums', up && 'text-emerald-600 dark:text-emerald-400', down && 'text-destructive')}>
            {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta * 100).toFixed(0)}%
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}
