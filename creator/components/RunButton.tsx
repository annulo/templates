import { useState, type ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { runLocal, type Progress } from '../lib/annulo'
import { Button } from './ui/button'

/**
 * 跑一个本机函数的按钮（确定的操作：发布、采集、自检……）：按钮上显示进度，跑完调 onDone，出错把原因写在按钮下面。
 * 写稿这类要 AI 想的活不用它，用 Task.tsx 的 TaskButton 交给助手。
 */
export function RunButton({ fn, input, onDone, icon: Icon, variant = 'outline', size = 'sm', children }: { fn: string; input?: unknown; onDone?: (r: unknown) => void; icon?: LucideIcon; variant?: 'default' | 'outline' | 'ghost' | 'destructive'; size?: 'sm' | 'default'; children: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const run = async () => {
    setBusy(true)
    setError('')
    setProgress('')
    try {
      onDone?.(await runLocal(fn, input ?? {}, (p: Progress) => p.message && setProgress(p.message)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <Button variant={variant} size={size} disabled={busy} onClick={run}>
        {busy ? <Loader2 className="animate-spin" /> : Icon && <Icon />}
        {busy && progress ? <span className="max-w-56 truncate">{progress}</span> : children}
      </Button>
      {error && <span className="max-w-80 text-xs text-destructive [overflow-wrap:anywhere]">{error}</span>}
    </span>
  )
}
