import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Link2 } from 'lucide-react'
import RunButton from './RunButton'
import Select from './Select'
import TrendChart from './charts/TrendChart'
import BreakdownTable, { type BreakdownColumn } from './BreakdownTable'
import { Button, Notice, Skeleton } from './ui'
import Reloading from './Reloading'
import { openShuttleSettings, runLocal, type Channel } from '../lib/shuttle'
import { fmtNum } from '../lib/format'
import { tr } from '../lib/i18n'
import { useCanRun } from '../lib/useShuttle'

type Sum = { sessions: number; users: number; views: number; key_events: number }
type Top = { key: string; sessions: number; key_events: number }
type Overview = { property: string; days: number; start?: string; end?: string; current: Sum; previous: Sum; trend: { day: string; sessions: number; users: number; views: number }[]; pages: Top[]; sources: Top[]; countries: Top[] }
/** google：用哪个 Google 账号看的（Shuttle 能连多个；旧版没有） */
type Prop = { property: string; name: string; account: string; urls: string[]; google?: string }

/** GA4 的访问数据（local/ga4.ts）：WordPress 站没有平台统计靠它；creght 站点也能看转化、来源。没关联时引导关联。
 *  start、end（YYYY-MM-DD）都给时看这段自定义时间，不然看近 days 天 */
export default function Ga4Panel({ channel, days, start, end, onLinked }: { channel: Channel; days: number; start?: string; end?: string; onLinked: () => void }) {
  const shuttle = useCanRun('ga4.overview') // 读 GA4 要电脑上的 Google 授权：在 Shuttle 里，或者电脑在线时转给电脑
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [props, setProps] = useState<Prop[] | null>(null)
  const [pick, setPick] = useState('')
  const [linking, setLinking] = useState(false)

  const custom = !!(start && end)
  const load = useCallback(() => {
    if (!shuttle || !channel.ga4_property) return
    // 换时间段时旧数据先留着（变淡 + 加载中），新数据回来再换；晚回来的旧请求不覆盖
    let cancelled = false
    setError('')
    setLoading(true)
    runLocal<Overview>('ga4.overview', custom ? { channel_id: channel.id, start, end } : { channel_id: channel.id, days })
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [shuttle, channel.id, channel.ga4_property, days, custom, start, end])
  useEffect(load, [load])

  const loadProps = () => {
    setError('')
    runLocal<{ list: Prop[] }>('ga4.properties', {})
      .then((r) => setProps(r.list))
      .catch((e) => setError((e as Error).message))
  }
  const linkPicked = async () => {
    setLinking(true)
    setError('')
    try {
      await runLocal('ga4.link', { channel_id: channel.id, property: pick })
      onLinked()
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setLinking(false)
    }
  }
  const needsConnect = /设置\s*→\s*连接|Settings\s*→\s*Connections/.test(error)

  const head = (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <BarChart3 className="size-4 text-muted-foreground" /> {tr('ga4.title')}
    </div>
  )

  if (!channel.ga4_property)
    return (
      <div className="space-y-3 rounded-xl border border-border bg-background p-4 text-sm">
        {head}
        <p className="text-xs leading-relaxed text-muted-foreground">{channel.type === 'wordpress' ? tr('ga4.desc_wp') : tr('ga4.desc')}</p>
        {error && <Notice tone="error">{error}</Notice>}
        {needsConnect && (
          <Button variant="outline" size="sm" onClick={() => openShuttleSettings('connections')}>
            <Link2 /> {tr('ga4.go_connect')}
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <RunButton inline fn="ga4.link" input={{ channel_id: channel.id }} onDone={onLinked} onError={(m) => (setError(m), m && !props && loadProps())} icon={Link2}>
            {tr('ga4.link_auto')}
          </RunButton>
          {props && props.length > 0 && (
            <>
              <Select
                variant="inline"
                value={pick}
                onChange={setPick}
                placeholder={tr('ga4.pick')}
                className="w-64"
                options={props.map((p) => ({ value: p.property, label: p.name, sub: `${p.account} · ${p.urls.join(', ') || p.property}${new Set(props.map((x) => x.google)).size > 1 ? ` · ${p.google}` : ''}` }))}
              />
              <Button fn="ga4.link" size="sm" onClick={linkPicked} disabled={!pick || linking}>
                {tr('ga4.link')}
              </Button>
            </>
          )}
        </div>
      </div>
    )

  const c = data?.current
  const p = data?.previous
  const delta = (a?: number, b?: number) => (a == null || !b ? '' : `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`)
  const cards: [string, keyof Sum][] = [
    [tr('ga4.sessions'), 'sessions'],
    [tr('ga4.users'), 'users'],
    [tr('ga4.views'), 'views'],
    [tr('ga4.key_events'), 'key_events'],
  ]
  // GA4 的排行是会话和关键事件，不是平台统计的 PV / UV
  const topColumns: BreakdownColumn<Top>[] = [
    { label: tr('ga4.sessions'), value: (r) => r.sessions },
    { label: tr('ga4.key_events'), value: (r) => r.key_events, width: 'w-24' },
  ]
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        {head}
        <span className="font-mono text-[11px] text-muted-foreground">{data?.start && data.end ? `${data.start} ~ ${data.end} · ` : ''}{channel.ga4_property}</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {needsConnect && (
        <Button variant="outline" size="sm" onClick={() => openShuttleSettings('connections')}>
          <Link2 /> {tr('ga4.go_connect')}
        </Button>
      )}
      {!data && !error ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : data ? (
        <Reloading loading={loading} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map(([label, k]) => (
              <div key={k} className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{fmtNum(c?.[k] ?? 0)}</div>
                <div className="text-[11px] text-muted-foreground">{tr('ga4.vs_prev', { d: delta(c?.[k], p?.[k]) || '—' })}</div>
              </div>
            ))}
          </div>
          {data.trend.length > 1 && (
            <TrendChart
              days={data.trend.map((r) => r.day)}
              height={200}
              series={[
                { name: tr('ga4.sessions'), color: 'var(--series-1)', values: data.trend.map((r) => r.sessions) },
                { name: tr('ga4.users'), color: 'var(--series-2)', values: data.trend.map((r) => r.users) },
              ]}
            />
          )}
          {/* 页面路径、来源 / 媒介都长：热门页面占满一行，来源和国家两列并排（窄屏单列），关键字不会被三列挤掉 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {([
              ['pages', tr('ga4.pages'), tr('ga4.page'), data.pages],
              ['sources', tr('ga4.sources'), tr('ga4.source'), data.sources],
              ['countries', tr('ga4.countries'), tr('ga4.country'), data.countries],
            ] as const).map(([id, title, keyLabel, rows]) => (
              <div key={id} className={id === 'pages' ? 'min-w-0 md:col-span-2' : 'min-w-0'}>
                <BreakdownTable<Top> title={title} keyLabel={keyLabel} rows={rows} columns={topColumns} empty={tr('ga4.none')} />
              </div>
            ))}
          </div>
        </Reloading>
      ) : null}
    </div>
  )
}
