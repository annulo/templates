import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, CircleHelp, EyeOff, FilePlus2, ListPlus, MessageCircle, Plus, RefreshCw, SearchCheck, ShieldCheck, Sparkles, Target, Undo2, X } from 'lucide-react'
import { Badge, Button, Dialog, Notice, Skeleton, cx, fmtTime, inputCls, type Tone } from './ui'
import RunButton from './RunButton'
import { TaskButton, TaskLaunchButton } from './Task'
import { LandingButton } from './views/Landing'
import { openChat, runLocal, type Channel } from '../lib/shuttle'
import { numLocale, tr } from '../lib/i18n'

// SEO 与关键词 → 关键词（keywords.ts，设计见 docs/keywords.md「页面」）：按主题组织，一个主题做一个页面，每个主题一个主按钮；
// 每个词一行、一句理由，细节点开才看。页面问题（标题 / H1 没用上、几个页面在抢）由站点体检查、记成体检问题（_audit_keywords.ts），这里只摆结论、链过去。

const RESEARCH_TASK = 'keyword-research'
const EXPAND_TASK = 'search-expand'
const META_TASK = 'search-meta' // 标题、描述没用上这个词：谷歌排名现成的改标题描述任务

type Bucket = 'quick_win' | 'ranking' | 'open' | 'mixed' | 'hard' | 'unchecked'
type Keyword = {
  id: string; keyword: string; status: string; intent?: string; cluster?: string; note?: string; sources?: string
  gsc_impressions?: number; gsc_clicks?: number; gsc_position?: number; gsc_page?: string; search_page_id?: string
  bucket?: Bucket; score?: number; topic_id?: string; seen?: boolean
  serp_at?: string; serp_position?: number; serp_weak?: number; serp_strong?: number; serp_competitors?: string; serp_results?: string; serp_error?: string; rank_history?: string
  target_page?: string; live_at?: string; review_verdict?: string; review_summary?: string; onpage?: string; gsc_pages?: string
}
type OnPage = { page: string; title: boolean; h1: boolean; description: boolean; url?: boolean; checked_at: string; error?: string; primary?: boolean; title_text?: string; h1_text?: string; desc_text?: string }
type Competing = { page: string; impressions: number; position: number }
type SerpRow = { p: number; domain: string; kind: string; title: string; url: string }
type Rank = { d: string; p: number; s: 'gsc' | 'serp' }
type Data = { list: Keyword[]; raw: number; raw_sample: string[]; serp_pending: number; chat_id: string; reviewed_at: string; gsc_at: string }
type Tab = 'fix' | 'write' | 'doing' | 'other'
type Go = (view: string, params?: Record<string, string>) => void

const num = (x?: number) => (x ?? 0).toLocaleString(numLocale())
const pathOf = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/'
const KIND_TONE: Record<string, Tone> = { ours: 'ok', competitor: 'bad', b2b: 'primary', forum: 'primary', social: 'primary', marketplace: 'warn', reference: 'warn' }
const VERDICT_TONE: Record<string, Tone> = { better: 'ok', flat: 'default', worse: 'bad', no_data: 'default' }
const REVIEW_DAYS = 17 // 和 _review.ts 的 REVIEW_DELAY_DAYS 一样：上线 17 天后复查

function parse<T>(s: string | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}
const onpageOf = (k: Keyword) => parse<OnPage | null>(k.onpage, null)
const competingOf = (k: Keyword) => parse<Competing[]>(k.gsc_pages, [])
/** 这个词是目标页面的主词，但标题或 H1 没用上（站点体检查的；不是主词的只记事实，不算问题） */
const pageMissing = (k: Keyword) => {
  const o = onpageOf(k)
  return !!o && !o.error && !!o.primary && (!o.title || !o.h1)
}
const competing = (k: Keyword) => competingOf(k).length > 1
/** 竞品在前 10、我们不在（和 _keywords.ts 的 rivalOnly 同一个口径） */
const rivalOnly = (k: Keyword) => !!k.serp_at && !!k.serp_competitors && !k.serp_position && !(k.gsc_position && k.gsc_position <= 10)
const pageOf = (k: Keyword) => k.target_page || k.gsc_page || ''



const pos = (r: Rank) => (r.p ? String(r.p) : '10+')
const day = (iso: string) => new Date(iso).toLocaleDateString(numLocale(), { month: 'numeric', day: 'numeric' })

/** 每个词一句理由：为什么在这一类、现在怎么样 */
function reasonOf(k: Keyword, tab: Tab): string {
  const parts: string[] = []
  const rank = k.gsc_position ? tr('keywords.r_rank', { pos: k.gsc_position.toFixed(1), imp: num(k.gsc_impressions) }) : k.serp_position ? tr('keywords.r_serp_rank', { pos: k.serp_position }) : ''
  if (tab === 'fix') {
    if (rank) parts.push(rank)
    if (pageMissing(k)) parts.push(tr('keywords.r_missing'))
    if (competing(k)) parts.push(tr('keywords.r_competing', { n: competingOf(k).length }))
  } else if (tab === 'write') {
    if (rivalOnly(k)) parts.push(tr('keywords.r_rival', { d: (k.serp_competitors ?? '').split(',').join('、') }))
    if (k.bucket === 'open') parts.push(tr('keywords.r_open', { n: k.serp_weak ?? 0 }))
    else if (k.bucket === 'mixed') parts.push(tr('keywords.r_mixed', { n: k.serp_weak ?? 0 }))
  } else if (tab === 'doing') {
    const hist = parse<Rank[]>(k.rank_history, [])
    if (k.review_verdict) parts.push(`${tr(`keywords.verdict_${k.review_verdict}`)} · ${k.review_summary ?? ''}`)
    else if (k.live_at) parts.push(tr('keywords.live_wait', { live: day(k.live_at), review: day(new Date(Date.parse(k.live_at) + REVIEW_DAYS * 86400_000).toISOString()) }))
    if (!k.review_verdict && hist.length >= 2) parts.push(tr('keywords.rank_trend', { from: pos(hist[hist.length - 2]), to: pos(hist[hist.length - 1]) }))
    else if (!k.review_verdict && rank) parts.push(rank)
    if (!parts.length) parts.push(k.topic_id ? tr('keywords.r_topic') : tr('keywords.no_rank'))
  } else if (rank) parts.push(rank)
  return parts.join(' · ')
}

/** 关键词地图的一行（plan.keywordMap，有增长计划模块的模板才有：外贸、产品运营） */
export type TopicRow = {
  cluster: string; channel_id?: string; stage: Stage; page: string; best_position: number | null; impressions: number; clicks: number; leads?: number | null
  topic_id?: string; article_id?: string; search_page_id?: string; untopiced?: string[]; opportunity_id?: string
  next?: { text: string; action: { kind: 'go'; view: string; params?: Record<string, string> } }
}
type Stage = 'none' | 'topic' | 'draft' | 'live' | 'shown' | 'top30' | 'top10'
type Act = 'write' | 'writing' | 'publish' | 'fix' | 'reviewing' | 'watch'
type Filter = 'all' | 'todo' | 'doing' | 'live' | 'loose'
type Topic = TopicRow & { words: Keyword[]; act: Act }
const RANK: Record<Stage, number> = { none: 0, topic: 1, draft: 2, live: 3, shown: 4, top30: 4, top10: 5 }
const STEPS = ['topic', 'draft', 'live', 'shown', 'top10'] as const
const FILTER_OF: Record<Act, Filter> = { write: 'todo', fix: 'todo', writing: 'doing', publish: 'doing', reviewing: 'doing', watch: 'live' }

/** 没有增长计划模块（自媒体）时按词自己的数据推算阶段：选题、上线、谷歌排名 */
function guessRow(cluster: string, words: Keyword[]): TopicRow {
  const best = Math.min(...words.map((k) => k.gsc_position || k.serp_position || 999))
  const impressions = words.reduce((s, k) => s + (k.gsc_impressions ?? 0), 0)
  const page = words.find((k) => k.target_page)?.target_page || words.find((k) => k.gsc_page)?.gsc_page || ''
  const topic = words.find((k) => k.topic_id)?.topic_id || ''
  const stage: Stage = best <= 10 ? 'top10' : best <= 30 ? 'top30' : impressions > 0 ? 'shown' : page || words.some((k) => k.live_at) ? 'live' : topic ? 'topic' : 'none'
  return { cluster, stage, page, best_position: best === 999 ? null : best, impressions, clicks: words.reduce((s, k) => s + (k.gsc_clicks ?? 0), 0), topic_id: topic, search_page_id: words.find((k) => k.search_page_id)?.search_page_id, untopiced: words.filter((k) => !k.topic_id).map((k) => k.id) }
}

/** 这个主题下一步做什么：没页面写新的；在写、写好了去写 / 发布；有页面但排在 4~30、标题没用上主词的改现有页面；其余看排名 */
function actOf(r: TopicRow, words: Keyword[]): Act {
  if (r.stage === 'none') return 'write'
  if (r.stage === 'topic') return 'writing'
  if (r.stage === 'draft') return 'publish'
  const best = r.best_position ?? 999
  if (r.page && (words.some((k) => k.bucket === 'quick_win' || pageMissing(k)) || (best > 3 && best <= 30))) {
    // 已经改过页面、还在等复查（改动上线后 17 天内、这个词还没出结论）：不再催着改，到复查出了结论还没起色再回到待做
    const waiting = words.some((k) => k.live_at && !k.review_verdict && Date.now() < Date.parse(k.live_at) + REVIEW_DAYS * 86400_000)
    return waiting ? 'reviewing' : 'fix'
  }
  return 'watch'
}

/** 卡片上一句话：现在怎么样 */
function statusOf(t: Topic): string {
  const parts: string[] = [tr('keywords.words_n', { n: t.words.length })]
  const best = t.best_position
  if (t.stage === 'none') {
    parts.push(tr('keywords.s_none'))
    const rival = t.words.find(rivalOnly), open = t.words.find((k) => k.bucket === 'open' || k.bucket === 'mixed')
    if (open) parts.push(tr(open.bucket === 'open' ? 'keywords.r_open' : 'keywords.r_mixed', { n: open.serp_weak ?? 0 }))
    else if (rival) parts.push(tr('keywords.r_rival', { d: (rival.serp_competitors ?? '').split(',').join('、') }))
  } else if (t.stage === 'topic') parts.push(tr('keywords.s_topic'))
  else if (t.stage === 'draft') parts.push(tr('keywords.s_draft'))
  else {
    if (t.page) parts.push(pathOf(t.page) + (best ? ' ' + tr('keywords.s_rank', { pos: Math.round(best * 10) / 10 }) : ''))
    const review = t.words.find((k) => k.review_verdict)
    const live = t.words.map((k) => k.live_at).filter(Boolean).sort().pop()
    if (review) parts.push(`${tr(`keywords.verdict_${review.review_verdict}`)} · ${review.review_summary ?? ''}`)
    else if (t.act === 'reviewing' && live) parts.push(tr('keywords.changed_wait', { live: day(live), review: day(new Date(Date.parse(live) + REVIEW_DAYS * 86400_000).toISOString()) }))
    else if (live && !t.impressions) parts.push(tr('keywords.live_wait', { live: day(live), review: day(new Date(Date.parse(live) + REVIEW_DAYS * 86400_000).toISOString()) }))
    else if (t.impressions) parts.push(tr('keywords.s_shown', { imp: num(t.impressions), clicks: num(t.clicks) }))
    if (t.words.some(pageMissing)) parts.push(tr('keywords.r_missing'))
  }
  if (t.leads) parts.push(tr('keywords.s_leads', { n: t.leads }))
  return parts.join(' · ')
}

/**
 * 关键词：按主题组织，一个主题做一个页面（docs/keywords.md「页面」）。上面三步说明（找词 → 一个主题做一个页面 → 看排名涨没涨），
 * 下面每个主题一张卡片：现在怎么样、五格进度、一个主按钮（写新内容 / 去写文章 / 去发布 / 改现有页面 / 看排名），点开看主题里的词。
 * 还没归主题、不要的、已经排前 3 的词收在「不急的词」。外贸、产品运营、自媒体一个样；
 * beforeLoad：读之前先做的事（产品运营把导入的 SEO 页面地图、研究出的页面机会并进关键词表）；topicActions：模板在卡片上加的次要操作（产品运营的「创建运营主题」）。
 */
export default function Keywords({ channel, rev, onGo, beforeLoad, topicActions }: { channel: Channel; rev?: number; onGo: Go; beforeLoad?: () => Promise<unknown>; topicActions?: (t: TopicRow, reload: () => void) => ReactNode }) {
  const [data, setData] = useState<Data | null>(null)
  const [map, setMap] = useState<TopicRow[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  // 「新」：打开这一页时还没看过的，这次还标着（markSeen 之后下次就不标）
  const fresh = useRef<Set<string> | null>(null)
  const gsc = !!channel.gsc_property && !channel.gsc_link_disabled

  const load = useCallback(async () => {
    try {
      if (beforeLoad) await beforeLoad().catch(() => {})
      const [d, m] = await Promise.all([
        runLocal<Data>('keywords.list', { channel_id: channel.id }),
        // 增长计划模块的关键词地图：阶段、页面、询盘、下一步；没有这个模块（自媒体）就按词推算
        runLocal<{ rows: TopicRow[] }>('plan.keywordMap', {}).then((r) => r.rows, () => null),
      ])
      if (!fresh.current) {
        fresh.current = new Set(d.list.filter((k) => k.seen === false).map((k) => k.id))
        if (fresh.current.size) runLocal('keywords.markSeen', { channel_id: channel.id }).catch(() => {})
      }
      setData(d)
      setMap(m)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [channel.id])
  useEffect(() => {
    fresh.current = null
    setData(null)
    setFilter('all')
    void load()
  }, [load])
  useEffect(() => {
    if (rev) void load()
  }, [rev])

  const { topics, loose } = useMemo(() => {
    const byCluster = new Map<string, Keyword[]>()
    const loose: Keyword[] = []
    for (const k of data?.list ?? []) {
      if (k.cluster && (k.status === 'idea' || k.status === 'targeting')) byCluster.set(k.cluster, [...(byCluster.get(k.cluster) ?? []), k])
      else loose.push(k)
    }
    const topics: Topic[] = [...byCluster].map(([cluster, words]) => {
      const row = map?.find((r) => r.cluster === cluster) ?? guessRow(cluster, words)
      return { ...row, words, act: actOf(row, words) }
    })
    // 要做的在前：待做 → 进行中 → 已上线；同一类里阶段靠后、曝光多的在前
    const order: Act[] = ['fix', 'write', 'publish', 'writing', 'reviewing', 'watch']
    topics.sort((a, b) => order.indexOf(a.act) - order.indexOf(b.act) || RANK[b.stage] - RANK[a.stage] || b.impressions - a.impressions)
    return { topics, loose }
  }, [data, map])

  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <Skeleton className="h-40 rounded-xl" />

  const count = (f: Filter) => (f === 'all' ? topics.length : f === 'loose' ? loose.length : topics.filter((t) => FILTER_OF[t.act] === f).length)
  const shown = filter === 'loose' ? [] : topics.filter((t) => filter === 'all' || FILTER_OF[t.act] === filter)
  const live = topics.filter((t) => RANK[t.stage] >= RANK.live).length
  const top10 = topics.filter((t) => t.stage === 'top10').length
  const step = (n: number, title: string, desc: string, body: ReactNode) => (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">{n}</span>{title}</p>
      <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      {body}
    </div>
  )
  const big = (a: number, aLabel: string, b: number, bLabel: string) => (
    <p className="text-xl font-semibold tabular-nums">{a}<span className="ml-1 text-xs font-normal text-muted-foreground">{aLabel}</span><span className="mx-2 text-muted-foreground">·</span>{b}<span className="ml-1 text-xs font-normal text-muted-foreground">{bLabel}</span></p>
  )

  return (
    <div className="space-y-4">
      {/* 三步：这一页在做什么、做到哪了 */}
      <div className="grid gap-3 md:grid-cols-3">
        {step(1, tr('keywords.step1'), tr('keywords.step1_desc'), (
          <div className="flex flex-wrap items-center gap-2">
            <TaskLaunchButton
              task={RESEARCH_TASK}
              input={{ channel_id: channel.id }}
              match={(r) => r.input?.channel_id === channel.id}
              reqKey="keyword_requirements"
              onFinished={load}
              title={tr('keywords.launch_title')}
              desc={tr('keywords.launch_desc')}
              reqTitle={tr('keywords.req_title')}
              reqHint={tr('keywords.req_hint')}
              startLabel={tr('keywords.launch_start')}
              icon={Sparkles}
              variant={data.list.length ? 'outline' : 'default'}
            >
              {tr('keywords.launch')}
            </TaskLaunchButton>
            {data.chat_id && (
              <Button variant="ghost" size="sm" onClick={() => openChat(data.chat_id)}>
                <MessageCircle /> {tr('keywords.continue_chat')}
              </Button>
            )}
          </div>
        ))}
        {step(2, tr('keywords.step2'), tr('keywords.step2_desc'), big(topics.length, tr('keywords.u_topics'), count('todo'), tr('keywords.u_todo')))}
        {step(3, tr('keywords.step3'), tr('keywords.step3_desc'), big(live, tr('keywords.u_live'), top10, tr('keywords.u_top10')))}
      </div>

      {!gsc && <Notice>{tr('keywords.no_gsc')}</Notice>}
      {data.raw > 0 && <Notice>{tr('keywords.raw_left', { n: data.raw })}</Notice>}

      {data.list.length === 0 ? (
        <Notice>{tr('keywords.empty')}</Notice>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'todo', 'doing', 'live', 'loose'] as Filter[]).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={cx('cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors', filter === f ? 'border-primary/40 bg-primary/10 font-semibold text-primary-text' : 'border-border bg-background text-muted-foreground hover:text-foreground')}>
                {tr(`keywords.f_${f}`)} <span className="tabular-nums">{count(f)}</span>
              </button>
            ))}
            <span className="flex-1" />
            {/* 次要的操作：排名每周自动更新，平时不用点 */}
            {data.gsc_at && <span className="text-[11px] text-muted-foreground/80">{tr('keywords.gsc_at', { t: fmtTime(data.gsc_at) })}</span>}
            {gsc && (
              <RunButton inline fn="keywords.refresh" input={{ channel_id: channel.id, manual: true }} onDone={load} variant="ghost" icon={RefreshCw}>
                {tr('keywords.refresh')}
              </RunButton>
            )}
            {data.serp_pending > 0 && (
              <RunButton inline watch fn="keywords.serp" input={{ channel_id: channel.id }} onDone={load} variant="ghost" icon={SearchCheck}>
                {tr('keywords.serp_run', { n: Math.min(20, data.serp_pending) })}
              </RunButton>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{tr(`keywords.f_${filter}_hint`)}</p>
          {filter === 'loose' ? (
            <>
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                {loose.length ? loose.map((k) => <Row key={k.id} k={k} channel={channel} tab="other" isNew={!!fresh.current?.has(k.id)} onChanged={load} />) : <p className="p-4 text-sm text-muted-foreground">{tr('keywords.filter_empty')}</p>}
              </div>
              <AddKeywords channel={channel} onAdded={load} />
            </>
          ) : shown.length === 0 ? (
            <Notice>{tr(topics.length ? 'keywords.filter_empty' : 'keywords.no_topics')}</Notice>
          ) : (
            shown.map((t) => <TopicCard key={t.cluster} t={t} open={open === t.cluster} onToggle={() => setOpen(open === t.cluster ? null : t.cluster)} fresh={fresh.current} channel={channel} onChanged={load} onGo={onGo} extra={topicActions?.(t, load)} />)
          )}
        </>
      )}
    </div>
  )
}

/** 一个主题一张卡片：名字、一句现状、五格进度、主按钮；点开看主题里的词（每个词再点开看细节、改状态） */
function TopicCard({ t, open, onToggle, fresh, channel, onChanged, onGo, extra }: { t: Topic; open: boolean; onToggle: () => void; fresh: Set<string> | null; channel: Channel; onChanged: () => void; onGo: Go; extra?: ReactNode }) {
  const isNew = t.words.some((k) => fresh?.has(k.id))
  const done = RANK[t.stage]
  const go = (fallback: [string, Record<string, string>?]) => () => (t.next?.action ? onGo(t.next.action.view, t.next.action.params) : onGo(...fallback))
  const primary = (() => {
    switch (t.act) {
      case 'write':
        return t.untopiced?.length ? (
          <RunButton inline fn="keywords.toTopic" input={{ ids: t.untopiced }} onDone={() => onGo('website-content', {})} size="sm" icon={ListPlus}>{tr('keywords.act_write')}</RunButton>
        ) : <Button size="sm" onClick={() => onGo('website-content', {})}>{tr('keywords.act_write')}</Button>
      case 'writing':
        return <Button size="sm" onClick={go(['website-content', t.topic_id ? { topic: t.topic_id } : {}])}>{tr('keywords.act_writing')} <ArrowUpRight /></Button>
      case 'publish':
        return <Button size="sm" onClick={go(['website-content', t.article_id ? { article: t.article_id } : {}])}>{tr('keywords.act_publish')} <ArrowUpRight /></Button>
      case 'fix':
        return t.search_page_id ? (
          <TaskButton task={EXPAND_TASK} input={{ id: t.search_page_id }} match={(r) => r.input?.id === t.search_page_id} onFinished={onChanged} icon={FilePlus2}>{tr('keywords.act_fix')}</TaskButton>
        ) : <Button size="sm" onClick={() => onGo('audit', { channel: channel.id })}><ShieldCheck /> {tr('keywords.act_fix')}</Button>
      default:
        return <Button size="sm" variant="outline" onClick={() => onGo('search', { channel: channel.id })}>{tr('keywords.act_watch')}</Button>
    }
  })()
  return (
    <div className={cx('rounded-xl border border-border bg-background', isNew && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left">
          <ChevronDown className={cx('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              {isNew && <span className="inline-flex h-4 items-center rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">{tr('article.new_badge')}</span>}
              <span className="font-semibold [overflow-wrap:anywhere]">{t.cluster}</span>
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground tabular-nums [overflow-wrap:anywhere]">{statusOf(t)}</span>
          </span>
        </button>
        {/* 五格进度：选题 → 写好 → 上线 → 有展示 → 前 10 */}
        <div className="w-full shrink-0 md:w-56" aria-label={tr(`keywords.p_${t.stage === 'top30' ? 'shown' : t.stage === 'none' ? 'topic' : t.stage}`)}>
          <div className="flex gap-1">{STEPS.map((s) => <i key={s} className={cx('h-1.5 flex-1 rounded-full', RANK[s as Stage] <= done && done > 0 ? 'bg-primary' : 'bg-muted')} />)}</div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">{STEPS.map((s) => <span key={s}>{tr(`keywords.p_${s}`)}</span>)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 md:justify-end">{extra}{primary}</div>
      </div>
      {open && (
        <div className="border-t border-dashed border-border">
          {t.words.map((k) => <Row key={k.id} k={k} channel={channel} tab={k.status === 'targeting' ? 'doing' : 'other'} isNew={!!fresh?.has(k.id)} onChanged={onChanged} />)}
        </div>
      )}
    </div>
  )
}

/** 一个词一行：词 + 一句理由；点开看细节和改状态 */
function Row({ k, channel, tab, isNew, onChanged }: { k: Keyword; channel: Channel; tab: Tab; isNew: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const reason = reasonOf(k, tab)
  return (
    <div className={cx('border-b border-border last:border-b-0', isNew && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left hover:bg-muted/30">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          {isNew && <span className="inline-flex h-4 items-center rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">{tr('article.new_badge')}</span>}
          <span className="text-[13px] font-medium">{k.keyword}</span>
          {k.intent === 'buy' && <Badge tone="primary">{tr('keywords.intent_buy')}</Badge>}
          {reason && <span className="text-[11px] text-muted-foreground tabular-nums">{reason}</span>}
        </span>
        <ChevronDown className={cx('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <Details k={k} channel={channel} onChanged={onChanged} />}
    </div>
  )
}

/** 点开一个词：Google 排名、目标页面用没用上、几个页面在抢、排名历史、复查结论、Google 前 10、助手的说明，和改状态 */
function Details({ k, channel, onChanged }: { k: Keyword; channel: Channel; onChanged: () => void }) {
  const [help, setHelp] = useState(false)
  const top = parse<SerpRow[]>(k.serp_results, [])
  const hist = parse<Rank[]>(k.rank_history, [])
  const o = onpageOf(k)
  const rivals = competingOf(k)
  const status = (s: string, label: string, icon: typeof Target) => (
    <RunButton inline fn="keywords.setStatus" input={{ ids: [k.id], status: s }} onDone={onChanged} variant="ghost" icon={icon}>
      {label}
    </RunButton>
  )
  const row = (label: string, children: ReactNode) => (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
  const mark = (ok: boolean, label: string) => (
    <span className={cx('inline-flex items-center gap-0.5', !ok && 'text-amber-700 dark:text-amber-400')}>
      {ok ? <Check className="size-3 text-emerald-600" /> : <X className="size-3" />}
      {label}
    </span>
  )
  return (
    <div className="space-y-2 px-4 pb-3 text-xs tabular-nums">
      {k.note && <p className="leading-relaxed text-muted-foreground">{k.note}</p>}
      {row(tr('keywords.d_google'), k.gsc_impressions
        ? <span>{tr('keywords.gsc_line', { imp: num(k.gsc_impressions), clicks: num(k.gsc_clicks), pos: (k.gsc_position ?? 0).toFixed(1) })}</span>
        : <span className="text-muted-foreground">{tr('keywords.no_rank')}</span>)}
      {pageOf(k) && row(tr('keywords.target_page'), (
        <div className="space-y-0.5">
          <a href={pageOf(k)} target="_blank" rel="noreferrer" className="font-mono hover:text-primary-text">{pathOf(pageOf(k))}</a>
          {o && !o.error && (
            <button onClick={() => setHelp(true)} className="flex cursor-pointer flex-wrap items-center gap-x-2.5 text-left text-[11px] hover:text-primary-text">
              <span className="text-muted-foreground">{tr('keywords.onpage_used')}</span>
              {mark(o.title, tr('keywords.onpage_title'))}
              {mark(o.h1, 'H1')}
              {mark(o.description, tr('keywords.onpage_desc'))}
              <span className="inline-flex items-center gap-0.5 text-primary-text"><CircleHelp className="size-3" />{tr('keywords.onpage_help')}</span>
            </button>
          )}
          {o && !o.error && <OnPageDialog open={help} onClose={() => setHelp(false)} k={k} o={o} onChanged={onChanged} />}
          {rivals.length > 1 && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400">
              {tr('keywords.competing', { n: rivals.length, pages: rivals.map((p) => tr('keywords.competing_page', { page: pathOf(p.page), pos: p.position })).join('、') })}
            </div>
          )}
        </div>
      ))}
      {hist.length > 0 && row(tr('keywords.d_history'), (
        <span className="inline-flex flex-wrap items-center gap-x-2">
          {hist.slice(-6).map((r, i, a) => (
            <span key={r.d + r.s} className="inline-flex items-center gap-0.5">
              {day(r.d)} {pos(r)}
              {i > 0 && ((r.p || 99) < (a[i - 1].p || 99) ? <ArrowUp className="size-3 text-emerald-600" /> : (r.p || 99) > (a[i - 1].p || 99) ? <ArrowDown className="size-3 text-destructive" /> : null)}
            </span>
          ))}
        </span>
      ))}
      {k.review_verdict && row(tr('keywords.d_review'), (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Badge tone={VERDICT_TONE[k.review_verdict] ?? 'default'}>{tr(`keywords.verdict_${k.review_verdict}`)}</Badge>
          {k.review_summary}
        </span>
      ))}
      {(top.length > 0 || k.serp_error) && row(tr('keywords.d_serp'), (
        <div>
          {k.serp_at && <div className="mb-1 text-[11px] text-muted-foreground">{tr('keywords.serp_at', { t: fmtTime(k.serp_at) })}</div>}
          {k.serp_error && <div className="text-destructive">{k.serp_error}</div>}
          <ol className="space-y-1">
            {top.map((r) => (
              <li key={r.p} className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-right text-muted-foreground">{r.p}</span>
                <Badge tone={KIND_TONE[r.kind] ?? 'default'}>{tr(`keywords.kind_${r.kind}`)}</Badge>
                <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-primary-text" title={r.title}>
                  <span className="font-medium">{r.domain}</span> · <span className="text-muted-foreground">{r.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      ))}
      <div className="flex flex-wrap gap-1 pt-1">
        {k.status === 'idea' && status('targeting', tr('keywords.target'), Target)}
        {k.status === 'targeting' && status('idea', tr('keywords.untarget'), Undo2)}
        {k.status === 'dismissed' ? status('idea', tr('keywords.restore'), Undo2) : status('dismissed', tr('keywords.dismiss'), EyeOff)}
        {k.status !== 'dismissed' && <LandingButton sites={[channel]} preset={() => ({ channel_id: channel.id, keyword: k.keyword, keyword_id: k.id, goal: tr('landing.goal_from_keyword', { kw: k.keyword }) })} />}
      </div>
    </div>
  )
}

/** 手动加几个词：加进待筛，下次「挖一批关键词」时助手一起筛 */
function AddKeywords({ channel, onAdded }: { channel: Channel; onAdded: () => void }) {
  const [text, setText] = useState('')
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('keywords.add_placeholder')} aria-label={tr('keywords.add_placeholder')} className={cx(inputCls, 'min-w-0 flex-1')} />
      <RunButton inline fn="keywords.add" input={{ channel_id: channel.id, keywords: text }} onDone={() => (setText(''), onAdded())} variant="outline" icon={Plus}>
        {tr('keywords.add')}
      </RunButton>
    </div>
  )
}

/** 「这个词用没用上」的说明：标题、H1、描述、网址各是什么、为什么重要、页面上现在写的是什么、有没有这个词，算不算问题、怎么改 */
function OnPageDialog({ open, onClose, k, o, onChanged }: { open: boolean; onClose: () => void; k: Keyword; o: OnPage; onChanged: () => void }) {
  const items: { key: string; label: string; ok: boolean; text?: string }[] = [
    { key: 'title', label: tr('keywords.onpage_title'), ok: o.title, text: o.title_text },
    { key: 'h1', label: 'H1', ok: o.h1, text: o.h1_text },
    { key: 'desc', label: tr('keywords.onpage_desc'), ok: o.description, text: o.desc_text },
  ]
  const fixable = !!k.search_page_id && (!o.title || !o.description)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={560}
      title={tr('keywords.oh_title', { kw: k.keyword })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr('keywords.oh_close')}</Button>
          {fixable && (
            <TaskButton task={META_TASK} input={{ id: k.search_page_id }} match={(r) => r.input?.id === k.search_page_id} onFinished={() => (onClose(), onChanged())} variant="default" icon={Sparkles}>
              {tr('keywords.oh_fix')}
            </TaskButton>
          )}
        </>
      }
    >
      <div className="space-y-3 text-xs leading-relaxed">
        <p className="text-muted-foreground">{tr('keywords.oh_intro', { kw: k.keyword, page: pathOf(o.page) })}</p>
        <div className="divide-y divide-border rounded-lg border border-border">
          {items.map((it) => (
            <div key={it.key} className="space-y-1 p-3">
              <div className="flex items-center gap-2">
                {it.ok ? <Check className="size-3.5 text-emerald-600" /> : <X className="size-3.5 text-amber-600" />}
                <span className="font-semibold">{it.label}</span>
                <span className={cx('text-[11px]', it.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>{tr(it.ok ? 'keywords.oh_has' : 'keywords.oh_missing')}</span>
              </div>
              <p className="text-muted-foreground">{tr(`keywords.oh_${it.key}_why`)}</p>
              <p className="rounded bg-muted/60 px-2 py-1">{it.text ? tr('keywords.oh_now', { t: it.text }) : tr('keywords.oh_empty')}</p>
            </div>
          ))}
        </div>
        <p className="rounded-lg bg-muted/40 p-2.5">{tr(o.primary ? 'keywords.oh_primary' : 'keywords.oh_not_primary')}</p>
        <p className="text-[11px] text-muted-foreground">{tr('keywords.oh_rule', { t: fmtTime(o.checked_at) })}</p>
      </div>
    </Dialog>
  )
}
