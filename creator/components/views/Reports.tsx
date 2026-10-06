import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, ChevronLeft, ClipboardList, Lightbulb, Loader2, RotateCw, Sparkles } from 'lucide-react'
import Markdown from '../Markdown'
import { Badge, Button, Notice, PageHeader, Panel, Skeleton, cx, fmtTime } from '../ui'
import { dbList, listSchedules, type Report, type ReportHighlight, type ReportSuggestion, type Schedule } from '../../lib/shuttle'
import { TaskFailed, TaskRequirements, TaskRunning, useTask } from '../Task'
import type { Ctx, View } from './types'
import type { ChecklistItem } from '../../lib/useChecklist'
import { numLocale, tr } from '../../lib/i18n'
import { useInShuttle } from '../../lib/useShuttle'

/** 任务 id（tasks/weekly-report.md）：周报页的按钮和每 7 天的定时任务都按它交给助手 */
export const REPORT_TASK = 'weekly-report'

export function jsonList<T>(s?: string): T[] {
  try {
    const v = JSON.parse(s || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** 按周期从新到旧 */
export const byPeriod = (list: Report[]) => [...list].sort((a, b) => b.period_end.localeCompare(a.period_end) || b.period_start.localeCompare(a.period_start))

const period = (r: Report) => `${r.period_start.slice(5).replace('-', '/')} – ${r.period_end.slice(5).replace('-', '/')}`
const deltaTone = (d?: string) => (!d ? 'text-muted-foreground' : /^[+↑]/.test(d.trim()) ? 'text-emerald-600 dark:text-emerald-400' : /^[-−↓]/.test(d.trim()) ? 'text-destructive' : 'text-muted-foreground')

/** 运营周报：助手按任务 tasks/weekly-report.md 写（每 7 天定时，或点按钮），数字来自 reports.data；要求用户能在页面上改 */
export default function Reports({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const [list, setList] = useState<Report[] | null>(null)
  const [error, setError] = useState('')
  const [job, setJob] = useState<Schedule | null>(null) // 定时任务：显示下次什么时候自动写

  const load = useCallback(() => {
    dbList('reports')
      .then((l) => {
        setList(byPeriod(l))
        setError('')
      })
      .catch((e: Error) => {
        if (/没有这张表|table not found/i.test(e.message)) setList([])
        else setError(e.message)
      })
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])

  const { task, setTask, error: runError, starting, run, shuttle } = useTask(REPORT_TASK, load)
  useEffect(() => {
    if (shuttle)
      listSchedules()
        .then((l) => setJob(l.find((x) => x.task === REPORT_TASK || x.id === REPORT_TASK) ?? null))
        .catch(() => {})
  }, [shuttle, task?.running.length])

  const running = !!task?.running.length
  const current = list?.find((r) => r.id === params.report)

  const action = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={load} className="text-muted-foreground">
        <RotateCw /> {tr('common.refresh')}
      </Button>
      <TaskRequirements task={task} onSaved={setTask} title={tr('reports.req_title')} hint={tr('reports.req_hint')} />
      <Button size="sm" onClick={() => run()} disabled={!shuttle || running || starting || ctx.offline} title={shuttle ? tr('reports.gen_title') : tr('reports.gen_offline')}>
        {running || starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {running ? tr('reports.writing') : tr('reports.generate')}
      </Button>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader title={tr('reports.title')} desc={tr('reports.desc')} actions={action} />
      {(error || runError) && <Notice tone="error">{error || runError}</Notice>}
      {task && <TaskRunning runs={task.running} title={() => tr('reports.running_title')} desc={tr('reports.running_desc')} />}
      <TaskFailed task={task} />

      {list === null ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : current ? (
        <ReportDetail ctx={ctx} r={current} onBack={() => setParam('report', '')} />
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
          <ClipboardList className="mx-auto size-6 text-muted-foreground" />
          <div className="mt-2 text-sm font-semibold">{tr('reports.empty')}</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {job ? (job.next_at && !job.disabled ? tr('reports.auto_next', { when: fmtTime(job.next_at) || new Date(job.next_at).toLocaleString(numLocale()) }) : tr('reports.auto')) : ''}{tr('reports.empty_tail')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {list.map((r, i) => (
            <button key={r.id} onClick={() => setParam('report', r.id)} className="flex w-full cursor-pointer items-start gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{period(r)}</span>
                  {i === 0 && <Badge tone="primary">{tr('reports.latest')}</Badge>}
                </div>
                {r.summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{r.summary}</p>}
              </div>
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const VIEWS: View[] = ['overview', 'reports', 'company', 'content', 'calendar', 'assets', 'social', 'channels']

/** 建议点了去哪：先用 link；老周报只有 action 文字，按起步配置的标题、侧栏的页面名猜，猜不到就不做成链接 */
function suggestionTarget(ctx: Ctx, s: ReportSuggestion): (() => void) | null {
  const setup = ctx.checklist.data?.setup ?? []
  const openSetup = (it: ChecklistItem) => () => {
    if (it.wizard && it.screen) return ctx.openWizard(it.key)
    if (it.action.kind === 'go') return ctx.go(it.action.view as View, it.action.params)
    ctx.go('overview')
    if (!ctx.setupOpen) ctx.toggleSetup()
  }
  const link = s.link
  if (link?.setup) {
    const it = setup.find((x) => x.key === link.setup)
    if (it) return openSetup(it)
  }
  if (link?.view && VIEWS.includes(link.view as View)) return () => ctx.go(link.view as View, link.params)
  const text = `${s.title} ${s.action ?? ''}`
  const it = setup.find((x) => x.title && text.includes(x.title))
  if (it) return openSetup(it)
  const first = (s.action ?? '').split(/[→>]/)[0].trim()
  const view = first && VIEWS.find((v) => tr('nav.' + v) === first)
  return view ? () => ctx.go(view) : null
}

function SuggestionAction({ text, onClick }: { text: string; onClick: (() => void) | null }) {
  if (!onClick) return <p className="mt-1 text-xs font-medium text-muted-foreground">{text}</p>
  return (
    <button type="button" onClick={onClick} className="mt-1 inline-flex cursor-pointer items-center gap-0.5 text-left text-xs font-medium text-primary-text hover:underline">
      {text}
      <ArrowUpRight className="size-3 shrink-0" />
    </button>
  )
}

function ReportDetail({ ctx, r, onBack }: { ctx: Ctx; r: Report; onBack: () => void }) {
  const shuttle = useInShuttle()
  const highlights = jsonList<ReportHighlight>(r.highlights)
  const suggestions = jsonList<ReportSuggestion>(r.suggestions)
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-3.5" /> {tr('reports.all')}
      </button>
      <div>
        <h2 className="text-base font-semibold">{r.title}</h2>
        <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {r.period_start} ~ {r.period_end}
          {r.created_at ? tr('reports.written_at', { when: fmtTime(r.created_at) }) : ''}
          {r.chat_id && shuttle && (
            <button
              onClick={() => window.parent.postMessage({ type: 'shuttle:open-chat', chat_id: r.chat_id }, window.location.origin)}
              className="ml-2 cursor-pointer font-medium text-primary-text hover:underline"
            >
              {tr('reports.view_chat')}
            </button>
          )}
        </div>
        {r.summary && <p className="mt-2 text-sm leading-relaxed">{r.summary}</p>}
      </div>

      {highlights.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {highlights.map((h, i) => (
            <div key={i} className="rounded-xl border border-border bg-background px-3 py-2.5">
              <div className="truncate text-xs text-muted-foreground">{h.label}</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums">{h.value}</span>
                {h.delta && <span className={cx('text-xs font-medium tabular-nums', deltaTone(h.delta))}>{h.delta}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <Panel title={<span className="inline-flex items-center gap-1.5"><Lightbulb className="size-4" /> {tr('reports.next_week')}</span>}>
          <ol className="space-y-3">
            {suggestions.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary-text">{i + 1}</span>
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{s.title}</div>
                  {s.why && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.why}</p>}
                  {s.action && <SuggestionAction text={s.action} onClick={suggestionTarget(ctx, s)} />}
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {r.body && (
        <Panel>
          <Markdown text={r.body} />
        </Panel>
      )}
    </div>
  )
}
