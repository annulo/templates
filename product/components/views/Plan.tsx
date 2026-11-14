import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, Flag, MessageSquareText, MoreHorizontal, Play, Sparkles, Undo2, X } from 'lucide-react'
import RunButton from '../RunButton'
import { TaskButton, TaskLaunchButton } from '../Task'
import { Badge, Button, Notice, PageHeader, Panel, Segmented, Skeleton, cx } from '../ui'
import KeywordMap from '../KeywordMap'
import Backlinks from '../Backlinks'
import { openChat, runLocal } from '../../lib/shuttle'
import { tr } from '../../lib/i18n'
import type { Ctx, View } from './types'

type Action = { kind: 'go'; view: View; params?: Record<string, string> } | { kind: 'task'; task: string; input?: unknown }
type Item = { id: string; phase: number; week: number; area: string; title: string; why: string; action: Action | null; status: '' | 'done' | 'skipped'; auto?: boolean; done_by?: '' | 'auto' | 'ai' | 'user'; done_note?: string }
type Progress = { metric: string; tier: 'process' | 'leading' | 'result'; better: 'up' | 'down'; label: string; baseline: number | null; current: number | null; target: number; pct: number | null }
type Option = { level: 'conservative' | 'normal' | 'aggressive'; note: string; targets: Record<string, number> }
type Phase = { phase: number; title: string; focus: string; goals: string[] }
type Checkpoint = { day: number; at: string; summary: string; wins: string[]; issues: string[]; adjustments: string[]; chat_id?: string }
type Plan = {
  id: string; status: 'draft' | 'active' | 'done'; summary: string; start_date: string; start_phase: number; stage_reason: string
  phases: Phase[]; options: Option[]; recommended: string; level: string; targets: Record<string, number>
  baseline: { at?: string; metrics?: Record<string, number | null> }; checkpoints: Checkpoint[]; chat_id?: string
}
type Data = {
  plan: Plan | null
  stage?: { phase: number; reasons: string[] }
  position?: { day: number; week: number; phase: number } | null
  progress?: Progress[]
  items?: Item[]
  checkpoint_due?: number | null
  metrics?: Record<string, number | null>
}
type Defs = Record<string, { tier: string; label: string; better: string }>

const TIERS = ['process', 'leading', 'result'] as const
/** 指标按「做了多少 → 先行 → 结果」排（plan.metrics 的 defs 就是这个顺序） */
const order = (defs: Defs, k: string) => { const i = Object.keys(defs).indexOf(k); return i < 0 ? 99 : i }
const fmt = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','))

/**
 * 增长计划：90 天的目标、基线、阶段和每周要做的事（docs/growth-plan.md）。
 * 没有计划时让 AI 起草；草稿选一档目标开始执行；执行中看进度、做这周的事、到了 Day 30 / 60 / 90 做检查点。
 */
export default function PlanView({ ctx, params = {}, setParam }: { ctx: Ctx; params?: Record<string, string>; setParam?: (k: string, v: string) => void }) {
  const tab = params.tab === 'map' || params.tab === 'links' ? params.tab : 'plan'
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    runLocal<Data>('plan.get', {})
      .then((d) => (setData(d), setError('')))
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])

  const plan = data?.plan
  const draftButton = (label: string, variant: 'default' | 'outline' = 'default') => (
    <TaskLaunchButton
      task="draft-plan"
      onFinished={load}
      title={tr('plan.draft_title')}
      desc={tr('plan.draft_desc')}
      reqTitle={tr('plan.req_title')}
      reqHint={tr('plan.req_hint')}
      startLabel={tr('plan.draft_start')}
      icon={Sparkles}
      variant={variant}
    >
      {label}
    </TaskLaunchButton>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('plan.title')}
        desc={tr('plan.desc')}
        actions={
          plan && (
            <div className="flex flex-wrap items-center gap-2">
              {plan.chat_id && (
                <Button variant="outline" size="sm" feedback={false} onClick={() => openChat(plan.chat_id!)}>
                  <MessageSquareText /> {tr('plan.continue_chat')}
                </Button>
              )}
              {plan.status !== 'draft' && draftButton(plan.status === 'done' ? tr('plan.draft_next') : tr('plan.redraft'), 'outline')}
            </div>
          )
        }
      />
      <Segmented
        value={tab}
        onChange={(v) => setParam?.('tab', v === 'plan' ? '' : v)}
        options={[
          { value: 'plan', label: tr('plan.tab_plan') },
          { value: 'map', label: tr('plan.tab_map') },
          { value: 'links', label: tr('plan.tab_links') },
        ]}
      />
      {tab === 'map' ? (
        <KeywordMap ctx={ctx} />
      ) : tab === 'links' ? (
        <Backlinks ctx={ctx} />
      ) : (
        <>
          {error && <Notice tone="error">{error}</Notice>}
          {data === null ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : !plan ? (
            <Empty stage={data.stage} action={draftButton(tr('plan.draft'))} />
          ) : plan.status === 'draft' ? (
            <Draft plan={plan} items={data.items ?? []} metrics={data.metrics ?? {}} onDone={load} redraft={draftButton(tr('plan.redraft'), 'outline')} />
          ) : (
            <Active ctx={ctx} data={data} plan={plan} onChanged={load} />
          )}
        </>
      )}
    </div>
  )
}

/** 还没有计划：说清楚这是什么，按数据说建议从哪开始 */
function Empty({ stage, action }: { stage?: Data['stage']; action: ReactNode }) {
  return (
    <div className="space-y-5 rounded-xl border border-border bg-background p-6">
      <div className="space-y-2">
        <h3 className="text-base font-semibold">{tr('plan.empty_title')}</h3>
        <p className="text-sm text-muted-foreground">{tr('plan.empty_desc')}</p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <li key={n} className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">{tr(`plan.phase_days_${n}`)}</div>
            <div className="mt-1 text-sm font-medium">{tr(`plan.phase_name_${n}`)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{tr(`plan.phase_hint_${n}`)}</div>
          </li>
        ))}
      </ol>
      {stage && (
        <Notice tone="info">
          {tr('plan.stage_suggest', { phase: tr(`plan.phase_name_${stage.phase}`) })}
          {stage.reasons.length > 0 && <span className="text-muted-foreground"> {stage.reasons.join(tr('plan.sep'))}</span>}
        </Notice>
      )}
      {action}
    </div>
  )
}

/** AI 起草好的计划：选一档目标，开始执行 */
function Draft({ plan, items, metrics, onDone, redraft }: { plan: Plan; items: Item[]; metrics: Record<string, number | null>; onDone: () => void; redraft: ReactNode }) {
  const [level, setLevel] = useState(plan.recommended || 'normal')
  const [defs, setDefs] = useState<Defs>({})
  useEffect(() => void runLocal<{ defs: Defs }>('plan.metrics', {}).then((r) => setDefs(r.defs)).catch(() => {}), [])
  return (
    <div className="space-y-6">
      <Notice tone="info">{tr('plan.draft_notice')}</Notice>
      <Summary plan={plan} />
      <Panel title={tr('plan.pick_level')}>
        <div className="grid gap-3 md:grid-cols-3">
          {plan.options.map((o) => (
            <button
              key={o.level}
              type="button"
              onClick={() => setLevel(o.level)}
              className={cx('cursor-pointer space-y-3 rounded-lg border p-4 text-left transition-colors', level === o.level ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}
            >
              <div className="flex items-center gap-2">
                <span className={cx('flex size-4 items-center justify-center rounded-full border', level === o.level ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                  {level === o.level && <Check className="size-3" />}
                </span>
                <span className="text-sm font-semibold">{tr(`plan.level_${o.level}`)}</span>
                {plan.recommended === o.level && <Badge tone="ok">{tr('plan.recommended')}</Badge>}
              </div>
              {o.note && <p className="text-xs text-muted-foreground">{o.note}</p>}
              <ul className="space-y-1 text-xs">
                {Object.entries(o.targets).sort(([a], [b]) => order(defs, a) - order(defs, b)).map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{defs[k]?.label ?? k}</span>
                    <span className="tabular-nums">
                      <span className="text-muted-foreground">{fmt(metrics[k])} → </span>
                      <span className="font-medium">{fmt(v)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <RunButton fn="plan.activate" input={{ level }} icon={Play} onDone={onDone}>
            {tr('plan.start')}
          </RunButton>
          {redraft}
        </div>
      </Panel>
      <Weeks items={items} onChanged={onDone} readOnly />
    </div>
  )
}

function Summary({ plan, current }: { plan: Plan; current?: number }) {
  return (
    <div className="space-y-4">
      {plan.summary && <p className="text-sm leading-relaxed">{plan.summary}</p>}
      {plan.stage_reason && plan.start_phase > 1 && (
        <p className="text-xs text-muted-foreground">{tr('plan.start_from', { phase: tr(`plan.phase_name_${plan.start_phase}`) })}{plan.stage_reason}</p>
      )}
      <ol className="grid gap-3 md:grid-cols-3">
        {plan.phases.map((p) => (
          <li key={p.phase} className={cx('rounded-lg border p-3', current === p.phase ? 'border-primary bg-primary/5' : 'border-border', !!current && p.phase < current && 'opacity-60')}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{tr(`plan.phase_days_${p.phase}`)}</span>
              {current === p.phase && <Badge tone="ok">{tr('plan.now')}</Badge>}
            </div>
            <div className="mt-1 text-sm font-medium">{p.title}</div>
            <p className="mt-1 text-xs text-muted-foreground">{p.focus}</p>
            {p.goals.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">
                {p.goals.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 执行中 / 已结束：进度、目标、检查点、每周的事 */
function Active({ ctx, data, plan, onChanged }: { ctx: Ctx; data: Data; plan: Plan; onChanged: () => void }) {
  const pos = data.position
  const day = Math.min(pos?.day ?? 1, 90)
  const due = data.checkpoint_due
  return (
    <div className="space-y-6">
      <div className="space-y-2 rounded-xl border border-border bg-background p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm">
            {plan.status === 'done' ? (
              <span className="font-semibold">{tr('plan.finished')}</span>
            ) : (
              <>
                <span className="text-2xl font-semibold tabular-nums">{tr('plan.day', { n: day })}</span>
                <span className="ml-1 text-muted-foreground">/ 90 · {tr('plan.week', { n: pos?.week ?? 1 })} · {tr(`plan.phase_name_${pos?.phase ?? 1}`)}</span>
              </>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{tr('plan.level_is', { level: tr(`plan.level_${plan.level}`), date: plan.start_date })}</span>
        </div>
        <Timeline day={plan.status === 'done' ? 90 : day} checkpoints={plan.checkpoints} />
      </div>

      {due && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold"><Flag className="size-4 text-primary" />{tr('plan.cp_due', { n: due })}</div>
            <p className="text-xs text-muted-foreground">{tr(due === 90 ? 'plan.cp_due_desc_final' : 'plan.cp_due_desc')}</p>
          </div>
          <TaskButton task="plan-checkpoint" input={{ day: due }} onFinished={onChanged} icon={Sparkles}>{tr('plan.cp_run')}</TaskButton>
        </div>
      )}

      <Targets progress={data.progress ?? []} />
      <Summary plan={plan} current={plan.status === 'done' ? undefined : pos?.phase} />
      {plan.checkpoints.length > 0 && <Checkpoints list={plan.checkpoints} />}
      <Weeks ctx={ctx} items={data.items ?? []} currentWeek={plan.status === 'done' ? 99 : pos?.week ?? 1} onChanged={onChanged} />
    </div>
  )
}

function Timeline({ day, checkpoints }: { day: number; checkpoints: Checkpoint[] }) {
  return (
    <div className="relative pt-1 pb-5">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${(day / 90) * 100}%` }} />
      </div>
      {[30, 60, 90].map((d) => {
        const done = checkpoints.some((c) => c.day === d)
        return (
          <div key={d} className="absolute top-0 -translate-x-full text-right" style={{ left: `${(d / 90) * 100}%` }}>
            <div className={cx('ml-auto h-4 w-0.5', done ? 'bg-primary' : 'bg-border')} />
            <div className={cx('mt-0.5 whitespace-nowrap text-[11px]', done ? 'text-foreground' : 'text-muted-foreground')}>
              {done && <Check className="mr-0.5 inline size-3" />}Day {d}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 目标：三层分开看，每个指标 基线 → 现在 / 目标 */
function Targets({ progress }: { progress: Progress[] }) {
  if (!progress.length) return null
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {TIERS.map((tier) => {
        const list = progress.filter((p) => p.tier === tier)
        if (!list.length) return null
        return (
          <Panel key={tier} title={tr(`plan.tier_${tier}`)}>
            <p className="-mt-1 mb-3 text-xs text-muted-foreground">{tr(`plan.tier_${tier}_hint`)}</p>
            <ul className="space-y-3">
              {list.map((p) => (
                <li key={p.metric} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span>{p.label}</span>
                    <span className="tabular-nums">
                      <span className="text-muted-foreground">{fmt(p.baseline)} → </span>
                      <span className="font-semibold">{fmt(p.current)}</span>
                      <span className="text-muted-foreground"> / {fmt(p.target)}</span>
                    </span>
                  </div>
                  {p.current == null ? (
                    <p className="text-[11px] text-muted-foreground">{tr('plan.not_connected')}</p>
                  ) : (
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cx('h-full rounded-full', (p.pct ?? 0) >= 100 ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${p.pct ?? 0}%` }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )
      })}
    </div>
  )
}

function Checkpoints({ list }: { list: Checkpoint[] }) {
  const [open, setOpen] = useState<number | null>(list[list.length - 1]?.day ?? null)
  return (
    <Panel title={tr('plan.cp_title')}>
      <div className="divide-y divide-border">
        {list.map((c) => (
          <div key={c.day} className="py-2">
            <button type="button" onClick={() => setOpen(open === c.day ? null : c.day)} className="flex w-full cursor-pointer items-center justify-between gap-2 text-left text-sm font-medium">
              <span>Day {c.day} · <span className="font-normal text-muted-foreground">{String(c.at).slice(0, 10)}</span></span>
              <ChevronDown className={cx('size-4 text-muted-foreground transition-transform', open === c.day && 'rotate-180')} />
            </button>
            {open === c.day && (
              <div className="mt-2 space-y-3 text-sm">
                <p className="leading-relaxed">{c.summary}</p>
                <CpList title={tr('plan.cp_wins')} items={c.wins} />
                <CpList title={tr('plan.cp_issues')} items={c.issues} />
                <CpList title={tr('plan.cp_adjust')} items={c.adjustments} />
                {c.chat_id && (
                  <Button variant="ghost" size="sm" feedback={false} onClick={() => openChat(c.chat_id!)}>
                    <MessageSquareText /> {tr('plan.continue_chat')}
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}

function CpList({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  )
}

/**
 * 每周的事。执行中：本周在最上面，前几周没做完的挪进本周（标「第 N 周没做完」）；前几周做完的收起来；以后几周折叠。
 * 草稿：按周排开。
 */
function Weeks({ ctx, items, currentWeek = 0, onChanged, readOnly = false }: { ctx?: Ctx; items: Item[]; currentWeek?: number; onChanged: () => void; readOnly?: boolean }) {
  const [showLater, setShowLater] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const weeks = [...new Set(items.map((i) => i.week))].sort((a, b) => a - b)
  if (!weeks.length) return null
  const block = (w: number, list: Item[], head?: ReactNode) => (
    <div key={w} className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">{tr('plan.week', { n: w })}</span>
        {head}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {list.map((i) => <Row key={i.id} item={i} ctx={ctx} onChanged={onChanged} readOnly={readOnly} currentWeek={currentWeek} />)}
      </div>
    </div>
  )
  if (readOnly)
    return (
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">{tr('plan.first_weeks')}</h3>
        {weeks.map((w) => block(w, items.filter((i) => i.week === w)))}
      </section>
    )
  // 本周：先列前几周挪过来的，再列本周的；没做完的在前
  const open = (i: Item) => (i.status ? 1 : 0)
  const now = [...items.filter((i) => i.week < currentWeek && !i.status), ...items.filter((i) => i.week === currentWeek)].sort((a, b) => open(a) - open(b))
  const left = now.filter((i) => !i.status).length
  const past = items.filter((i) => i.week < currentWeek && i.status)
  const later = weeks.filter((w) => w > currentWeek)
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">{tr('plan.weekly')}</h3>
      {now.length > 0 && block(currentWeek, now, <>
        <Badge tone="ok">{tr('plan.this_week')}</Badge>
        <span className="text-muted-foreground">{left ? tr('plan.left', { n: left }) : tr('plan.all_done')}</span>
        <span className="text-muted-foreground">· {tr('plan.auto_hint')}</span>
      </>)}
      {later.length > 0 && (
        <div className="space-y-4">
          <Toggle open={showLater} onClick={() => setShowLater((v) => !v)}>{tr('plan.later', { n: later.length })}</Toggle>
          {showLater && later.map((w) => block(w, items.filter((i) => i.week === w)))}
        </div>
      )}
      {past.length > 0 && (
        <div className="space-y-4">
          <Toggle open={showPast} onClick={() => setShowPast((v) => !v)}>{tr('plan.past', { n: past.length })}</Toggle>
          {showPast && [...new Set(past.map((i) => i.week))].sort((a, b) => b - a).map((w) => block(w, past.filter((i) => i.week === w)))}
        </div>
      )}
    </section>
  )
}

function Toggle({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      {children}
      <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
    </button>
  )
}

function Row({ item: i, ctx, onChanged, readOnly, currentWeek }: { item: Item; ctx?: Ctx; onChanged: () => void; readOnly: boolean; currentWeek: number }) {
  const a = i.action
  const carried = !readOnly && !i.status && i.week < currentWeek
  return (
    <div className={cx('flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 last:border-b-0', i.status && 'opacity-60')}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {i.area && <Badge>{tr(`plan.area_${i.area}`)}</Badge>}
          <span className={cx('text-sm font-medium [overflow-wrap:anywhere]', i.status === 'skipped' && 'line-through')}>{i.title}</span>
          {i.status === 'done' && <Badge tone="ok">{tr(i.done_by === 'auto' ? 'plan.auto_done' : i.done_by === 'ai' ? 'plan.ai_done' : 'plan.done')}</Badge>}
          {i.status === 'skipped' && <Badge>{tr('plan.skipped')}</Badge>}
          {carried && <Badge tone="warn">{tr('plan.carried', { n: i.week })}</Badge>}
        </div>
        {i.status === 'done' && i.done_note ? (
          <p className="flex items-start gap-1 text-xs text-emerald-700 dark:text-emerald-400 [overflow-wrap:anywhere]"><Check className="mt-0.5 size-3 shrink-0" />{i.done_note}</p>
        ) : (
          i.why && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{i.why}</p>
        )}
      </div>
      {!readOnly && (
        <div className="flex shrink-0 items-center gap-1">
          {!i.status && a?.kind === 'go' && ctx && (
            <Button size="sm" feedback={false} onClick={() => ctx.go(a.view, a.params)}>
              {tr('plan.go')} <ArrowRight />
            </Button>
          )}
          {/* 交给助手的：带上这条计划项，助手做完自己标上 */}
          {!i.status && a?.kind === 'task' && (
            <TaskButton task={a.task} input={{ ...((a.input as object) ?? {}), plan_item_id: i.id }} onFinished={onChanged}>{tr('plan.go')}</TaskButton>
          )}
          <RowMenu item={i} onChanged={onChanged} />
        </div>
      )}
    </div>
  )
}

/** 手动标做完 / 不做 / 撤销：大多数会自动判断，收进「···」里 */
function RowMenu({ item: i, onChanged }: { item: Item; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const mark = (status: '' | 'done' | 'skipped') => async () => {
    await runLocal('plan.mark', { id: i.id, status })
    setOpen(false)
    onChanged()
  }
  const item = 'flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted'
  return (
    <div ref={ref} className="relative">
      <Button size="icon-sm" variant="ghost" feedback={false} aria-label={tr('plan.more')} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-background p-1 shadow-lg">
          {i.status ? (
            <button type="button" className={item} onClick={mark('')}>
              <Undo2 className="size-4" />{tr(i.done_by === 'auto' ? 'plan.undo_auto' : 'plan.undo')}
            </button>
          ) : (
            <>
              <button type="button" className={item} onClick={mark('done')}><Check className="size-4" />{tr('plan.mark_done')}</button>
              <button type="button" className={item} onClick={mark('skipped')}><X className="size-4" />{tr('plan.skip')}</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** 总览上的计划卡片：第几天、目标进度一行、这周还剩几件事、检查点到了 */
export function PlanCard({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<Data | null>(null)
  useEffect(() => void runLocal<Data>('plan.get', {}).then(setData).catch(() => setData(null)), [ctx.rev])
  if (!data) return null
  const plan = data.plan
  if (!plan || plan.status === 'draft')
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold">{plan ? tr('plan.card_draft') : tr('plan.card_none')}</div>
          <p className="text-xs text-muted-foreground">{plan ? tr('plan.card_draft_desc') : tr('plan.card_none_desc')}</p>
        </div>
        <Button size="sm" feedback={false} onClick={() => ctx.go('plan')}>{tr('plan.card_open')} <ArrowRight /></Button>
      </div>
    )
  const pos = data.position
  const left = (data.items ?? []).filter((i) => !i.status && i.week <= (pos?.week ?? 0)).length
  const key = (data.progress ?? []).filter((p) => p.tier !== 'process').slice(0, 3)
  return (
    <button type="button" onClick={() => ctx.go('plan')} className="block w-full cursor-pointer space-y-3 rounded-xl border border-border bg-background p-4 text-left hover:bg-muted/30">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm">
          <span className="font-semibold">{tr('plan.title')}</span>
          <span className="ml-2 text-muted-foreground">
            {plan.status === 'done' ? tr('plan.finished') : `${tr('plan.day', { n: Math.min(pos?.day ?? 1, 90) })} / 90 · ${tr(`plan.phase_name_${pos?.phase ?? 1}`)}`}
          </span>
        </div>
        <span className="text-xs">
          {data.checkpoint_due ? <span className="font-medium text-primary">{tr('plan.cp_due', { n: data.checkpoint_due })}</span> : plan.status !== 'done' && (left ? tr('plan.card_left', { n: left }) : tr('plan.all_done'))}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${(Math.min(pos?.day ?? 0, 90) / 90) * 100}%` }} />
      </div>
      {key.length > 0 && (
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          {key.map((p) => (
            <div key={p.metric} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{p.label}</span>
              <span className="tabular-nums"><span className="font-semibold">{fmt(p.current)}</span><span className="text-muted-foreground"> / {fmt(p.target)}</span></span>
            </div>
          ))}
        </div>
      )}
    </button>
  )
}
