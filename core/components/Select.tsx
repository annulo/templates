import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cx, inputCls } from './ui'
import { tr } from '../lib/i18n'

export type SelectOption<T extends string> = {
  value: T
  label: string
  /** 第二行的小字（地址、id、说明） */
  sub?: string
  /** 左边的图标；不给就用名字的第一个字 */
  icon?: ReactNode
}

/**
 * 下拉选择。样子和 Shuttle 顶栏的项目切换一致：按钮 + 弹出的菜单（标题、每项一个图标块、两行字、选中的打勾）。
 * 不用系统的 <select>：各平台长得不一样、也放不了图标和第二行字。点外面或按 Esc 关掉。
 *
 * variant：field 是表单里的输入框样式（有边框、占满宽度）；inline 是页头下面那种紧凑的按钮。
 * 菜单用 fixed 定位（按按钮在窗口里的位置算），外层有 overflow-hidden 也不会被裁掉；下面放不下就往上弹，
 * align=right 时和按钮右边对齐。页面滚动、窗口变化时收起。
 */
export default function Select<T extends string>({
  value,
  onChange,
  options,
  title,
  placeholder,
  ariaLabel,
  variant = 'field',
  align = 'left',
  className,
  menuClassName,
}: {
  value: T
  onChange: (v: T) => void
  options: SelectOption<T>[]
  title?: string
  placeholder?: string
  ariaLabel?: string
  variant?: 'field' | 'inline'
  align?: 'left' | 'right'
  className?: string
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const pos = usePopup(open, setOpen, root, btn, menu, align, options.length)

  const cur = options.find((o) => o.value === value)
  return (
    <div ref={root} className={cx('relative min-w-0', variant === 'field' && 'w-full', className)}>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className={cx(
          'flex w-full min-w-0 cursor-pointer items-center gap-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          variant === 'field'
            ? 'h-9 rounded-md border border-input bg-input-background px-3 text-sm shadow-xs hover:bg-accent/50'
            : 'h-8 rounded-lg border border-border bg-background px-2.5 text-[13px] font-semibold hover:bg-accent',
          open && 'bg-accent',
        )}
      >
        {cur?.icon && <span className="flex shrink-0 text-muted-foreground">{cur.icon}</span>}
        <span className={cx('min-w-0 flex-1 truncate', !cur && 'text-muted-foreground')}>{cur?.label ?? placeholder ?? tr('ui.select_placeholder')}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
          className={cx('fixed z-50 w-72 max-w-[90vw] rounded-xl border border-border bg-popover p-1.5 text-sm text-popover-foreground shadow-xl', menuClassName)}
        >
          {title && <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">{title}</div>}
          <div className="max-h-72 overflow-y-auto">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={o.value === value}
                onClick={() => {
                  setOpen(false)
                  if (o.value !== value) onChange(o.value)
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">{o.icon ?? o.label.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{o.label}</span>
                  {o.sub && <span className="block truncate font-mono text-[11px] text-muted-foreground">{o.sub}</span>}
                </span>
                {o.value === value && <Check className="size-4 shrink-0 text-primary-text" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 弹出菜单的开关和位置（Select、Combobox 共用）：点外面、按 Esc、页面滚动（菜单里面的滚动除外）、窗口变化就收起；
 * 打开后量菜单大小，放在锚点下面（放不下就上面），左右不出窗口。
 */
function usePopup(open: boolean, setOpen: (v: boolean) => void, root: RefObject<HTMLElement | null>, anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>, align: 'left' | 'right', size: number) {
  const [pos, setPos] = useState<CSSProperties | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = (e: Event) => !menu.current?.contains(e.target as Node) && setOpen(false)
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])
  useLayoutEffect(() => {
    if (!open) return setPos(null)
    const b = anchor.current?.getBoundingClientRect()
    const m = menu.current
    if (!b || !m) return
    const w = m.offsetWidth
    const h = m.offsetHeight
    const gap = 8
    let left = align === 'right' ? b.right - w : b.left
    left = Math.min(Math.max(left, gap), window.innerWidth - w - gap)
    const below = window.innerHeight - b.bottom
    const top = below >= h + gap || below >= b.top ? b.bottom + gap : Math.max(b.top - h - gap, gap)
    setPos({ left, top })
  }, [open, align, size])
  return pos
}

export type ComboboxOption = SelectOption<string> & {
  /** 灰掉、不能选；sub 写明为什么 */
  disabled?: boolean
}

/**
 * 能输入的下拉框：值是输入框里的字，菜单给常用的选项（比如服务商登记的模型），点一项填进去；
 * 菜单里没有的也能直接输入。输入时按字过滤选项，输入的正好是某一项时列出全部。
 */
export function Combobox({
  value,
  onChange,
  options,
  title,
  placeholder,
  ariaLabel,
  className,
  inputClassName,
}: {
  value: string
  onChange: (v: string) => void
  options: ComboboxOption[]
  title?: string
  placeholder?: string
  ariaLabel?: string
  className?: string
  inputClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(false) // 打开后用户打过字才过滤；刚点开时列出全部
  const root = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const q = value.trim().toLowerCase()
  const shown = typed && q ? options.filter((o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)) : options
  const pos = usePopup(open && shown.length > 0, setOpen, root, box, menu, 'left', shown.length)
  const show = (v: boolean) => (setOpen(v), setTyped(false))

  return (
    <div ref={root} className={cx('relative w-full min-w-0', className)}>
      <div ref={box} className="relative">
        <input
          value={value}
          onChange={(e) => (onChange(e.target.value), setOpen(true), setTyped(true))}
          onFocus={() => show(true)}
          onClick={() => !open && show(true)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Tab') && setOpen(false)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          role="combobox"
          className={cx(inputCls, 'h-9 pr-8', inputClassName)}
        />
        {options.length > 0 && (
          <button type="button" tabIndex={-1} onClick={() => show(!open)} aria-label={ariaLabel} className="absolute inset-y-0 right-0 flex w-8 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground">
            <ChevronsUpDown className="size-3.5" />
          </button>
        )}
      </div>
      {open && shown.length > 0 && (
        <div ref={menu} role="listbox" style={pos ?? { left: 0, top: 0, visibility: 'hidden' }} className="fixed z-50 w-72 max-w-[90vw] rounded-xl border border-border bg-popover p-1.5 text-sm text-popover-foreground shadow-xl">
          {title && <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">{title}</div>}
          <div className="max-h-72 overflow-y-auto">
            {shown.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                disabled={o.disabled}
                onClick={() => (setOpen(false), o.value !== value && onChange(o.value))}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">{o.icon ?? o.label.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{o.label}</span>
                  {o.sub && <span className="block truncate font-mono text-[11px] text-muted-foreground">{o.sub}</span>}
                </span>
                {o.value === value && <Check className="size-4 shrink-0 text-primary-text" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
