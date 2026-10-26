import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, ExternalLink, EyeOff, FilePlus2, Link2, Loader2, RefreshCw, SearchCheck, Sparkles, Undo2, Unlink } from 'lucide-react'
import AskButton from '../AskButton'
import { TaskButton, TaskRequirements, useTask } from '../Task'
import RunButton from '../RunButton'
import Ga4Panel from '../Ga4Panel'
import TrendChart from '../charts/TrendChart'
import { Badge, Button, Dialog, Notice, PageHeader, Panel, RangeToggle, Segmented, Skeleton, cx, fmtTime, inputCls, type Tone } from '../ui'
import Reloading from '../Reloading'
import {
  dbList,
  openShuttleSettings,
  runLocal,
  type Channel,
  type ChangeMetrics,
  type SearchExpandBrief,
  type SearchPage,
  type SearchQuery,
  type SearchSuggestion,
  type SiteChange,
  type Topic,
} from '../../lib/shuttle'
import Select from '../Select'
import SitePicker from '../SitePicker'
import Keywords from '../Keywords'
import type { Ctx, View } from './types'
import { numLocale, tr } from '../../lib/i18n'
import { useCanRun } from '../../lib/useShuttle'

/** 交给助手的任务：改写标题描述（点击率偏低的页面）、写补内容的要点（差一点上首页的页面） */
const META_TASK = 'search-meta'
const EXPAND_TASK = 'search-expand'
const VERIFY_TASK = 'search-verify-live' // 「已上线，开始复查」：助手核对线上再开始复查
const REFRESH_TASK = 'refresh-page' // 流量下滑的页面：写刷新内容的要点（存在 search_pages 同一条的 expand_brief 上）

// 搜索表现：独立站在 Google 搜索里的表现（GSC，gsc.sync 写进 search_pages），找出「曝光高、点击率低」「排名 8~20」的页面，
// 生成新标题和描述 → 交给助手改站推预览 → 用户发布后点「已上线」→ 17 天后 review.check 自动对比前后数据（site_changes）。
// 差一点上首页的页面走「补内容」：助手按任务 search-expand 写要点 → 交给助手改页面、推预览、记复查（search_content）。
// 页面级的数字用非品牌口径（nb_*：去掉品牌词和 site: 查询），顶部汇总是全站原始口径。
// 「流量下滑」（内容衰减雷达，decay.scan 写进 content_decay）：以前带过点击、最近掉了的页面，刷新内容或改标题描述，后面的改页面、复查和上面一样。

const pct = (x?: number) => `${((x ?? 0) * 100).toFixed(1)}%`
const num = (x?: number) => (x ?? 0).toLocaleString(numLocale())
const pathOf = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/'
const DAY = 86400_000
const dateOf = (time: number) => new Date(time).toISOString().slice(0, 10)
/** 本地日期 YYYY-MM-DD（GA4 当天就有数据，按电脑所在的日子算「今天」） */
const localDate = (time: number) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const RANGES = ['7', '30', '90', 'custom']
const rangeOptions = () => [7, 30, 90].map((days) => ({ value: String(days), label: tr('common.last_days', { n: days }) })).concat([{ value: 'custom', label: tr('search.custom_range') }])

type RangePage = { page: string; clicks: number; impressions: number; ctr: number; position: number }
type RangeDaily = { date: string; clicks: number; impressions: number }
type RangeTotals = { clicks: number; impressions: number; ctr: number; position: number }
type RangeData = { start: string; end: string; prev_start: string; prev_end: string; totals: RangeTotals; prev: RangeTotals; pages: RangePage[]; daily: RangeDaily[] }
type DecayCause = 'rank' | 'ctr' | 'demand'
type LostQuery = { query: string; peak_clicks: number; clicks: number; peak_position: number; position: number }
type DecayPage = {
  id: string; channel_id: string; page: string; search_page_id?: string
  peak_start: string; peak_end: string; peak_clicks: number; peak_impressions: number; peak_ctr: number; peak_position: number
  clicks: number; impressions: number; ctr: number; position: number; drop: number; lost_clicks: number
  cause: DecayCause; trend: number[]; lost_queries: LostQuery[]; status?: string; seen?: boolean; scanned_at?: string
}

function parse<T>(s: string | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

/** 页面的非品牌口径（老数据没有 nb_* 时退回原字段） */
const nbOf = (p: SearchPage) => ({ clicks: p.nb_clicks ?? p.clicks, impressions: p.nb_impressions ?? p.impressions, ctr: p.nb_ctr ?? p.ctr, position: p.nb_position ?? p.position })

const OPP: Record<string, { label: string; tone: Tone; hint: string }> = {
  low_ctr: { get label() { return tr('search.opp_low_ctr') }, tone: 'warn', get hint() { return tr('search.opp_low_ctr_hint') } },
  striking_distance: { get label() { return tr('search.opp_striking') }, tone: 'primary', get hint() { return tr('search.opp_striking_hint') } },
}

/** headerActions：模板放在页头上面的按钮，拿到当前选中的网站（产品运营的「增长机会」、SEO 研究任务） */
export default function Search({ ctx, params, setParam, headerActions }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void; headerActions?: (channel: Channel) => ReactNode }) {
  const sites = ctx.channels.filter((c) => c.type === 'creght_site' || c.type === 'wordpress')
  const channel = sites.find((c) => c.id === params.channel) ?? sites[0]
  const tab = params.tab === 'review' ? 'review' : params.tab === 'ga4' ? 'ga4' : params.tab === 'decay' ? 'decay' : params.tab === 'keywords' ? 'keywords' : 'pages'
  // GA4：近 7/30/90 天或自定义（ga4_days 是老链接里的参数）
  const ga4Choice = RANGES.includes(params.ga4_range) ? params.ga4_range : ['7', '30', '90'].includes(params.ga4_days) ? params.ga4_days : '30'
  const ga4Days = ga4Choice === 'custom' ? 30 : Number(ga4Choice)
  const today = localDate(Date.now())
  const ga4Start = params.ga4_start || localDate(Date.now() - 29 * DAY)
  const ga4End = params.ga4_end || today
  // 谷歌排名（GSC）：数据晚两三天，最晚只能看到 3 天前
  const rangeChoice = RANGES.includes(params.gsc_range) ? params.gsc_range : '30'
  const latest = dateOf(Date.now() - 3 * DAY)
  const defaultStart = dateOf(Date.parse(latest) - 29 * DAY)
  const rangeStart = rangeChoice === 'custom' ? params.gsc_start ?? '' : dateOf(Date.parse(latest) - (Number(rangeChoice) - 1) * DAY)
  const rangeEnd = rangeChoice === 'custom' ? params.gsc_end ?? '' : latest
  const [rangeData, setRangeData] = useState<RangeData | null>(null)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [rangeError, setRangeError] = useState('')
  const [rangeRevision, setRangeRevision] = useState(0)
  const [pages, setPages] = useState<SearchPage[] | null>(null)
  const [changes, setChanges] = useState<SiteChange[] | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [decay, setDecay] = useState<DecayPage[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!channel || tab === 'ga4' || channel.type === 'wordpress') return
    Promise.all([dbList('search_pages'), dbList('site_changes')])
      .then(([p, c]) => {
        setPages(p.filter((x) => x.channel_id === channel.id))
        setChanges(c.filter((x) => x.channel_id === channel.id).sort((a, b) => Date.parse(b.live_at) - Date.parse(a.live_at)))
      })
      .catch((e) => setError(e.message))
    // 搜索词选题是附加的：表还没建好（老项目没同步过）时不显示，不报错
    dbList('topics')
      .then((t) => setTopics(t.filter((x) => x.source === 'search' && x.status === 'idea')))
      .catch(() => setTopics([]))
    runLocal<DecayPage[]>('decay.list', { channel_id: channel.id })
      .then(setDecay)
      .catch(() => setDecay([]))
  }, [channel?.id, tab])
  useEffect(() => {
    setPages(null)
    setChanges(null)
    setTopics([])
    setDecay(null)
    setError('')
    load()
  }, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])
  // 换网站才清掉旧数据；只换时间段时旧数据留着、盖一层「加载中」，新数据回来再换
  useEffect(() => setRangeData(null), [channel?.id])
  useEffect(() => {
    if (!channel || channel.type !== 'creght_site' || tab !== 'pages' || !channel.gsc_property || channel.gsc_link_disabled || !rangeStart || !rangeEnd) {
      setRangeData(null)
      setRangeLoading(false)
      setRangeError('')
      return
    }
    let cancelled = false
    setRangeLoading(true)
    setRangeError('')
    runLocal<RangeData>('gsc.range', { channel_id: channel.id, start: rangeStart, end: rangeEnd })
      .then((data) => { if (!cancelled) setRangeData(data) })
      .catch((e) => { if (!cancelled) setRangeError((e as Error).message) })
      .finally(() => { if (!cancelled) setRangeLoading(false) })
    return () => { cancelled = true }
  }, [channel?.id, channel?.gsc_property, channel?.gsc_link_disabled, tab, rangeStart, rangeEnd, rangeRevision, ctx.rev])

  const applyGsc = (start: string, end: string) => {
    setParam('gsc_start', start)
    setParam('gsc_end', end)
    setRangeRevision((n) => n + 1)
  }
  const applyGa4 = (start: string, end: string) => {
    setParam('ga4_start', start)
    setParam('ga4_end', end)
  }
  const refresh = () => { load(); setRangeRevision((n) => n + 1) }

  if (!channel)
    return (
      <div className="space-y-6">
        <PageHeader title={tr('search.title')} />
        <Notice>{tr('search.no_site')}</Notice>
      </div>
    )

  const waiting = (changes ?? []).filter((c) => c.status === 'waiting').length
  const declining = (decay ?? []).filter((d) => d.status !== 'dismissed').length
  return (
    <div className="space-y-6">
      {headerActions && <div className="flex flex-wrap justify-between gap-3">{headerActions(channel)}</div>}
      <PageHeader
        title={tr('search.title')}
        desc={tr(tab === 'ga4' ? 'search.ga4_desc' : 'search.desc')}
        actions={
          <Segmented
            value={tab}
            onChange={(v) => setParam('tab', v)}
            options={[
              { value: 'pages', label: tr('search.tab_pages') },
              { value: 'keywords', label: tr('search.tab_keywords') },
              { value: 'decay', label: declining ? tr('search.tab_decay_n', { n: declining }) : tr('search.tab_decay') },
              { value: 'ga4', label: tr('search.tab_ga4') },
              { value: 'review', label: waiting ? tr('search.tab_review_waiting', { n: waiting }) : tr('search.tab_review') },
            ]}
          />
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SitePicker sites={sites} value={channel.id} onChange={(v) => setParam('channel', v)} />
        {tab === 'ga4' && channel.ga4_property && <RangeToggle value={ga4Choice} onChange={(value) => setParam('ga4_range', value)} options={rangeOptions()} />}
        {tab === 'pages' && channel.type === 'creght_site' && <RangeToggle value={rangeChoice} onChange={(value) => setParam('gsc_range', value)} options={rangeOptions()} />}
      </div>
      {tab === 'ga4' && channel.ga4_property && ga4Choice === 'custom' && <CustomRange key="ga4" start={ga4Start} end={ga4End} max={today} onApply={applyGa4} />}
      {tab === 'pages' && channel.type === 'creght_site' && rangeChoice === 'custom' && <CustomRange key="gsc" start={params.gsc_start || defaultStart} end={params.gsc_end || latest} max={latest} onApply={applyGsc} />}
      {error && <Notice tone="error">{error}</Notice>}
      {tab === 'ga4' ? (
        <Ga4Panel key={channel.id} channel={channel} days={ga4Days} start={ga4Choice === 'custom' ? ga4Start : undefined} end={ga4Choice === 'custom' ? ga4End : undefined} onLinked={() => ctx.reloadChannels()} />
      ) : channel.type === 'wordpress' ? (
        <Notice><p>{tr('search.wordpress_ga4')}</p><Button variant="outline" size="sm" onClick={() => setParam('tab', 'ga4')}>{tr('search.tab_ga4')}</Button></Notice>
      ) : tab === 'review' ? (
        <Review changes={changes} channel={channel} onChanged={load} />
      ) : tab === 'keywords' ? (
        <Keywords key={channel.id} channel={channel} rev={ctx.rev} onGo={(v, p) => ctx.go(v as View, p)} />
      ) : !channel.gsc_property || channel.gsc_link_disabled ? (
        <LinkProperty channel={channel} onLinked={() => ctx.reloadChannels()} />
      ) : tab === 'decay' ? (
        <Decay ctx={ctx} channel={channel} list={decay} pages={pages} onChanged={load} />
      ) : pages === null ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : rangeError ? (
        <Notice tone="error">{rangeError}</Notice>
      ) : !rangeStart || !rangeEnd ? (
        <Notice>{tr('search.choose_range')}</Notice>
      ) : rangeData === null ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <Reloading loading={rangeLoading}>
          <Pages ctx={ctx} channel={channel} pages={channel.gsc_synced_at ? pages : []} range={rangeData} topics={topics} onChanged={refresh} />
        </Reloading>
      )}
    </div>
  )
}

/** 自定义时间段：选好开始、结束日期点「应用时间」才生效（日期框改一下就查一次太频繁）；max 是最晚能选到的日子 */
function CustomRange({ start, end, max, onApply }: { start: string; end: string; max: string; onApply: (start: string, end: string) => void }) {
  const [draftStart, setDraftStart] = useState(start)
  const [draftEnd, setDraftEnd] = useState(end)
  const [error, setError] = useState('')
  const apply = () => {
    if (!draftStart || !draftEnd || draftStart > draftEnd || draftEnd > max) {
      setError(tr('search.invalid_range', { latest: max }))
      return
    }
    setError('')
    onApply(draftStart, draftEnd)
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
      <label className="space-y-1 text-xs text-muted-foreground">{tr('search.start_date')}<input type="date" value={draftStart} max={max} onChange={(e) => setDraftStart(e.target.value)} className={inputCls} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">{tr('search.end_date')}<input type="date" value={draftEnd} min={draftStart} max={max} onChange={(e) => setDraftEnd(e.target.value)} className={inputCls} /></label>
      <Button size="sm" onClick={apply}>{tr('search.apply_range')}</Button>
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </div>
  )
}

/** 还没关联属性：读 Google 账号下的属性，自动匹配或手动选 */
function LinkProperty({ channel, onLinked }: { channel: Channel; onLinked: () => void }) {
  const [props, setProps] = useState<{ siteUrl: string; permissionLevel: string; google?: string }[] | null>(null)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ok = useCanRun('gsc.properties') // 列 Search Console 属性要电脑上的 Google 授权
  const needConnect = /设置\s*→\s*连接|Settings\s*→\s*Connections/i.test(err)

  const loadProps = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await runLocal<{ list: { siteUrl: string; permissionLevel: string; google?: string }[] }>('gsc.properties', {})
      setProps(r.list)
      setPick(r.list[0]?.siteUrl ?? '')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    if (ok) loadProps()
  }, [ok, loadProps])

  const link = async (property?: string) => {
    setBusy(true)
    setErr('')
    try {
      await runLocal('gsc.link', { channel_id: channel.id, property })
      onLinked()
    } catch (e) {
      setErr((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8">
      <div className="mx-auto max-w-xl space-y-4 text-center">
        <div className="space-y-1">
          <div className="text-sm font-semibold">{tr('search.link_title', { name: channel.name })}</div>
          <p className="text-sm text-muted-foreground">{tr('search.link_desc')}</p>
          {channel.gsc_link_disabled && <p className="text-sm text-muted-foreground">{tr('search.unlinked')}</p>}
        </div>
        {!ok ? (
          <p className="text-xs text-muted-foreground">{tr('search.link_offline')}</p>
        ) : needConnect || (err && !props) ? (
          <div className="space-y-3">
            {!needConnect && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-center gap-2">
              {needConnect && (
                <Button onClick={() => openShuttleSettings('connections')}>
                  <Link2 /> {tr('search.connect')}
                </Button>
              )}
              <Button variant="outline" onClick={loadProps} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {needConnect ? tr('search.connected') : tr('common.retry')}
              </Button>
            </div>
          </div>
        ) : props === null ? (
          <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
        ) : props.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tr('search.no_props_1')}{' '}
            <a className="font-semibold underline underline-offset-2" href="https://search.google.com/search-console" target="_blank" rel="noreferrer">
              Search Console
            </a>{' '}
            {tr('search.no_props_2')}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row">
              <Select
                title={tr('search.property')}
                ariaLabel={tr('search.property')}
                value={pick}
                onChange={setPick}
                className="sm:max-w-xs"
                options={props.map((p) => ({ value: p.siteUrl, label: p.siteUrl.replace(/^sc-domain:/, ''), sub: (p.siteUrl.startsWith('sc-domain:') ? tr('search.prop_domain') : tr('search.prop_prefix')) + (new Set(props.map((x) => x.google)).size > 1 ? ` · ${p.google}` : '') }))}
              />
              <Button fn="gsc.link" onClick={() => link(pick)} disabled={busy || !pick}>
                {tr('search.link')}
              </Button>
              <Button fn="gsc.link" variant="outline" onClick={() => link()} disabled={busy} title={tr('search.auto_title')}>
                {tr('search.auto')}
              </Button>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function Delta({ cur, prev, invert, fmt = num }: { cur: number; prev: number; invert?: boolean; fmt?: (x: number) => string }) {
  if (!prev) return <span className="text-xs text-muted-foreground">{tr('search.no_prev')}</span>
  const d = (cur - prev) / prev
  const good = invert ? d < 0 : d > 0
  if (Math.abs(d) < 0.005) return <span className="text-xs text-muted-foreground">{tr('search.flat', { v: fmt(prev) })}</span>
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-xs font-medium', good ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
      {d > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {Math.abs(Math.round(d * 100))}%<span className="font-normal text-muted-foreground">{tr('search.prev', { v: fmt(prev) })}</span>
    </span>
  )
}

function Stat({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}

type SortKey = 'impressions' | 'clicks' | 'ctr' | 'position'

function Pages({ ctx, channel, pages, range, topics, onChanged }: { ctx: Ctx; channel: Channel; pages: SearchPage[]; range: RangeData; topics: Topic[]; onChanged: () => void }) {
  // 改写标题描述的「AI 要求」（tasks/search-meta.md 的写法），放在同步按钮旁边
  const metaTask = useTask(META_TASK)
  const [sort, setSort] = useState<SortKey>('impressions')
  const [showAll, setShowAll] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [unlinkError, setUnlinkError] = useState('')
  const s = { ...range.totals, pc: range.prev.clicks, pi: range.prev.impressions, pctr: range.prev.ctr, ppos: range.prev.position }
  const opps = useMemo(() => pages.filter((p) => p.opportunity || p.status).sort((a, b) => nbOf(b).impressions - nbOf(a).impressions), [pages])
  const sorted = useMemo(() => [...range.pages].sort((a, b) => (sort === 'position' ? (a.position || 999) - (b.position || 999) : b[sort] - a[sort])), [range.pages, sort])
  const wanted = useMemo(() => [...topics].sort((a, b) => (b.search_impressions ?? 0) - (a.search_impressions ?? 0)).slice(0, 10), [topics])
  const period = tr('search.data_range', { start: range.start, end: range.end })
  const propertyName = channel.gsc_property?.replace(/^sc-domain:/, '')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {tr('search.prop_label')} <span className="break-all">{propertyName}</span>
          {period && ` · ${period}`}
          {channel.gsc_synced_at && tr('search.synced', { when: fmtTime(channel.gsc_synced_at) })}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button fn="gsc.unlink" variant="ghost" size="sm" onClick={() => { setUnlinkError(''); setUnlinking(true) }}>
            <Unlink className="size-4" /> {tr('search.unlink')}
          </Button>
          <TaskRequirements task={metaTask.task} onSaved={metaTask.setTask} title={tr('search.meta_req_title')} hint={tr('search.meta_req_hint')} label={tr('search.meta_req_btn')} />
          <RunButton inline fn="gsc.sync" input={{ channel_id: channel.id, manual: true }} onDone={onChanged} variant="outline" icon={RefreshCw}>
            {tr('search.sync')}
          </RunButton>
        </div>
      </div>
      <Dialog open={unlinking} onClose={() => setUnlinking(false)} title={tr('search.unlink_title', { name: channel.name })} footer={<><Button variant="ghost" size="sm" onClick={() => setUnlinking(false)}>{tr('common.cancel')}</Button><RunButton inline fn="gsc.unlink" input={{ channel_id: channel.id }} icon={Unlink} onError={setUnlinkError} onDone={(result) => { if ((result as { unlinked?: boolean } | undefined)?.unlinked) { setUnlinking(false); ctx.reloadChannels() } }}>{tr('search.unlink')}</RunButton></>}>
        <p className="text-sm text-muted-foreground">{tr('search.unlink_hint')}</p>
        {unlinkError && <Notice tone="error">{unlinkError}</Notice>}
      </Dialog>

      {range.pages.length === 0 ? (
        <Notice>{tr('search.empty_range')}</Notice>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={tr('search.clicks')} value={num(s.clicks)}>
              <Delta cur={s.clicks} prev={s.pc} />
            </Stat>
            <Stat label={tr('search.impressions')} value={num(s.impressions)}>
              <Delta cur={s.impressions} prev={s.pi} />
            </Stat>
            <Stat label={tr('search.ctr')} value={pct(s.ctr)}>
              <Delta cur={s.ctr} prev={s.pctr} fmt={pct} />
            </Stat>
            <Stat label={tr('search.position')} value={s.position ? s.position.toFixed(1) : '-'}>
              <Delta cur={s.position} prev={s.ppos} invert fmt={(x) => x.toFixed(1)} />
            </Stat>
          </div>

          <DailyTrend daily={range.daily} start={range.start} end={range.end} channel={channel} />

          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">{tr('search.worth')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{tr('search.worth_desc')} {tr('search.synced_28_days')}</p>
            </div>
            {opps.length === 0 ? (
              <Notice>{tr('search.worth_none')}</Notice>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                {opps.map((p) => (
                  <OppRow key={p.id} p={p} ctx={ctx} channel={channel} onChanged={onChanged} />
                ))}
              </div>
            )}
          </div>

          {wanted.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">{tr('search.gaps')}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tr('search.gaps_desc')} {tr('search.synced_28_days')}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => ctx.go('content', { tab: 'topics' })}>
                  {tr('search.go_topics')} <ArrowUpRight />
                </Button>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                {wanted.map((t) => (
                  <div key={t.id} className="flex items-center gap-4 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
                    <span className="min-w-0 flex-1 truncate">{t.search_query || t.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{tr('search.imp_n', { n: num(t.search_impressions) })}</span>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{tr('search.rank_n', { n: t.search_position ? t.search_position.toFixed(1) : '-' })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Panel
            title={tr('search.all_pages', { n: range.pages.length })}
            aside={
              <Segmented
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'impressions', label: tr('search.impressions') },
                  { value: 'clicks', label: tr('search.clicks') },
                  { value: 'ctr', label: tr('search.ctr') },
                  { value: 'position', label: tr('search.rank') },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{tr('search.page')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{tr('search.clicks')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{tr('search.impressions')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{tr('search.ctr')}</th>
                    <th className="py-2 text-right font-medium">{tr('search.rank')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAll ? sorted : sorted.slice(0, 20)).map((p) => {
                    return (
                      <tr key={p.page} className="border-b border-border last:border-b-0">
                        <td className="max-w-0 py-2 pr-3">
                          <a href={p.page} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs hover:text-primary-text" title={p.page}>
                            {pathOf(p.page)}
                          </a>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{num(p.clicks)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {num(p.impressions)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{pct(p.ctr)}</td>
                        <td className="py-2 text-right tabular-nums">{p.position ? p.position.toFixed(1) : '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {sorted.length > 20 && (
              <div className="mt-3 flex justify-center">
                <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? tr('search.collapse') : tr('search.show_all', { n: sorted.length })}
                </Button>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}

type Metric = 'clicks' | 'impressions'

/** 选中区间的按天趋势。点击和曝光量级差太多，切换着看；没有数据不显示 */
function DailyTrend({ daily, start, end, channel }: { daily: RangeDaily[]; start: string; end: string; channel: Channel }) {
  const [metric, setMetric] = useState<Metric>('clicks')
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => setPicked(null), [start, end, channel.id])
  const rows = useMemo(() => {
    // 缺的日期（GSC 没有曝光的天不返回）补 0
    const by = new Map(daily.map((d) => [d.date, d]))
    const out: { date: string; day: string; clicks: number; impressions: number }[] = []
    for (let t = Date.parse(start); t <= Date.parse(end); t += DAY) {
      const date = new Date(t).toISOString().slice(0, 10)
      const d = by.get(date)
      out.push({ date, day: date.replace(/-/g, ''), clicks: d?.clicks ?? 0, impressions: d?.impressions ?? 0 })
    }
    return out
  }, [daily, start, end])
  if (!rows.length) return null
  const label = metric === 'clicks' ? tr('search.clicks') : tr('search.impressions')
  return (
    <Panel
      title={tr('search.daily', { m: label, n: rows.length })}
      aside={
        <Segmented
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'clicks', label: tr('search.clicks') },
            { value: 'impressions', label: tr('search.impressions') },
          ]}
        />
      }
    >
      <TrendChart
        days={rows.map((r) => r.day)}
        series={[{ name: label, color: 'var(--series-1)', values: rows.map((r) => r[metric]) }]}
        height={220}
        label={tr('search.trend', { m: label })}
        onPick={(i) => setPicked(rows[i].date)}
        picked={picked ? rows.findIndex((r) => r.date === picked) : null}
      />
      {picked ? <DayDetail channel={channel} date={picked} onClose={() => setPicked(null)} /> : <p className="mt-2 text-xs text-muted-foreground">{tr('search.pick_day')}</p>}
    </Panel>
  )
}

type DayRow = { clicks: number; impressions: number; ctr: number; position: number }
type DayData = { date: string; queries: (DayRow & { query: string; noise: boolean })[]; pages: (DayRow & { page: string })[] }

/** 趋势图上点的那一天：曝光最多的搜索词和页面（gsc.day 现查 GSC） */
function DayDetail({ channel, date, onClose }: { channel: Channel; date: string; onClose: () => void }) {
  const [data, setData] = useState<DayData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setData(null)
    setError('')
    runLocal<DayData>('gsc.day', { channel_id: channel.id, date })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [channel.id, date])
  const pathOf = (u: string) => {
    try {
      return decodeURI(new URL(u).pathname)
    } catch {
      return u
    }
  }
  const stat = (r: DayRow) => tr('search.day_stat', { i: r.impressions, c: r.clicks, p: r.position })
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{tr('search.day_top', { date })}</div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {tr('search.collapse')}
        </Button>
      </div>
      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : !data ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {tr('search.querying')}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{tr('search.query')}</div>
            {data.queries.length ? (
              data.queries.map((q) => (
                <div key={q.query} className="min-w-0 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-foreground">{q.query}</span>
                    {q.noise && <Badge>{tr('search.brand_site')}</Badge>}
                  </div>
                  <div className="text-muted-foreground tabular-nums">{stat(q)}</div>
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground">{tr('search.no_queries')}</div>
            )}
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{tr('search.page')}</div>
            {data.pages.map((p) => (
              <div key={p.page} className="min-w-0 text-xs">
                <a href={p.page} target="_blank" rel="noreferrer" className="block truncate font-mono text-foreground hover:underline">
                  {pathOf(p.page)}
                </a>
                <div className="text-muted-foreground tabular-nums">{stat(p)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OppRow({ p, ctx, channel, onChanged }: { p: SearchPage; ctx: Ctx; channel: Channel; onChanged: () => void }) {
  const queries = parse<SearchQuery[]>(p.top_queries, [])
  const sug = parse<SearchSuggestion | null>(p.suggestion, null)
  const brief = parse<SearchExpandBrief | null>(p.expand_brief, null)
  const [open, setOpen] = useState(!!(sug || brief) && p.status !== 'live')
  const opp = p.opportunity ? OPP[p.opportunity] : null
  const m = nbOf(p)
  // 差一点上首页：问题是排不上去，补内容；点击率偏低：改标题和描述
  const expanding = p.opportunity === 'striking_distance' || (!p.opportunity && !!brief && !sug)
  const site = `site_ref ${channel.project_id}/${channel.site_id}`
  const prompt = sug
    ? tr('search.meta_prompt', { name: channel.name, site, page: p.page, id: p.id, title: sug.title, desc: sug.description, reason: sug.reason })
    : ''
  const expandPrompt = brief
    ? tr('search.expand_prompt', { name: channel.name, site, page: p.page, id: p.id, pos: m.position ? m.position.toFixed(1) : '-', brief: briefText(brief), site_id: channel.site_id ?? '' })
    : ''
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium" title={p.page}>
              {pathOf(p.page)}
            </span>
            {opp && (
              <span title={opp.hint}>
                <Badge tone={opp.tone}>{opp.label}</Badge>
              </span>
            )}
            {p.status === 'fixing' && <Badge tone="primary">{tr('search.fixing')}</Badge>}
            {p.status === 'live' && <Badge tone="ok">{tr('search.live')}</Badge>}
            <ChevronDown className={cx('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
            <span>{tr('search.imp_n', { n: num(m.impressions) })}</span>
            <span>
              {tr('search.ctr_n', { n: pct(m.ctr) })}
              {p.expected_ctr ? tr('search.expected', { n: pct(p.expected_ctr) }) : ''}
            </span>
            <span>{tr('search.rank_n', { n: m.position ? m.position.toFixed(1) : '-' })}</span>
            {queries[0] && <span className="truncate">{tr('search.main_queries', { q: queries.slice(0, 3).map((q) => q.query).join(', ') })}</span>}
          </div>
          {!!p.noise_impressions && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{tr('search.noise', { n: num(p.noise_impressions) })}</div>}
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {p.status !== 'live' &&
            (expanding ? (
              <TaskButton task={EXPAND_TASK} input={{ id: p.id }} match={(r) => r.input?.id === p.id} onFinished={() => (setOpen(true), onChanged())} variant={brief ? 'ghost' : 'outline'} icon={FilePlus2}>
                {brief ? tr('search.regen') : tr('search.expand')}
              </TaskButton>
            ) : (
              <TaskButton task={META_TASK} input={{ id: p.id }} match={(r) => r.input?.id === p.id} onFinished={() => (setOpen(true), onChanged())} variant={sug ? 'ghost' : 'outline'} icon={Sparkles}>
                {sug ? tr('search.regen') : tr('search.gen_meta')}
              </TaskButton>
            ))}
          {!expanding && sug && !p.status && (
            <AskButton variant="default" prompt={prompt}>
              {tr('search.hand_site')}
            </AskButton>
          )}
          {p.status === 'fixing' && (
            // 交给助手核对：抓线上页面、对照建议判断真的上线了才开始复查（建议是 AI 写的，线上措辞可能调过，代码比不了）
            <TaskButton task={VERIFY_TASK} input={{ id: p.id, kind: expanding ? 'search_content' : 'search_meta' }} match={(r) => r.input?.id === p.id} onFinished={onChanged} variant="default" icon={SearchCheck}>
              {tr('search.mark_live')}
            </TaskButton>
          )}
        </div>
      </div>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          {!expanding && sug && (
            <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3 text-xs md:grid-cols-2">
              <div className="space-y-1">
                <div className="font-semibold text-muted-foreground">{tr('search.now')}</div>
                <div className="text-[13px] font-medium">{sug.current_title || tr('search.no_title')}</div>
                <div className="text-muted-foreground">{sug.current_description || tr('search.no_desc')}</div>
              </div>
              <div className="space-y-1">
                <div className="font-semibold text-primary-text">{tr('search.suggest')}</div>
                <div className="text-[13px] font-medium">{sug.title}</div>
                <div className="text-muted-foreground">{sug.description}</div>
              </div>
              {sug.reason && <div className="text-muted-foreground md:col-span-2">{tr('search.why', { r: sug.reason })}</div>}
            </div>
          )}
          {expanding && brief && (
            <div className="space-y-3">
              <ExpandBrief brief={brief} />
              {!p.status && (
                <AskButton variant="default" prompt={expandPrompt}>
                  {tr('search.hand_page')}
                </AskButton>
              )}
            </div>
          )}
          {queries.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">{tr('search.query')}</th>
                  <th className="py-1 pr-3 text-right font-medium">{tr('search.impressions')}</th>
                  <th className="py-1 pr-3 text-right font-medium">{tr('search.clicks')}</th>
                  <th className="py-1 text-right font-medium">{tr('search.rank')}</th>
                </tr>
              </thead>
              <tbody>
                {queries.map((q) => (
                  <tr key={q.query} className="border-t border-border">
                    <td className="py-1 pr-3">{q.query}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{num(q.impressions)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{num(q.clicks)}</td>
                    <td className="py-1 text-right tabular-nums">{q.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <a href={p.page} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold hover:text-primary-text">
            {tr('search.open_page')} <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    </div>
  )
}

/** 补内容要点写成给助手的文字 */
const CAUSE: Record<DecayCause, { tone: Tone }> = { rank: { tone: 'bad' }, ctr: { tone: 'warn' }, demand: { tone: 'default' } }

/** 流量下滑（内容衰减雷达）：decay.scan 每周对比最近 28 天和之前 5 个 28 天的高峰，找出掉了的页面 */
function Decay({ ctx, channel, list, pages, onChanged }: { ctx: Ctx; channel: Channel; list: DecayPage[] | null; pages: SearchPage[] | null; onChanged: () => void }) {
  const [showDismissed, setShowDismissed] = useState(false)
  // 「新」：这次打开时还没看过的；打开就记成看过，这一页上仍然标着，下次不再标
  const [fresh, setFresh] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (!list || fresh) return
    const ids = list.filter((d) => !d.seen).map((d) => d.id)
    setFresh(new Set(ids))
    if (ids.length) runLocal('decay.markSeen', { ids }).catch(() => {})
  }, [list])
  if (list === null || pages === null) return <Skeleton className="h-40 rounded-xl" />
  const active = list.filter((d) => d.status !== 'dismissed')
  const dismissed = list.filter((d) => d.status === 'dismissed')
  const scanned = list.map((d) => d.scanned_at ?? '').sort().pop()
  const lost = active.reduce((n, d) => n + d.lost_clicks, 0)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          {tr('search.decay_desc')}
          {scanned && tr('search.decay_scanned', { when: fmtTime(scanned) })}
        </p>
        <RunButton inline fn="decay.scan" input={{ channel_id: channel.id, manual: true }} onDone={onChanged} variant="outline" icon={RefreshCw}>
          {tr('search.decay_scan')}
        </RunButton>
      </div>
      {active.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={tr('search.decay_pages')} value={num(active.length)}>
            <span className="text-xs text-muted-foreground">{tr('search.decay_pages_hint')}</span>
          </Stat>
          <Stat label={tr('search.decay_lost')} value={num(lost)}>
            <span className="text-xs text-muted-foreground">{tr('search.decay_lost_hint')}</span>
          </Stat>
        </div>
      )}
      {active.length === 0 ? (
        <Notice>{scanned || dismissed.length ? tr('search.decay_none') : tr('search.decay_never')}</Notice>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {active.map((d) => (
            <DecayRow key={d.id} d={d} sp={pages.find((p) => p.id === d.search_page_id)} isNew={!!fresh?.has(d.id)} ctx={ctx} channel={channel} onChanged={onChanged} />
          ))}
        </div>
      )}
      {dismissed.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setShowDismissed((v) => !v)} aria-expanded={showDismissed} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {tr('search.decay_dismissed', { n: dismissed.length })}
            <ChevronDown className={cx('size-3.5 transition-transform', showDismissed && 'rotate-180')} />
          </button>
          {showDismissed && (
            <div className="overflow-hidden rounded-xl border border-border bg-background opacity-70">
              {dismissed.map((d) => (
                <DecayRow key={d.id} d={d} sp={pages.find((p) => p.id === d.search_page_id)} isNew={false} ctx={ctx} channel={channel} onChanged={onChanged} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 6 个 28 天的点击，一根柱子一个 */
function Bars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  return (
    <span className="inline-flex h-5 items-end gap-0.5" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className={cx('w-1.5 rounded-sm', i === values.length - 1 ? 'bg-destructive/70' : 'bg-primary/40')} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </span>
  )
}

function DecayRow({ d, sp, isNew, ctx, channel, onChanged }: { d: DecayPage; sp?: SearchPage; isNew: boolean; ctx: Ctx; channel: Channel; onChanged: () => void }) {
  const sug = parse<SearchSuggestion | null>(sp?.suggestion, null)
  const brief = parse<SearchExpandBrief | null>(sp?.expand_brief, null)
  // 点击率降了：改标题描述；排名掉了、曝光少了：刷新内容
  const meta = d.cause === 'ctr'
  const [open, setOpen] = useState(!!(meta ? sug : brief) && !sp?.status)
  const site = `site_ref ${channel.project_id}/${channel.site_id}`
  const handPrompt = !sp
    ? ''
    : meta
      ? sug ? tr('search.meta_prompt', { name: channel.name, site, page: d.page, id: sp.id, title: sug.title, desc: sug.description, reason: sug.reason }) : ''
      : brief ? tr('search.refresh_prompt', { name: channel.name, site, page: d.page, id: sp.id, peak: d.peak_clicks, now: d.clicks, brief: briefText(brief), site_id: channel.site_id ?? '' }) : ''
  const dismissed = d.status === 'dismissed'
  return (
    <div className={cx('border-b border-border last:border-b-0', isNew && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex flex-wrap items-center gap-2">
            {isNew && <span className="inline-flex h-4 items-center rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">{tr('article.new_badge')}</span>}
            <span className="truncate font-mono text-[13px] font-medium" title={d.page}>{pathOf(d.page)}</span>
            <span title={tr(`search.cause_${d.cause}_hint`)}><Badge tone={CAUSE[d.cause]?.tone ?? 'default'}>{tr(`search.cause_${d.cause}`)}</Badge></span>
            {sp?.status === 'fixing' && <Badge tone="primary">{tr('search.fixing')}</Badge>}
            {sp?.status === 'live' && <Badge tone="ok">{tr('search.live')}</Badge>}
            <ChevronDown className={cx('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1.5"><Bars values={d.trend} />{tr('search.decay_clicks', { peak: num(d.peak_clicks), now: num(d.clicks), pct: Math.round(d.drop * 100) })}</span>
            <span>{tr('search.decay_rank', { peak: d.peak_position ? d.peak_position.toFixed(1) : '-', now: d.position ? d.position.toFixed(1) : '-' })}</span>
            <span>{tr('search.decay_ctr', { peak: pct(d.peak_ctr), now: pct(d.ctr) })}</span>
            <span>{tr('search.decay_imp', { peak: num(d.peak_impressions), now: num(d.impressions) })}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">{tr('search.decay_period', { start: d.peak_start, end: d.peak_end })}</div>
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {dismissed ? (
            <RunButton inline fn="decay.dismiss" input={{ id: d.id, undo: true }} onDone={onChanged} variant="ghost" icon={Undo2}>{tr('search.decay_undismiss')}</RunButton>
          ) : !sp ? (
            <span className="text-xs text-muted-foreground">{tr('search.decay_no_record')}</span>
          ) : sp.status === 'live' ? (
            <Button variant="ghost" size="sm" onClick={() => ctx.go('search', { tab: 'review', channel: channel.id })}>{tr('search.decay_go_review')} <ArrowUpRight /></Button>
          ) : sp.status === 'fixing' ? (
            <TaskButton task={VERIFY_TASK} input={{ id: sp.id, kind: meta ? 'search_meta' : 'search_content' }} match={(r) => r.input?.id === sp.id} onFinished={onChanged} variant="default" icon={SearchCheck}>{tr('search.mark_live')}</TaskButton>
          ) : (
            <>
              {meta ? (
                <TaskButton task={META_TASK} input={{ id: sp.id }} match={(r) => r.input?.id === sp.id} onFinished={() => (setOpen(true), onChanged())} variant={sug ? 'ghost' : 'outline'} icon={Sparkles}>
                  {sug ? tr('search.regen') : tr('search.gen_meta')}
                </TaskButton>
              ) : (
                <TaskButton task={REFRESH_TASK} input={{ id: d.id }} match={(r) => r.input?.id === d.id} onFinished={() => (setOpen(true), onChanged())} variant={brief ? 'ghost' : 'outline'} icon={FilePlus2}>
                  {brief ? tr('search.regen') : tr('search.decay_refresh')}
                </TaskButton>
              )}
              {handPrompt && <AskButton variant="default" prompt={handPrompt}>{meta ? tr('search.hand_site') : tr('search.hand_page')}</AskButton>}
            </>
          )}
          {!dismissed && !sp?.status && (
            <RunButton inline fn="decay.dismiss" input={{ id: d.id }} onDone={onChanged} variant="ghost" icon={EyeOff}>{tr('search.decay_dismiss')}</RunButton>
          )}
        </div>
      </div>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          <p className="text-xs text-muted-foreground">{tr(`search.cause_${d.cause}_hint`)}</p>
          {meta && sug && (
            <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3 text-xs md:grid-cols-2">
              <div className="space-y-1">
                <div className="font-semibold text-muted-foreground">{tr('search.now')}</div>
                <div className="text-[13px] font-medium">{sug.current_title || tr('search.no_title')}</div>
                <div className="text-muted-foreground">{sug.current_description || tr('search.no_desc')}</div>
              </div>
              <div className="space-y-1">
                <div className="font-semibold text-primary-text">{tr('search.suggest')}</div>
                <div className="text-[13px] font-medium">{sug.title}</div>
                <div className="text-muted-foreground">{sug.description}</div>
              </div>
              {sug.reason && <div className="text-muted-foreground md:col-span-2">{tr('search.why', { r: sug.reason })}</div>}
            </div>
          )}
          {!meta && brief && <ExpandBrief brief={brief} />}
          {d.lost_queries.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">{tr('search.decay_lost_queries')}</th>
                  <th className="py-1 pr-3 text-right font-medium">{tr('search.decay_q_clicks')}</th>
                  <th className="py-1 text-right font-medium">{tr('search.decay_q_rank')}</th>
                </tr>
              </thead>
              <tbody>
                {d.lost_queries.map((q) => (
                  <tr key={q.query} className="border-t border-border">
                    <td className="py-1 pr-3">{q.query}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{num(q.peak_clicks)} → {num(q.clicks)}</td>
                    <td className="py-1 text-right tabular-nums">{q.peak_position || '-'} → {q.position || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <a href={d.page} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold hover:text-primary-text">
            {tr('search.open_page')} <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    </div>
  )
}

function briefText(b: SearchExpandBrief) {
  const parts: string[] = []
  if (b.summary) parts.push(tr('search.b_summary', { s: b.summary }))
  if (b.gaps.length) parts.push(tr('search.b_gaps') + ':\n' + b.gaps.map((g) => `- ${g}`).join('\n'))
  if (b.sections.length) parts.push(tr('search.b_sections') + ':\n' + b.sections.map((x) => `- ${x.heading}: ${x.what}`).join('\n'))
  if (b.faq.length) parts.push('FAQ:\n' + b.faq.map((q) => `- ${q}`).join('\n'))
  if (b.internal_links.length) parts.push(tr('search.b_links') + ':\n' + b.internal_links.map((l) => tr('search.b_link_item', { from: l.from, anchor: l.anchor })).join('\n'))
  return parts.join('\n\n')
}

function ExpandBrief({ brief }: { brief: SearchExpandBrief }) {
  const block = (title: string, children: ReactNode) => (
    <div className="space-y-1">
      <div className="font-semibold text-muted-foreground">{title}</div>
      {children}
    </div>
  )
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3 text-xs">
      {brief.summary && <div className="text-[13px] font-medium">{brief.summary}</div>}
      {brief.gaps.length > 0 &&
        block(
          tr('search.b_gaps'),
          <ul className="list-disc space-y-0.5 pl-4">
            {brief.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>,
        )}
      {brief.sections.length > 0 &&
        block(
          tr('search.b_sections_ui'),
          <ul className="space-y-1">
            {brief.sections.map((x) => (
              <li key={x.heading}>
                <span className="font-medium">{x.heading}</span>
                <span className="text-muted-foreground">{tr('search.sep')}{x.what}</span>
              </li>
            ))}
          </ul>,
        )}
      {brief.faq.length > 0 &&
        block(
          'FAQ',
          <ul className="list-disc space-y-0.5 pl-4">
            {brief.faq.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>,
        )}
      {brief.internal_links.length > 0 &&
        block(
          tr('search.b_links_ui'),
          <ul className="space-y-0.5">
            {brief.internal_links.map((l) => (
              <li key={l.from + l.anchor}>
                <a href={l.from} target="_blank" rel="noreferrer" className="font-mono hover:text-primary-text">
                  {pathOf(l.from)}
                </a>
                <span className="text-muted-foreground">{tr('search.b_anchor', { anchor: l.anchor })}</span>
              </li>
            ))}
          </ul>,
        )}
    </div>
  )
}

const kindLabel = (k: string) => (['issue_fix', 'search_meta', 'search_content', 'article'].includes(k) ? tr(`search.k_${k}`) : k)
const VERDICT: Record<string, { label: string; tone: Tone }> = {
  better: { get label() { return tr('overview.v_better') }, tone: 'ok' },
  flat: { get label() { return tr('overview.v_flat') }, tone: 'default' },
  worse: { get label() { return tr('overview.v_worse') }, tone: 'bad' },
}

/** 改动复查：上线过的改动，到期对比前后 14 天 */
function Review({ changes, channel, onChanged }: { changes: SiteChange[] | null; channel: Channel; onChanged: () => void }) {
  if (changes === null) return <Skeleton className="h-40 rounded-xl" />
  const due = changes.filter((c) => c.status === 'waiting' && Date.parse(c.review_at) <= Date.now()).length
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {tr('search.review_desc')}
        </p>
        {due > 0 && (
          <RunButton inline fn="review.check" input={{}} onDone={onChanged} variant="outline">
            {tr('search.review_now', { n: due })}
          </RunButton>
        )}
      </div>
      {changes.length === 0 ? (
        <Notice>{tr('search.no_changes', { name: channel.name })}</Notice>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {changes.map((c) => (
            <ChangeRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChangeRow({ c }: { c: SiteChange }) {
  const [open, setOpen] = useState(false)
  const before = parse<ChangeMetrics | null>(c.before, null)
  const after = parse<ChangeMetrics | null>(c.after, null)
  const v = c.verdict ? VERDICT[c.verdict] : null
  const days = Math.ceil((Date.parse(c.review_at) - Date.now()) / 86400_000)
  const rows: [string, (m: ChangeMetrics) => string][] =
    before?.source === 'gsc'
      ? [
          [tr('search.clicks'), (m) => num(m.clicks)],
          [tr('search.impressions'), (m) => num(m.impressions)],
          [tr('search.ctr'), (m) => pct(m.ctr)],
          [tr('search.position'), (m) => (m.position ? String(m.position) : '-')],
        ]
      : [[tr('search.pv'), (m) => num(m.pv)]]
  return (
    <div className="border-b border-border last:border-b-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!before} className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left disabled:cursor-default">
        <Badge className="mt-0.5">{kindLabel(c.kind)}</Badge>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{c.title}</span>
            {c.status === 'waiting' ? (
              <Badge tone="primary">{days > 0 ? tr('search.in_days', { n: days }) : tr('search.today')}</Badge>
            ) : c.status === 'no_data' ? (
              <Badge>{tr('search.no_data')}</Badge>
            ) : (
              v && <Badge tone={v.tone}>{v.label}</Badge>
            )}
            {before && <ChevronDown className={cx('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {tr('search.live_at', { when: fmtTime(c.live_at) })}{c.summary ? ` · ${c.summary}` : ''}
          </div>
        </div>
      </button>
      {open && before && after && (
        <div className="px-4 pb-3 pl-[88px]">
          <table className="text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-6 font-medium" />
                <th className="py-1 pr-6 font-medium">
                  {tr('search.before')} <span className="font-normal">{before.start} ~ {before.end}</span>
                </th>
                <th className="py-1 font-medium">
                  {tr('search.after')} <span className="font-normal">{after.start} ~ {after.end}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, f]) => (
                <tr key={label} className="border-t border-border">
                  <td className="py-1 pr-6 text-muted-foreground">{label}</td>
                  <td className="py-1 pr-6 tabular-nums">{f(before)}</td>
                  <td className="py-1 tabular-nums">{f(after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[11px] text-muted-foreground">{tr('search.source', { s: before.source === 'gsc' ? 'Google Search Console' : tr('search.src_creght') })}</div>
        </div>
      )}
    </div>
  )
}
