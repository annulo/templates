import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, EyeOff, FilePlus2, ListPlus, MessageCircle, Plus, RefreshCw, SearchCheck, ShieldCheck, Sparkles, Target, Undo2, X } from 'lucide-react'
import { Badge, Button, Notice, Panel, Segmented, Skeleton, cx, fmtTime, inputCls, type Tone } from './ui'
import RunButton from './RunButton'
import { TaskButton, TaskLaunchButton } from './Task'
import { openChat, runLocal, type Channel } from '../lib/shuttle'
import { numLocale, tr } from '../lib/i18n'

// 谷歌排名 → 关键词（keywords.ts，设计见 docs/keywords.md「页面」）。
// 按「下一步要做什么」分四类，每类一个主动作，每个词一行、一句理由，细节点开才看：
//   - 改现有页面：已经排在 4~30 位，或者目标页面标题 / H1 没用上、几个页面在抢 → 按页面分组，「补内容」（search-expand）、页面问题去站点体检修；
//   - 写新内容：还没排上、能做的（新机会、有竞争、竞品在排）→ 按主题分组，「转成选题」；
//   - 在做：转了选题、标了在做的 → 排名变化、上线后的复查结论；
//   - 其他：已排前 3、难、还没查过 Google 结果页、不要的。
// 页面问题（标题 / H1 没用上、几个页面在抢）由站点体检查、记成体检问题（_audit_keywords.ts），这里只摆结论、链过去。

const RESEARCH_TASK = 'keyword-research'
const EXPAND_TASK = 'search-expand'

type Bucket = 'quick_win' | 'ranking' | 'open' | 'mixed' | 'hard' | 'unchecked'
type Keyword = {
  id: string; keyword: string; status: string; intent?: string; cluster?: string; note?: string; sources?: string
  gsc_impressions?: number; gsc_clicks?: number; gsc_position?: number; gsc_page?: string; search_page_id?: string
  bucket?: Bucket; score?: number; topic_id?: string; seen?: boolean
  serp_at?: string; serp_position?: number; serp_weak?: number; serp_strong?: number; serp_competitors?: string; serp_results?: string; serp_error?: string; rank_history?: string
  target_page?: string; live_at?: string; review_verdict?: string; review_summary?: string; onpage?: string; gsc_pages?: string
}
type OnPage = { page: string; title: boolean; h1: boolean; description: boolean; url: boolean; checked_at: string; error?: string; primary?: boolean }
type Competing = { page: string; impressions: number; position: number }
type SerpRow = { p: number; domain: string; kind: string; title: string; url: string }
type Rank = { d: string; p: number; s: 'gsc' | 'serp' }
type Data = { list: Keyword[]; raw: number; raw_sample: string[]; serp_pending: number; chat_id: string; reviewed_at: string; gsc_at: string }
type Tab = 'fix' | 'write' | 'doing' | 'other'
type Go = (view: string, params?: Record<string, string>) => void

const TABS: Tab[] = ['fix', 'write', 'doing', 'other']
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

function tabOf(k: Keyword): Tab {
  if (k.status === 'targeting') return 'doing'
  if (k.status !== 'idea') return 'other'
  if (k.bucket === 'quick_win' || pageMissing(k) || competing(k)) return 'fix'
  if (k.bucket === 'open' || k.bucket === 'mixed' || rivalOnly(k)) return 'write'
  return 'other'
}

/** 其他里分小组：为什么不急着做 */
const otherReason = (k: Keyword) => (k.status === 'dismissed' ? 'dismissed' : k.bucket === 'ranking' ? 'ranking' : k.bucket === 'hard' ? 'hard' : 'unchecked')

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

export default function Keywords({ channel, rev, onGo }: { channel: Channel; rev?: number; onGo: Go }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab | ''>('')
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
    setTab('')
    load()
  }, [load])
  useEffect(() => {
    if (rev) load()
  }, [rev])

  const byTab = useMemo(() => {
    const m: Record<Tab, Keyword[]> = { fix: [], write: [], doing: [], other: [] }
    for (const k of data?.list ?? []) m[tabOf(k)].push(k)
    return m
  }, [data])
  const active: Tab = tab || (TABS.find((t) => byTab[t].length) ?? 'fix')

  // 分组：改现有页面按页面，其他按原因，别的按主题
  const groups = useMemo(() => {
    const m = new Map<string, Keyword[]>()
    for (const k of byTab[active]) {
      const g = active === 'fix' ? pageOf(k) || tr('keywords.no_cluster') : active === 'other' ? otherReason(k) : k.cluster || tr('keywords.no_cluster')
      m.set(g, [...(m.get(g) ?? []), k])
    }
    return [...m]
  }, [byTab, active])

  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <Skeleton className="h-40 rounded-xl" />

  return (
    <div className="space-y-4">
      <Panel
        title={tr('keywords.title')}
        aside={
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
        }
      >
        <p className="text-xs leading-relaxed text-muted-foreground">{tr('keywords.desc')}</p>
        {/* 次要的操作：排名每周自动更新、页面问题由站点体检每周查，平时不用点 */}
        {data.list.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-muted-foreground/80">
            {data.gsc_at && <span className="mr-2">{tr('keywords.gsc_at', { t: fmtTime(data.gsc_at) })}</span>}
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
            {data.chat_id && (
              <Button variant="ghost" size="sm" onClick={() => openChat(data.chat_id)}>
                <MessageCircle /> {tr('keywords.continue_chat')}
              </Button>
            )}
          </div>
        )}
      </Panel>

      {!gsc && <Notice>{tr('keywords.no_gsc')}</Notice>}
      {data.raw > 0 && <Notice>{tr('keywords.raw_left', { n: data.raw })}</Notice>}

      {data.list.length === 0 ? (
        <Notice>{tr('keywords.empty')}</Notice>
      ) : (
        <>
          <Segmented value={active} onChange={(v) => setTab(v)} options={TABS.map((t) => ({ value: t, label: `${tr(`keywords.tab_${t}`)} ${byTab[t].length}` }))} />
          <p className="text-xs text-muted-foreground">{tr(`keywords.tab_${active}_hint`)}</p>
          {byTab[active].length === 0 ? (
            <Notice>{tr('keywords.filter_empty')}</Notice>
          ) : (
            groups.map(([g, ks]) => <Group key={g} name={g} tab={active} list={ks} fresh={fresh.current} channel={channel} onChanged={load} onGo={onGo} />)
          )}
          {active === 'other' && <AddKeywords channel={channel} onAdded={load} />}
        </>
      )}
    </div>
  )
}

/** 一组：标题 + 这一组的主动作 */
function Group({ name, tab, list, fresh, channel, onChanged, onGo }: { name: string; tab: Tab; list: Keyword[]; fresh: Set<string> | null; channel: Channel; onChanged: () => void; onGo: Go }) {
  const spId = list.find((k) => k.search_page_id)?.search_page_id
  const notTopic = list.filter((k) => !k.topic_id)
  const isPage = tab === 'fix' && /^https?:\/\//.test(name)
  const title = isPage ? pathOf(name) : tab === 'other' ? tr(`keywords.other_${name}`) : name
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2">
        {isPage ? (
          <a href={name} target="_blank" rel="noreferrer" className="truncate font-mono text-[13px] font-semibold hover:text-primary-text" title={name}>{title}</a>
        ) : (
          <span className="text-[13px] font-semibold">{title}</span>
        )}
        <span className="text-[11px] text-muted-foreground tabular-nums">{tr('keywords.group_n', { n: list.length })}</span>
        <span className="flex-1" />
        {tab === 'fix' && list.some((k) => pageMissing(k) || competing(k)) && (
          <Button variant="ghost" size="sm" onClick={() => onGo('audit', { channel: channel.id })}>
            <ShieldCheck /> {tr('keywords.go_audit')} <ArrowUpRight />
          </Button>
        )}
        {tab === 'fix' && spId && (
          <TaskButton task={EXPAND_TASK} input={{ id: spId }} match={(r) => r.input?.id === spId} onFinished={onChanged} variant="outline" icon={FilePlus2}>
            {tr('keywords.expand_page')}
          </TaskButton>
        )}
        {tab === 'write' && notTopic.length > 0 && (
          <RunButton inline fn="keywords.toTopic" input={{ ids: notTopic.map((k) => k.id) }} onDone={onChanged} variant="outline" icon={ListPlus}>
            {tr('keywords.to_topic')}
          </RunButton>
        )}
        {(tab === 'write' || tab === 'doing') && list.some((k) => k.topic_id) && (
          <Button variant="ghost" size="sm" onClick={() => onGo('content', { tab: 'topics' })}>
            {tr('keywords.go_topics')} <ArrowUpRight />
          </Button>
        )}
      </div>
      {list.map((k) => (
        <Row key={k.id} k={k} tab={tab} isNew={!!fresh?.has(k.id)} onChanged={onChanged} />
      ))}
    </div>
  )
}

/** 一个词一行：词 + 一句理由；点开看细节和改状态 */
function Row({ k, tab, isNew, onChanged }: { k: Keyword; tab: Tab; isNew: boolean; onChanged: () => void }) {
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
      {open && <Details k={k} onChanged={onChanged} />}
    </div>
  )
}

/** 点开一个词：Google 排名、目标页面用没用上、几个页面在抢、排名历史、复查结论、Google 前 10、助手的说明，和改状态 */
function Details({ k, onChanged }: { k: Keyword; onChanged: () => void }) {
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
            <div className="flex flex-wrap gap-x-2.5 text-[11px]">
              {mark(o.title, tr('keywords.onpage_title'))}
              {mark(o.h1, 'H1')}
              {mark(o.description, tr('keywords.onpage_desc'))}
              {pathOf(o.page) !== '/' && mark(o.url, tr('keywords.onpage_url'))}
            </div>
          )}
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
