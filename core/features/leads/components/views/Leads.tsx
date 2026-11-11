import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Check, Copy, Download, ExternalLink, KanbanSquare, List, Mail, RefreshCw, Search, ShieldAlert, Sparkles, UserSearch } from 'lucide-react'
import RunButton from '../RunButton'
import { Badge, Button, Dialog, Notice, PageHeader, Panel, Segmented, Skeleton, cx, fmtTime, inputCls, type Tone } from '../ui'
import { TaskButton, TaskRequirements, useTask } from '../Task'
import { dbList, leadStats, runLocal, shuttleMissing, ShuttleUnavailable, updateLead, type Lead, type LeadActivity, type LeadIntent, type LeadResearch, type LeadStats, type LeadStatus, type LeadTag, type LeadVerdict } from '../../lib/shuttle'
import { hostOf } from '../../lib/format'
import Select from '../Select'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'
import { useCanRun } from '../../lib/useShuttle'

/** 任务 id（tasks/reply-lead.md）：给一条询盘写回复草稿 */
const REPLY_TASK = 'reply-lead'
/** 任务 id（tasks/research-lead.md）：客户背调 */
const RESEARCH_TASK = 'research-lead'

// 显示名按当前语言取（getter）
const intentMeta = (k: LeadIntent, tone: Tone, rank: number) => ({ get label() { return tr(`leads.i_${k}`) }, tone, rank })
const INTENT: Record<LeadIntent, { label: string; tone: Tone; rank: number }> = {
  high: intentMeta('high', 'ok', 0),
  medium: intentMeta('medium', 'warn', 1),
  low: intentMeta('low', 'default', 2),
}
/** 商机看板的列，也是跟进阶段的顺序 */
const STAGES: LeadStatus[] = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost']
const STATUS_KEYS: LeadStatus[] = [...STAGES, 'spam']
/** 旧的「有效商机」显示在「谈判中」（leads.judge 会把它改掉） */
const stageOf = (l: Lead): LeadStatus => (l.status === 'qualified' ? 'negotiating' : l.status || 'new')
const statusLabel = (s: LeadStatus) => tr(`leads.s_${s}`)
const VERDICT_TONE: Record<LeadVerdict, Tone> = { pursue: 'ok', normal: 'default', caution: 'warn', avoid: 'bad' }

const parse = <T,>(s: string | undefined, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d
  } catch {
    return d
  }
}
const pathOf = (u?: string) => {
  try {
    return u ? new URL(u).pathname : ''
  } catch {
    return u ?? ''
  }
}
const at = (l: Lead) => Date.parse(l.submitted_at || l.created_at || '') || 0
const isReal = (l: Lead) => l.is_real !== false && l.status !== 'spam'
const tagsOf = (l: Lead) => parse<LeadTag[]>(l.tags, [])
const researchOf = (l: Lead) => (l.research ? parse<LeadResearch | null>(l.research, null) : null)
const contactOf = (l: Lead) => parse<Record<string, string>>(l.contact, {})
const whoOf = (l: Lead) => {
  const c = contactOf(l)
  return c.name || c.email || c.phone || tr('leads.no_name')
}

const DAY = 86400_000
const FILTERS = ['real', 'day', 'week', 'high', 'quote', 'todo', 'all', 'spam'] as const
type Filter = (typeof FILTERS)[number]
type Sort = 'intent' | 'time'
type Mode = 'list' | 'board'

const match: Record<Filter, (l: Lead, now: number) => boolean> = {
  real: (l) => isReal(l),
  day: (l, now) => isReal(l) && at(l) > now - DAY,
  week: (l, now) => isReal(l) && at(l) > now - 7 * DAY,
  high: (l) => isReal(l) && l.intent === 'high' && !['won', 'lost'].includes(l.status),
  quote: (l) => isReal(l) && tagsOf(l).includes('quote'),
  todo: (l) => isReal(l) && l.status === 'new',
  all: () => true,
  spam: (l) => !isReal(l),
}

// 「新」标识：还没点开看过的新询盘。看过的 id 记在本机浏览器里（读写不了就当都没看过）
const SEEN_KEY = 'trade.leads.seen'
const loadSeen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'))
  } catch {
    return new Set()
  }
}
const saveSeen = (s: Set<string>) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-2000)))
  } catch {
    // 存不了就算了
  }
}

/**
 * 询盘：渠道站点的表单提交实时推送进来（Func leads_hook，leads.sync 兜底补拉），本机函数 leads.judge 判断真假、意向、打标签。
 * 列表和商机看板两种看法；点开一条是详情：概览（原文、联系人、回复草稿）、客户背调（任务 research-lead）、跟进记录。
 */
export default function Leads({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  // 写回复的「AI 要求」（tasks/reply-lead.md 的写法），放在页头
  const replyTask = useTask(REPLY_TASK)
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [stats, setStats] = useState<LeadStats | null>(null)
  // 新询盘自动判断真假要本机模型（leads.judge 没有云端版本）：这里调不了就不触发
  const canJudge = useCanRun('leads.judge')
  const [error, setError] = useState('')
  const [syncErr, setSyncErr] = useState('')
  const [q, setQ] = useState('')
  const [seen, setSeen] = useState(loadSeen)
  const filter: Filter = (FILTERS as readonly string[]).includes(params.filter) ? (params.filter as Filter) : 'real'
  const sort: Sort = params.sort === 'time' ? 'time' : 'intent'
  const mode: Mode = params.mode === 'board' ? 'board' : 'list'
  const openId = params.lead ?? ''
  const sites = ctx.channels.filter((c) => c.type === 'creght_site')
  const lastSync = sites.map((c) => c.leads_synced_at ?? '').sort().pop()

  const load = useCallback(() => {
    dbList('leads')
      .then(setLeads)
      .catch((e) => setError(e.message))
    leadStats(30)
      .then(setStats)
      .catch((e) => !(e instanceof ShuttleUnavailable) && setError(e.message))
    // 定时同步上次的结果：失败了（比如平台接口没开放）在页面上说清楚
    if (!shuttleMissing()) fetch('/_shuttle/api/local/schedules', { headers: { 'X-Shuttle': '1' } })
      .then((r) => r.json())
      .then((r) => setSyncErr(r?.list?.find((j: any) => j.fn === 'leads.sync')?.last?.error ?? ''))
      .catch(() => {})
  }, [])
  useEffect(() => {
    setLeads(null)
    load()
  }, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])
  // 实时推送进来的新线索：页面开着时每 30 秒刷新一次（页面在后台不刷）
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') dbList('leads').then(setLeads).catch(() => {})
    }, 30_000)
    return () => clearInterval(t)
  }, [])
  // 有待判断的（刚推送进来）就在本机马上判断，不等定时任务。同一时间只跑一个；
  // 每条只自动触发一次，模型出错判断不了的留给定时任务，不在页面上反复重试
  const judging = useRef(false)
  const tried = useRef(new Set<string>())
  useEffect(() => {
    const fresh = (leads ?? []).filter((l) => l.pending && !tried.current.has(l.id))
    if (!fresh.length || !canJudge || judging.current) return
    judging.current = true
    fresh.forEach((l) => tried.current.add(l.id))
    runLocal('leads.judge', {})
      .then(load)
      .catch(() => {})
      .finally(() => {
        judging.current = false
      })
  }, [leads, canJudge, load])

  const now = Date.now()
  const all = leads ?? []
  const counts = Object.fromEntries(FILTERS.map((f) => [f, all.filter((l) => match[f](l, now)).length])) as Record<Filter, number>
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase()
    const list = (leads ?? []).filter((l) => match[filter](l, Date.now())).filter((l) => !words || [l.company, l.contact, l.message, l.country, l.landing_page, l.form_name].join(' ').toLowerCase().includes(words))
    return list.sort((a, b) => (sort === 'intent' ? (INTENT[a.intent ?? 'low']?.rank ?? 3) - (INTENT[b.intent ?? 'low']?.rank ?? 3) : 0) || at(b) - at(a))
  }, [leads, filter, sort, q])

  // 顶上的数：24 小时、本周（和上周比）、高意向还没成交的、累计成交
  const real = all.filter(isReal)
  const week = real.filter((l) => at(l) > now - 7 * DAY).length
  const lastWeek = real.filter((l) => at(l) <= now - 7 * DAY && at(l) > now - 14 * DAY).length

  const patchLocal = (id: string, p: Partial<Lead>) => setLeads((ls) => ls?.map((x) => (x.id === id ? { ...x, ...p } : x)) ?? null)
  const setStatus = async (l: Lead, status: LeadStatus) => {
    if (status === l.status) return
    patchLocal(l.id, { status, is_real: status === 'spam' ? false : l.status === 'spam' ? true : l.is_real })
    try {
      const saved = await updateLead(l.id, { status })
      if (saved) patchLocal(l.id, saved)
    } catch (e) {
      setError((e as Error).message)
      load()
    }
  }
  const openLead = (id: string) => {
    setParam('lead', id)
    if (!seen.has(id)) {
      const next = new Set(seen).add(id)
      setSeen(next)
      saveSeen(next)
    }
  }
  const isNew = (l: Lead) => l.status === 'new' && isReal(l) && !l.pending && !seen.has(l.id)
  const opened = all.find((l) => l.id === openId)
  const channelName = (l: Lead) => ctx.channels.find((c) => c.id === l.channel_id)?.name

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('leads.title')}
        desc={tr('leads.desc')}
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {lastSync && <span className="text-xs text-muted-foreground">{tr('leads.last_sync', { when: fmtTime(lastSync) })}</span>}
            <TaskRequirements task={replyTask.task} onSaved={replyTask.setTask} title={tr('leads.reply_req_title')} hint={tr('leads.reply_req_hint')} />
            <Button variant="outline" size="sm" disabled={!shown.length} onClick={() => exportCSV(shown, channelName)}>
              <Download /> {tr('leads.export')}
            </Button>
            <RunButton inline fn="leads.sync" input={{}} icon={RefreshCw} onDone={load}>
              {tr('leads.sync')}
            </RunButton>
          </div>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {syncErr && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{tr('leads.sync_failed', { error: syncErr })}</div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label={tr('leads.m_day')} hint={tr('leads.m_day_hint')} cur={leads ? counts.day : undefined} onClick={() => setParam('filter', 'day')} />
        <Metric label={tr('leads.m_week')} hint={tr('leads.m_week_hint')} cur={leads ? week : undefined} prev={leads ? lastWeek : undefined} onClick={() => setParam('filter', 'week')} />
        <Metric label={tr('leads.m_high')} hint={tr('leads.m_high_hint')} cur={leads ? counts.high : undefined} onClick={() => setParam('filter', 'high')} />
        <Metric label={tr('leads.m_won')} hint={tr('leads.m_won_hint')} cur={leads ? real.filter((l) => l.status === 'won').length : undefined} />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setParam('filter', f)}
              aria-pressed={filter === f}
              className={cx(
                'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                filter === f ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              {tr(`leads.f_${f}`)}
              {leads && <span className={cx('tabular-nums', filter === f ? 'opacity-80' : 'opacity-60')}>{counts[f]}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('leads.search')} className={cx(inputCls, 'h-8 pl-8')} />
          </label>
          {mode === 'list' && (
            <Segmented
              value={sort}
              onChange={(v) => setParam('sort', v)}
              options={[
                { value: 'intent', label: tr('leads.sort_intent') },
                { value: 'time', label: tr('leads.sort_time') },
              ]}
            />
          )}
          <Segmented
            value={mode}
            onChange={(v) => setParam('mode', v)}
            options={[
              { value: 'list', label: <><List className="size-3.5" />{tr('leads.mode_list')}</> },
              { value: 'board', label: <><KanbanSquare className="size-3.5" />{tr('leads.mode_board')}</> },
            ]}
          />
        </div>
      </div>

      {leads === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : sites.length === 0 && leads.length === 0 ? (
        <Notice>{tr('leads.no_site')}</Notice>
      ) : leads.length === 0 ? (
        <Notice>{tr('leads.empty')}</Notice>
      ) : mode === 'board' ? (
        <Board leads={shown.filter(isReal)} isNew={isNew} onOpen={openLead} onStatus={setStatus} />
      ) : shown.length === 0 ? (
        <Notice>{filter === 'real' ? tr('leads.all_spam') : tr('leads.no_match')}</Notice>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {shown.map((l) => (
            <LeadRow key={l.id} lead={l} isNew={isNew(l)} channel={channelName(l)} onOpen={() => openLead(l.id)} onStatus={(s) => setStatus(l, s)} />
          ))}
        </div>
      )}

      {stats && stats.current.real > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          <Breakdown title={tr('leads.by_page')} rows={stats.by_page.filter((r) => r.real > 0).map((r) => ({ label: r.key === '（无）' ? tr('leads.unknown_page') : pathOf(r.key) || r.key, title: r.key, n: r.real }))} />
          <Breakdown title={tr('leads.by_utm')} rows={stats.by_utm_source.filter((r) => r.real > 0).map((r) => ({ label: r.key === '（无）' ? tr('leads.direct') : r.key, n: r.real }))} />
        </div>
      )}

      {opened && <LeadDetail lead={opened} channel={channelName(opened)} onClose={() => setParam('lead', '')} onStatus={(s) => setStatus(opened, s)} onChanged={load} onSaved={(l) => patchLocal(l.id, l)} />}
    </div>
  )
}

function Metric({ label, hint, cur, prev, onClick }: { label: string; hint: string; cur?: number; prev?: number; onClick?: () => void }) {
  const diff = cur !== undefined && prev !== undefined ? cur - prev : undefined
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{cur ?? '…'}</span>
        {diff !== undefined && (prev ?? 0) + (cur ?? 0) > 0 && (
          <span className={cx('inline-flex items-center text-xs font-medium tabular-nums', diff > 0 ? 'text-emerald-700 dark:text-emerald-400' : diff < 0 ? 'text-destructive' : 'text-muted-foreground')}>
            {diff > 0 ? <ArrowUpRight className="size-3.5" /> : diff < 0 ? <ArrowDownRight className="size-3.5" /> : null}
            {diff === 0 ? tr('leads.flat') : tr(diff > 0 ? 'leads.more' : 'leads.less', { n: Math.abs(diff) })}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </>
  )
  const cls = 'rounded-xl border border-border bg-background px-4 py-3 text-left'
  // 点了按这个数筛选列表
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, 'cursor-pointer transition-colors hover:border-primary/40')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; title?: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tr('leads.no_data')}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="relative flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm">
              <span className="absolute inset-y-0 left-0 rounded-md bg-[var(--series-1)] opacity-10" style={{ width: `${(r.n / max) * 100}%` }} aria-hidden />
              <span className="relative truncate" title={r.title}>
                {r.label}
              </span>
              <span className="relative shrink-0 tabular-nums text-muted-foreground">{r.n}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** 意向、背调结论、标签、国家这几个徽标，列表、看板、详情共用 */
function LeadBadges({ lead: l, compact }: { lead: Lead; compact?: boolean }) {
  const intent = l.intent ? INTENT[l.intent] : undefined
  const research = researchOf(l)
  return (
    <>
      {l.pending ? <Badge>{tr('leads.pending')}</Badge> : !isReal(l) ? <Badge>{statusLabel('spam')}</Badge> : intent && <Badge tone={intent.tone}>{intent.label}</Badge>}
      {research && <Badge tone={VERDICT_TONE[research.verdict] ?? 'default'}>{tr(`leads.v_${research.verdict}`)}</Badge>}
      {!compact && tagsOf(l).map((t) => <Badge key={t} tone="primary">{tr(`leads.t_${t}`)}</Badge>)}
      {l.country && <Badge>{l.country}</Badge>}
    </>
  )
}

function NewMark() {
  return <span className="inline-flex h-4 shrink-0 items-center rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">{tr('article.new_badge')}</span>
}

function LeadRow({ lead: l, isNew, channel, onOpen, onStatus }: { lead: Lead; isNew: boolean; channel?: string; onOpen: () => void; onStatus: (s: LeadStatus) => void }) {
  const utm = parse<Record<string, string>>(l.utm, {})
  const company = l.company || contactOf(l).company
  return (
    <div className={cx('border-b border-border last:border-b-0', !isReal(l) && 'opacity-70', isNew && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer space-y-1.5 text-left">
          <div className="flex flex-wrap items-center gap-2">
            {isNew && <NewMark />}
            <span className="text-sm font-semibold">{company || whoOf(l)}</span>
            {company && <span className="text-sm text-muted-foreground">{whoOf(l)}</span>}
            <LeadBadges lead={l} />
          </div>
          {l.message && <p className="line-clamp-2 text-sm leading-relaxed">{l.message}</p>}
          {l.intent_reason && <p className="text-xs text-muted-foreground">{tr('leads.reason', { r: l.intent_reason })}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{fmtTime(l.submitted_at || l.created_at)}</span>
            {l.landing_page && <span title={l.landing_page}>{tr('leads.from', { host: hostOf(l.landing_page) })}{pathOf(l.landing_page)}</span>}
            {utm.utm_source && <span>{tr('leads.utm', { s: utm.utm_source })}</span>}
            {channel && <span>{tr('leads.channel', { c: channel })}</span>}
            {l.reply_at && <span>{tr('leads.has_reply')}</span>}
          </div>
        </button>
        <StatusSelect value={l.status} onChange={onStatus} />
      </div>
    </div>
  )
}

function StatusSelect({ value, onChange }: { value: LeadStatus; onChange: (s: LeadStatus) => void }) {
  return (
    <Select
      variant="inline"
      title={tr('leads.follow')}
      ariaLabel={tr('leads.follow')}
      value={value === 'qualified' ? 'negotiating' : value}
      onChange={onChange}
      className="w-32 shrink-0"
      align="right"
      menuClassName="w-48"
      options={STATUS_KEYS.map((s) => ({ value: s, label: statusLabel(s) }))}
    />
  )
}

/** 商机看板：每个跟进阶段一列，卡片拖到别的列就改阶段 */
function Board({ leads, isNew, onOpen, onStatus }: { leads: Lead[]; isNew: (l: Lead) => boolean; onOpen: (id: string) => void; onStatus: (l: Lead, s: LeadStatus) => void }) {
  const [over, setOver] = useState<LeadStatus | ''>('')
  const drop = (s: LeadStatus, id: string) => {
    const l = leads.find((x) => x.id === id)
    if (l && stageOf(l) !== s) onStatus(l, s)
  }
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="grid grid-cols-[repeat(6,minmax(112px,1fr))] gap-2">
        {STAGES.map((s) => {
          const col = leads.filter((l) => stageOf(l) === s)
          return (
            <div
              key={s}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(s)
              }}
              onDragLeave={() => setOver((o) => (o === s ? '' : o))}
              onDrop={(e) => {
                e.preventDefault()
                setOver('')
                drop(s, e.dataTransfer.getData('text/plain'))
              }}
              className={cx('flex min-h-40 flex-col rounded-xl border bg-muted/40 p-2', over === s ? 'border-primary' : 'border-border')}
            >
              <div className="flex items-center justify-between px-1.5 pt-0.5 pb-2 text-xs font-semibold">
                <span>{statusLabel(s)}</span>
                <span className="tabular-nums text-muted-foreground">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', l.id)}
                    onClick={() => onOpen(l.id)}
                    className={cx('block w-full cursor-pointer space-y-1.5 rounded-lg border border-border bg-background p-2.5 text-left shadow-xs transition-colors hover:border-primary/40', isNew(l) && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}
                  >
                    <div className="flex items-center gap-1.5">
                      {isNew(l) && <NewMark />}
                      <span className="truncate text-sm font-semibold" title={l.company || contactOf(l).company || whoOf(l)}>{l.company || contactOf(l).company || whoOf(l)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <LeadBadges lead={l} compact />
                    </div>
                    {l.message && <p className="line-clamp-2 text-xs text-muted-foreground">{l.message}</p>}
                    <div className="text-[11px] text-muted-foreground">{fmtTime(l.submitted_at || l.created_at)}</div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{tr('leads.board_hint')}</p>
    </div>
  )
}

type Tab = 'overview' | 'research' | 'activity'

/** 一条询盘的详情：概览 / 客户背调 / 跟进记录 */
function LeadDetail({ lead: l, channel, onClose, onStatus, onChanged, onSaved }: { lead: Lead; channel?: string; onClose: () => void; onStatus: (s: LeadStatus) => void; onChanged: () => void; onSaved: (l: Lead) => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const contact = contactOf(l)
  const company = l.company || contact.company
  const activities = parse<LeadActivity[]>(l.activities, [])
  return (
    <Dialog open onClose={onClose} width={880} title={<span className="flex flex-wrap items-center gap-2">{company || whoOf(l)}{company && <span className="font-normal text-muted-foreground">{whoOf(l)}</span>}</span>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <LeadBadges lead={l} />
          <span className="text-xs text-muted-foreground">{fmtTime(l.submitted_at || l.created_at)}</span>
          <span className="ml-auto" />
          <StatusSelect value={l.status} onChange={onStatus} />
        </div>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: tr('leads.tab_overview') },
            { value: 'research', label: tr('leads.tab_research') },
            { value: 'activity', label: tr('leads.tab_activity', { n: activities.length || '' }) },
          ]}
        />
        {tab === 'overview' ? <Overview lead={l} channel={channel} onChanged={onChanged} /> : tab === 'research' ? <ResearchPanel lead={l} onChanged={onChanged} /> : <Activities lead={l} list={activities} onSaved={onSaved} />}
      </div>
    </Dialog>
  )
}

function Overview({ lead: l, channel, onChanged }: { lead: Lead; channel?: string; onChanged: () => void }) {
  const contact = contactOf(l)
  const utm = parse<Record<string, string>>(l.utm, {})
  const fields = parse<Record<string, string>>(l.fields, {})
  return (
    <div className="space-y-3 text-sm">
      {l.message && <p className="leading-relaxed whitespace-pre-wrap">{l.message}</p>}
      {l.intent_reason && <p className="text-xs text-muted-foreground">{tr('leads.reason', { r: l.intent_reason })}</p>}
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[8rem_minmax(0,1fr)]">
        {Object.entries(contact).map(([k, v]) => (
          <Row key={'c' + k} k={['name', 'email', 'phone', 'company', 'title', 'country'].includes(k) ? tr(`leads.c_${k}`) : k} v={v} />
        ))}
        {l.landing_page && <Row k={tr('leads.c_page')} v={l.landing_page} />}
        {utm.utm_source && <Row k={tr('leads.c_utm')} v={[utm.utm_source, utm.utm_medium, utm.utm_campaign].filter(Boolean).join(' / ')} />}
        {l.form_name && <Row k={tr('leads.c_form')} v={l.form_name} />}
        {channel && <Row k={tr('leads.c_channel')} v={channel} />}
      </dl>
      <details className="rounded-lg border border-border bg-muted/40 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">{tr('leads.raw')}</summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
          {Object.entries(fields).map(([k, v]) => (
            <Row key={'f' + k} k={k} v={String(v)} />
          ))}
        </dl>
      </details>
      {l.landing_page && (
        <a href={l.landing_page} target="_blank" rel="noreferrer" className="inline-block text-xs font-medium text-primary-text hover:underline">
          {tr('leads.open_page')}
        </a>
      )}
      <Reply lead={l} email={contact.email} onChanged={onChanged} />
    </div>
  )
}

/** 客户背调：交给助手查（tasks/research-lead.md），结果存在 leads.research 上 */
function ResearchPanel({ lead: l, onChanged }: { lead: Lead; onChanged: () => void }) {
  const r = researchOf(l)
  const button = (
    <TaskButton task={RESEARCH_TASK} input={{ id: l.id }} match={(run) => run.input?.id === l.id} onFinished={onChanged} variant={r ? 'ghost' : 'default'} icon={UserSearch}>
      {r ? tr('leads.research_again') : tr('leads.research_run')}
    </TaskButton>
  )
  if (!r)
    return (
      <div className="space-y-3 rounded-lg border border-dashed border-border p-4 text-sm">
        <p>{tr('leads.research_empty')}</p>
        {button}
      </div>
    )
  const company = r.company ?? {}
  const domain = r.domain ?? {}
  const facts = (['website', 'country', 'founded', 'size', 'revenue'] as const).filter((k) => company[k])
  return (
    <div className="space-y-4 text-sm">
      <div className={cx('rounded-lg border p-3', r.verdict === 'avoid' ? 'border-destructive/30 bg-destructive/5' : r.verdict === 'caution' ? 'border-amber-500/30 bg-amber-500/5' : r.verdict === 'pursue' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-muted/40')}>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <Badge tone={VERDICT_TONE[r.verdict] ?? 'default'}>{tr(`leads.v_${r.verdict}`)}</Badge>
          {l.research_at && <span className="text-xs text-muted-foreground">{fmtTime(l.research_at)}</span>}
          <span className="ml-auto" />
          {button}
        </div>
        <p className="leading-relaxed whitespace-pre-wrap">{r.conclusion}</p>
      </div>
      {(company.name || company.business || facts.length > 0) && (
        <Section title={tr('leads.r_company')}>
          {company.name && <div className="font-medium">{company.name}</div>}
          {company.business && <p className="text-muted-foreground">{company.business}</p>}
          {facts.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {facts.map((k) => (
                <div key={k} className="rounded-md border border-border px-2.5 py-1.5">
                  <div className="text-[11px] text-muted-foreground">{tr(`leads.r_${k}`)}</div>
                  <div className="truncate text-sm font-medium" title={company[k]}>{k === 'website' ? hostOf(company[k]) || company[k] : company[k]}</div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
      {!!r.signals?.length && <Section title={tr('leads.r_signals')}><Cited list={r.signals} /></Section>}
      {!!r.risks?.length && (
        <Section title={<span className="inline-flex items-center gap-1 text-destructive"><ShieldAlert className="size-3.5" />{tr('leads.r_risks')}</span>}>
          <Cited list={r.risks} />
        </Section>
      )}
      {(domain.domain || domain.registered) && (
        <Section title={tr('leads.r_domain')}>
          <p>{[domain.domain, domain.registered && tr('leads.r_registered', { d: domain.registered }), domain.age].filter(Boolean).join(' · ')}</p>
          {domain.note && <p className="text-muted-foreground">{domain.note}</p>}
        </Section>
      )}
      {!!r.next_steps?.length && (
        <Section title={tr('leads.r_next')}>
          <ol className="list-decimal space-y-1 pl-5">
            {r.next_steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </Section>
      )}
      {!!r.sources?.length && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{tr('leads.r_sources', { n: r.sources.length })}</summary>
          <ul className="mt-1 space-y-0.5">
            {r.sources.map((u) => <li key={u} className="truncate"><a href={u} target="_blank" rel="noreferrer" className="hover:underline">{u}</a></li>)}
          </ul>
        </details>
      )}
      <p className="text-xs text-muted-foreground">{tr('leads.research_hint')}</p>
    </div>
  )
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

function Cited({ list }: { list: { text: string; url?: string }[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {list.map((x, i) => (
        <li key={i}>
          {x.text}
          {x.url && (
            <a href={x.url} target="_blank" rel="noreferrer" title={x.url} className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground">
              <ExternalLink className="size-3" />
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

/** 跟进记录：改阶段、写回复、背调自动记一条；用户自己也能记（打过电话、发过报价…） */
function Activities({ lead: l, list, onSaved }: { lead: Lead; list: LeadActivity[]; onSaved: (l: Lead) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const add = async () => {
    if (!text.trim()) return
    setBusy(true)
    setErr('')
    try {
      onSaved(await updateLead(l.id, { log: text.trim() }))
      setText('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const describe = (a: LeadActivity) =>
    a.kind === 'status' ? tr('leads.a_status', { s: statusLabel(a.text as LeadStatus) }) : a.kind === 'research' ? tr('leads.a_research', { v: tr(`leads.v_${a.text}`) }) : a.kind === 'reply' ? tr('leads.a_reply', { s: a.text }) : a.text
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={tr('leads.log_placeholder')} className={cx(inputCls, 'min-h-16 py-2')} />
        {err && <Notice tone="error">{err}</Notice>}
        <Button size="sm" disabled={busy || !text.trim()} onClick={add}>
          {tr('leads.log_add')}
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tr('leads.log_empty')}</p>
      ) : (
        <ol className="space-y-2 border-l border-border pl-4">
          {[...list].reverse().map((a, i) => (
            <li key={i} className="relative">
              <span className={cx('absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background', a.kind === 'note' ? 'bg-primary' : 'bg-muted-foreground/50')} />
              <div className="text-xs text-muted-foreground">{fmtTime(a.at)}</div>
              <div className={cx('whitespace-pre-wrap', a.kind !== 'note' && 'text-muted-foreground')}>{describe(a)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * 回复草稿：「AI 写回复」交给助手（tasks/reply-lead.md，写法用户可改），写好存在这条线索上；
 * 用户复制，或者用自己的邮件客户端打开发送（mailto）。不替用户发邮件。
 */
function Reply({ lead: l, email, onChanged }: { lead: Lead; email?: string; onChanged: () => void }) {
  const [copied, setCopied] = useState(false)
  const has = !!l.reply_body
  const copy = async () => {
    try {
      await navigator.clipboard.writeText((l.reply_subject ? l.reply_subject + '\n\n' : '') + (l.reply_body ?? ''))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 复制不了（权限）就算了，用户还能手动选
    }
  }
  const mailto = email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(l.reply_subject ?? '')}&body=${encodeURIComponent(l.reply_body ?? '')}` : ''
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{tr('leads.reply_title')}</span>
        {has && l.reply_at && <span className="text-xs text-muted-foreground">{fmtTime(l.reply_at)}</span>}
        <span className="ml-auto" />
        <TaskButton task={REPLY_TASK} input={{ id: l.id }} match={(r) => r.input?.id === l.id} onFinished={onChanged} variant={has ? 'ghost' : 'default'} icon={Sparkles}>
          {has ? tr('leads.reply_again') : tr('leads.reply_write')}
        </TaskButton>
      </div>
      {has ? (
        <>
          {l.reply_subject && <div className="text-sm font-medium">{l.reply_subject}</div>}
          <p className="max-h-72 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">{l.reply_body}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check /> : <Copy />} {copied ? tr('leads.copied') : tr('leads.copy')}
            </Button>
            {mailto && (
              <a href={mailto} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm hover:bg-accent">
                <Mail className="size-4" /> {tr('leads.send_mail')}
              </a>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{tr('leads.reply_hint')}</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{tr(researchOf(l) ? 'leads.reply_empty' : 'leads.reply_empty_research')}</p>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all whitespace-pre-wrap">{v}</dd>
    </>
  )
}

/** 导出当前列表：CSV 带 BOM，Excel 直接打开不乱码 */
function exportCSV(list: Lead[], channelName: (l: Lead) => string | undefined) {
  const cols: [string, (l: Lead) => string][] = [
    [tr('leads.x_time'), (l) => l.submitted_at || l.created_at || ''],
    [tr('leads.x_stage'), (l) => statusLabel(stageOf(l))],
    [tr('leads.x_intent'), (l) => (l.intent ? INTENT[l.intent]?.label : '') ?? ''],
    [tr('leads.c_company'), (l) => l.company || contactOf(l).company || ''],
    [tr('leads.c_name'), (l) => contactOf(l).name ?? ''],
    [tr('leads.c_email'), (l) => contactOf(l).email ?? ''],
    [tr('leads.c_phone'), (l) => contactOf(l).phone ?? ''],
    [tr('leads.c_country'), (l) => l.country || contactOf(l).country || ''],
    [tr('leads.x_tags'), (l) => tagsOf(l).map((t) => tr(`leads.t_${t}`)).join(', ')],
    [tr('leads.x_research'), (l) => {
      const r = researchOf(l)
      return r ? tr(`leads.v_${r.verdict}`) : ''
    }],
    [tr('leads.x_message'), (l) => l.message ?? ''],
    [tr('leads.c_page'), (l) => l.landing_page ?? ''],
    [tr('leads.c_utm'), (l) => parse<Record<string, string>>(l.utm, {}).utm_source ?? ''],
    [tr('leads.c_channel'), (l) => channelName(l) ?? ''],
  ]
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const csv = [cols.map(([h]) => cell(h)).join(','), ...list.map((l) => cols.map(([, f]) => cell(f(l))).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `inquiries-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
