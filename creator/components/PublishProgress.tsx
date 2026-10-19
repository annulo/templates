import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, Eye, Loader2, Square, X, XCircle } from 'lucide-react'
import { Button, toast } from './ui'
import { clearFinished, reveal, stop, usePublishQueue } from '../lib/publishQueue'
import { tr } from '../lib/i18n'

/**
 * 右下角的发布进度：后台在发的时候显示「发布中 1/3 · 账号 · 正在做哪一步」，切到别的页面也一直在；
 * 发完显示成功几个、失败几个，点「查看」打开那篇文章的发布记录，「×」收起。页面（pages/Index.tsx）挂一个就行。
 * 「过程」展开这条报过的每一步（最新的在最下面、自动滚到底），左边是这一步用了多久（到下一步开始为止，正在做的那步实时走）；
 * 浏览器助手做完时最后一行是总耗时和 token（输入 + 输出），悬停看模型、输入、输出、缓存。发完也能看
 */
const dur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` }
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
export default function PublishProgress({ onOpen }: { onOpen: (articleId: string) => void }) {
  const jobs = usePublishQueue()
  // hook 都放在提前返回之前：没有发布任务时也要调用同样几个，不然 React 报 hooks 顺序变了
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  const list = useRef<HTMLOListElement>(null)
  const runningSteps = jobs.find((j) => j.state === 'running')?.steps?.length ?? 0
  // 正在跑时每秒刷新一次（最后一步的耗时实时走）；有新的一步就滚到底
  useEffect(() => { if (!open || !runningSteps) return; const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t) }, [open, runningSteps > 0])
  useEffect(() => { if (open && list.current) list.current.scrollTop = list.current.scrollHeight }, [open, runningSteps, jobs])
  if (!jobs.length) return null
  const active = jobs.find((j) => j.state === 'running') ?? jobs.find((j) => j.state === 'queued')
  const done = jobs.filter((j) => j.state === 'ok' || j.state === 'error').length
  const failed = jobs.filter((j) => j.state === 'error').length
  const last = active ?? jobs[jobs.length - 1]
  const shown = active ?? [...jobs].reverse().find((j) => j.steps?.length)
  const steps = shown?.steps ?? []
  return <div role="status" aria-live="polite" className="fixed right-4 bottom-4 z-[90] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
    <div className="flex items-start gap-2.5">
      {active ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary-text" /> : failed ? <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{active ? tr('article.progress_running', { done: done + 1, n: jobs.length }) : failed ? tr('article.progress_done_failed', { ok: done - failed, failed }) : tr('article.progress_done', { n: done })}</div>
        {active ? <p className="mt-0.5 line-clamp-2 text-xs break-all text-muted-foreground" title={`${active.channel_name} · ${active.article_title}`}>{active.channel_name} · {active.state === 'running' ? active.step || tr('article.pub_running') : tr('article.pub_queued')}</p>
          : failed ? <p className="mt-0.5 line-clamp-2 text-xs text-destructive">{jobs.filter((j) => j.state === 'error').map((j) => `${j.channel_name}：${j.error}`).join('；')}</p>
          : <p className="mt-0.5 truncate text-xs text-muted-foreground">{last.article_title}</p>}
      </div>
      {!active && <button type="button" onClick={clearFinished} aria-label={tr('common.close')} className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
    </div>
    {open && steps.length > 0 && <ol ref={list} className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
      {steps.map((s, i) => <li key={i} className="flex gap-2">
        <span className="w-10 shrink-0 text-right tabular-nums">{dur((steps[i + 1]?.at ?? shown?.finished_at ?? Date.now()) - s.at)}</span>
        <span className="min-w-0 break-all">{s.text}</span>
      </li>)}
      {shown?.summary && <li className="flex gap-2 border-t border-border pt-1 font-medium text-foreground">
        <span className="w-10 shrink-0 text-right tabular-nums">{dur(shown.summary.total_ms)}</span>
        <span className="min-w-0 cursor-default" title={tr('article.pub_usage_tip', { model: shown.summary.model || '-', input: shown.summary.input, output: shown.summary.output, cache: shown.summary.cache_read })}>
          {tr('article.pub_total', { time: dur(shown.summary.total_ms), tokens: tok(shown.summary.input + shown.summary.output) })}
        </span>
      </li>}
    </ol>}
    <div className="mt-2 flex flex-wrap justify-end gap-1">
      {steps.length > 0 && <Button size="sm" variant="ghost" feedback={false} className="mr-auto" onClick={() => setOpen((x) => !x)}>{open ? <ChevronUp /> : <ChevronDown />}{tr('article.pub_steps', { n: steps.length })}</Button>}
      {active?.state === 'running' && <>
        <Button size="sm" variant="ghost" feedback={false} onClick={() => reveal(active.key).catch((e) => toast((e as Error).message, 'error'))}><Eye />{tr('article.pub_show')}</Button>
        <Button size="sm" variant="ghost" feedback={false} className="text-destructive" onClick={() => stop(active.key).catch((e) => toast((e as Error).message, 'error'))}><Square />{tr('article.pub_stop')}</Button>
      </>}
      <Button size="sm" variant="ghost" feedback={false} onClick={() => onOpen(last.article_id)}>{tr('article.progress_view')}</Button>
    </div>
  </div>
}
