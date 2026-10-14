import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Check, Loader2, MessageSquareText, RefreshCw, Send, Sparkles } from 'lucide-react'
import { Badge, Button, cx } from './ui'
import { dbList, isSite, openChat, runLocal, runTask, type Channel, type Publication } from '../lib/shuttle'
import { useTaskRuns } from './Task'
import { useCanRunAll } from '../lib/useShuttle'
import { tr } from '../lib/i18n'
import type { Ctx } from './views/types'

/** 任务 id（tasks/setup-publish.md）：让助手给一个网站配置文章发布（写发布脚本），发布失败时也按它修 */
export const SETUP_TASK = 'setup-publish'

/** 让助手配置（或修）一个网站的文章发布：开一段对话，在右侧打开 */
export async function setupPublish(channelId: string, note?: string) {
  const r = await runTask(SETUP_TASK, { channel_id: channelId, ...(note ? { note } : {}) })
  openChat(r.chat_id)
  return r.chat_id
}

/**
 * 文章页的「发布到网站」：一篇文章可以发到多个网站，每个网站单独显示状态。
 * 只有配好发布设置（publish_status = ready，助手写好了发布脚本）的网站能勾选；没配好的只给「让 AI 配置」，系统不替它猜字段。
 * 发布就是执行那个网站的发布脚本 <publisher>.publish（本机函数，不经过助手）；再发一次就是更新。
 */
export default function PublishTargets({ ctx, articleId, disabled, onChanged }: { ctx: Ctx; articleId: string; disabled?: boolean; onChanged: () => void }) {
  const sites = ctx.channels.filter(isSite)
  const [pubs, setPubs] = useState<Publication[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState('') // 正在发的网站 id
  const [errors, setErrors] = useState<Record<string, string>>({})
  const load = useCallback(() => {
    dbList('publications')
      .then((l) => setPubs(l.filter((p) => p.article_id === articleId)))
      .catch(() => setPubs([]))
  }, [articleId])
  useEffect(load, [load, ctx.rev])
  // 助手正在配置的网站（配完 ctx.rev 会变，网站列表跟着刷新）
  const { runs } = useTaskRuns([SETUP_TASK], () => true, () => ctx.reloadChannels())
  const configuring = (id: string) => runs.find((r) => r.input?.channel_id === id)

  if (!sites.length)
    return (
      <div className="space-y-2 rounded-xl border border-border bg-background p-4 text-sm">
        <div className="font-semibold">{tr('publish.title')}</div>
        <p className="text-xs text-muted-foreground">{tr('publish.no_site')}</p>
        <Button variant="outline" size="sm" onClick={() => ctx.go('channels')}>
          {tr('publish.add_site')}
        </Button>
      </div>
    )

  const pubOf = (id: string) => pubs.find((p) => p.channel_id === id)
  const publishTo = async (ch: Channel) => {
    setBusy(ch.id)
    setErrors((e) => ({ ...e, [ch.id]: '' }))
    try {
      await runLocal(`${ch.publisher}.publish`, { article_id: articleId })
    } catch (e) {
      setErrors((x) => ({ ...x, [ch.id]: (e as Error).message }))
      return false
    } finally {
      setBusy('')
      load()
      onChanged()
    }
  }
  const publishPicked = async () => {
    let ok = true
    for (const id of picked) {
      const ch = sites.find((s) => s.id === id)
      if (ch?.publisher && (await publishTo(ch)) === false) ok = false
    }
    setPicked([])
    return ok
  }
  // 每个网站按自己的发布函数判断：在 Shuttle 里都能发，不在的话声明了 remote 的电脑在线才能发（lib/useShuttle.ts）
  const canPublish = useCanRunAll(sites.filter((c) => c.publisher).map((c) => `${c.publisher}.publish`))
  const locked = disabled || !!busy
  const lockedFor = (ch: Channel) => locked || !ch.publisher || !canPublish[`${ch.publisher}.publish`]
  const pickable = (ch: Channel) => ch.publish_status === 'ready' && !!ch.publisher && !pubOf(ch.id)?.url
  // 有能勾选的网站时，别的网站留出勾选框的位置让名字对齐；一个都不能勾就不留
  const indent = sites.some(pickable)

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4 text-sm">
      <div className="font-semibold">{tr('publish.title')}</div>
      <p className="text-xs text-muted-foreground">{tr('publish.desc')}</p>
      <div className="grid grid-cols-1 gap-2">
        {sites.map((ch) => {
          const p = pubOf(ch.id)
          const ready = ch.publish_status === 'ready' && !!ch.publisher
          const run = configuring(ch.id)
          const err = errors[ch.id] || (p?.status === 'failed' ? p.error : '')
          return (
            <div key={ch.id} className={cx('rounded-lg border px-2.5 py-2', picked.includes(ch.id) ? 'border-primary/50 bg-primary/5' : 'border-border')}>
              <div className="flex items-center gap-2">
                {pickable(ch) ? (
                  <input
                    type="checkbox"
                    checked={picked.includes(ch.id)}
                    disabled={lockedFor(ch)}
                    onChange={() => setPicked((l) => (l.includes(ch.id) ? l.filter((x) => x !== ch.id) : [...l, ch.id]))}
                    className="size-4 accent-[var(--primary)]"
                    aria-label={ch.name}
                  />
                ) : (
                  indent && <span className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{ch.name}</span>
                {busy === ch.id ? (
                  <Loader2 className="size-3.5 animate-spin text-primary-text" />
                ) : p?.status === 'published' ? (
                  <Badge tone="ok">
                    <Check className="size-3" /> {tr('publish.published')}
                  </Badge>
                ) : p?.status === 'failed' ? (
                  <Badge tone="bad">{tr('publish.failed')}</Badge>
                ) : !ready ? (
                  <Badge tone="default">{ch.publish_status === 'broken' ? tr('publish.broken') : tr('publish.not_ready')}</Badge>
                ) : null}
              </div>
              {/* 已发布：地址 + 更新（改了文章再发一次） */}
              {p?.url && (
                <div className={cx('mt-1.5 flex items-center gap-3 text-xs', indent && 'pl-6')}>
                  <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate font-medium hover:text-primary-text">
                    {tr('publish.view')} <ArrowUpRight className="size-3" />
                  </a>
                  {ready && (
                    <button type="button" disabled={lockedFor(ch)} onClick={() => publishTo(ch)} className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
                      <RefreshCw className="size-3" /> {tr('publish.update')}
                    </button>
                  )}
                </div>
              )}
              {/* 没配好：只引导去让助手配置 */}
              {!ready && (
                <div className={cx('mt-1.5 flex flex-wrap items-center gap-2', indent && 'pl-6')}>
                  {run ? (
                    <button type="button" onClick={() => openChat(run.chat_id)} className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary-text">
                      <Loader2 className="size-3 animate-spin" /> {tr('publish.configuring')} · {tr('task.view')}
                    </button>
                  ) : (
                    <Button needsShuttle variant="outline" size="sm" onClick={() => setupPublish(ch.id)}>
                      <Sparkles /> {tr('publish.setup')}
                    </Button>
                  )}
                </div>
              )}
              {/* 失败：报错原文 + 重试 / 让助手修 */}
              {err && (
                <div className={cx('mt-1.5 space-y-1.5', indent && 'pl-6')}>
                  <p className="text-xs break-words text-destructive">{err}</p>
                  <div className="flex flex-wrap gap-2">
                    {ready && (
                      <Button variant="outline" size="sm" disabled={lockedFor(ch)} onClick={() => publishTo(ch)}>
                        <RefreshCw /> {tr('publish.retry')}
                      </Button>
                    )}
                    {run ? (
                      <Button variant="ghost" size="sm" onClick={() => openChat(run.chat_id)}>
                        <MessageSquareText /> {tr('task.view')}
                      </Button>
                    ) : (
                      <Button needsShuttle variant="outline" size="sm" onClick={() => setupPublish(ch.id, err)}>
                        <Sparkles /> {tr('publish.fix')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {picked.length > 0 && (
        <Button className="w-full" disabled={locked || picked.some((id) => { const c = sites.find((x) => x.id === id); return !c || lockedFor(c) })} onClick={publishPicked}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
          {tr('publish.go', { n: picked.length })}
        </Button>
      )}
    </div>
  )
}

/** 网站页的「文章发布」：配没配好、怎么映射的（助手写的说明）、让助手配置 / 重新配置 */
/** bare：不带自己的边框，放进网站卡片（Channels.tsx 的 SiteCard）里用 */
export function PublishSetup({ ctx, channel, bare }: { ctx: Ctx; channel: Channel; bare?: boolean }) {
  const [err, setErr] = useState('')
  const { runs } = useTaskRuns([SETUP_TASK], (r) => r.input?.channel_id === channel.id, () => ctx.reloadChannels())
  const ready = channel.publish_status === 'ready' && !!channel.publisher
  const go = async () => {
    setErr('')
    try {
      await setupPublish(channel.id)
    } catch (e) {
      setErr((e as Error).message)
      return false
    }
  }
  return (
    <div className={cx('flex flex-col gap-3 text-sm md:flex-row md:items-center', !bare && 'rounded-xl border border-border bg-background p-4')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-semibold">
          {tr('publish.setup_title')}
          <Badge tone={ready ? 'ok' : channel.publish_status === 'broken' ? 'bad' : 'default'}>{ready ? tr('publish.ready') : channel.publish_status === 'broken' ? tr('publish.broken') : tr('publish.not_ready')}</Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{channel.publish_note || (ready ? '' : tr('publish.setup_desc'))}</p>
        {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
      </div>
      {runs[0] ? (
        <Button variant="outline" size="sm" onClick={() => openChat(runs[0].chat_id)}>
          <Loader2 className="animate-spin" /> {tr('publish.configuring')} · {tr('task.view')}
        </Button>
      ) : (
        <Button needsShuttle variant={ready ? 'outline' : 'default'} size="sm" onClick={go}>
          <Sparkles /> {ready ? tr('publish.reconfigure') : tr('publish.setup')}
        </Button>
      )}
    </div>
  )
}
