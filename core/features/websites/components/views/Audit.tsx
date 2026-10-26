import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ExternalLink, RotateCw, Rocket } from 'lucide-react'
import AskButton from '../AskButton'
import RunButton from '../RunButton'
import { Badge, Button, Notice, PageHeader, Segmented, Skeleton, cx, fmtTime, type Tone } from '../ui'
import { dbList, dbPatch, newestFirst, type AuditRun, type IssueStatus, type Severity, type SiteChange, type SiteIssue, isSite } from '../../lib/shuttle'
import SitePicker from '../SitePicker'
import SeoReport from '../SeoReport'
import Select from '../Select'
import { useOnboarding, type OnboardingData } from '../../lib/onboarding'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

// label 按当前语言取（getter）
const lbl = (key: string, tone: Tone) => ({ get label() { return tr(key) }, tone })
const SEV: Record<Severity, { label: string; tone: Tone }> = {
  high: lbl('audit.sev_high', 'bad'),
  medium: lbl('audit.sev_medium', 'warn'),
  low: lbl('audit.sev_low', 'default'),
}
const STATUS: Record<IssueStatus, { label: string; tone: Tone }> = {
  open: lbl('audit.st_open', 'default'),
  fixing: lbl('audit.st_fixing', 'primary'),
  fixed: lbl('audit.st_fixed', 'ok'),
  ignored: lbl('audit.st_ignored', 'default'),
}

function parse<T>(s: string | undefined, fallback: T): T {
  try {
    const v = s ? JSON.parse(s) : fallback
    return Array.isArray(fallback) && !Array.isArray(v) ? fallback : v
  } catch {
    return fallback
  }
}

function pagesOf(i: SiteIssue): string[] {
  try {
    const v = JSON.parse(i.pages ?? '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** 站点体检：运营助手按 site-audit skill 抓取检查，结果写进 audit_runs / site_issues，这里展示 */
export default function Audit({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const { data, load: loadOnboarding } = useOnboarding(ctx.rev)
  const sites = ctx.channels.filter(isSite)
  const channel = sites.find((c) => c.id === params.channel) ?? sites.find((c) => c.id === data?.channel_id) ?? sites[0]
  const [runs, setRuns] = useState<AuditRun[] | null>(null)
  const [issues, setIssues] = useState<SiteIssue[] | null>(null)
  const [changes, setChanges] = useState<Record<string, SiteChange>>({}) // 已解决的问题进了改站复查：按问题 id 找最近一条
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'todo' | 'all'>('todo')

  const load = useCallback(() => {
    if (!channel) return
    Promise.all([dbList('audit_runs'), dbList('site_issues'), dbList('site_changes').catch(() => [] as SiteChange[])])
      .then(([r, i, c]) => {
        setRuns(newestFirst(r.filter((x) => x.channel_id === channel.id)))
        setIssues(i.filter((x) => x.channel_id === channel.id))
        const by: Record<string, SiteChange> = {}
        for (const x of c.filter((x) => x.kind === 'issue_fix').sort((a, b) => Date.parse(a.live_at) - Date.parse(b.live_at))) by[x.ref_id] = x
        setChanges(by)
      })
      .catch((e) => setError(e.message))
  }, [channel?.id])
  useEffect(() => {
    setRuns(null)
    setIssues(null)
    load()
  }, [load])
  // 助手改了数据：静默重拉，不清空
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])

  const shown = useMemo(() => {
    const order = { high: 0, medium: 1, low: 2 }
    return (issues ?? [])
      .filter((i) => filter === 'all' || i.status === 'open' || i.status === 'fixing')
      .sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
  }, [issues, filter])

  const external = !!data?.website_url && (!params.channel || params.channel === 'website-url')
  const picker = data?.website_url ? <div className="max-w-md"><Select value={external ? 'website-url' : channel?.id || ''} onChange={(v) => setParam('channel', v)} ariaLabel={tr('ui.pick_site')} options={[{ value: 'website-url', label: data.website_url }, ...sites.map((s) => ({ value: s.id, label: s.name }))]} /></div> : channel ? <SitePicker sites={sites} value={channel.id} onChange={(v) => setParam('channel', v)} /> : null
  if (external) return <div className="space-y-6"><PageHeader title={tr('audit.title')} desc={tr('audit.desc')} />{picker}<WebsiteAudit data={data!} ctx={ctx} onDone={() => { loadOnboarding(); ctx.checklist.load() }} /></div>
  if (!channel)
    return (
      <div className="space-y-6">
        <PageHeader title={tr('audit.title')} />
        <Notice>{tr('audit.no_site')}</Notice>
      </div>
    )

  const last = runs?.[0]
  // 「问题」是逐条处理的清单，「SEO 报告」是全站的概况和建议（SeoReport）；记在网址参数 audit_tab 里
  const tab = params.audit_tab === 'report' ? 'report' : 'issues'
  // 这次检查了、没扣分的项（老记录没有 passed，就不显示）
  const passed = parse<{ check: string; name: string }[]>(last?.passed, [])
  const todo = (issues ?? []).filter((i) => i.status === 'open')
  const fixing = (issues ?? []).filter((i) => i.status === 'fixing')

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('audit.title')}
        desc={tr('audit.desc')}
        actions={
          <Button variant="ghost" size="sm" onClick={load} className="text-muted-foreground">
            <RotateCw /> {tr('common.refresh')}
          </Button>
        }
      />
      {picker}
      {error && <Notice tone="error">{error}</Notice>}

      {runs === null ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : !last ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
          <div className="text-sm font-semibold">{tr('audit.never', { name: channel.name })}</div>
          <p className="mt-1 text-sm text-muted-foreground">{tr('audit.never_desc')}</p>
          <div className="mt-4 flex justify-center">
            <RunButton fn="audit.run" input={{ channel_id: channel.id }} onDone={load} size="default">
              {tr('audit.start')}
            </RunButton>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-5 rounded-xl border border-border bg-background px-5 py-4">
            <Score value={last.score ?? 0} />
            <div className="space-y-1 text-sm">
              <div className="font-semibold">
                {todo.length ? tr('audit.todo_n', { n: todo.length }) : tr('audit.todo_none')}
              </div>
              <div className="text-xs text-muted-foreground">
                {tr('audit.checked', { n: last.pages_checked ?? 0, when: fmtTime(last.finished_at || last.created_at) })}
              </div>
              {last.target_url && (
                <a href={last.target_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold hover:text-primary-text">
                  {last.target_url.replace(/^https?:\/\//, '')} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>
          <div className="grid min-w-0 gap-4 rounded-xl border border-border bg-background px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] sm:items-center">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{tr('audit.history')}</div>
              <div className="mt-2 flex min-h-11 items-end gap-1.5 overflow-hidden">
                {[...(runs ?? [])].slice(0, 12).reverse().map((r) => (
                  <div key={r.id} title={tr('audit.score_at', { score: r.score ?? 0, when: fmtTime(r.finished_at || r.created_at) })} className="w-3 shrink-0 rounded-t-[3px] bg-primary/70" style={{ height: `${Math.max(6, ((r.score ?? 0) / 100) * 44)}px` }} />
                ))}
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
              <RunButton inline fn="audit.run" input={{ channel_id: channel.id }} onDone={load} variant="outline">
                {tr('audit.rerun')}
              </RunButton>
              {todo.length > 0 && (
                <AskButton
                  variant="default"
                  prompt={
                    channel.type === 'wordpress'
                      ? tr('audit.fix_all_wp', { name: channel.name, id: channel.id, url: channel.preview_url ?? '' })
                      : tr('audit.fix_all', { name: channel.name, id: channel.id, ref: `${channel.project_id}/${channel.site_id}` })
                  }
                >
                  {tr('audit.fix_all_btn')}
                </AskButton>
              )}
            </div>
          </div>
        </div>
      )}

      {last && (
        <Segmented
          value={tab}
          onChange={(v) => setParam('audit_tab', v === 'issues' ? '' : v)}
          options={[
            { value: 'issues', label: tr('audit.tab_issues') },
            { value: 'report', label: tr('audit.tab_report') },
          ]}
        />
      )}

      {tab === 'report' && last && <SeoReport ctx={ctx} channel={channel} onIssues={() => setParam('audit_tab', '')} />}

      {tab === 'issues' && fixing.length > 0 && channel.type === 'creght_site' && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <div className="font-semibold">{tr('audit.fixing_n', { n: fixing.length })}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {tr('audit.fixing_desc')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {channel.preview_url && (
              <a href={channel.preview_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold hover:text-primary-text">
                {tr('audit.open_preview')} <ExternalLink className="size-3" />
              </a>
            )}
            <RunButton inline fn="audit.publish" input={{ channel_id: channel.id }} onDone={load} icon={Rocket}>
              {tr('audit.go_live')}
            </RunButton>
          </div>
        </div>
      )}

      {tab === 'issues' && issues && issues.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{tr('audit.issues')}</h2>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todo', label: tr('audit.f_todo') },
                { value: 'all', label: tr('audit.f_all', { n: issues.length }) },
              ]}
            />
          </div>
          {shown.length === 0 ? (
            <Notice>{tr('audit.no_todo')}</Notice>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              {shown.map((i) => (
                <IssueRow key={i.id} i={i} change={changes[i.id]} ctx={ctx} channelLabel={channel.type === 'wordpress' ? tr('audit.label_wp', { name: channel.name, url: channel.preview_url ?? '' }) : tr('audit.label', { name: channel.name, ref: `${channel.project_id}/${channel.site_id}` })}
                  wordpress={channel.type === 'wordpress'} onChanged={load} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'issues' && passed.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold">{tr('audit.passed_title', { n: passed.length })}</h2>
            <span className="text-xs text-muted-foreground">{tr('audit.passed_hint')}</span>
          </div>
          <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-background p-4">
            {passed.map((p) => (
              <span key={p.check} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
                <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />{p.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function WebsiteAudit({ data, ctx, onDone }: { data: OnboardingData; ctx: Ctx; onDone: () => void }) {
  const result = data.audit_result
  return <div className="space-y-4">
    {data.audit_note && <Notice tone="error">{data.audit_note}</Notice>}
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-background p-5">
      {result && <Score value={result.score} />}
      <div className="min-w-0 flex-1 space-y-1"><a href={data.website_url} target="_blank" rel="noreferrer" className="break-all text-sm font-medium text-primary-text">{data.website_url}</a><p className="text-xs text-muted-foreground">{result ? tr('onboarding.audit_summary', { score: result.score, pages: result.pages, high: result.issues?.high || 0, medium: result.issues?.medium || 0, low: result.issues?.low || 0 }) : tr('audit.never_desc')}</p></div>
      <RunButton fn="onboarding.audit" input={{ revision: data.revision }} onDone={onDone} variant="outline">{tr(result ? 'audit.rerun' : 'audit.start')}</RunButton>
    </div>
    {result?.found?.map((issue, i) => <details key={issue.check + i} className="rounded-xl border border-border bg-background p-4"><summary className="cursor-pointer text-sm font-medium">{issue.title}</summary><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{issue.detail}</p><ul className="mt-2 space-y-1">{issue.pages.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="break-all text-xs text-primary-text">{url}</a></li>)}</ul></details>)}
    {!result?.found?.length && result?.top?.map((title) => <p key={title} className="text-sm text-muted-foreground">{title}</p>)}
  </div>
}

function Score({ value }: { value: number }) {
  const tone = value >= 90 ? 'text-emerald-600 dark:text-emerald-400' : value >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="relative size-16 shrink-0" role="img" aria-label={tr('audit.score_aria', { n: value })}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} className={tone} />
      </svg>
      <span className={cx('absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums', tone)}>{value}</span>
    </div>
  )
}

function IssueRow({ i, change, ctx, channelLabel, wordpress, onChanged }: { i: SiteIssue; change?: SiteChange; ctx: Ctx; channelLabel: string; wordpress?: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const pages = pagesOf(i)
  const sev = SEV[i.severity] ?? SEV.low
  const st = STATUS[i.status] ?? STATUS.open
  const setStatus = async (status: IssueStatus) => {
    await dbPatch('site_issues', i.id, { status })
    onChanged()
  }
  return (
    <div className={cx('border-b border-border last:border-b-0', (i.status === 'fixed' || i.status === 'ignored') && 'opacity-60')}>
      {/* 手机上按钮换到下一行、和文字左对齐（徽标 w-10 + gap-3 = 52px），不把标题和说明挤成一列 */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 sm:flex-nowrap">
        <Badge tone={sev.tone} className="mt-0.5 w-10 justify-center">
          {sev.label}
        </Badge>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{i.title}</span>
            {i.status !== 'open' && <Badge tone={st.tone}>{st.label}</Badge>}
            {i.status === 'fixed' && change && (
              <span title={change.summary || tr('audit.review_hint')}>
                <Badge tone={change.verdict === 'better' ? 'ok' : change.verdict === 'worse' ? 'bad' : 'default'}>
                  {change.status === 'waiting' ? tr('audit.reviewing') : change.status === 'no_data' ? tr('audit.review_no_data') : tr('audit.review_v', { v: tr(`overview.v_${change.verdict ?? 'flat'}`) })}
                </Badge>
              </span>
            )}
            {pages.length > 0 && <span className="text-xs text-muted-foreground">{tr('audit.pages_n', { n: pages.length })}</span>}
            <ChevronDown className={cx('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </div>
          {i.detail && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{i.detail}</p>}
        </button>
        <div className="flex w-full shrink-0 items-center gap-1 pl-[52px] sm:w-auto sm:pl-0">
          {i.status === 'open' && (
            <AskButton
              variant="ghost"
              className="text-primary-text"
              prompt={tr('audit.fix_one', { label: channelLabel, title: i.title, id: i.id, check: i.check, pages: pages.slice(0, 10).join(', ') }) + tr(wordpress ? 'audit.fix_one_wp' : 'audit.fix_one_tail')}
            >
              {tr('audit.fix_one_btn')}
            </AskButton>
          )}
          {i.status === 'ignored' ? (
            <Button variant="ghost" size="sm" onClick={() => setStatus('open')} className="text-muted-foreground">
              {tr('audit.restore')}
            </Button>
          ) : i.status === 'open' ? (
            <Button variant="ghost" size="sm" onClick={() => setStatus('ignored')} className="text-muted-foreground" title={tr('audit.ignore_title')}>
              {tr('audit.ignore')}
            </Button>
          ) : null}
        </div>
      </div>
      {open && pages.length > 0 && (
        <ul className="space-y-1 px-4 pb-3 pl-[68px]">
          {pages.map((p) => (
            <li key={p}>
              <a href={p} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate font-mono text-xs text-muted-foreground hover:text-primary-text">
                <span className="truncate">{p}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
