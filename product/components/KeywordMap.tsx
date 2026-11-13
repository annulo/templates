import { Fragment, useCallback, useEffect, useState } from 'react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { Badge, Button, Notice, Skeleton, cx, type Tone } from './ui'
import { runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import type { Ctx, View } from './views/types'

type Stage = 'none' | 'topic' | 'draft' | 'live' | 'shown' | 'top30' | 'top10'
type Row = {
  cluster: string; keywords: number; targeting: number; main: string; page: string; stage: Stage
  best_position: number | null; page_position: number | null; impressions: number; clicks: number; leads: number | null
  words: { keyword: string; status: string; position: number | null; impressions: number }[]
  next: { text: string; action: { kind: 'go'; view: View; params?: Record<string, string> } }
}
type Data = { rows: Row[]; by_stage: Record<Stage, number>; leads_since: string }

const STAGES: Stage[] = ['none', 'topic', 'draft', 'live', 'shown', 'top30', 'top10']
const TONE: Record<Stage, Tone> = { none: 'default', topic: 'default', draft: 'warn', live: 'primary', shown: 'primary', top30: 'ok', top10: 'ok' }
const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const pathOf = (u: string) => String(u || '').replace(/^https?:\/\/[^/]+/, '') || '/'

/**
 * 关键词地图（增长计划 → 关键词地图）：关键词按主题分，每个主题一个目标页面，看它走到了哪一步、带来了多少展示、点击和询盘，
 * 下一步去哪做。数据是 plan.keywordMap 现算的（关键词、选题、文章、发布记录、谷歌数据、询盘的落地页），不另存表。
 */
export default function KeywordMap({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [stage, setStage] = useState<Stage | ''>('')
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => {
    runLocal<Data>('plan.keywordMap', {})
      .then((d) => (setData(d), setError('')))
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(load, [load, ctx.rev])

  if (error) return <Notice tone="error">{error}</Notice>
  if (!data) return <Skeleton className="h-48 rounded-xl" />
  if (!data.rows.length)
    return (
      <div className="space-y-3 rounded-xl border border-border bg-background p-6">
        <p className="text-sm">{tr('plan.map_empty')}</p>
        <Button size="sm" feedback={false} onClick={() => ctx.go('search', { tab: 'keywords' })}>
          {tr('plan.map_go_keywords')} <ArrowRight />
        </Button>
      </div>
    )
  const rows = stage ? data.rows.filter((r) => r.stage === stage) : data.rows
  const hasLeads = data.rows.some((r) => r.leads != null)
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{tr('plan.map_desc')}</p>
      {/* 各阶段几个主题：点了只看这一步的 */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStage(stage === s ? '' : s)}
            className={cx('flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors', stage === s ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}
          >
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span>{tr(`plan.stage_${s}`)}</span>
            <span className="font-semibold tabular-nums">{data.by_stage[s] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-background">
        <table className="w-full min-w-[720px] table-fixed text-sm">
          <colgroup>
            <col className="w-[23%]" />
            <col className="w-[17%]" />
            <col />
            <col className="w-[72px]" />
            <col className="w-[72px]" />
            {hasLeads && <col className="w-[52px]" />}
            <col className="w-[76px]" />
          </colgroup>
          <thead className="border-b border-border text-left text-xs whitespace-nowrap text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-normal">{tr('plan.map_cluster')}</th>
              <th className="px-3 py-2 font-normal">{tr('plan.map_page')}</th>
              <th className="px-3 py-2 font-normal">{tr('plan.map_stage')} · {tr('plan.map_next')}</th>
              <th className="px-3 py-2 text-right font-normal">{tr('plan.map_position')}</th>
              <th className="px-3 py-2 text-right font-normal">{tr('plan.map_impr')}</th>
              {hasLeads && <th className="px-3 py-2 text-right font-normal">{tr('plan.map_leads')}</th>}
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.cluster}>
                <tr className="border-b border-border align-top last:border-b-0">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setOpen(open === r.cluster ? null : r.cluster)} className="flex cursor-pointer items-start gap-1 text-left">
                      <ChevronDown className={cx('mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform', open === r.cluster && 'rotate-180')} />
                      <span>
                        <span className="font-medium [overflow-wrap:anywhere]">{r.cluster}</span>
                        <span className="block text-xs text-muted-foreground">{tr('plan.map_words', { n: r.keywords, t: r.targeting })}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {r.page ? (
                      <a href={r.page} target="_blank" rel="noreferrer" title={r.page} className="block truncate text-primary hover:underline">{pathOf(r.page)}</a>
                    ) : (
                      <span className="text-muted-foreground">{tr('plan.map_no_page')}</span>
                    )}
                  </td>
                  <td className="space-y-1 px-3 py-3">
                    <Badge tone={TONE[r.stage]}>{tr(`plan.stage_${r.stage}`)}</Badge>
                    <p className="text-xs text-muted-foreground">{r.next.text}</p>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {r.best_position ?? '—'}
                    {r.best_position == null && r.page_position != null && <span className="block text-[11px] whitespace-nowrap text-muted-foreground" title={tr('plan.map_page_pos_hint')}>{tr('plan.map_page_pos', { n: r.page_position })}</span>}
                  </td>
                  <td className="px-3 py-3 text-right text-xs tabular-nums">{fmt(r.impressions)} / {fmt(r.clicks)}</td>
                  {hasLeads && <td className="px-3 py-3 text-right tabular-nums">{r.leads ?? '—'}</td>}
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" feedback={false} onClick={() => ctx.go(r.next.action.view, r.next.action.params)}>
                      {tr('plan.go')}
                    </Button>
                  </td>
                </tr>
                {open === r.cluster && (
                  <tr className="border-b border-border bg-muted/20">
                    <td colSpan={hasLeads ? 7 : 6} className="px-4 py-2">
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        {r.words.map((w) => (
                          <span key={w.keyword} className={cx('rounded border border-border bg-background px-2 py-0.5', w.status === 'targeting' && 'border-primary/40')}>
                            {w.keyword}
                            {w.position ? <span className="ml-1 text-muted-foreground">#{w.position}</span> : null}
                            {w.impressions ? <span className="ml-1 text-muted-foreground">· {fmt(w.impressions)}</span> : null}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{tr(data.leads_since ? 'plan.map_note_since' : 'plan.map_note', { date: data.leads_since.slice(0, 10) })}</p>
    </div>
  )
}
