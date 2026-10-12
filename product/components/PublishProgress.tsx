import { CheckCircle2, Eye, Loader2, Square, X, XCircle } from 'lucide-react'
import { Button, toast } from './ui'
import { clearFinished, reveal, stop, usePublishQueue } from '../lib/publishQueue'
import { tr } from '../lib/i18n'

/**
 * 右下角的发布进度：后台在发的时候显示「发布中 1/3 · 账号 · 正在做哪一步」，切到别的页面也一直在；
 * 发完显示成功几个、失败几个，点「查看」打开那篇文章的发布记录，「×」收起。页面（pages/Index.tsx）挂一个就行
 */
export default function PublishProgress({ onOpen }: { onOpen: (articleId: string) => void }) {
  const jobs = usePublishQueue()
  if (!jobs.length) return null
  const active = jobs.find((j) => j.state === 'running') ?? jobs.find((j) => j.state === 'queued')
  const done = jobs.filter((j) => j.state === 'ok' || j.state === 'error').length
  const failed = jobs.filter((j) => j.state === 'error').length
  const last = active ?? jobs[jobs.length - 1]
  return <div role="status" aria-live="polite" className="fixed right-4 bottom-4 z-[90] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
    <div className="flex items-start gap-2.5">
      {active ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary-text" /> : failed ? <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{active ? tr('article.progress_running', { done: done + 1, n: jobs.length }) : failed ? tr('article.progress_done_failed', { ok: done - failed, failed }) : tr('article.progress_done', { n: done })}</div>
        {active ? <p className="mt-0.5 truncate text-xs text-muted-foreground" title={`${active.channel_name} · ${active.article_title}`}>{active.channel_name} · {active.state === 'running' ? active.step || tr('article.pub_running') : tr('article.pub_queued')}</p>
          : failed ? <p className="mt-0.5 line-clamp-2 text-xs text-destructive">{jobs.filter((j) => j.state === 'error').map((j) => `${j.channel_name}：${j.error}`).join('；')}</p>
          : <p className="mt-0.5 truncate text-xs text-muted-foreground">{last.article_title}</p>}
      </div>
      {!active && <button type="button" onClick={clearFinished} aria-label={tr('common.close')} className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
    </div>
    <div className="mt-2 flex flex-wrap justify-end gap-1">
      {active?.state === 'running' && <>
        <Button size="sm" variant="ghost" feedback={false} onClick={() => reveal(active.key).catch((e) => toast((e as Error).message, 'error'))}><Eye />{tr('article.pub_show')}</Button>
        <Button size="sm" variant="ghost" feedback={false} className="text-destructive" onClick={() => stop(active.key).catch((e) => toast((e as Error).message, 'error'))}><Square />{tr('article.pub_stop')}</Button>
      </>}
      <Button size="sm" variant="ghost" feedback={false} onClick={() => onOpen(last.article_id)}>{tr('article.progress_view')}</Button>
    </div>
  </div>
}
