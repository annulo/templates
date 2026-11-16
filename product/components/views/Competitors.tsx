import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Lightbulb, Pause, Play, Plus, RefreshCw, Scale, ScanSearch, Sparkles, Trash2, WandSparkles, X } from 'lucide-react'
import RunButton from '../RunButton'
import Markdown from '../Markdown'
import { Badge, Button, Dialog, Field, Notice, PageHeader, Panel, Segmented, Skeleton, cx, fmtTime, inputCls, type Tone } from '../ui'
import { TaskButton, TaskLaunchButton } from '../Task'
import Playbook from '../Playbook'
import { runLocal } from '../../lib/shuttle'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

/** 任务 id：tasks/competitor-overview.md、tasks/competitor-compare.md */
const OVERVIEW_TASK = 'competitor-overview'
const COMPARE_TASK = 'competitor-compare'
/** tasks/competitor-suggest.md：AI 联网找同行，存成候选（status=suggested），用户确认了才加进监控 */
const SUGGEST_TASK = 'competitor-suggest'
/** tasks/suggest-topics.md 的「从竞品新页面出选题」：勾几条新发现，交给助手按买家的问题出我们的选题 */
const TOPICS_TASK = 'suggest-topics'

type Kind = 'product' | 'blog' | 'landing' | 'other'
type Competitor = {
  id: string
  name: string
  url: string
  host: string
  reason?: string
  source?: string
  status?: string
  pages_total?: number
  counts: Partial<Record<Kind, number>>
  baseline_at?: string
  scanned_at?: string
  error?: string
  new_total: number
  new_unseen: number
  new_week: number
  /** 最近更新的几个页面（带标题），每次读完更新 */
  recent?: { url: string; kind: Kind; lastmod: string; title: string; description: string }[]
}
type Discovery = { id: string; competitor_id: string; url: string; kind: Kind; title?: string; description?: string; first_seen: string; seen?: boolean; topic_id?: string }
type Suggestion = { id: string; name: string; url: string; host: string; kind?: 'direct' | 'brand' | 'channel'; reason?: string; evidence?: string; source?: string }
type Report = { id: string; title: string; body: string; created_at: string; competitors: { id: string; name: string }[] }

const KIND_TONE: Record<Kind, Tone> = { product: 'ok', blog: 'primary', landing: 'warn', other: 'default' }
const REL_TONE: Record<string, Tone> = { direct: 'warn', brand: 'primary', channel: 'default' }
const pathOf = (u: string) => {
  try {
    const x = new URL(u)
    return decodeURIComponent(x.pathname) || '/'
  } catch {
    return u
  }
}

/**
 * 竞品监控：每天读竞品网站的 sitemap（competitors.scan），新上的产品页、文章、落地页列在「新发现」，能转成选题；
 * 竞对总览、规格对比交给助手写（任务），存成竞品分析显示在下面。
 */
export default function Competitors({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<{ competitors: Competitor[]; discoveries: Discovery[]; suggestions?: Suggestion[] } | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [error, setError] = useState('')
  const [kind, setKind] = useState<'all' | Kind>('all')
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [open, setOpen] = useState('')

  const load = useCallback(() => {
    runLocal<{ competitors: Competitor[]; discoveries: Discovery[]; suggestions?: Suggestion[] }>('competitors.list', {})
      .then(setData)
      .catch((e) => setError(e.message))
    runLocal<Report[]>('competitors.reports', { limit: 10 })
      .then(setReports)
      .catch(() => {})
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])

  const comps = data?.competitors ?? []
  const name = (id: string) => comps.find((c) => c.id === id)?.name ?? ''
  const shown = (data?.discoveries ?? []).filter((d) => kind === 'all' || d.kind === kind)
  const unseen = (data?.discoveries ?? []).filter((d) => !d.seen).length
  const lastScan = comps.map((c) => c.scanned_at ?? '').sort().pop()

  const act = async (fn: string, input: unknown) => {
    setError('')
    try {
      await runLocal(fn, input)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('competitors.title')}
        desc={tr('competitors.desc')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {lastScan && <span className="text-xs text-muted-foreground">{tr('competitors.last_scan', { when: fmtTime(lastScan) })}</span>}
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus /> {tr('competitors.add')}
            </Button>
            <RunButton inline variant="outline" fn="competitors.scan" input={{ browser: true }} icon={RefreshCw} onDone={load}>
              {tr('competitors.scan')}
            </RunButton>
            <TaskButton task={SUGGEST_TASK} input={{}} onFinished={load} variant="outline" icon={ScanSearch}>
              {tr('competitors.suggest')}
            </TaskButton>
            <TaskButton task={OVERVIEW_TASK} input={{}} onFinished={load} icon={Sparkles} disabled={!comps.length}>
              {tr('competitors.overview')}
            </TaskButton>
          </div>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={tr('competitors.m_watching')} value={data ? comps.filter((c) => c.status !== 'paused').length : undefined} />
        <Stat label={tr('competitors.m_week')} value={data ? comps.reduce((n, c) => n + c.new_week, 0) : undefined} />
        <Stat label={tr('competitors.m_unseen')} value={data ? unseen : undefined} />
        <Stat label={tr('competitors.m_pages')} value={data ? comps.reduce((n, c) => n + (c.pages_total ?? 0), 0) : undefined} />
      </div>

      {!!data?.suggestions?.length && <Suggestions list={data.suggestions} onChanged={load} />}

      {data === null ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : comps.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-border p-6 text-sm">
          <p className="font-medium">{tr('competitors.empty_title')}</p>
          <p className="text-muted-foreground">{tr('competitors.empty')}</p>
          <div className="flex flex-wrap gap-2">
            <TaskButton task={SUGGEST_TASK} input={{}} onFinished={load} icon={ScanSearch}>
              {tr('competitors.suggest')}
            </TaskButton>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus /> {tr('competitors.add')}
            </Button>
            <RunButton inline variant="outline" fn="competitors.scan" input={{ browser: true }} icon={RefreshCw} onDone={load}>
              {tr('competitors.import')}
            </RunButton>
          </div>
        </div>
      ) : (
        <>
          <Panel
            title={tr('competitors.discoveries')}
            aside={
              <div className="flex items-center gap-2">
                <Segmented
                  value={kind}
                  onChange={setKind}
                  options={(['all', 'product', 'blog', 'landing'] as const).map((k) => ({ value: k, label: tr(`competitors.k_${k}`) }))}
                />
                {unseen > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => act('competitors.markSeen', {})}>
                    <Check /> {tr('competitors.mark_all')}
                  </Button>
                )}
                {picked.length > 0 && (
                  <TaskLaunchButton
                    task={TOPICS_TASK}
                    reqKey="topic_requirements"
                    input={{ competitor_page_ids: picked }}
                    match={(r) => !!(r.input as any)?.competitor_page_ids}
                    onFinished={() => {
                      setPicked([])
                      load()
                    }}
                    title={tr('competitors.pick_topics')}
                    desc={tr('competitors.pick_topics_desc', { n: picked.length })}
                    reqTitle={tr('competitors.pick_req')}
                    reqHint={tr('competitors.pick_req_hint')}
                    startLabel={tr('competitors.pick_start')}
                    icon={Lightbulb}
                  >
                    {tr('competitors.pick_topics_n', { n: picked.length })}
                  </TaskLaunchButton>
                )}
              </div>
            }
          >
            {shown.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{comps.some((c) => c.baseline_at) ? tr('competitors.no_new') : tr('competitors.no_baseline')}</p>
                {/* 刚加进来、还没有新页面：先看各家最近更新了什么 */}
                {kind === 'all' && comps.some((c) => c.recent?.length) && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">{tr('competitors.recent_all')}</p>
                    <ul className="space-y-1.5">
                      {comps.flatMap((c) => (c.recent ?? []).slice(0, 5).map((p) => ({ ...p, name: c.name }))).map((p) => (
                        <li key={p.url} className="flex min-w-0 items-center gap-2 text-xs">
                          <span className="shrink-0 font-medium">{p.name}</span>
                          <Badge tone={KIND_TONE[p.kind] ?? 'default'}>{tr(`competitors.k_${p.kind}`)}</Badge>
                          <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline" title={p.url}>
                            {p.title || pathOf(p.url)}
                          </a>
                          {p.lastmod && <span className="ml-auto shrink-0 text-muted-foreground">{fmtTime(p.lastmod)}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <ul className="-mx-2 divide-y divide-border">
                {shown.map((d) => (
                  <li key={d.id} className={cx('flex flex-col gap-2 px-2 py-2.5 sm:flex-row sm:items-center', !d.seen && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
                    {!d.topic_id && (
                      <input
                        type="checkbox"
                        aria-label={tr('competitors.pick')}
                        checked={picked.includes(d.id)}
                        onChange={(e) => setPicked((v) => (e.target.checked ? [...v, d.id] : v.filter((x) => x !== d.id)))}
                        className="size-4 shrink-0 cursor-pointer accent-primary"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {!d.seen && <span className="inline-flex h-4 items-center rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">{tr('article.new_badge')}</span>}
                        <span className="font-medium">{name(d.competitor_id)}</span>
                        <Badge tone={KIND_TONE[d.kind]}>{tr(`competitors.k_${d.kind}`)}</Badge>
                        <span className="text-xs text-muted-foreground">{fmtTime(d.first_seen)}</span>
                      </div>
                      <a href={d.url} target="_blank" rel="noreferrer" onClick={() => !d.seen && act('competitors.markSeen', { ids: [d.id] })} className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline" title={d.url}>
                        {d.title || pathOf(d.url)}
                      </a>
                      {d.description && <p className="line-clamp-2 text-xs text-muted-foreground/80 [overflow-wrap:anywhere]">{d.description}</p>}
                    </div>
                    {d.topic_id ? (
                      <Button variant="ghost" size="sm" onClick={() => ctx.go('content', { tab: 'topics' })}>
                        <Check /> {tr('competitors.topic_done')}
                      </Button>
                    ) : (
                      <RunButton inline variant="outline" fn="competitors.toTopic" input={{ page_id: d.id }} icon={Lightbulb} onDone={load}>
                        {tr('competitors.to_topic')}
                      </RunButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={tr('competitors.list')}>
            <ul className="-mx-2 divide-y divide-border">
              {comps.map((c) => (
                <li key={c.id} className={cx('flex flex-col gap-3 px-2 py-3 md:flex-row md:flex-wrap md:items-center', c.status === 'paused' && 'opacity-60')}>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{c.name}</span>
                      <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                        {c.host} <ExternalLink className="size-3" />
                      </a>
                      {c.status === 'paused' && <Badge>{tr('competitors.paused')}</Badge>}
                      {c.new_unseen > 0 && <Badge tone="primary">{tr('competitors.new_n', { n: c.new_unseen })}</Badge>}
                    </div>
                    {c.error ? (
                      <p className="text-xs text-destructive">{c.error}</p>
                    ) : c.scanned_at ? (
                      <p className="text-xs text-muted-foreground">
                        {tr('competitors.counts', { total: c.pages_total ?? 0, product: c.counts.product ?? 0, blog: c.counts.blog ?? 0, landing: c.counts.landing ?? 0 })} · {fmtTime(c.scanned_at)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{tr('competitors.not_scanned')}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button variant={open === c.id ? 'default' : 'outline'} size="sm" onClick={() => setOpen(open === c.id ? '' : c.id)}>
                      <WandSparkles /> {tr('competitors.playbook')} <ChevronDown className={cx('transition-transform', open === c.id && 'rotate-180')} />
                    </Button>
                    <TaskButton task={COMPARE_TASK} input={{ id: c.id }} match={(r) => r.input?.id === c.id} onFinished={load} variant="outline" icon={Scale}>
                      {tr('competitors.compare')}
                    </TaskButton>
                    <Button variant="ghost" size="sm" onClick={() => act('competitors.pause', { id: c.id, paused: c.status !== 'paused' })} title={c.status === 'paused' ? tr('competitors.resume') : tr('competitors.pause')}>
                      {c.status === 'paused' ? <Play /> : <Pause />}
                    </Button>
                    <DeleteButton onConfirm={() => act('competitors.remove', { id: c.id })} />
                  </div>
                  {open === c.id && <CompetitorDetail c={c} onChanged={load} />}
                </li>
              ))}
            </ul>
          </Panel>

          {reports.length > 0 && (
            <Panel title={tr('competitors.reports')}>
              <div className="space-y-2">
                {reports.map((r) => (
                  <details key={r.id} className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      {r.title} <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtTime(r.created_at)}</span>
                    </summary>
                    <Markdown text={r.body} className="mt-3 text-sm" />
                  </details>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}

      {adding && <AddCompetitor onClose={() => setAdding(false)} onDone={load} />}
    </div>
  )
}

/** AI 推荐的竞品：确认了才加进监控（马上读一次网站地图），不要的记着、下次不再推荐 */
function Suggestions({ list, onChanged }: { list: Suggestion[]; onChanged: () => void }) {
  return (
    <Panel title={tr('competitors.suggested', { n: list.length })} aside={<span className="text-xs text-muted-foreground">{tr('competitors.suggested_hint')}</span>}>
      <ul className="-mx-2 divide-y divide-border">
        {list.map((c) => (
          <li key={c.id} className="flex flex-col gap-3 bg-primary/5 px-2 py-3 shadow-[inset_3px_0_0_var(--color-primary)] md:flex-row md:items-center">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{c.name}</span>
                <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                  {c.host} <ExternalLink className="size-3" />
                </a>
                {c.kind && <Badge tone={REL_TONE[c.kind] ?? 'default'}>{tr(`competitors.rel_${c.kind}`)}</Badge>}
                {c.source === 'geo' && <Badge tone="primary">{tr('competitors.from_geo')}</Badge>}
              </div>
              {c.reason && <p className="text-xs [overflow-wrap:anywhere]">{c.reason}</p>}
              {c.evidence && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{tr('competitors.evidence', { e: c.evidence })}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <RunButton inline fn="competitors.accept" input={{ id: c.id }} icon={Plus} onDone={onChanged}>
                {tr('competitors.accept')}
              </RunButton>
              <RunButton inline variant="ghost" fn="competitors.reject" input={{ id: c.id }} icon={X} onDone={onChanged}>
                {tr('competitors.reject')}
              </RunButton>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** 展开一家竞品：最近更新的页面（加进监控马上就有）、它的打法卡（风格卡，照它出选题、写文章） */
function CompetitorDetail({ c, onChanged }: { c: Competitor; onChanged: () => void }) {
  return (
    <div className="w-full space-y-4 rounded-lg bg-muted/30 p-4">
      {!!c.recent?.length && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{tr('competitors.recent')}</h4>
          <ul className="space-y-1.5">
            {c.recent.map((p) => (
              <li key={p.url} className="flex min-w-0 items-start gap-2 text-xs">
                <Badge tone={KIND_TONE[p.kind] ?? 'default'}>{tr(`competitors.k_${p.kind}`)}</Badge>
                <div className="min-w-0 flex-1">
                  <a href={p.url} target="_blank" rel="noreferrer" className="block truncate hover:underline" title={p.url}>
                    {p.title || pathOf(p.url)}
                  </a>
                  {p.description && <p className="line-clamp-1 text-muted-foreground">{p.description}</p>}
                </div>
                {p.lastmod && <span className="shrink-0 text-muted-foreground">{fmtTime(p.lastmod)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Playbook creatorId={c.id} subjectType="competitor" workspace="website" onSource={(u) => /^https?:\/\//.test(u) && window.open(u, '_blank', 'noopener')} onChanged={onChanged} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value ?? '…'}</div>
    </div>
  )
}

function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  return (
    <Button variant="ghost" size="sm" className={cx(armed && 'text-destructive')} onClick={() => (armed ? onConfirm() : setArmed(true))} onBlur={() => setArmed(false)} title={tr('competitors.remove')}>
      <Trash2 /> {armed && tr('competitors.remove_confirm')}
    </Button>
  )
}

function AddCompetitor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await runLocal<{ errors?: string[] }>('competitors.add', { url, name })
      onDone()
      if (r?.errors?.length) setErr(r.errors.join('\n'))
      else onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr('competitors.add')}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{tr('competitors.cancel')}</Button>
          <Button size="sm" disabled={busy || !url.trim()} onClick={save}>
            {busy && <RefreshCw className="animate-spin" />} {tr('competitors.add_save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={tr('competitors.url_label')} hint={tr('competitors.url_hint')}>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="competitor.com" className={inputCls} />
        </Field>
        <Field label={tr('competitors.name_label')}>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        {err && <Notice tone="error">{err}</Notice>}
      </div>
    </Dialog>
  )
}
