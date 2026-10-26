import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, MessageSquareText, RotateCw, Sparkles } from 'lucide-react'
import RunButton from './RunButton'
import Markdown from './Markdown'
import { TaskButton, TaskRequirements, useTask } from './Task'
import { Badge, Button, Notice, Skeleton, cx, fmtTime, type Tone } from './ui'
import { openChat, runLocal, type Channel } from '../lib/shuttle'
import type { Ctx } from './views/types'
import { numLocale, tr } from '../lib/i18n'

/** 任务 id（tasks/seo-review.md）：AI 每类页面挑几页真读一遍，记下规则查不出的问题、写全站优化方案；写法用户可改 */
const PLAN_TASK = 'seo-review'

type IndexState = 'indexed' | 'crawled' | 'discovered' | 'unknown' | 'duplicate' | 'alternate' | 'excluded'
/** audit.report 的返回 */
type Report = {
  channel: { id: string; name: string; gsc?: boolean }
  run: { id: string; target_url: string; pages_checked: number; sitemap_pages: number | null; score: number; finished_at: string } | null
  categories?: Record<'tech' | 'page' | 'content' | 'ai', number> | null
  index?: { pages: number; checked: number; inspected_now: number; by_state: Partial<Record<IndexState, number>>; sitemaps: { path: string; submitted: number; last_read: string; errors: number }[] } | null
  search?: { clicks: number; impressions: number; prev_clicks: number; pages_with_impressions: number; striking_distance: number; low_ctr: number } | null
  suggestions?: { key: string; impact: number; severity: 'high' | 'medium' | 'low'; pages: number; issues: { id: string; check: string; title: string; severity: string; status: string; pages: number }[] }[]
  plan?: { text: string; at: string; chat_id: string; stale: boolean } | null
}

const SEV_TONE: Record<string, Tone> = { high: 'bad', medium: 'warn', low: 'default' }
const STATES: IndexState[] = ['indexed', 'crawled', 'discovered', 'unknown', 'duplicate', 'excluded']
const num = (n: number) => n.toLocaleString(numLocale())
const scoreTone = (n: number) => (n >= 85 ? 'text-emerald-600 dark:text-emerald-400' : n >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-destructive')

/**
 * SEO 报告（网站检查的「报告」标签）：总分和四类得分、谷歌收录、搜索表现、按影响排好的全站建议、AI 写的优化方案。
 * 数据都来自 audit.report（最近一次网站检查 + Search Console），这里只展示；AI 审查和方案由助手按 tasks/seo-review.md 做
 */
/** onRan：报告里点「重新检查」跑完后，让整页（顶部得分卡、问题清单）一起重读 */
export default function SeoReport({ ctx, channel, onIssues, onRan }: { ctx: Ctx; channel: Channel; onIssues: () => void; onRan?: () => void }) {
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    runLocal<Report>('audit.report', { channel_id: channel.id })
      .then((r) => {
        setData(r)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
  }, [channel.id])
  useEffect(load, [load, ctx.rev])
  const { task, setTask } = useTask(PLAN_TASK, load)

  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <Skeleton className="h-60 rounded-xl" />
  if (!data.run) return <Notice>{tr('audit.report_empty')}</Notice>
  const { run, categories, index, search, suggestions = [], plan } = data
  const indexed = index?.by_state.indexed ?? 0

  return (
    <div className="space-y-6">
      {/* 总分在页面顶部的得分卡上（两个页签共用），这里只放四类得分和抓了多少页。
          老版本的检查（全站 SEO 检测之前）没存分类得分和 sitemap 页数：说清楚是旧结果，给重新检查 */}
      {categories ? (
        <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(['tech', 'page', 'content', 'ai'] as const).map((c) => <Tile key={c} label={tr(`audit.cat_${c}`)} value={<span className={scoreTone(categories[c])}>{categories[c]}</span>} sub={tr(`audit.cat_${c}_hint`)} />)}
          </div>
          <p className="text-xs text-muted-foreground">{run.sitemap_pages ? tr('audit.r_pages', { n: run.pages_checked, total: run.sitemap_pages }) : tr('audit.r_pages_only', { n: run.pages_checked })}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <div className="font-semibold">{tr('audit.r_old_title')}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tr('audit.r_old_desc', { n: run.pages_checked })}</p>
          </div>
          <RunButton inline fn="audit.run" input={{ channel_id: channel.id }} onDone={() => { load(); onRan?.() }} variant="outline" icon={RotateCw}>
            {tr('audit.rerun')}
          </RunButton>
        </div>
      )}

      {/* 谷歌收录 */}
      <section className="space-y-3 rounded-xl border border-border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{tr('audit.r_index')}</h3>
          {index && <span className="text-xs text-muted-foreground">{tr('audit.r_index_checked', { n: index.checked, total: index.pages })}</span>}
        </div>
        {!index ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{data.channel.gsc ? tr('audit.r_index_pending') : tr('audit.r_index_none')}</p>
            {!data.channel.gsc && (
              <Button variant="outline" size="sm" onClick={() => ctx.go('search', { channel: channel.id })}>
                {tr('audit.r_index_link')} <ArrowRight />
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{num(indexed)}</span>
              <span className="text-sm text-muted-foreground">{tr('audit.r_indexed_of', { n: index.checked })}</span>
            </div>
            {index.checked > 0 && (
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                {STATES.map((s) => (index.by_state[s] ? <div key={s} className={STATE_COLOR[s]} style={{ width: `${((index.by_state[s] ?? 0) / index.checked) * 100}%` }} title={`${tr(`audit.ix_${s}`)} ${index.by_state[s]}`} /> : null))}
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {STATES.filter((s) => index.by_state[s]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className={cx('size-2 rounded-full', STATE_COLOR[s])} />
                  {tr(`audit.ix_${s}`)} {index.by_state[s]}
                </span>
              ))}
            </div>
            {index.sitemaps.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {index.sitemaps.map((m) => <div key={m.path}>{tr('audit.r_sitemap', { path: m.path.replace(/^https?:\/\/[^/]+/, ''), submitted: m.submitted, when: fmtTime(m.last_read) || '—' })}</div>)}
              </div>
            )}
          </>
        )}
      </section>

      {/* 搜索表现：最快见效的机会 */}
      {search && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label={tr('audit.r_clicks')} value={num(search.clicks)} sub={tr('audit.r_prev', { n: num(search.prev_clicks) })} />
          <Tile label={tr('audit.r_impressions')} value={num(search.impressions)} sub={tr('audit.r_shown_pages', { n: search.pages_with_impressions })} />
          <Tile label={tr('audit.r_striking')} value={search.striking_distance} sub={tr('audit.r_striking_hint')} onClick={() => ctx.go('search', { channel: channel.id })} />
          <Tile label={tr('audit.r_low_ctr')} value={search.low_ctr} sub={tr('audit.r_low_ctr_hint')} onClick={() => ctx.go('search', { channel: channel.id })} />
        </section>
      )}

      {/* 全站建议：按影响排好 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{tr('audit.r_suggestions')}</h3>
          <Button variant="ghost" size="sm" onClick={onIssues} className="text-muted-foreground">
            {tr('audit.r_all_issues')} <ArrowRight />
          </Button>
        </div>
        {!suggestions.length ? (
          <Notice>{tr('audit.r_no_suggestions')}</Notice>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
            {suggestions.map((g, i) => (
              <div key={g.key} className="flex gap-3 px-5 py-4">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{tr(`audit.sg_${g.key}`)}</span>
                    <Badge tone={SEV_TONE[g.severity]}>{tr(`audit.sev_${g.severity}`)}</Badge>
                    {g.pages > 0 && <span className="text-xs text-muted-foreground">{tr('audit.r_pages_n', { n: g.pages })}</span>}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{tr(`audit.sg_${g.key}_do`)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.issues.map((x) => (
                      <span key={x.id} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                        {x.title}
                        {x.pages > 1 && <span className="text-muted-foreground"> · {x.pages}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* AI 写的全站优化方案 */}
      <section className="space-y-3 rounded-xl border border-border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{tr('audit.plan_title')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{plan ? tr(plan.stale ? 'audit.plan_at_stale' : 'audit.plan_at', { when: fmtTime(plan.at) }) : tr('audit.plan_desc')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TaskRequirements task={task} onSaved={setTask} title={tr('audit.plan_req_title')} hint={tr('audit.plan_req_hint')} />
            {plan?.chat_id && (
              <Button variant="outline" size="sm" onClick={() => openChat(plan.chat_id)}>
                <MessageSquareText /> {tr('audit.plan_continue')}
              </Button>
            )}
            <TaskButton task={PLAN_TASK} input={{ channel_id: channel.id }} match={(r) => (r.input as any)?.channel_id === channel.id} onFinished={load} icon={Sparkles} variant={plan ? 'outline' : 'default'}>
              {plan ? tr('audit.plan_rewrite') : tr('audit.plan_write')}
            </TaskButton>
          </div>
        </div>
        {plan && (
          <div className="border-t border-border pt-4 text-sm">
            <Markdown text={plan.text} />
          </div>
        )}
      </section>

      {run.target_url && (
        <a href={run.target_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary-text">
          {tr('audit.r_checked_at', { url: run.target_url.replace(/^https?:\/\//, ''), when: fmtTime(run.finished_at) })} <ArrowUpRight className="size-3" />
        </a>
      )}
    </div>
  )
}

const STATE_COLOR: Record<IndexState, string> = {
  indexed: 'bg-emerald-500',
  crawled: 'bg-destructive',
  discovered: 'bg-amber-500',
  unknown: 'bg-amber-300',
  duplicate: 'bg-sky-500',
  alternate: 'bg-muted-foreground/40',
  excluded: 'bg-muted-foreground/60',
}

function Tile({ label, value, sub, onClick }: { label: string; value: ReactNode; sub?: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="cursor-pointer rounded-xl border border-border bg-background px-4 py-3 text-left hover:bg-muted/40">
      {body}
    </button>
  ) : (
    <div className="rounded-xl border border-border bg-background px-4 py-3">{body}</div>
  )
}
