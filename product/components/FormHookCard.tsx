import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, Inbox } from 'lucide-react'
import { Button, Notice, cx } from './ui'
import { runLocal, type Channel } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { useCanRun } from '../lib/useShuttle'

type Hook = { url: string; base: string; key: string; header: string; field: string }

/**
 * WordPress 这类站点的表单询盘：给一个 webhook 地址（leads.formHook），用户贴进表单插件的 webhook 设置，
 * 有人提交就实时进「询盘线索」。creght 站点不用：它的表单是平台原生推送（leads.connect）。
 */
export default function FormHookCard({ channel }: { channel: Channel }) {
  const shuttle = useCanRun('leads.formHook') // 在 Shuttle 里，或者电脑在线时转给电脑
  const [hook, setHook] = useState<Hook | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!shuttle) return
    runLocal<Hook>('leads.formHook', { channel_id: channel.id })
      .then(setHook)
      .catch((e) => setError((e as Error).message))
  }, [channel.id, shuttle])
  const copy = async (k: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(k)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      // 复制不了就让用户手动选
    }
  }
  const field = (k: string, label: string, value: string) => (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs select-all">{value}</code>
        <Button variant="outline" size="sm" onClick={() => copy(k, value)}>
          {copied === k ? <Check /> : <Copy />} {copied === k ? tr('leads.copied') : tr('leads.copy')}
        </Button>
      </div>
    </div>
  )
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <Inbox className="size-4 text-muted-foreground" /> {tr('formhook.title')}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{tr('formhook.desc')}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {hook && (
        <div className="space-y-3">
          {field('url', tr('formhook.url'), hook.url)}
          {field('key', tr('formhook.key', { field: hook.field, header: hook.header }), hook.key)}
          <button type="button" onClick={() => setOpen(!open)} className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-primary-text">
            <ChevronDown className={cx('size-3.5 transition-transform', !open && '-rotate-90')} /> {tr('formhook.howto')}
          </button>
          {open && (
            <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
              <li>{tr('formhook.elementor')}</li>
              <li>{tr('formhook.wpforms')}</li>
              <li>{tr('formhook.cf7')}</li>
              <li>{tr('formhook.other')}</li>
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
