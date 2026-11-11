import { useEffect, useState, type ComponentType } from 'react'
import { ArrowDownRight, ArrowUpRight, Crosshair, Heart, Kanban, MessagesSquare, MousePointerClick, Radar, ShieldAlert, Users } from 'lucide-react'
import TrendChart from './charts/TrendChart'
import { Notice, Panel, Segmented, Skeleton, cx } from './ui'
import Select from './Select'
import { runLocal } from '../lib/shuttle'
import { fmtNum } from '../lib/format'
import { tr } from '../lib/i18n'
import type { Ctx, View } from './views/types'

const b = (key: string, vars?: Record<string, unknown>) => tr('board.' + key, vars)

type Status = 'ok' | 'none' | 'error'
type Card = { cur: number | null; prev: number | null; trend: number[]; status: Status; error?: string }
type CardKey = 'visitors' | 'clicks' | 'geo' | 'leads' | 'pipeline' | 'social'
type Point = { day: string; visitors: number; leads: number; clicks: number; impressions: number; interactions: number }
type Summary = {
  days: number
  sites: { id: string; name: string; type: string }[]
  cards: Record<CardKey, Card>
  trend: Point[]
  funnel: { visitors: number | null; leads: number; contacted: number; quoted: number; won: number }
  traffic_sources: { key: string; visitors: number; share: number }[]
  lead_origins: { countries: { key: string; n: number; high: number }[]; pages: { key: string; n: number; high: number }[] }
  top_pages: { page: string; visitors: number; metric: 'visitors' | 'clicks' }[]
  top_posts: { id: string; title: string; views: number; interactions: number; article_id: string; url: string }[]
  external: { competitor_new: number; geo: number | null; geo_prev: number | null; issues_high: number }
}

// 每张卡片：图标、点了去哪、没连上时去哪连
const CARDS: { key: CardKey; icon: ComponentType<{ className?: string }>; go: [View, Record<string, string>?]; connect: [View, Record<string, string>?]; suffix?: string }[] = [
  { key: 'visitors', icon: Users, go: ['site'], connect: ['channels'] },
  { key: 'clicks', icon: MousePointerClick, go: ['search'], connect: ['search'] },
  { key: 'geo', icon: Radar, go: ['geo'], connect: ['geo'], suffix: '/100' },
  { key: 'leads', icon: MessagesSquare, go: ['leads'], connect: ['channels'] },
  { key: 'pipeline', icon: Kanban, go: ['leads', { mode: 'board' }], connect: ['leads'] },
  { key: 'social', icon: Heart, go: ['social'], connect: ['channels'] },
]
type Metric = 'visitors' | 'leads' | 'clicks' | 'interactions'
const METRIC_COLOR: Record<Metric, string> = { visitors: 'var(--series-1)', leads: 'var(--series-2)', clicks: 'var(--series-3, #e5a00d)', interactions: 'var(--series-4, #c2410c)' }
const RANGE_KEY = 'trade.board.days'

/** 运营总览的数据看板（dashboard.summary）：六张卡片、趋势、从流量到成交、流量来源、询盘来自哪里、内容效果、外部动向 */
export default function Dashboard({ ctx }: { ctx: Ctx }) {
  const [days, setDays] = useState(() => {
    try {
      const v = Number(localStorage.getItem(RANGE_KEY))
      return [7, 30, 90].includes(v) ? v : 30
    } catch {
      return 30
    }
  })
  const [site, setSite] = useState('')
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  const [metric, setMetric] = useState<Metric>('visitors')
  const [origin, setOrigin] = useState<'countries' | 'pages'>('countries')
  useEffect(() => {
    let live = true
    setError('')
    runLocal<Summary>('dashboard.summary', { days, ...(site ? { channel_id: site } : {}) })
      .then((d) => live && setData(d))
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [days, site, ctx.rev])
  const pickDays = (v: string) => {
    setDays(Number(v))
    try {
      localStorage.setItem(RANGE_KEY, v)
    } catch {}
  }

  return (
    <section aria-label={b('title')} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={String(days)} onChange={pickDays} options={[7, 30, 90].map((n) => ({ value: String(n), label: b('days', { n }) }))} />
        {(data?.sites.length ?? 0) > 1 && (
          <Select variant="inline" ariaLabel={b('site')} value={site} onChange={setSite} className="w-48" options={[{ value: '', label: b('all_sites') }, ...data!.sites.map((s) => ({ value: s.id, label: s.name }))]} />
        )}
        <span className="text-xs text-muted-foreground">{b('vs_prev', { n: days })}</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid grid-cols-2 gap-3 @min-[480px]/overview:grid-cols-3 @min-[680px]/overview:grid-cols-6">
        {CARDS.map((c) => (
          <StatCard key={c.key} meta={c} card={data?.cards[c.key]} onGo={(target) => ctx.go(target[0], target[1])} />
        ))}
      </div>

      {!data ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : (
        <>
          <div className="grid gap-4 @min-[680px]/overview:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel
              title={b('trend')}
              aside={<Segmented value={metric} onChange={setMetric} options={(['visitors', 'leads', 'clicks', 'interactions'] as Metric[]).map((m) => ({ value: m, label: b('m_' + m) }))} />}
            >
              {data.trend.every((p) => !p[metric]) ? (
                <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">{b('trend_empty')}</div>
              ) : (
                <TrendChart height={220} days={data.trend.map((p) => p.day.slice(5))} series={[{ name: b('m_' + metric), color: METRIC_COLOR[metric], values: data.trend.map((p) => p[metric]) }]} />
              )}
            </Panel>
            <Funnel f={data.funnel} onGo={() => ctx.go('leads', { mode: 'board' })} />
          </div>

          <div className="grid gap-4 @min-[680px]/overview:grid-cols-2">
            <Panel title={b('sources')}>
              <Rows
                empty={data.cards.visitors.status === 'ok' ? b('sources_empty') : b('sources_none')}
                head={[b('col_source'), b('col_visitors'), b('col_share')]}
                rows={data.traffic_sources.map((r) => [r.key, fmtNum(r.visitors), `${r.share}%`])}
              />
            </Panel>
            <Panel title={b('origins')} aside={<Segmented value={origin} onChange={setOrigin} options={[{ value: 'countries', label: b('by_country') }, { value: 'pages', label: b('by_page') }]} />}>
              <Rows
                empty={b('origins_empty')}
                head={[origin === 'countries' ? b('col_country') : b('col_page'), b('col_leads'), b('col_high')]}
                rows={data.lead_origins[origin].map((r) => [r.key, String(r.n), String(r.high)])}
                onRow={() => ctx.go('leads')}
              />
            </Panel>
          </div>

          <div className="grid gap-4 @min-[680px]/overview:grid-cols-3">
            <Panel title={b('top_pages')}>
              <Rows
                empty={b('top_pages_empty')}
                head={[b('col_page'), data.top_pages[0]?.metric === 'clicks' ? b('m_clicks') : b('col_visitors')]}
                rows={data.top_pages.map((r) => [r.page, fmtNum(r.visitors)])}
              />
            </Panel>
            <Panel title={b('top_posts')}>
              <Rows
                empty={b('top_posts_empty')}
                head={[b('col_post'), b('col_views'), b('col_interactions')]}
                rows={data.top_posts.map((r) => [r.title || '—', fmtNum(r.views), fmtNum(r.interactions)])}
                onRow={(i) => (data.top_posts[i].article_id ? ctx.go('social-content', { article: data.top_posts[i].article_id }) : ctx.go('social-content', { ownership: 'platform' }))}
              />
            </Panel>
            <Panel title={b('external')}>
              <ul className="space-y-2 text-sm">
                <External icon={Crosshair} label={b('ext_competitors')} value={b('ext_competitors_v', { n: data.external.competitor_new })} onClick={() => ctx.go('competitors')} highlight={data.external.competitor_new > 0} />
                <External
                  icon={Radar}
                  label={b('ext_geo')}
                  value={data.external.geo == null ? b('ext_geo_none') : data.external.geo_prev == null ? `${data.external.geo}/100` : b('ext_geo_v', { v: data.external.geo, d: signed(data.external.geo - data.external.geo_prev) })}
                  onClick={() => ctx.go('geo')}
                />
                <External icon={ShieldAlert} label={b('ext_issues')} value={b('ext_issues_v', { n: data.external.issues_high })} onClick={() => ctx.go('audit')} highlight={data.external.issues_high > 0} />
              </ul>
            </Panel>
          </div>
        </>
      )}
    </section>
  )
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function StatCard({ meta, card, onGo }: { meta: (typeof CARDS)[number]; card?: Card; onGo: (target: [View, Record<string, string>?]) => void }) {
  const Icon = meta.icon
  const none = card && card.status !== 'ok'
  const diff = card && card.cur != null && card.prev != null ? card.cur - card.prev : null
  const pct = diff != null && card!.prev ? Math.round((diff / card!.prev!) * 100) : null
  return (
    <button
      type="button"
      onClick={() => onGo(none ? meta.connect : meta.go)}
      title={card?.error}
      className="flex min-w-0 cursor-pointer flex-col rounded-xl border border-border bg-background px-3.5 py-3 text-left transition-colors hover:border-primary/40"
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{b('c_' + meta.key)}</span>
      </span>
      {!card ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : none ? (
        <span className="mt-2 text-sm font-medium text-primary-text">{card.status === 'error' ? b('c_error') : b('c_connect_' + meta.key)}</span>
      ) : (
        <>
          <span className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{fmtNum(card.cur ?? 0)}</span>
            {meta.suffix && <span className="text-xs text-muted-foreground">{meta.suffix}</span>}
          </span>
          <span className="mt-1 flex h-4 min-w-0 items-center gap-1 text-[11px] tabular-nums">
            {diff == null ? (
              <span className="truncate text-muted-foreground">{meta.key === 'pipeline' ? b('c_pipeline_hint') : b('c_no_prev')}</span>
            ) : diff === 0 ? (
              <span className="text-muted-foreground">{b('flat')}</span>
            ) : (
              <span className={cx('inline-flex items-center', diff > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
                {diff > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                {signed(diff)}
                {pct != null && meta.key !== 'geo' && ` (${signed(pct)}%)`}
              </span>
            )}
          </span>
          <Spark values={card.trend} />
        </>
      )}
    </button>
  )
}

/** 卡片底下的小折线 */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => !v)) return <span className="mt-2 block h-6" />
  const max = Math.max(...values), min = Math.min(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${24 - ((v - min) / (max - min || 1)) * 22 - 1}`).join(' ')
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="mt-2 block h-6 w-full text-primary/70" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** 从流量到成交：每一步的数和从上一步到这一步的转化率 */
function Funnel({ f, onGo }: { f: Summary['funnel']; onGo: () => void }) {
  const steps: { key: string; n: number | null }[] = [
    { key: 'visitors', n: f.visitors },
    { key: 'leads', n: f.leads },
    { key: 'contacted', n: f.contacted },
    { key: 'quoted', n: f.quoted },
    { key: 'won', n: f.won },
  ]
  const top = Math.max(1, ...steps.map((s) => s.n ?? 0))
  return (
    <Panel title={b('funnel')}>
      <button type="button" onClick={onGo} className="block w-full cursor-pointer space-y-2.5 text-left">
        {steps.map((s, i) => {
          const before = i > 0 ? steps[i - 1].n : null
          const rate = s.n != null && before ? Math.round((s.n / before) * 1000) / 10 : null
          return (
            <div key={s.key}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{b('f_' + s.key)}</span>
                <span className="tabular-nums">
                  <span className="text-sm font-semibold">{s.n == null ? '—' : fmtNum(s.n)}</span>
                  {rate != null && <span className="ml-1.5 text-muted-foreground">{rate}%</span>}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-muted">
                <div className="h-2 rounded-full bg-primary/70" style={{ width: `${s.n ? Math.max(2, (s.n / top) * 100) : 0}%` }} />
              </div>
            </div>
          )
        })}
        <p className="pt-1 text-[11px] text-muted-foreground">{b('funnel_hint')}</p>
      </button>
    </Panel>
  )
}

function Rows({ head, rows, empty, onRow }: { head: string[]; rows: string[][]; empty: string; onRow?: (i: number) => void }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th key={h} className={cx('pb-1.5 font-medium', i === 0 ? 'w-auto' : 'w-20 text-right')}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} onClick={onRow && (() => onRow(i))} className={cx('border-t border-border', onRow && 'cursor-pointer hover:bg-muted/40')}>
            {r.map((c, j) => (
              <td key={j} className={cx('py-1.5', j === 0 ? 'truncate pr-2' : 'text-right tabular-nums text-muted-foreground')} title={j === 0 ? c : undefined}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function External({ icon: Icon, label, value, onClick, highlight }: { icon: ComponentType<{ className?: string }>; label: string; value: string; onClick: () => void; highlight?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/50">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{label}</span>
        <span className={cx('shrink-0 tabular-nums', highlight ? 'font-semibold text-primary-text' : 'text-muted-foreground')}>{value}</span>
      </button>
    </li>
  )
}

