import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import { Button, fmtUntil, inputCls } from './ui'
import { tr } from '../lib/i18n'

/** datetime-local 要的本地时间：给了 iso（改时间）就是它，没给是下一个整点 */
function localInput(iso?: string) {
  let d = new Date(iso ?? '')
  if (!iso || isNaN(d.getTime())) {
    d = new Date(Date.now() + 3600_000)
    d.setMinutes(0, 0, 0)
  }
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 已排期的那一行字：「2 小时 15 分钟后（10月7日 17:00）自动发布」，每 30 秒刷新；过了时间还没发出去时说明会补发 */
export function ScheduledLine({ at, className }: { at?: string; className?: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const u = fmtUntil(at)
  if (!u) return null
  return <p className={className ?? 'text-xs text-muted-foreground'}>{u.due ? tr('versions.scheduled_due', { at: u.at }) : tr('versions.scheduled_in', { rel: u.rel, at: u.at })}</p>
}

/**
 * 「排期」按钮。已排期时按钮显示「已排期 10月7日 17:00」，点开的气泡里改时间或取消排期（onUnschedule），不另放取消排期的按钮。
 * 没排期时：点了在按钮上方弹一个小气泡选时间（默认下一个整点），点「确定排期」才排；点外面、按 Esc 收起。
 * 时间框不一直摆在那里，也不用整屏的弹窗。onSchedule 收到 ISO 时间，抛错时气泡里显示报错、不收起。
 */
export default function SchedulePopover({ onSchedule, onUnschedule, hint, disabled, size = 'default', current }: { onSchedule: (iso: string) => Promise<unknown>; onUnschedule?: () => Promise<unknown>; hint?: ReactNode; disabled?: boolean; size?: 'sm' | 'default'; /** 已经排了的时间：按钮显示它，气泡里预填它 */ current?: string }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const toggle = () => {
    if (!open) { setAt(localInput(current)); setError('') }
    setOpen(!open)
  }
  const unschedule = async () => {
    if (!onUnschedule) return
    setSaving(true)
    try {
      await onUnschedule()
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const scheduled = current ? fmtUntil(current) : null
  const confirm = async () => {
    const ts = Date.parse(at)
    if (!ts || ts <= Date.now()) { setError(tr('versions.future_time')); return }
    setSaving(true)
    try {
      await onSchedule(new Date(ts).toISOString())
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div ref={ref} className="relative">
      <Button size={size} variant="outline" onClick={toggle} disabled={disabled} aria-expanded={open}>
        <CalendarClock />
        {scheduled ? tr('versions.scheduled_btn', { at: scheduled.at }) : tr('social.schedule')}
      </Button>
      {open && (
        <div role="dialog" aria-label={tr('social.schedule_title')} className="absolute bottom-full left-0 z-30 mb-2 w-72 space-y-2.5 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="text-xs font-medium">{tr('social.f_time')}</div>
          <input type="datetime-local" autoFocus className={inputCls} value={at} onChange={(e) => { setAt(e.target.value); setError('') }} onKeyDown={(e) => { if (e.key === 'Enter') void confirm() }} />
          {error ? <p className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
          <div className="flex items-center justify-end gap-2">
            {scheduled && onUnschedule ? (
              <Button size="sm" variant="ghost" className="mr-auto text-destructive" onClick={unschedule} disabled={saving}>{tr('versions.unschedule')}</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{tr('common.cancel')}</Button>
            )}
            <Button size="sm" onClick={confirm} disabled={saving || !at}>{saving && <Loader2 className="animate-spin" />}{scheduled ? tr('versions.reschedule_confirm') : tr('versions.schedule_confirm')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
