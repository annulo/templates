import { useState as useStateD, useEffect as useEffectD, useRef as useRefD, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { isEn, numLocale, tr } from '../lib/i18n'
import { isNeedsShuttle, shuttleMissing } from '../lib/shuttle'
import { useCanRun } from '../lib/useShuttle'

// 站点内的基础控件，样式照搬 talizen 平台（和 Shuttle 外壳一致）。

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

const base =
  'cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all shrink-0 outline-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'
const variants = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input-background dark:border-input dark:hover:bg-input/50',
  ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
  destructive: 'bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/60',
}
const sizes = {
  default: 'h-9 px-4 py-2 has-[>svg]:px-3',
  sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
  'icon-sm': 'size-8',
}

/** 异步操作统一反馈：处理中禁用，成功短暂显示勾选，失败不显示成功。 */
export function Button({
  variant = 'default', size = 'default', className, onClick, children, disabled,
  feedback = true, successLabel, fn, needsShuttle = false, ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants; size?: keyof typeof sizes; feedback?: boolean; successLabel?: ReactNode
  /**
   * 这个按钮调的本机函数（'文件.函数'）：在这里调不了就灰掉（lib/useShuttle.ts useCanRun：在 Shuttle 里都能；不在的话
   * 函数文件里声明了 cloud 的能、remote 的电脑在线才能）。调本机函数的按钮都写它，不要自己判断在不在 Shuttle 里。
   */
  fn?: string
  /** 不是本机函数、只在 Shuttle 里才有的（交给助手、上传本机文件、本机密钥）：不在 Shuttle 里时灰掉。原因由页面顶部那一句统一说（pages/Index.tsx） */
  needsShuttle?: boolean
}) {
  const [state, setState] = useStateD<'idle' | 'pending' | 'success'>('idle')
  // 挂载后再判断：服务端渲染时没有 window，直接算会和首屏对不上
  const [missing, setMissing] = useStateD(false)
  useEffectD(() => { if (needsShuttle) setMissing(shuttleMissing()) }, [needsShuttle])
  const canRun = useCanRun(fn)
  const noShuttle = (needsShuttle && missing) || (!!fn && !canRun)
  const [error, setError] = useStateD('')
  useEffectD(() => {
    if (state !== 'success') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (!feedback) { onClick?.(event); return }
    setError('')
    setState('idle')
    try {
      const result: unknown = onClick?.(event)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        setState('pending')
        Promise.resolve(result).then((value) => setState(value === false ? 'idle' : 'success')).catch((e) => {
          setState('idle'); setError(e instanceof Error ? e.message : String(e))
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return <>
    <button className={cx(base, variants[variant], sizes[size], className)} disabled={disabled || noShuttle || state === 'pending'} onClick={click} aria-busy={state === 'pending' || undefined} {...p}>
      {state === 'pending' ? <><Loader2 className="animate-spin" />{tr('ui.running')}</> : state === 'success' ? <><Check /><span aria-live="polite">{successLabel ?? tr('ui.done')}</span></> : children}
    </button>
    {error && <span className="block w-64 min-w-0 max-w-full"><ErrorDetails message={error} /></span>}
  </>
}

/** 时间范围切换：平台「设置 → 分析」的范围按钮组 */
export function RangeToggle<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" className="inline-flex shrink-0 gap-1 rounded-lg border border-border p-1">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex h-7 cursor-pointer items-center rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              on ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent/50',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** 平台的卡片：rounded-xl border bg-background p-4，标题 text-sm font-semibold */
export function Panel({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-border bg-background p-4', className)}>
      {(title || aside) && (
        // 标题和右边的控件（切换、按钮）放不下一行时，控件换到下一行，不把标题挤成竖字（手机上）
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

/** 报错单独一排：默认一行摘要，点详情在原处展开完整原文。 */
export function ErrorDetails({ message, actions }: { message: string; actions?: ReactNode }) {
  const [open, setOpen] = useStateD(false)
  const text = useRefD<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useStateD(false)
  useEffectD(() => setOpen(false), [message])
  useEffectD(() => {
    const node = text.current
    if (!node || open) return
    const measure = () => setOverflow(node.scrollWidth > node.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [message, open])
  const expandable = open || overflow || /[\r\n]/.test(message)
  // 要电脑才能做的不是出错：灰色说明，和别处灰掉的按钮一个意思
  if (isNeedsShuttle(message)) return <span className="block w-full min-w-0 max-w-full text-xs text-muted-foreground">{message}</span>
  return <span className="block w-full min-w-0 max-w-full text-xs text-destructive">
    <span className="flex min-w-0 items-start gap-2">
      <span ref={text} className={cx('min-w-0 flex-1', open ? 'whitespace-pre-wrap font-mono leading-relaxed [overflow-wrap:anywhere]' : 'truncate')}>{message}</span>
      {expandable && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={tr('ui.error_details')} className="shrink-0 cursor-pointer underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {tr(open ? 'ui.collapse' : 'ui.details')}
      </button>}
    </span>
    {(open || !expandable) && actions && <span className="mt-2 block">{actions}</span>}
  </span>
}

/** 空状态 / 提示：平台的虚线框 */
export function Notice({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' }) {
  if (tone === 'error' && typeof children === 'string' && isNeedsShuttle(children)) return <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{children}</div>
  return tone === 'error' ? (
    <div className="min-w-0 max-w-full [overflow-wrap:anywhere] rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{typeof children === 'string' ? <ErrorDetails message={children} /> : children}</div>
  ) : (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-10 text-center text-sm leading-relaxed text-muted-foreground">{children}</div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-muted', className)} />
}

/** 胶囊分段切换：编辑器页面面板「PAGE | LAYERS」的样式 */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="relative flex h-8 w-fit items-center rounded-full border border-border bg-muted px-[2px] text-muted-foreground">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'my-[2px] inline-flex h-[calc(100%-4px)] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              on ? 'border-transparent bg-background text-primary-text shadow-sm dark:border-input dark:bg-input-background' : 'border-transparent hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const tones = {
  default: 'border-border bg-muted text-muted-foreground',
  primary: 'border-primary/10 bg-primary/10 text-primary-text',
  ok: 'border-emerald-500/15 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn: 'border-amber-500/15 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  bad: 'border-destructive/15 bg-destructive/10 text-destructive',
}
export type Tone = keyof typeof tones

/** 平台的徽标：rounded-md、border、浅色底、text-[10px] font-semibold */
export function Badge({ tone = 'default', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap', tones[tone], className)}>{children}</span>
}

export const inputCls =
  'flex w-full rounded-md border border-input bg-input-background px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50'

/** 原生 <dialog> 弹窗：Esc 关闭、焦点自动圈住、点遮罩关闭。text-left：dialog 渲染在按钮旁边，会继承外面（比如居中的空状态）的对齐 */
export function Dialog({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  return open ? <DialogInner onClose={onClose} title={title} footer={footer} width={width}>{children}</DialogInner> : null
}

/**
 * 弹窗里改过东西（输入框、文本框、富文本编辑器打过字）之后，点外面、按 Esc 都不关，晃一下提示用「取消」或「保存」：
 * 改了一半手一滑点到外面，改的就全丢了。没改过的照旧点外面就关。
 */
function DialogInner({ onClose, title, children, footer, width }: { onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width: number }) {
  const ref = useRefD<HTMLDialogElement>(null)
  const edited = useRefD(false)
  useEffectD(() => {
    ref.current?.showModal()
  }, [])
  const nudge = () => ref.current?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 220 })
  return (
    <dialog
      ref={ref}
      onInput={() => { edited.current = true }}
      onCancel={(e) => { if (edited.current) { e.preventDefault(); nudge() } }}
      onClose={(event) => { event.stopPropagation(); onClose() }}
      onClick={(e) => { if (e.target !== ref.current) return; if (edited.current) nudge(); else ref.current?.close() }}
      style={{ width: `min(92vw, ${width}px)` }}
      className="m-auto rounded-xl border border-border bg-popover p-0 text-left text-popover-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[min(85vh,760px)] flex-col">
        <div className="border-b border-border px-5 py-3.5 text-sm font-semibold">{title}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </dialog>
  )
}

/** 表单项 */
/**
 * 表单的一项：标题 + 控件 + 说明。默认是 <label>，点标题就聚焦里面的输入框。
 * 里面放的是一组按钮、图片（配图、视频这类）时传 group：label 里点哪儿都会替你点第一个按钮（比如删除图片），要换成 div。
 */
export function Field({ label, hint, group, children }: { label: ReactNode; hint?: ReactNode; group?: boolean; children: ReactNode }) {
  const body = <>
    <span className="text-sm leading-none font-medium">{label}</span>
    {children}
    {hint && <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>}
  </>
  return group ? <div role="group" className="grid content-start gap-2">{body}</div> : <label className="grid content-start gap-2">{body}</label>
}

/** 页面标题行：字号、间距和运营总览的标题一样（Overview.tsx 自己写的那行），改一处要一起改 */
export function PageHeader({ title, desc, actions, level = 1 }: { title: ReactNode; desc?: ReactNode; actions?: ReactNode; level?: 1 | 2 }) {
  const Heading = level === 2 ? 'h2' : 'h1'
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 flex-1 space-y-1 md:min-w-64">
        <Heading className={cx('leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]', level === 2 ? 'text-lg' : 'text-2xl')}>{title}</Heading>
        {desc && <div className="text-sm leading-relaxed text-muted-foreground">{desc}</div>}
      </div>
      {/* 按钮区限制宽度：错误在下一排折叠显示，不能把标题挤成一列 */}
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2 md:max-w-[60%] md:justify-end">{actions}</div>}
    </div>
  )
}

export const fmtTime = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return tr('common.just_now')
  if (diff < 3600) return tr('common.min_ago', { n: Math.floor(diff / 60) })
  if (diff < 86400) return tr('common.hour_ago', { n: Math.floor(diff / 3600) })
  if (diff < 86400 * 7) return tr('common.day_ago', { n: Math.floor(diff / 86400) })
  return fmtMonthDay(d)
}

/** 「9月24日」/「Sep 24」 */
export const fmtMonthDay = (d: Date) =>
  isEn() ? d.toLocaleDateString(numLocale(), { month: 'short', day: 'numeric' }) : tr('common.month_day', { m: d.getMonth() + 1, d: d.getDate() })
