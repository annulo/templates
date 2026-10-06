import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'talizen'
import { CalendarClock, Check, ExternalLink, Loader2, Pencil, Send, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { db, onRefresh, openChat, openSettings, runLocal } from '../../lib/annulo'
import type { Ctx } from '../../lib/ctx'
import { PLATFORMS, WRITE_TASKS, platformLabel, postsOf, writePosts, type Account, type Post } from '../../lib/social'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input, Textarea } from '../ui/input'
import { confirm } from '../ui/confirm'
import { DatePicker } from '../ui/date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { PlatformBadge } from '../PlatformBadge'
import { RunButton } from '../RunButton'
import { TaskRequirements, TaskRunning, useTaskRuns } from '../Task'
import type { Draft } from './Drafts'

/**
 * 一篇稿件发到社媒：勾账号 → 交给助手按社媒插件的任务（social/write-<平台>）每个账号写一版 → 审核 → 发布或排期。
 * 发布、删除由插件的本机函数做（social/social.publish、remove、purge），审核、排期就是改帖子的 status、scheduled_at。
 */
export default function Distribute({ ctx, draft }: { ctx: Ctx; draft: Draft }) {
  const t = useTranslations('dist')
  const locale = useLocale()
  const [posts, setPosts] = useState<Post[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (ctx.plugin) postsOf(draft.id).then(setPosts).catch(() => {})
  }, [draft.id, ctx.plugin])
  useEffect(() => {
    load()
    return onRefresh(load)
  }, [load])
  const writing = useTaskRuns(WRITE_TASKS, (r) => r.input?.source?.id === draft.id, load)

  if (!ctx.plugin)
    return (
      <section className="space-y-2 rounded-xl border border-dashed border-border p-4 text-sm">
        <h3 className="font-semibold">{t('title')}</h3>
        <p className="text-muted-foreground">{t('noPlugin')}</p>
        <Button variant="outline" size="sm" onClick={() => openSettings('backend')}>
          {t('openSettings')}
        </Button>
      </section>
    )

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const chats = await writePosts(
        draft.id,
        ctx.accounts.filter((a) => picked.has(a.id)),
      )
      if (chats[0]) openChat(chats[0])
      setPicked(new Set())
      writing.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // 「AI 要求」：有账号的平台各一个（写法是插件的默认，用户改的存 user/plugins/social/prompts/）
  const platforms = [...new Set(ctx.accounts.map((a) => a.type))]
  const reqTasks = writing.tasks.filter((task) => platforms.some((p) => PLATFORMS[p]?.task === task.id))

  return (
    <section className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">{t('desc')}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {reqTasks.map((task) => (
            <TaskRequirements key={task.id} task={task} onSaved={writing.setTask} label={t('reqPlatform', { platform: platformLabel(task.id.replace('social/write-', ''), locale) })} />
          ))}
        </div>
      </div>

      {ctx.accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('noAccounts')}{' '}
          <button type="button" className="font-medium text-primary-text hover:underline" onClick={() => ctx.go('accounts')}>
            {t('addAccount')}
          </button>
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {ctx.accounts.map((a) => (
              <label key={a.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', picked.has(a.id) ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50')}>
                <input type="checkbox" className="sr-only" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                <PlatformBadge type={a.type} className="size-5" />
                {a.name}
                {picked.has(a.id) && <Check className="size-3.5 text-primary-text" />}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={generate} disabled={busy || picked.size === 0 || !draft.body?.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {t('generate', { n: picked.size })}
            </Button>
            {!draft.body?.trim() && <span className="text-xs text-muted-foreground">{t('needBody')}</span>}
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>
        </div>
      )}

      <TaskRunning runs={writing.runs} title={(r) => t('writingRun', { platform: WRITE_TASKS.includes(r.task) ? platformLabel(r.task.replace('social/write-', ''), locale) : r.task })} />

      {posts.length > 0 && (
        <ul className="space-y-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} account={ctx.accounts.find((a) => a.id === p.channel_id)} onChanged={load} />
          ))}
        </ul>
      )}
    </section>
  )
}

const REVIEWABLE = ['draft', 'pending_review', 'rejected', 'failed']
/** 排期能选的时间：每半小时一个 */
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

function PostCard({ post, account, onChanged }: { post: Post; account?: Account; onChanged: () => void }) {
  const t = useTranslations('dist')
  const locale = useLocale()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(post.body ?? '')
  const [video, setVideo] = useState(post.video ?? '')
  const [day, setDay] = useState('')
  const [time, setTime] = useState('09:00')
  const [problems, setProblems] = useState<string[]>([])
  const videoOnly = account && PLATFORMS[account.type]?.videoOnly

  const patch = async (fields: Record<string, unknown>) => {
    await db.update('social_posts', post.id, { ...fields, updated_at: new Date().toISOString() })
    onChanged()
  }
  const saveEdit = async () => {
    await patch({ body, video })
    setEditing(false)
    // 按平台的规格检查一遍（字数、话题、配图……），有问题列出来
    const r = await runLocal<{ problems: string[] }>('social/social.check', { post_id: post.id }).catch(() => ({ problems: [] }))
    setProblems(r.problems ?? [])
  }
  // 排期：本机时区的日期 + 时间，存成 ISO 时间；插件的定时任务每几分钟把到点的发出去
  const schedule = () => {
    const at = new Date(`${day}T${time}:00`)
    if (!day || isNaN(at.getTime())) return
    patch({ status: 'scheduled', scheduled_at: at.toISOString() })
  }
  const purge = async () => {
    if (await confirm({ title: t('confirmPurge'), danger: true })) runLocal('social/social.purge', { post_id: post.id }).then(onChanged)
  }

  return (
    <li className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {account && <PlatformBadge type={account.type} />}
        <span className="text-sm font-medium">{account?.name ?? t('unknownAccount')}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t(`status.${post.status}`)}</span>
        {post.status === 'scheduled' && post.scheduled_at && <span className="text-xs text-muted-foreground">{new Date(post.scheduled_at).toLocaleString(locale)}</span>}
        {post.post_url && (
          <a href={post.post_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary-text hover:underline">
            {t('openPost')} <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="text-sm" />
          {videoOnly && <Input value={video} onChange={(e) => setVideo(e.target.value)} placeholder={t('videoPlaceholder')} className="font-mono text-xs" />}
          <div className="flex gap-2">
            <Button size="sm" onClick={saveEdit}>
              <Check /> {t('save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {post.title && <div className="text-sm font-medium">{post.title}</div>}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{post.body}</p>
          {videoOnly && !post.video && <p className="text-xs text-amber-600 dark:text-amber-400">{t('needVideo')}</p>}
        </>
      )}

      {problems.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-600 dark:text-amber-400">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {post.status === 'failed' && post.error && <p className="text-xs text-destructive [overflow-wrap:anywhere]">{post.error}</p>}
      {post.status === 'published' && (
        <p className="text-xs text-muted-foreground">{t('metrics', { views: post.views ?? 0, likes: post.likes ?? 0, comments: post.comments ?? 0 })}</p>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-2">
          {REVIEWABLE.includes(post.status) && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil /> {t('edit')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => patch({ status: 'approved' })}>
                <Check /> {t('approve')}
              </Button>
              {post.status !== 'rejected' && (
                <Button size="sm" variant="ghost" onClick={() => patch({ status: 'rejected' })}>
                  <X /> {t('reject')}
                </Button>
              )}
            </>
          )}
          {(post.status === 'approved' || post.status === 'failed') && (
            <>
              <RunButton fn="social/social.publish" input={{ post_id: post.id }} icon={Send} variant="default" onDone={onChanged}>
                {t('publish')}
              </RunButton>
              <span className="inline-flex flex-wrap items-center gap-1">
                <DatePicker value={day} onChange={setDay} placeholder={t('day')} className="h-8 w-40" />
                <Select value={time} onValueChange={setTime}>
                  <SelectTrigger size="sm" className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {TIMES.map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={!day} onClick={schedule}>
                  <CalendarClock /> {t('schedule')}
                </Button>
              </span>
            </>
          )}
          {post.status === 'scheduled' && (
            <Button size="sm" variant="ghost" onClick={() => patch({ status: 'approved', scheduled_at: null })}>
              <Undo2 /> {t('unschedule')}
            </Button>
          )}
          {post.status === 'published' && (
            <RunButton fn="social/social.remove" input={{ post_id: post.id }} icon={Trash2} variant="ghost" onDone={onChanged}>
              {t('removeFromPlatform')}
            </RunButton>
          )}
          {post.status !== 'published' && post.status !== 'publishing' && (
            <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={purge}>
              <Trash2 /> {t('purge')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
