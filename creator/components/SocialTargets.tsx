import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Loader2, MessageSquareText, Sparkles } from 'lucide-react'
import { Badge, Button, cx, type Tone } from './ui'
import { useTaskRuns } from './Task'
import { dbList, openChat, shuttleImage, type Channel, type SocialPost, type SocialPostStatus } from '../lib/shuttle'
import { SOCIAL, SOCIAL_TASKS, platformOf, writeSocial } from '../lib/social'
import type { Ctx } from './views/types'
import { tr } from '../lib/i18n'

const TONE: Record<SocialPostStatus, Tone> = { draft: 'default', pending_review: 'warn', approved: 'primary', scheduled: 'primary', publishing: 'warn', published: 'ok', failed: 'bad', rejected: 'default', removed: 'default' }
const STATUS = Object.fromEntries(
  (Object.keys(TONE) as SocialPostStatus[]).map((k) => [k, { get label() { return tr(`meta.social_status.${k}`) }, tone: TONE[k] }]),
) as Record<SocialPostStatus, { label: string; tone: Tone }>

/**
 * 文章详情里的「发到社媒」：这篇文章发到哪些账号（小红书、X）由用户勾选，交给助手按各平台的任务（tasks/write-<平台>.md）每个账号各写一篇待审的，过程看得见。
 * 已经为某个账号生成过的显示那篇笔记的状态，点它去社媒页看。
 */
export default function SocialTargets({ ctx, articleId }: { ctx: Ctx; articleId: string }) {
  const accounts = ctx.channels.filter((c) => !!SOCIAL[c.type])
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const load = useCallback(() => {
    dbList('social_posts')
      .then((l) => setPosts(l.filter((p) => p.article_id === articleId)))
      .catch(() => {})
  }, [articleId])
  useEffect(load, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])
  const { runs } = useTaskRuns(SOCIAL_TASKS, (r) => r.input?.source?.id === articleId, load)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const writing = (id: string) => runs.find((r) => (r.input?.channel_ids ?? []).includes(id))
  const generate = async () => {
    setStarting(true)
    setError('')
    try {
      await writeSocial(articleId, picked, accounts)
      setPicked([])
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setStarting(false)
    }
  }

  if (accounts.length === 0) return null
  const postOf = (a: Channel) => posts.find((p) => p.channel_id === a.id && p.status !== 'rejected' && p.status !== 'removed')
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const open = (a: Channel) => ctx.go('social', { section: 'data', account: a.id })

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4 text-sm">
      <div className="font-semibold">{tr('ui.targets_title')}</div>
      <p className="text-xs text-muted-foreground">{tr('ui.targets_desc')}</p>
      <div className="grid grid-cols-1 gap-1.5">
        {accounts.map((a) => {
          const p = postOf(a)
          const w = !p && writing(a.id)
          const avatar = a.avatar ? <img src={shuttleImage(a.avatar)} alt="" className="size-5 rounded-full object-cover" /> : <div className="size-5 rounded-full bg-muted" />
          return w ? (
            <button key={a.id} type="button" onClick={() => openChat(w.chat_id)} title={tr('task.view')} className="flex cursor-pointer items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-left hover:bg-primary/10">
              {avatar}
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <Loader2 className="size-3.5 animate-spin text-primary-text" />
              <span className="text-xs text-primary-text">{tr('ui.writing')}</span>
              <MessageSquareText className="size-3.5 text-muted-foreground" />
            </button>
          ) : p ? (
            <button key={a.id} type="button" onClick={() => open(a)} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left hover:bg-accent">
              {avatar}
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="text-xs text-muted-foreground">{platformOf(a)?.label}</span>
              <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
              <ArrowUpRight className="size-3.5 text-muted-foreground" />
            </button>
          ) : (
            <label key={a.id} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5', picked.includes(a.id) ? 'border-primary/50 bg-primary/5' : 'border-border')}>
              <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} className="size-4 accent-[var(--primary)]" />
              {avatar}
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="text-xs text-muted-foreground">{platformOf(a)?.label}</span>
            </label>
          )
        })}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {picked.length > 0 && (
        <Button variant="outline" className="w-full" onClick={generate} disabled={starting}>
          {starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {picked.length > 1 ? tr('ui.generate_n', { n: picked.length }) : tr('ui.generate')}
        </Button>
      )}
    </div>
  )
}
