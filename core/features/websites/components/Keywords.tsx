import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, EyeOff, FilePlus2, ListPlus, MessageCircle, Plus, RefreshCw, SearchCheck, Sparkles, Target, Undo2 } from 'lucide-react'
import { Badge, Button, Notice, Panel, Segmented, Skeleton, cx, fmtTime, inputCls, type Tone } from './ui'
import RunButton from './RunButton'
import { TaskButton, TaskLaunchButton } from './Task'
import { openChat, runLocal, type Channel } from '../lib/shuttle'
import { numLocale, tr } from '../lib/i18n'

// 谷歌排名 → 关键词：挖出来、助手筛过的词，按 GSC 排名分桶（keywords.ts，设计见 docs/keywords.md）。
// 「挖一批关键词」交给助手（tasks/keyword-research.md），筛完回到这里看；要调整就「继续对话」回到筛词的那段对话。
// 快赢的词（已经排在 4~30 位）给它曝光最多的页面补内容（复用谷歌排名的 search-expand 任务）；还没排名的按主题转成选题去写。
// 「查 Google 结果页」在用户自己的 Chrome 里看前 10 都是谁（keywords.serp），没有 GSC 数据的词分成新机会 / 有竞争 / 难；前 10 名点开能看。

const RESEARCH_TASK = 'keyword-research'
const EXPAND_TASK = 'search-expand'

type Bucket = 'quick_win' | 'ranking' | 'open' | 'mixed' | 'hard' | 'unchecked'
type Keyword = {
  id: string; keyword: string; status: string; intent?: string; cluster?: string; note?: string; sources?: string
  gsc_impressions?: number; gsc_clicks?: number; gsc_position?: number; gsc_page?: string; search_page_id?: string
  bucket?: Bucket; score?: number; topic_id?: string; seen?: boolean
  serp_at?: string; serp_position?: number; serp_weak?: number; serp_strong?: number; serp_results?: string; serp_error?: string; rank_history?: string
  target_page?: string; live_at?: string; review_verdict?: string; review_summary?: string
}
type SerpRow = { p: number; domain: string; kind: string; title: string; url: string }
type Rank = { d: string; p: number; s: 'gsc' | 'serp' }
type Data = { list: Keyword[]; raw: number; raw_sample: string[]; serp_pending: number; chat_id: string; reviewed_at: string; gsc_at: string }
type Filter = Bucket | 'targeting' | 'dismissed'

const INTENT: Record<string, Tone> = { buy: 'primary', compare: 'warn', research: 'default', other: 'default' }
const num = (x?: number) => (x ?? 0).toLocaleString(numLocale())
const pathOf = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/'
const FILTERS: Filter[] = ['quick_win', 'open', 'mixed', 'unchecked', 'hard', 'ranking', 'targeting', 'dismissed']
const KIND_TONE: Record<string, Tone> = { ours: 'ok', competitor: 'bad', b2b: 'primary', forum: 'primary', social: 'primary', marketplace: 'warn', reference: 'warn' }
function parse<T>(s: string | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

const filterOf = (k: Keyword): Filter => (k.status === 'dismissed' ? 'dismissed' : k.status === 'targeting' ? 'targeting' : k.bucket ?? 'unchecked')

export default function Keywords({ channel, rev, onGo }: { channel: Channel; rev?: number; onGo: (view: string, params?: Record<string, string>) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter | ''>('')
  // 「新」：打开这一页时还没看过的，这次还标着（markSeen 之后下次就不标）
  const fresh = useRef<Set<string> | null>(null)
  const gsc = !!channel.gsc_property && !channel.gsc_link_disabled

  const load = useCallback(() => {
    runLocal<Data>('keywords.list', { channel_id: channel.id })
      .then((d) => {
        if (!fresh.current) {
          fresh.current = new Set(d.list.filter((k) => k.seen === false).map((k) => k.id))
          if (fresh.current.size) runLocal('keywords.markSeen', { channel_id: channel.id }).catch(() => {})
        }
        setData(d)
        setError('')
      })
      .catch((e) => setError((e as Error).message))
  }, [channel.id])
  useEffect(() => {
    fresh.current = null
    setData(null)
    setFilter('')
    load()
  }, [load])
  useEffect(() => {
    if (rev) load()
  }, [rev])

  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTERS.map((f) => [f, 0])) as Record<Filter, number>
    for (const k of data?.list ?? []) c[filterOf(k)]++
    return c
  }, [data])
  const active: Filter = filter || (FILTERS.find((f) => counts[f] && f !== 'dismissed') ?? 'unchecked')
  const shown = (data?.list ?? []).filter((k) => filterOf(k) === active)
  const groups = useMemo(() => {
    const m = new Map<string, Keyword[]>()
    for (const k of shown) m.set(k.cluster || tr('keywords.no_cluster'), [...(m.get(k.cluster || tr('keywords.no_cluster')) ?? []), k])
    return [...m]
  }, [shown])

  const launch = (
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
      variant={data?.list.length ? 'outline' : 'default'}
    >
      {tr('keywords.launch')}
    </TaskLaunchButton>
  )

  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <Skeleton className="h-40 rounded-xl" />

  return (
    <div className="space-y-4">
      <Panel
        title={tr('keywords.title')}
        aside={
          <div className="flex flex-wrap items-center justify-end gap-1">
            {data.chat_id && (
              <Button variant="ghost" size="sm" onClick={() => openChat(data.chat_id)}>
                <MessageCircle /> {tr('keywords.continue_chat')}
              </Button>
            )}
            {data.serp_pending > 0 && (
              <RunButton inline watch fn="keywords.serp" input={{ channel_id: channel.id }} onDone={load} variant="ghost" icon={SearchCheck}>
                {tr('keywords.serp_run', { n: Math.min(20, data.serp_pending) })}
              </RunButton>
            )}
            {gsc && data.list.length > 0 && (
              <RunButton inline fn="keywords.refresh" input={{ channel_id: channel.id, manual: true }} onDone={load} variant="ghost" icon={RefreshCw}>
                {tr('keywords.refresh')}
              </RunButton>
            )}
            {launch}
          </div>
        }
      >
        <p className="text-xs leading-relaxed text-muted-foreground">{tr('keywords.desc')}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground/80">
          {data.reviewed_at && <span>{tr('keywords.reviewed_at', { t: fmtTime(data.reviewed_at) })}</span>}
          {data.gsc_at && <span>{tr('keywords.gsc_at', { t: fmtTime(data.gsc_at) })}</span>}
        </div>
      </Panel>

      {!gsc && <Notice>{tr('keywords.no_gsc')}</Notice>}
      {data.raw > 0 && (
        <Notice>
          <p>{tr('keywords.raw_left', { n: data.raw })}</p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">{data.raw_sample.slice(0, 12).join(' · ')}</p>
        </Notice>
      )}

      {data.list.length === 0 ? (
        <Notice>{tr('keywords.empty')}</Notice>
      ) : (
        <>
          <Segmented
            value={active}
            onChange={(v) => setFilter(v)}
            options={FILTERS.filter((f) => counts[f] || f === active || f === 'quick_win' || f === 'unchecked').map((f) => ({ value: f, label: `${tr(`keywords.f_${f}`)} ${counts[f]}` }))}
          />
          <p className="text-xs text-muted-foreground">{tr(`keywords.f_${active}_hint`)}</p>
          {shown.length === 0 ? (
            <Notice>{tr('keywords.filter_empty')}</Notice>
          ) : (
            groups.map(([cluster, ks]) => <Group key={cluster} cluster={cluster} list={ks} fresh={fresh.current} filter={active} channel={channel} onChanged={load} onGo={onGo} />)
          )}
          <AddKeywords channel={channel} onAdded={load} />
        </>
      )}
    </div>
  )
}

function Group({ cluster, list, fresh, filter, channel, onChanged, onGo }: { cluster: string; list: Keyword[]; fresh: Set<string> | null; filter: Filter; channel: Channel; onChanged: () => void; onGo: (view: string, params?: Record<string, string>) => void }) {
  const open = list.filter((k) => !k.topic_id)
  const imp = list.reduce((n, k) => n + (k.gsc_impressions ?? 0), 0)
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2">
        <span className="text-[13px] font-semibold">{cluster}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{tr('keywords.group_meta', { n: list.length, imp: num(imp) })}</span>
        <span className="flex-1" />
        {filter !== 'dismissed' && filter !== 'ranking' && filter !== 'hard' && open.length > 0 && (
          <RunButton inline fn="keywords.toTopic" input={{ ids: open.map((k) => k.id) }} onDone={onChanged} variant="ghost" icon={ListPlus}>
            {tr('keywords.to_topic')}
          </RunButton>
        )}
        {list.some((k) => k.topic_id) && (
          <Button variant="ghost" size="sm" onClick={() => onGo('content', { tab: 'topics' })}>
            {tr('keywords.go_topics')} <ArrowUpRight />
          </Button>
        )}
      </div>
      {list.map((k) => (
        <Row key={k.id} k={k} isNew={!!fresh?.has(k.id)} channel={channel} onChanged={onChanged} onGo={onGo} />
      ))}
    </div>
  )
}

function Row({ k, isNew, channel, onChanged, onGo }: { k: Keyword; isNew: boolean; channel: Channel; onChanged: () => void; onGo: (view: string, params?: Record<string, string>) => void }) {
  const status = (s: string, label: string, icon: typeof Target) => (
    <RunButton inline fn="keywords.setStatus" input={{ ids: [k.id], status: s }} onDone={onChanged} variant="ghost" icon={icon}>
      {label}
    </RunButton>
  )
  return (
    <div className={cx('flex flex-col gap-2 border-b border-border px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-start', isNew && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {isNew && <span className="inline-flex h-4 items-center rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">{tr('article.new_badge')}</span>}
          <span className="text-[13px] font-medium">{k.keyword}</span>
          {k.intent && <Badge tone={INTENT[k.intent] ?? 'default'}>{tr(`keywords.intent_${k.intent}`)}</Badge>}
          {k.topic_id && <Badge tone="ok">{tr('keywords.has_topic')}</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
          {k.gsc_impressions ? (
            <>
              <span>{tr('keywords.gsc_line', { imp: num(k.gsc_impressions), clicks: num(k.gsc_clicks), pos: (k.gsc_position ?? 0).toFixed(1) })}</span>
              {k.gsc_page && (
                <a href={k.gsc_page} target="_blank" rel="noreferrer" className="truncate font-mono hover:text-primary-text" title={k.gsc_page}>
                  {pathOf(k.gsc_page)}
                </a>
              )}
            </>
          ) : (
            <span>{tr('keywords.no_rank')}</span>
          )}
        </div>
        <SerpLine k={k} />
        <LoopLine k={k} />
        {k.note && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{k.note}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {k.status !== 'dismissed' && k.bucket === 'quick_win' && k.search_page_id && (
          <>
            <TaskButton task={EXPAND_TASK} input={{ id: k.search_page_id }} match={(r) => r.input?.id === k.search_page_id} onFinished={onChanged} variant="outline" icon={FilePlus2}>
              {tr('keywords.expand_page')}
            </TaskButton>
            <Button variant="ghost" size="sm" onClick={() => onGo('search', { tab: 'pages', channel: channel.id })}>
              {tr('keywords.see_brief')} <ArrowUpRight />
            </Button>
          </>
        )}
        {k.status === 'idea' && status('targeting', tr('keywords.target'), Target)}
        {k.status === 'targeting' && status('idea', tr('keywords.untarget'), Undo2)}
        {k.status === 'dismissed' ? status('idea', tr('keywords.restore'), Undo2) : status('dismissed', tr('keywords.dismiss'), EyeOff)}
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

/** Google 结果页的事实：我们排第几、前 10 里弱位置和强站各几个、在做的词的排名变化；点开看前 10 名 */
function SerpLine({ k }: { k: Keyword }) {
  const [open, setOpen] = useState(false)
  const top = parse<SerpRow[]>(k.serp_results, [])
  const hist = parse<Rank[]>(k.rank_history, [])
  const trend = hist.length >= 2 ? [hist[hist.length - 2], hist[hist.length - 1]] : null
  const pos = (r: Rank) => (r.p ? String(r.p) : '10+')
  if (!k.serp_at && !trend && !k.serp_error) return null
  return (
    <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {k.serp_at && (
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex cursor-pointer items-center gap-1 hover:text-primary-text">
            {tr('keywords.serp_line', { pos: k.serp_position ? String(k.serp_position) : tr('keywords.serp_not_top'), weak: k.serp_weak ?? 0, strong: k.serp_strong ?? 0 })}
            <ChevronDown className={cx('size-3 transition-transform', open && 'rotate-180')} />
          </button>
        )}
        {trend && (
          <span className="inline-flex items-center gap-0.5" title={hist.map((r) => `${r.d} ${pos(r)}`).join('\n')}>
            {tr('keywords.rank_trend', { from: pos(trend[0]), to: pos(trend[1]) })}
            {(trend[1].p || 99) < (trend[0].p || 99) ? <ArrowUp className="size-3 text-emerald-600" /> : (trend[1].p || 99) > (trend[0].p || 99) ? <ArrowDown className="size-3 text-destructive" /> : null}
          </span>
        )}
        {k.serp_at && <span className="text-muted-foreground/70">{tr('keywords.serp_at', { t: fmtTime(k.serp_at) })}</span>}
        {k.serp_error && <span className="text-destructive">{k.serp_error}</span>}
      </div>
      {open && top.length > 0 && (
        <ol className="mt-1.5 space-y-1 rounded-lg border border-border bg-muted/40 p-2">
          {top.map((r) => (
            <li key={r.p} className="flex min-w-0 items-center gap-2">
              <span className="w-4 shrink-0 text-right">{r.p}</span>
              <Badge tone={KIND_TONE[r.kind] ?? 'default'}>{tr(`keywords.kind_${r.kind}`)}</Badge>
              <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-primary-text" title={r.title}>
                <span className="font-medium text-foreground">{r.domain}</span> · {r.title}
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const VERDICT_TONE: Record<string, Tone> = { better: 'ok', flat: 'default', worse: 'bad', no_data: 'default' }
const REVIEW_DAYS = 17 // 和 _review.ts 的 REVIEW_DELAY_DAYS 一样：上线 17 天后复查

/** 闭环：目标页面、哪天上线、什么时候复查；复查过的写这个词自己的结论（排名、曝光前后） */
function LoopLine({ k }: { k: Keyword }) {
  if (!k.target_page && !k.live_at) return null
  const day = (iso: string) => new Date(iso).toLocaleDateString(numLocale(), { month: 'numeric', day: 'numeric' })
  const page = k.target_page ? (
    <a href={k.target_page} target="_blank" rel="noreferrer" className="truncate font-mono hover:text-primary-text" title={k.target_page}>{pathOf(k.target_page)}</a>
  ) : null
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
      <span>{tr('keywords.target_page')}</span>
      {page}
      {k.live_at && !k.review_verdict && (
        <span>{tr('keywords.live_wait', { live: day(k.live_at), review: day(new Date(Date.parse(k.live_at) + REVIEW_DAYS * 86400_000).toISOString()) })}</span>
      )}
      {k.review_verdict && (
        <>
          <Badge tone={VERDICT_TONE[k.review_verdict] ?? 'default'}>{tr(`keywords.verdict_${k.review_verdict}`)}</Badge>
          <span>{k.review_summary}</span>
        </>
      )}
    </div>
  )
}
