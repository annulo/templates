import { useState } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronUp, Circle, Clock, Loader2, MessageSquareText, Sparkles, X } from 'lucide-react'
import RunButton from './RunButton'
import { Button, Notice, Skeleton, cx } from './ui'
import { openChat, runLocal, runTask } from '../lib/shuttle'
import { TaskButton } from './Task'
import { useInShuttle } from '../lib/useShuttle'
import { tr } from '../lib/i18n'
import type { Ctx, View } from './views/types'

import type { ChecklistItem as Item, ChecklistData as Today } from '../lib/useChecklist'

/**
 * 总览的任务清单：起步任务一步一步做（当前这一步展开，做完自动打勾），起步做完后换成「今天要做的」。
 * 清单由本机函数 today.list 按数据算出来；每一项的按钮是去某个页面、跑某个本机函数，或者交给助手的任务。
 */
export default function Checklist({ ctx, mode = 'all' }: { ctx: Ctx; mode?: 'all' | 'setup' }) {
  const shuttle = useInShuttle()
  const { data, setData, error, setError, load } = ctx.checklist
  // 起步清单整块收起 / 展开：用户点过就记住；没点过时，做完了收起、没做完展开
  const [openPref, setOpenPref] = useState<boolean | null>(() => {
    try {
      const v = localStorage.getItem('shuttle.checklist.open')
      return v === null ? null : v === '1'
    } catch {
      return null
    }
  })
  const toggleOpen = (open: boolean) => {
    setOpenPref(open)
    try {
      localStorage.setItem('shuttle.checklist.open', open ? '1' : '0')
    } catch {
      // 存不了就只在这次有效
    }
  }
  const [chat, setChat] = useState<Record<string, string>>({}) // 交给助手的任务：清单项 → 对话 id
  const [picked, setPicked] = useState('') // 用户点开的那一步（没点就是 today.list 给的当前步）

  const call = async (fn: 'today.skip' | 'today.unskip' | 'today.dismiss', input: unknown) => {
    try {
      setData(await runLocal<Today>(fn, input))
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }

  // 不在 Shuttle 里（手机）时 today.list 走云端版本（lib/shuttle.ts runCloud），读到了就照常显示
  if (!shuttle && !data && !error) return <Notice>{tr('today.offline')}</Notice>
  if (error && !data) return <Notice tone="error">{error}</Notice>
  if (!data) return <Skeleton className="h-64 rounded-xl" />

  const allDone = data.done === data.total
  const open = mode === 'setup' || (openPref ?? !allDone)
  // 当前这一步：用户点开的那步，否则第一个没做完、也没跳过的（跳过的收起来，不再占着当前）
  const autoCurrent = data.setup.find((x) => !x.done && !x.skipped && !x.running)?.key
  const act = (it: Item) => <ChecklistItemAction ctx={ctx} it={it} onDone={load} onChat={(id) => setChat((c) => ({ ...c, [it.key]: id }))} />

  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}

      {/* 起步任务 */}
      <section id="setup-checklist" className="rounded-lg border border-border bg-background">
        <div className="flex items-center gap-2 pr-2">
          <button type="button" onClick={() => mode === 'setup' ? ctx.toggleSetup() : toggleOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pl-4 text-left">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {allDone ? tr('today.setup_done') : tr('today.setup_title')}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {data.done}/{data.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(data.done / data.total) * 100}%` }} />
              </div>
            </div>
            {mode === 'all' && <ChevronDown className={cx('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />}
          </button>
          {/* 重新打开向导是次要入口：一行小字；收起清单要一眼看得到：带字的按钮 */}
          {!!data.wizard?.steps.length && (
            <button type="button" onClick={() => ctx.openWizard()} title={tr('wizard.open')} aria-label={tr('wizard.open')} className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              <Sparkles className="size-3.5" />
              <span className="hidden sm:inline">{tr('wizard.open')}</span>
            </button>
          )}
          {mode === 'setup' && (
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => ctx.toggleSetup()}>
              <ChevronUp />
              {tr('today.collapse')}
            </Button>
          )}
        </div>
        {open && (
          <ol className="border-t border-border">
            {data.setup.map((it, i) => {
              const current = it.key === (data.setup.some((x) => x.key === picked && !x.done) ? picked : autoCurrent)
              // 整行都能点：去页面的直接去；跑函数、交给助手的在原地展开，显示按钮
              const open = () => (it.wizard && it.screen ? ctx.openWizard(it.key) : it.action.kind === 'go' ? ctx.go(it.action.view as View, it.action.params) : setPicked(it.key))
              const editable = it.wizard && !!it.screen
              const clickable = !current && !it.running && (editable || (!it.done && !it.skipped))
              return (
                <li key={it.key} className={cx('border-b border-border px-4 last:border-b-0', current ? 'bg-primary/[0.04] py-4' : 'py-2.5', clickable && 'cursor-pointer hover:bg-accent/50')} onClick={clickable ? open : undefined}>
                  <div className="flex items-center gap-3">
                    <span
                      className={cx(
                        'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums',
                        it.done ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : current ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
                      )}
                    >
                      {it.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={cx('min-w-0 flex-1 truncate text-sm', it.done ? 'text-muted-foreground line-through decoration-muted-foreground/40' : current ? 'font-semibold' : '')}>{it.title}</span>
                    {it.running && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title={it.summary}>
                        <Loader2 className="size-3.5 animate-spin" /> {tr('today.running')}
                      </span>
                    )}
                    {it.skipped && (
                      <button type="button" onClick={(e) => (e.stopPropagation(), call('today.unskip', { key: it.key }))} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        {tr('today.skipped')} · {tr('today.unskip')}
                      </button>
                    )}
                    {clickable && (
                      <button type="button" onClick={(e) => (e.stopPropagation(), open())} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={it.action_label} title={it.action_label}>
                        <ArrowRight className="size-4" />
                      </button>
                    )}
                  </div>
                  {current && (
                    <div className="mt-2 pl-9">
                      <p className="text-sm leading-relaxed text-muted-foreground">{it.why}</p>
                      {it.minutes && (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="size-3.5" /> {tr('today.minutes', { n: it.minutes })}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {act(it)}
                        {it.ask && (
                          <TaskButton task={it.ask.task} input={it.ask.input} variant="outline" icon={Sparkles} onFinished={load}>
                            {tr('today.ask')}
                          </TaskButton>
                        )}
                        {chat[it.key] && (
                          <Button variant="ghost" size="sm" onClick={() => openChat(chat[it.key])}>
                            <MessageSquareText /> {tr('task.view')}
                          </Button>
                        )}
                        <button type="button" onClick={() => (setPicked(''), call('today.skip', { key: it.key }))} className="ml-1 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          {tr('today.skip')}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {/* 今天要做的 */}
      {mode === 'all' && <section className="rounded-xl border border-border bg-background">
        <div className="px-4 py-3 text-sm font-semibold">{tr('today.daily_title')}</div>
        {data.daily.length === 0 ? (
          <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground">{allDone ? tr('today.daily_empty') : tr('today.daily_empty_setup')}</p>
        ) : (
          <ul className="border-t border-border">
            {data.daily.map((it) => (
              <li key={it.key} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <Circle className="size-4 shrink-0 text-primary-text" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{it.title}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{it.why}</p>
                </div>
                {act(it)}
                <button type="button" onClick={() => call('today.dismiss', { key: it.key, value: it.count ?? 1 })} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={tr('today.dismiss')} title={tr('today.dismiss')}>
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>}
    </div>
  )
}

/** 一项的主按钮：去页面 / 跑本机函数（按钮上带进度）/ 交给助手的任务（开一段对话，能看过程） */
export function ChecklistItemAction({ ctx, it, onDone, onChat, compact = false }: { ctx: Ctx; it: Item; onDone: () => void; onChat: (chatId: string) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const a = it.action
  if (it.running) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {tr('today.running')}</span>
  if (it.wizard && it.screen) return <Button size="sm" onClick={() => ctx.openWizard(it.key)}>{it.action_label}</Button>
  if (a.kind === 'run')
    return (
      <RunButton inline fn={a.fn} input={a.input ?? {}} size="sm" onDone={onDone}>
        {it.action_label}
      </RunButton>
    )
  if (a.kind === 'task')
    return (
      <span className="inline-flex items-center gap-2">
        <Button
          needsShuttle
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setErr('')
            try {
              const r = await runTask(a.task, a.input)
              onChat(r.chat_id)
              openChat(r.chat_id)
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {it.action_label}
        </Button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </span>
    )
  return (
    <Button size={compact ? 'sm' : 'default'} className={compact ? undefined : 'h-10! text-base!'} onClick={() => ctx.go(a.view as View, a.params)}>
      {it.action_label}
    </Button>
  )
}
