import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, Loader2, MessageSquareText, Minus, RotateCw, X } from 'lucide-react'
import { Button, cx } from './ui'
import { openChat, runLocal, runTask } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import type { Ctx } from './views/types'

type Step = { key: string; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; summary?: string; error?: string }
export type DiagnosisRun = { id: string; channel_id: string; status: 'running' | 'done' | 'failed'; steps: Step[]; chat_id: string; seen: boolean; started_at: string; finished_at: string }

/** 开一次「分析网站」（local/diagnosis.ts + 任务 site-diagnosis）：已经在跑的不重复开 */
export async function startDiagnosis(channel_id?: string) {
  const run = await runLocal<DiagnosisRun>('diagnosis.start', channel_id ? { channel_id } : {})
  if (run.status === 'running' && run.chat_id) return run
  const { chat_id } = await runTask('site-diagnosis', { id: run.id })
  await runLocal('diagnosis.attach', { id: run.id, chat_id }).catch(() => {})
  // 页面上的进度卡片马上刷新（它们听这个事件）
  window.dispatchEvent(new Event('diagnosis:changed'))
  return { ...run, chat_id }
}

/**
 * 总览上「分析网站」的进度（site_diagnosis）：在跑时每一步的状态，跑完给结论和「看计划」，看过就收起来。
 * 没跑过、跑完看过了不显示。跑的时候每 5 秒刷新一次
 */
export default function Diagnosis({ ctx }: { ctx: Ctx }) {
  const [run, setRun] = useState<DiagnosisRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(() => runLocal<{ run: DiagnosisRun | null }>('diagnosis.get', {}).then((r) => setRun(r.run)).catch(() => {}), [])
  useEffect(() => { load() }, [load, ctx.rev])
  useEffect(() => {
    window.addEventListener('diagnosis:changed', load)
    return () => window.removeEventListener('diagnosis:changed', load)
  }, [load])
  const running = run?.status === 'running'
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(load, 5000)
    return () => clearInterval(t)
  }, [running, load])

  if (!run || (run.seen && !running)) return null
  const done = run.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length
  const hide = () => runLocal('diagnosis.seen', { id: run.id }).then(load).catch(() => {})
  const again = async () => {
    setBusy(true)
    setErr('')
    try {
      await runLocal('diagnosis.seen', { id: run.id }).catch(() => {})
      setRun(await startDiagnosis(run.channel_id))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {running && <Loader2 className="size-4 animate-spin text-primary" />}
            {tr(running ? 'diagnosis.title_running' : run.status === 'done' ? 'diagnosis.title_done' : 'diagnosis.title_failed')}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{running ? tr('diagnosis.desc_running', { done, total: run.steps.length }) : run.status === 'done' ? tr('diagnosis.desc_done') : tr('diagnosis.desc_failed')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {run.chat_id && <Button variant="ghost" size="sm" onClick={() => openChat(run.chat_id)}><MessageSquareText />{tr('diagnosis.chat')}</Button>}
          {run.status === 'done' && <Button size="sm" onClick={() => { hide(); ctx.go('plan') }}>{tr('diagnosis.see_plan')}<ArrowRight /></Button>}
          {run.status === 'failed' && <Button size="sm" variant="outline" disabled={busy} onClick={again}>{busy ? <Loader2 className="animate-spin" /> : <RotateCw />}{tr('diagnosis.again')}</Button>}
          {!running && <Button variant="ghost" size="sm" onClick={hide}>{tr('diagnosis.hide')}</Button>}
        </div>
      </div>
      <ol className="space-y-1.5">
        {run.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2.5 text-sm">
            <StepIcon status={s.status} />
            <div className="min-w-0 flex-1">
              <span className={cx('font-medium', s.status === 'pending' && 'text-muted-foreground')}>{tr(`diagnosis.step_${s.key}`)}</span>
              {s.status === 'running' && <span className="ml-2 text-xs text-muted-foreground">{tr(`diagnosis.doing_${s.key}`)}</span>}
              {(s.summary || s.error) && <p className={cx('text-xs leading-relaxed', s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{s.status === 'failed' ? s.error || s.summary : s.summary}</p>}
            </div>
          </li>
        ))}
      </ol>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  )
}

function StepIcon({ status }: { status: Step['status'] }) {
  const base = 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full'
  if (status === 'running') return <span className={cx(base, 'bg-primary/10 text-primary')}><Loader2 className="size-3.5 animate-spin" /></span>
  if (status === 'done') return <span className={cx(base, 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400')}><Check className="size-3.5" /></span>
  if (status === 'failed') return <span className={cx(base, 'bg-destructive/10 text-destructive')}><X className="size-3.5" /></span>
  if (status === 'skipped') return <span className={cx(base, 'bg-muted text-muted-foreground')}><Minus className="size-3.5" /></span>
  return <span className={cx(base, 'border border-border')} />
}
