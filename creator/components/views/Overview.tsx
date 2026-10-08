import { useEffect, useState } from 'react'
import { ArrowRight, ArrowUpRight, FileText, Loader2, RefreshCw, Lightbulb, MessagesSquare, Share2, Sparkles, UserRound, X } from 'lucide-react'
import { Button, Notice, Panel, Skeleton, cx, fmtTime } from '../ui'
import { dbList, type SocialPost, type Article, type Topic, runLocal, shuttleImage, type Channel, type PlatformHealth } from '../../lib/shuttle'
import { CHANNEL_TYPES } from '../../lib/channels'
import { fmtNum } from '../../lib/format'
import type { Ctx, View } from './types'
import type { Report } from '../../lib/shuttle'
import { byPeriod } from './Reports'
import { tr } from '../../lib/i18n'
import Checklist, { ChecklistItemAction } from '../Checklist'
import type { ChecklistItem, ChecklistData } from '../../lib/useChecklist'
import { useInShuttle } from '../../lib/useShuttle'
import { TaskButton } from '../Task'
import { TOPICS_TASK } from './Content'
import { brokenOf, FIX_TASK, usePlatformHealth } from '../PlatformHealth'
import { loggedInElsewhere, useElsewhere } from '../../lib/social'
import { unpublished } from '../../local/_types'
import { TYPE_META, typeOf } from '../ArticleTypes'

/** 总览：各账号的粉丝、待你处理的事、最近的动作 */
export default function Overview({ ctx }: { ctx: Ctx }) {
  const machine = useElsewhere(ctx.channels)
  const health = usePlatformHealth(ctx.rev)
  const [data, setData] = useState<{ posts: SocialPost[]; articles: Article[]; topics: Topic[] } | null>(null)
  const [error, setError] = useState('')
  // 最新一期每周总结
  const [report, setReport] = useState<Report | null>(null)
  useEffect(() => {
    dbList('reports')
      .then((l) => setReport(byPeriod(l)[0] ?? null))
      .catch(() => setReport(null))
  }, [ctx.rev])

  useEffect(() => {
    if (!ctx.rev) setData(null) // 静默重拉（rev 变了）时保留旧数据，不闪骨架
    Promise.all([dbList('articles'), dbList('topics'), dbList('social_posts').catch(() => [] as SocialPost[])])
      .then(([articles, topics, posts]) => {
        setData({ posts, articles, topics })
        setError('')
      })
      .catch((e) => setError(e.message))
  }, [ctx.rev])

  // 写好了还没发的文章，最近改的在前；点了打开那篇
  const pending = data ? unpublished(data.articles, data.posts) : []
  const openPending = () => pending[0] ? ctx.go('content', { article: pending[0].id }) : ctx.go('content', { tab: 'articles' })
  const ideas = data?.topics.filter((t) => t.status === 'idea') ?? []

  const social = ctx.channels
  const connected = social.filter((channel) => ['logged_in', 'ready', 'ok', 'active'].includes(channel.login_status ?? ''))
  const broken = social.filter((channel) => brokenOf(health.rows, channel.id).some((row) => row.op === 'publish' || row.op === 'probe'))
  const publishingProblems = broken
  // 各账号的粉丝合计（采集时写进账号）：外贸模板这里是网站访问量
  const followers = social.some((channel) => channel.followers != null) ? social.reduce((sum, channel) => sum + (Number(channel.followers) || 0), 0) : null
  const published = (data?.posts ?? []).filter((p) => p.status === 'published' && Date.parse(p.published_at || '') > Date.now() - ctx.days * 86400_000).length
  const uncollected = social.filter((channel) => !channel.collected_at).length

  return (
    <div className="@container/overview min-w-0 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">{tr('overview.dashboard_title')}</h1>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{ctx.profile.name ? tr('overview.dashboard_desc', { name: ctx.profile.name }) : tr('overview.no_profile')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => ctx.go('reports', report ? { report: report.id } : {})}><FileText />{tr('overview.view_report')}</Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <section aria-label={tr('overview.dashboard_title')} className="grid grid-cols-2 border-y border-border py-4 @min-[640px]/overview:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="min-w-0 border-r border-border pr-3 pb-3 @min-[640px]/overview:pb-0">
          <div className="mb-2 flex min-w-0 items-center gap-2 text-sm"><span className="shrink-0">{tr('overview.followers')}</span><span className="truncate text-xs text-muted-foreground">{tr('overview.all_accounts')}</span></div>
          <div className="flex items-baseline gap-3 whitespace-nowrap">
            <span className="flex min-w-0 items-baseline gap-1.5"><span className="truncate text-2xl leading-none font-medium tracking-tight tabular-nums">{followers == null ? '—' : fmtNum(followers)}</span></span>
            <span className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">{tr('overview.published_n', { n: published, d: ctx.days })}</span>
          </div>
        </div>
        <Metric label={tr('overview.pending_review')} value={data ? pending.length : null} className="pl-3 pb-3 @min-[640px]/overview:border-r @min-[640px]/overview:px-4 @min-[640px]/overview:pb-0" onClick={openPending} />
        <Metric label={tr('overview.connected_social')} value={connected.length} suffix={tr('overview.signed_in')} className="border-t border-r pt-3 pr-3 @min-[640px]/overview:border-t-0 @min-[640px]/overview:px-4 @min-[640px]/overview:pt-0" onClick={() => ctx.go('social')} />
        <Metric label={tr('overview.publishing_errors')} value={publishingProblems.length} warning={publishingProblems.length > 0} className="border-t pl-3 pt-3 @min-[640px]/overview:border-t-0 @min-[640px]/overview:pl-4 @min-[640px]/overview:pt-0" onClick={() => ctx.go('channels', publishingProblems.length === 1 ? { channel: publishingProblems[0].id } : {})} />
      </section>

      {ctx.setupOpen && <Checklist ctx={ctx} mode="setup" />}

      {/* 嵌入基座时按内容区宽度排栏，侧边栏和助手占用的空间也计入。 */}
      <div className="grid items-stretch gap-4 @min-[720px]/overview:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TodayWork ctx={ctx} pending={pending} broken={broken} health={health.rows} />
        <section className="flex min-w-0 flex-col">
          <div className="mb-2 flex min-w-0 items-center justify-between gap-2"><h2 className="shrink-0 text-lg font-semibold">{tr('overview.latest_report')}</h2>{report && <span className="truncate text-xs text-muted-foreground tabular-nums">{periodLabel(report.period_start)} — {periodLabel(report.period_end)}</span>}</div>
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-background p-4">
            <h3 className="truncate text-base leading-relaxed font-semibold" title={report?.title}>{report?.title || tr('overview.report_empty')}</h3>
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{report?.summary || tr('overview.report_empty_desc')}</p>
            <div className="mt-3 divide-y divide-border border-y border-border text-xs">
              <div className="flex min-w-0 items-center gap-2 py-2.5"><FileText className="size-4 shrink-0" /><span className="shrink-0">{tr('overview.content_label')}</span><span className="truncate text-muted-foreground">{tr('common.last_days', { n: ctx.days })}</span><span className="ml-auto shrink-0 whitespace-nowrap tabular-nums">{tr('overview.published_posts', { n: published })}</span></div>
              <div className="flex min-w-0 items-center gap-2 py-2.5"><Share2 className="size-4 shrink-0" /><span className="shrink-0">{tr('overview.social_label')}</span><span className="ml-auto truncate text-muted-foreground">{tr('overview.uncollected_accounts', { n: uncollected })}</span></div>
            </div>
            <button type="button" onClick={() => ctx.go('reports', report ? { report: report.id } : {})} className="mt-3 inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{tr('overview.view_report')}<ArrowRight className="size-4" /></button>
          </div>
        </section>
      </div>

      <section>
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2"><h2 className="shrink-0 text-lg font-semibold">{tr('overview.accounts_title')}</h2><span className="truncate text-xs text-muted-foreground">{tr('overview.accounts_connected', { n: connected.length })}</span></div>
          <button type="button" onClick={() => ctx.go('channels')} className="shrink-0 cursor-pointer whitespace-nowrap text-sm font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{tr('overview.manage_accounts')}</button>
        </div>
        {ctx.channels.length === 0 ? <button onClick={() => ctx.go('channels')} className="w-full cursor-pointer rounded-lg border border-dashed border-border px-4 py-5 text-left text-sm text-muted-foreground hover:bg-accent">{tr('overview.no_channels')}</button> : <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[540px] table-fixed border-collapse text-left text-sm">
            <colgroup><col className="w-[34%]" /><col className="w-[18%]" /><col className="w-[20%]" /><col className="w-[28%]" /></colgroup>
            <thead className="bg-muted/50 text-xs font-medium text-muted-foreground"><tr>{['account', 'platform', 'collection', 'publish_check'].map((key) => <th key={key} scope="col" className="border-r border-b border-border px-3 py-2.5 font-medium last:border-r-0">{tr('overview.' + key)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {ctx.channels.map((channel) => {
                const meta = CHANNEL_TYPES[channel.type]
                const Icon = meta?.icon
                const problems = brokenOf(health.rows, channel.id)
                const probe = newestHealth(health.rows.filter((row) => row.channel_id === channel.id && row.op === 'probe'))
                const publishHealth = newestHealth(health.rows.filter((row) => row.channel_id === channel.id && row.op === 'publish'))
                const warning = problems.some((row) => row.op === 'publish' || row.op === 'probe')
                const publishedHealthy = publishHealth?.ok || probe?.ok
                const otherMachine = loggedInElsewhere(channel, machine)
                const statusLabel = warning ? tr('overview.publish_problem') : otherMachine ? tr('social.on_machine', { name: otherMachine }) : channel.login_status === 'expired' ? tr('overview.login_expired') : publishedHealthy ? tr('overview.healthy') : tr('overview.not_checked')
                return <tr key={channel.id} className="transition-colors hover:bg-muted/40">
                  <td className="border-r border-border px-3 py-2"><button type="button" onClick={() => ctx.go('channels', { channel: channel.id })} className="flex w-full min-w-0 cursor-pointer items-center gap-2 text-left outline-none hover:text-primary-text focus-visible:ring-2 focus-visible:ring-ring">
                    {channel.avatar ? <img src={shuttleImage(channel.avatar)} alt="" loading="lazy" className="size-7 shrink-0 rounded-full object-cover" /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserRound className="size-4" /></span>}
                    <span className="min-w-0 truncate" title={channel.name}>{channel.name}</span>
                  </button></td>
                  <td className="border-r border-border px-3 py-2"><span className="flex min-w-0 items-center gap-2 text-muted-foreground">{Icon && <Icon className={cx('size-4 shrink-0', channel.type === 'linkedin' ? 'text-[#0a66c2]' : channel.type === 'facebook' ? 'text-[#1877f2]' : '')} />}<span className="truncate" title={meta?.label || channel.type}>{meta?.label || channel.type}</span></span></td>
                  <td className="border-r border-border px-3 py-2 text-xs text-muted-foreground"><span className="block truncate">{channel.collected_at ? fmtTime(channel.collected_at) : tr('overview.not_collected')}</span></td>
                  <td className="px-3 py-2"><span className={cx('flex min-w-0 items-center gap-1.5 text-xs', warning ? 'text-amber-600 dark:text-amber-400' : channel.login_status === 'expired' && !otherMachine ? 'text-destructive' : 'text-muted-foreground')}>{warning && <span className="size-2 shrink-0 rounded-full bg-amber-500" />}<span className="truncate" title={statusLabel}>{statusLabel}</span></span></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>}
      </section>

      <details className="group border-t border-border pt-3">
        <summary className="mb-3 w-fit cursor-pointer text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{tr('overview.operations_details')}</summary>

      <div className="grid gap-3 @min-[560px]/overview:grid-cols-2 @min-[900px]/overview:grid-cols-3">
        <Todo
          icon={FileText}
          title={tr('overview.pending_articles')}
          count={data ? pending.length : null}
          empty={tr('overview.pending_empty')}
          onOpen={openPending}
          items={pending.slice(0, 3).map((p) => ({ id: p.id, text: p.title || tr('versions.untitled'), meta: `${TYPE_META[typeOf(p)].label} · ${fmtTime(p.updated_at || p.created_at)}` }))}
        />
        <Todo
          icon={Lightbulb}
          title={tr('overview.topics')}
          count={data ? ideas.length : null}
          empty={tr('overview.topics_empty')}
          onOpen={() => ctx.go('content', { tab: 'topics' })}
          items={ideas.slice(0, 3).map((t) => ({ id: t.id, text: t.title, meta: '' }))}
          action={<TaskButton task={TOPICS_TASK} match={(r) => !r.input?.channel_id} variant="outline" icon={Sparkles}>{tr('overview.gen_topics')}</TaskButton>}
        />
      </div>

      </details>
    </div>
  )
}

const periodLabel = (value: string) => { const parts = value.split('-'); return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : value }
const newestHealth = (rows: PlatformHealth[]) => [...rows].sort((a, b) => String(b.checked_at ?? '').localeCompare(String(a.checked_at ?? '')))[0]

function Metric({ label, value, suffix, warning, className, onClick }: { label: string; value: number | null; suffix?: string; warning?: boolean; className: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cx('min-w-0 cursor-pointer border-border text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
    <div className="mb-2 truncate text-sm" title={label}>{label}</div><div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">{warning && <span className="size-2.5 shrink-0 self-center rounded-full bg-amber-500" />}<span className="truncate text-2xl leading-none font-medium tracking-tight tabular-nums">{value == null ? '—' : fmtNum(value)}</span>{suffix && <span className="truncate text-xs text-muted-foreground">{suffix}</span>}</div>
  </button>
}

function TodayWork({ ctx, pending, broken, health }: { ctx: Ctx; pending: Article[]; broken: Channel[]; health: PlatformHealth[] }) {
  const shuttle = useInShuttle()
  const { data, error, setData, setError, load } = ctx.checklist
  // 在别的页面处理完（审核、回询盘…）回到总览，今日工作要跟着变：进来时、窗口重新拿到焦点时重拉一次，标题旁也能手动刷新
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }
  useEffect(() => {
    if (!shuttle) return
    void load()
    const onFocus = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [shuttle, load])
  const daily = data?.daily ?? []
  const added = broken.length
  const dismiss = async (item: ChecklistItem) => {
    try { setData(await runLocal<ChecklistData>('today.dismiss', { key: item.key, value: item.count ?? 1 })) } catch (e) { setError((e as Error).message) }
  }
  const rowClass = 'grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 py-3 @min-[400px]/work:grid-cols-[2rem_minmax(0,1fr)_auto]'
  // 有的行能关掉、有的不能：不能关的也占一个同样大小的空位，各行的按钮右边对齐
  const noDismiss = <span aria-hidden className="size-[22px] shrink-0" />
  // 每行的文字都能点进对应的地方：文章 → 那篇文章，社媒要修 → 那个账号，其余照这条的动作去的页面（周报 → 每周总结）
  const linkClass = 'min-w-0 cursor-pointer rounded-md text-left outline-none hover:[&_.row-title]:text-primary-text focus-visible:ring-2 focus-visible:ring-ring'
  const openItem = (item: ChecklistItem): (() => void) | undefined => {
    if (item.key === 'd_posts') return () => (pending[0] ? ctx.go('content', { article: pending[0].id }) : ctx.go('content', { tab: 'articles' }))
    if (item.action.kind === 'go') { const a = item.action; return () => ctx.go(a.view as View, a.params) }
    if (item.key === 'd_weekly') return () => ctx.go('reports')
    return undefined
  }
  const actionClass = 'col-start-2 flex min-w-0 items-center gap-1 justify-self-start @min-[400px]/work:col-start-auto @min-[400px]/work:justify-self-end'
  return <section className="@container/work flex min-w-0 flex-col">
    <div className="mb-2 flex min-w-0 items-center justify-between gap-2"><h2 className="shrink-0 text-lg font-semibold">{tr('overview.today_work')}</h2><div className="flex min-w-0 items-center gap-1">{data && <span className="truncate text-xs text-muted-foreground">{tr('overview.todo_count', { n: daily.length + added })}</span>}{shuttle && <button type="button" onClick={refresh} disabled={refreshing} aria-label={tr('overview.refresh')} title={tr('overview.refresh')} className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">{refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</button>}</div></div>
    <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-background px-4">
      {error && <div className="py-3"><Notice tone="error">{error}</Notice></div>}
      {/* 不在 Shuttle 里（手机）时 today.list 走云端版本，读到了就照常显示 */}
      {!shuttle && !data && !error ? <div className="py-4"><Notice>{tr('today.offline')}</Notice></div> : error && !data ? null : !data ? <div className="space-y-3 py-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : daily.length + added === 0 ? <p className="py-4 text-sm leading-relaxed text-muted-foreground">{tr(data.done === data.total ? 'today.daily_empty' : 'today.daily_empty_setup')}</p> : <div className="divide-y divide-border">
        {daily.map((item) => <div key={item.key} className={rowClass}>
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">{item.key === 'd_posts' ? <FileText className="size-4" /> : <MessagesSquare className="size-4" />}</span>
          <button type="button" onClick={openItem(item)} disabled={!openItem(item)} className={`${linkClass} disabled:cursor-default`}>
            {item.key === 'd_posts' && <div className="mb-0.5 text-xs text-muted-foreground">{tr('overview.content_review')}</div>}
            <div title={item.key === 'd_posts' && pending[0] ? pending[0].title : item.title} className="row-title truncate text-sm leading-relaxed font-medium">{item.key === 'd_posts' && pending[0] ? pending[0].title : item.title}</div>
            <p className="mt-0.5 truncate text-xs leading-relaxed text-muted-foreground" title={item.why}>{item.key === 'd_posts' && pending[0] ? `${TYPE_META[typeOf(pending[0])].label} · ${tr('overview.awaiting_review')} · ${fmtTime(pending[0].updated_at || pending[0].created_at)}${pending.length > 1 ? ' · ' + tr('overview.review_more', { n: pending.length - 1 }) : ''}` : item.why}</p>
          </button>
          <div className={actionClass}><ChecklistItemAction compact ctx={ctx} it={item} onDone={ctx.checklist.load} onChat={() => {}} /><button type="button" onClick={() => dismiss(item)} aria-label={tr('today.dismiss')} title={tr('today.dismiss')} className="cursor-pointer rounded-md p-1 text-muted-foreground/50 hover:bg-accent hover:text-foreground"><X className="size-3.5" /></button></div>
        </div>)}
        {broken.map((channel) => { const problem = brokenOf(health, channel.id).find((row) => row.op === 'publish' || row.op === 'probe'); return <div key={channel.id} className={rowClass}>
          <span className="flex size-8 items-center justify-center"><span className="size-2.5 rounded-full bg-amber-500" /></span>
          <button type="button" onClick={() => ctx.go('channels', { channel: channel.id })} className={linkClass}><div className="row-title truncate text-sm leading-relaxed font-medium" title={tr('overview.social_repair')}>{tr('overview.social_repair')}</div><p className="mt-0.5 truncate text-xs leading-relaxed text-muted-foreground" title={`${channel.name} · ${CHANNEL_TYPES[channel.type]?.label}${problem?.error ? ` · ${problem.error}` : ''}`}>{channel.name} · {CHANNEL_TYPES[channel.type]?.label}{problem?.error ? ` · ${problem.error}` : ''}</p></button>
          <div className={actionClass}><TaskButton task={FIX_TASK} input={{ channel_id: channel.id }} match={(run) => run.input?.channel_id === channel.id} variant="outline" onFinished={ctx.checklist.load}>{tr('overview.fix_social')}</TaskButton>{noDismiss}</div>
        </div>})}
      </div>}
    </div>
  </section>
}

function Todo({
  icon: Icon,
  title,
  count,
  badge,
  empty,
  items,
  onOpen,
  action,
}: {
  icon: typeof FileText
  title: string
  count: number | null
  badge?: React.ReactNode
  empty: string
  items: { id: string; text: string; meta: string }[]
  onOpen: () => void
  action?: React.ReactNode
}) {
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {title}
          {count !== null && <span className="text-muted-foreground tabular-nums">{count}</span>}
          {badge}
        </span>
      }
      aside={
        <button onClick={onOpen} className="inline-flex cursor-pointer items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          {tr('overview.view')} <ArrowUpRight className="size-3.5" />
        </button>
      }
    >
      {count === null ? (
        <div className="space-y-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : items.length === 0 ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{empty}</p>
          {action}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className={cx('flex items-center justify-between gap-3 text-sm')}>
              <span className="truncate">{i.text}</span>
              {i.meta && <span className="shrink-0 text-xs text-muted-foreground">{i.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
