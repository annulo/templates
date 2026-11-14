import { useState } from 'react'
import { ChartNoAxesCombined, ChevronDown, ClipboardList, FileText, Loader2, MessagesSquare, ShieldAlert, Sparkles, Target, X, type LucideIcon } from 'lucide-react'
import { ChecklistItemAction } from './Checklist'
import { Skeleton, cx } from './ui'
import { runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import type { ChecklistData, ChecklistItem } from '../lib/useChecklist'
import type { Ctx } from './views/types'

const SHOWN = 3

// 一件事去哪个页面，决定它的图标和颜色：询盘绿、内容蓝、网站问题橙、数据紫
const KINDS: [RegExp, LucideIcon, string][] = [
  [/^(leads|prospects)$/, MessagesSquare, 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'],
  [/content|calendar|social|landing/, FileText, 'bg-primary/10 text-primary-text'],
  [/^audit$/, ShieldAlert, 'bg-amber-500/10 text-amber-600 dark:text-amber-400'],
  [/^(search|geo|site|metrics|competitors|growth|opportunities)$/, ChartNoAxesCombined, 'bg-violet-500/10 text-violet-600 dark:text-violet-400'],
  [/^plan$/, Target, 'bg-primary/10 text-primary-text'],
  [/^reports$/, ClipboardList, 'bg-primary/10 text-primary-text'],
]
function kindOf(it: ChecklistItem): [LucideIcon, string] {
  const view = it.action.kind === 'go' ? it.action.view : it.page?.view ?? ''
  if (it.action.kind === 'task' && !view) return [Sparkles, 'bg-primary/10 text-primary-text']
  const k = KINDS.find(([re]) => re.test(view))
  return k ? [k[1], k[2]] : [ClipboardList, 'bg-muted text-muted-foreground']
}

/**
 * 总览顶上的「今天要做的事」：一件一行（图标、标题、原因、按钮），默认只显示最要紧的 3 件，多的点「全部」展开。
 * 清单是 today.list 的 daily（和起步清单同一次读取，ctx.checklist）；第一件用主按钮，其余用描边按钮。
 */
export default function TodayCard({ ctx, className }: { ctx: Ctx; className?: string }) {
  const { data, setData, setError, load } = ctx.checklist
  const [all, setAll] = useState(false)
  const [pending, setPending] = useState('')
  if (!data) return <Skeleton className={cx('h-40 rounded-xl', className)} />
  const items = data.daily
  const minutes = items.reduce((n, it) => n + (it.minutes ?? 0), 0)
  const shown = all ? items : items.slice(0, SHOWN)
  const dismiss = async (it: ChecklistItem) => {
    setPending(it.key)
    try {
      setData(await runLocal<ChecklistData>('today.dismiss', { key: it.key, value: it.count ?? 1 }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending('')
    }
  }
  return (
    <section className={cx('@container/today min-w-0 rounded-xl border border-border bg-background px-4 pt-3 pb-1.5', className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold">{tr('today.daily_title_short')}</h2>
        {items.length > 0 && <span className="text-xs text-muted-foreground">{tr('today.daily_count', { n: items.length })}{minutes > 0 && ' · ' + tr('today.daily_minutes', { n: minutes })}</span>}
        {items.length > SHOWN && (
          <button type="button" onClick={() => setAll(!all)} aria-expanded={all} className="ml-auto inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {all ? tr('today.collapse') : tr('today.show_all', { n: items.length })}
            <ChevronDown className={cx('size-3.5 transition-transform', all && 'rotate-180')} />
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{data.done === data.total ? tr('today.daily_empty') : tr('today.daily_empty_setup')}</p>
      ) : (
        <ul className="mt-1">
          {shown.map((it, i) => {
            const [Icon, tone] = kindOf(it)
            return (
              <li key={it.key} className="group flex min-h-11 items-center gap-3 border-t border-border/70 py-1.5 first:border-t-0">
                <span className={cx('grid size-7 shrink-0 place-items-center rounded-lg', tone)}><Icon className="size-3.5" /></span>
                {/* 和计划并排时卡片可能很窄：标题放不下就截断，原因先藏起来（悬停看全文） */}
                <div className="flex min-w-0 flex-1 items-baseline gap-2" title={it.why ? `${it.title}\n${it.why}` : it.title}>
                  <span className="min-w-0 truncate text-sm font-semibold">{it.title}</span>
                  {it.why && <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground @min-[560px]/today:block">{it.why}</span>}
                </div>
                <ChecklistItemAction ctx={ctx} it={it} compact variant={i === 0 ? 'default' : 'outline'} onDone={load} onChat={() => {}} />
                <button type="button" disabled={pending === it.key} onClick={() => dismiss(it)} aria-label={tr('today.dismiss')} title={tr('today.dismiss')}
                  className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:cursor-default">
                  {pending === it.key ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
