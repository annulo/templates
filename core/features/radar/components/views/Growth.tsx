import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, EyeOff, RefreshCw, Undo2 } from 'lucide-react'
import RunButton from '../RunButton'
import { TaskButton } from '../Task'
import { Badge, Button, Notice, PageHeader, Segmented, Skeleton, cx, fmtTime, type Tone } from '../ui'
import { runLocal } from '../../lib/shuttle'
import type { Ctx, View } from './types'
import { tr } from '../../lib/i18n'

type Action = { kind: 'go'; view: View; params?: Record<string, string> } | { kind: 'task'; task: string; input?: unknown }
type Area = 'site' | 'content' | 'customers' | 'setup'
type Item = {
  id: string; key: string; kind: string; area: Area; priority: 'high' | 'medium' | 'low'; score: number
  title: string; why: string; next: string; action: Action | null; value: number
  status?: '' | 'done' | 'dismissed'; seen?: boolean; first_seen?: string
}

const PRIORITY: Record<Item['priority'], Tone> = { high: 'bad', medium: 'warn', low: 'default' }
const AREAS = ['all', 'site', 'content', 'customers'] as const

/**
 * 增长机会（增长雷达）：growth.scan 每周把内容下滑、谷歌排名机会、竞品、AI 搜索、网站问题、询盘这些信号汇总成一份清单，
 * 每条带依据和下一步，点了去做；做完、不用管的标一下（docs/growth-radar.md）。
 */
export default function Growth({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<{ scanned_at: string; items: Item[] } | null>(null)
  const [error, setError] = useState('')
  const [area, setArea] = useState<(typeof AREAS)[number]>('all')
  const [showHandled, setShowHandled] = useState(false)
  const [fresh, setFresh] = useState<Set<string> | null>(null)

  const load = useCallback(async () => {
    try {
      let d = await runLocal<{ scanned_at: string; items: Item[] }>('growth.list', {})
      // 从来没算过（刚升级上来）：先算一次，不用等每周的定时任务
      if (!d.scanned_at) {
        await runLocal('growth.scan', {})
        d = await runLocal('growth.list', {})
      }
      setData(d)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => void load(), [load])
  useEffect(() => {
    if (ctx.rev) void load()
  }, [ctx.rev])
  // 「新」：这次打开时还没看过的；打开就记成看过，这一页上仍然标着
  useEffect(() => {
    if (!data || fresh) return
    const ids = data.items.filter((i) => !i.seen && !i.status).map((i) => i.id)
    setFresh(new Set(ids))
    if (ids.length) runLocal('growth.markSeen', { ids }).then(() => window.dispatchEvent(new CustomEvent('db:changed', { detail: { table: 'growth_items' } }))).catch(() => {})
  }, [data])

  const items = (data?.items ?? []).filter((i) => area === 'all' || i.area === area || (area === 'site' && i.area === 'setup'))
  const open = items.filter((i) => !i.status)
  const handled = items.filter((i) => i.status)
  const count = (a: Area) => (data?.items ?? []).filter((i) => !i.status && (i.area === a || (a === 'site' && i.area === 'setup'))).length

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('growth.title')}
        desc={tr('growth.desc')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data?.scanned_at && <span className="text-xs text-muted-foreground">{tr('growth.scanned', { when: fmtTime(data.scanned_at) })}</span>}
            <RunButton inline variant="outline" fn="growth.scan" input={{}} icon={RefreshCw} onDone={load}>
              {tr('growth.scan')}
            </RunButton>
          </div>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {data === null ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={area}
              onChange={setArea}
              options={AREAS.map((a) => ({ value: a, label: a === 'all' ? tr('growth.a_all', { n: data.items.filter((i) => !i.status).length }) : tr(`growth.a_${a}`, { n: count(a) }) }))}
            />
            <span className="text-xs text-muted-foreground">{tr('growth.hint')}</span>
          </div>
          {open.length === 0 ? (
            <Notice>{tr('growth.empty')}</Notice>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              {open.map((i) => (
                <Row key={i.id} item={i} isNew={!!fresh?.has(i.id)} ctx={ctx} onChanged={load} />
              ))}
            </div>
          )}
          {handled.length > 0 && (
            <div className="space-y-2">
              <button type="button" onClick={() => setShowHandled((v) => !v)} aria-expanded={showHandled} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                {tr('growth.handled', { n: handled.length })}
                <ChevronDown className={cx('size-3.5 transition-transform', showHandled && 'rotate-180')} />
              </button>
              {showHandled && (
                <div className="overflow-hidden rounded-xl border border-border bg-background opacity-70">
                  {handled.map((i) => (
                    <Row key={i.id} item={i} isNew={false} ctx={ctx} onChanged={load} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({ item: i, isNew, ctx, onChanged }: { item: Item; isNew: boolean; ctx: Ctx; onChanged: () => void }) {
  const a = i.action
  return (
    <div className={cx('flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 last:border-b-0', isNew && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {isNew && <span className="inline-flex h-4 items-center rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">{tr('article.new_badge')}</span>}
          <Badge tone={PRIORITY[i.priority]}>{tr(`growth.p_${i.priority}`)}</Badge>
          <span className="text-sm font-medium [overflow-wrap:anywhere]">{i.title}</span>
          {i.status === 'done' && <Badge tone="ok">{tr('growth.s_done')}</Badge>}
          {i.status === 'dismissed' && <Badge>{tr('growth.s_dismissed')}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{i.why}</p>
        <p className="text-xs"><span className="text-muted-foreground">{tr('growth.next')}</span>{i.next}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {!i.status && a?.kind === 'go' && (
          <Button size="sm" onClick={() => ctx.go(a.view, a.params)}>
            {tr('growth.go')} <ArrowRight />
          </Button>
        )}
        {!i.status && a?.kind === 'task' && (
          <TaskButton task={a.task} input={a.input} onFinished={onChanged}>
            {tr('growth.go')}
          </TaskButton>
        )}
        {i.status ? (
          <RunButton inline fn="growth.mark" input={{ id: i.id, status: '' }} onDone={onChanged} variant="ghost" icon={Undo2}>{tr('growth.undo')}</RunButton>
        ) : (
          <>
            <RunButton inline fn="growth.mark" input={{ id: i.id, status: 'done' }} onDone={onChanged} variant="ghost" icon={Check}>{tr('growth.done')}</RunButton>
            <RunButton inline fn="growth.mark" input={{ id: i.id, status: 'dismissed' }} onDone={onChanged} variant="ghost" icon={EyeOff}>{tr('growth.dismiss')}</RunButton>
          </>
        )}
      </div>
    </div>
  )
}
