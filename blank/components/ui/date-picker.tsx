import { useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { zhCN } from 'date-fns/locale/zh-CN'
import { cn } from '../../lib/utils'
import { Calendar } from './calendar'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

// 日期选择：按钮 + 弹出月历（shadcn 的 Date Picker 写法），代替 <input type="date">（系统的日期框各平台不一样，空的时候显示「年/月/日」）。
// 值和 <input type="date"> 一样是 'YYYY-MM-DD' 字符串，没选是 ''，可以直接存进表。
//   <DatePicker value={d} onChange={setD} placeholder="下次跟进" />

const pad = (n: number) => String(n).padStart(2, '0')
const toStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s?: string) => {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : undefined
}
const isEn = () => (((window as any).TalizenConfig?.locale || document.documentElement.lang || 'zh') as string).toLowerCase().startsWith('en')

export function DatePicker({
  value,
  onChange,
  placeholder,
  clearable = true,
  disabled,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** 能不能清空（悬停时显示一个 ×） */
  clearable?: boolean
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = parse(value)
  const en = isEn()
  const label = selected ? selected.toLocaleDateString(en ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }) : ''
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'group flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-input-background px-3 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn('flex-1 truncate', !label && 'text-muted-foreground')}>{label || placeholder || (en ? 'Pick a date' : '选择日期')}</span>
          {clearable && value && (
            <span
              role="button"
              aria-label="clear"
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
              className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0">
        <Calendar
          mode="single"
          locale={en ? undefined : zhCN}
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            onChange(d ? toStr(d) : '')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
