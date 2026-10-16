import { useEffect, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import { DayPicker, getDefaultClassNames } from 'react-day-picker'
import { zhCN } from 'date-fns/locale/zh-CN'
import { CalendarClock, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button, cx, fmtUntil } from './ui'
import { isEn, numLocale, tr } from '../lib/i18n'

/**
 * 选日期和时间（shadcn 的 Date Picker 写法：Radix Popover + react-day-picker 的月历；shadcn 没有选时间的，右边两列是自己的）。
 * 一个按钮显示选好的时间（「10月16日周五 14:00 · 2 小时后」），点开弹出：上面几个常用的（1 小时后、今晚 20:00、明早 9:00），
 * 左边月历、右边小时和分钟，点「确定」才改。不用系统的时间框：各平台长得不一样，深色下看不清。
 * value / onChange 是本地时间 'YYYY-MM-DDTHH:mm'（和 datetime-local 一样），过去的日子、时间点不了。
 * 位置交给 Radix（放不下自动换边、限高）；放在原生 <dialog> 弹窗里时挂进那个弹窗，不然会被压在弹窗下面。
 * react-day-picker、date-fns/locale/zh-CN 要在模板的 talizen.config.ts 的 importMap 里声明（radix-ui 页面默认就能加载）。
 */
export default function DateTimeField({ value, onChange, disabled, className }: { value: string; onChange: (v: string) => void; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const d = parse(value)
  const until = d ? fmtUntil(d.toISOString()) : null
  return (
    <Popover.Root open={open} onOpenChange={(o) => { if (o) setContainer(btn.current?.closest('dialog') ?? null); setOpen(o) }}>
      <Popover.Trigger asChild disabled={disabled}>
        <button ref={btn} type="button"
          className={cx('flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-input-background px-3 text-left text-sm shadow-xs outline-none hover:border-ring/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50', className)}>
          <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{d ? label(d) : tr('datetime.pick')}</span>
          {until && <span className={cx('shrink-0 text-xs', until.due ? 'text-destructive' : 'text-muted-foreground')}>{until.due ? tr('datetime.past') : until.rel}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container ?? undefined}>
        <Popover.Content align="start" sideOffset={6} collisionPadding={8}
          className="z-50 max-h-(--radix-popover-content-available-height) overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
          <Picker value={value} onDone={(v) => { if (v) onChange(v); setOpen(false) }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * 排期的小标签（照 X、LinkedIn 发帖框的做法，放在弹窗底栏发布按钮旁边）：没定时间是一个日历图标按钮，默认「现在发」；
 * 点开选好时间后变成「10月16日周五 14:00 · 15 分钟后 ×」，点标签改时间，点 × 改回现在发（onChange('')）。
 */
export function DateTimeChip({ value, onChange, disabled, label: hint }: { value: string; onChange: (v: string) => void; disabled?: boolean; /** 没定时间时图标的提示 */ label?: string }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const d = parse(value)
  const until = d ? fmtUntil(d.toISOString()) : null
  return (
    <Popover.Root open={open} onOpenChange={(o) => { if (o) setContainer(btn.current?.closest('dialog') ?? null); setOpen(o) }}>
      <span className="inline-flex min-w-0 items-center">
        <Popover.Trigger asChild disabled={disabled}>
          <button ref={btn} type="button" title={d ? undefined : hint} aria-label={d ? undefined : hint}
            className={cx('inline-flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-sm disabled:cursor-default disabled:opacity-50',
              d ? 'border border-primary/40 bg-primary/10 pl-2.5 pr-1 text-primary-text hover:bg-primary/15' : 'w-8 justify-center text-muted-foreground hover:bg-accent hover:text-foreground')}>
            <CalendarClock className="size-4 shrink-0" />
            {d && <span className="truncate">{label(d)}{until && <span className={cx('ml-1.5 text-xs', until.due ? 'text-destructive' : 'opacity-70')}>{until.due ? tr('datetime.past') : until.rel}</span>}</span>}
            {d && <span role="button" aria-label={tr('datetime.clear')} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange('') }} className="ml-0.5 rounded p-0.5 hover:bg-primary/20"><X className="size-3.5" /></span>}
          </button>
        </Popover.Trigger>
      </span>
      <Popover.Portal container={container ?? undefined}>
        <Popover.Content align="start" side="top" sideOffset={6} collisionPadding={8}
          className="z-50 max-h-(--radix-popover-content-available-height) overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
          <Picker value={value} onDone={(v) => { if (v) onChange(v); setOpen(false) }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

const pad = (x: number) => String(x).padStart(2, '0')
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
function parse(v: string) {
  const d = new Date(v)
  return v && !isNaN(d.getTime()) ? d : null
}
/** 「10月16日周五 14:00」/「Fri, Oct 16 14:00」 */
const label = (d: Date) => `${d.toLocaleDateString(numLocale(), { month: isEn() ? 'short' : 'long', day: 'numeric', weekday: 'short' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`

/** 下一个整点 */
function nextHour() {
  const d = new Date(Date.now() + 3600_000)
  d.setMinutes(0, 0, 0)
  return d
}

function Picker({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [sel, setSel] = useState<Date>(() => parse(value) ?? nextHour())
  const [month, setMonth] = useState(() => new Date(sel.getFullYear(), sel.getMonth(), 1))
  const hourRef = useRef<HTMLDivElement>(null)
  const minRef = useRef<HTMLDivElement>(null)
  // 打开时让选中的小时、分钟滚到看得见的地方
  // （弹出层先挂上、下一帧才放到位置上，等一帧再量）
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      for (const el of [hourRef.current, minRef.current]) {
        const on = el?.querySelector<HTMLElement>('[data-on]')
        if (el && on) el.scrollTop += on.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 2 + on.offsetHeight / 2
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  const set = (f: (d: Date) => void) => setSel((s) => { const d = new Date(s); f(d); return d })
  const past = sel.getTime() <= Date.now()
  const now = new Date()
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const minutes = [...new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, sel.getMinutes()])].sort((a, b) => a - b)
  const quick: { label: string; at: Date }[] = (() => {
    const tonight = new Date(today0); tonight.setHours(20)
    const morning = new Date(today0); morning.setDate(morning.getDate() + 1); morning.setHours(9)
    return [{ label: tr('datetime.in_hour'), at: nextHour() }, ...(tonight.getTime() > Date.now() ? [{ label: tr('datetime.tonight'), at: tonight }] : []), { label: tr('datetime.tomorrow_morning'), at: morning }]
  })()
  const dc = getDefaultClassNames()
  const cell = 'flex h-8 w-full cursor-pointer items-center justify-center rounded-md text-sm tabular-nums'
  return (
    <div className="w-[min(88vw,400px)]">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button key={q.label} type="button" onClick={() => { setSel(q.at); setMonth(new Date(q.at.getFullYear(), q.at.getMonth(), 1)) }}
            className={cx('cursor-pointer rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent', q.at.getTime() === sel.getTime() ? 'border-primary bg-primary/10 text-primary-text' : 'border-border text-muted-foreground')}>{q.label}</button>
        ))}
      </div>
      <div className="flex gap-2">
        {/* 月历：shadcn Calendar 的样式（react-day-picker 9） */}
        <DayPicker
          mode="single" required locale={isEn() ? undefined : zhCN} showOutsideDays
          month={month} onMonthChange={setMonth} startMonth={today0} disabled={{ before: today0 }}
          selected={sel} onSelect={(d: Date | undefined) => d && set((s) => s.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()))}
          className="min-w-0 flex-1 [--cell:2rem]"
          classNames={{
            months: cx('relative', dc.months),
            month: 'flex flex-col gap-2',
            nav: 'absolute inset-x-0 top-0 flex items-center justify-end gap-1',
            button_previous: 'flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-accent aria-disabled:cursor-default aria-disabled:opacity-30',
            button_next: 'flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-accent aria-disabled:cursor-default aria-disabled:opacity-30',
            month_caption: 'flex h-7 items-center',
            caption_label: 'text-sm font-medium',
            month_grid: 'w-full border-collapse',
            weekdays: 'flex',
            weekday: 'flex-1 select-none py-1 text-center text-xs font-normal text-muted-foreground',
            week: 'mt-0.5 flex w-full',
            day: 'flex-1 p-px text-center',
            day_button: 'flex h-(--cell) w-full cursor-pointer items-center justify-center rounded-md text-sm hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent',
            selected: '[&>button]:bg-primary [&>button]:font-medium [&>button]:text-primary-foreground [&>button]:hover:bg-primary',
            // 今天用主色字；今天又被选中时让选中的白字（data-selected 是 react-day-picker 给格子加的）
            today: '[&:not([data-selected=true])>button]:text-primary-text [&>button]:font-semibold',
            outside: 'text-muted-foreground/60',
            disabled: 'opacity-30',
            hidden: 'invisible',
          }}
          components={{ Chevron: ({ orientation }: { orientation?: string }) => (orientation === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />) }}
        />
        <div className="flex w-[100px] shrink-0 flex-col">
          <div className="flex h-7 items-center text-sm font-medium tabular-nums">{pad(sel.getHours())}:{pad(sel.getMinutes())}</div>
          <div className="mt-2 flex min-h-0 gap-1 border-l border-border pl-2">
            <div ref={hourRef} className="max-h-[232px] flex-1 overflow-y-auto">
              {Array.from({ length: 24 }, (_, h) => (
                <button key={h} type="button" data-on={h === sel.getHours() || undefined} onClick={() => set((s) => s.setHours(h))}
                  className={cx(cell, h === sel.getHours() ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-accent')}>{pad(h)}</button>
              ))}
            </div>
            <div ref={minRef} className="max-h-[232px] flex-1 overflow-y-auto">
              {minutes.map((m) => (
                <button key={m} type="button" data-on={m === sel.getMinutes() || undefined} onClick={() => set((s) => s.setMinutes(m))}
                  className={cx(cell, m === sel.getMinutes() ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-accent')}>{pad(m)}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <span className={cx('min-w-0 flex-1 truncate text-xs', past ? 'text-destructive' : 'text-muted-foreground')}>{past ? tr('datetime.future_only') : `${label(sel)} · ${fmtUntil(sel.toISOString())?.rel ?? ''}`}</span>
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>{tr('common.cancel')}</Button>
        <Button size="sm" disabled={past} onClick={() => onDone(fmt(sel))}>{tr('datetime.ok')}</Button>
      </div>
    </div>
  )
}
