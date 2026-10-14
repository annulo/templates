import type { ReactNode } from 'react'
import { cx } from './ui'

/** 页面级页签：地址栏持有状态，键盘方向键切换，深浅主题共享布局。
 * 页签没有左右内边距、靠 gap 隔开：第一个字和上面的标题、下面的内容左边对齐，下划线和文字一样宽。 */
export default function WorkspaceTabs<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (value: T) => void }) {
  return <div role="tablist" aria-label={label} className="flex gap-8 overflow-x-auto border-b border-border">
    {options.map((option, index) => <button key={option.value} type="button" role="tab" id={`${id}-${option.value}`} aria-controls={`${id}-panel`} aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1} onClick={() => onChange(option.value)} onKeyDown={(event) => {
      const next = event.key === 'ArrowRight' ? (index + 1) % options.length : event.key === 'ArrowLeft' ? (index + options.length - 1) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1
      if (next < 0) return
      event.preventDefault()
      onChange(options[next].value)
      const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      tabs?.[next]?.focus()
    }} className={cx('shrink-0 cursor-pointer rounded-t-sm border-b-2 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', value === option.value ? 'border-primary font-semibold text-primary-text' : 'border-transparent text-muted-foreground hover:text-foreground')}>{option.label}</button>)}
  </div>
}
