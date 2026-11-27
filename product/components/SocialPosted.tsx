import { useState } from 'react'
import { AlertTriangle, ArrowUpRight, Check, Clock, Copy, Loader2, RefreshCw, Send } from 'lucide-react'
import RunButton from './RunButton'
import SchedulePopover from './SchedulePopover'
import { ChannelAvatar } from './ArticlePublish'
import { Badge, Button, cx, fmtTime, toast } from './ui'
import { CHANNEL_TYPES } from '../lib/channels'
import { enqueue, usePublishQueue } from '../lib/publishQueue'
import InstagramPublishRecovery from './InstagramPublishRecovery'
import FacebookPublishRecovery from './FacebookPublishRecovery'
import FacebookPostActions, { facebookPostActions } from './FacebookPostActions'
import { instagramPublishRecovery } from '../lib/instagramPublishRecovery'
import { facebookPublishRecovery } from '../lib/facebookPublishRecovery'
import { fileSrc } from '../lib/files'
import { SOCIAL } from '../lib/social'
import { dbPatch, videoSrc, type Article, type Channel } from '../lib/shuttle'
import { metricKeys, type ContentData } from '../lib/contentWorkspace'
import { numLocale, tr } from '../lib/i18n'
import type { Ctx } from './views/types'

// 自媒体内容的排期、发布失败、已发布：和草稿同一个版式，顶上多一条状态栏（设计见 docs/social-workspace.md）。
// 排期、失败的右边仍是编辑器（SocialWorkspace 的 SocialEditor），这里只出状态栏；已发布的右边是只读的 PostedView。
// Instagram、Facebook 官方 API 发出去没拿到结果的（要先核对、不能直接重发），核对的卡片也在状态栏里。

const s = (key: string, vars?: Record<string, unknown>) => tr('social_ws.' + key, vars)

type Post = Record<string, any>

const parseList = (v: unknown): string[] => { try { const l = JSON.parse(String(v || '[]')); return Array.isArray(l) ? l.map(String) : [] } catch { return [] } }

/** 这条内容每个账号一个（排期、失败的、发出去的）帖子，按账号分组，账号的顺序照 order */
export function postsByChannel(posts: Post[], order: string[]) {
  const ids = [...new Set([...order, ...posts.map((p) => String(p.channel_id))])]
  return ids.map((id) => ({ id, posts: posts.filter((p) => p.channel_id === id).sort((a, b) => String(b.published_at || b.scheduled_at || b.updated_at || '').localeCompare(String(a.published_at || a.scheduled_at || a.updated_at || ''))) })).filter((g) => g.posts.length)
}

const enqueuePosts = (a: Article, posts: Post[], channels: Channel[]) =>
  enqueue(posts.map((p) => ({ article_id: a.id, article_title: a.title, channel_id: p.channel_id, channel_name: channels.find((c) => c.id === p.channel_id)?.name ?? '', post_id: p.id })))

/**
 * 编辑器顶上的状态栏：要核对发布结果的（Instagram、Facebook 官方 API）、排期中（改期、取消排期、立即发布）、发布失败（原因、重试）。
 * 发布中不显示（页面保持草稿的样子，进度在右下角 PublishProgress）。没有这几种帖子就不显示。内容仍然能改（SocialEditor 存了会重新备好排期的帖子）
 */
export function PostStatusBar({ ctx, a, posts, onChanged }: { ctx: Ctx; a: Article; posts: Post[]; onChanged: () => void }) {
  const queue = usePublishQueue()
  const [busy, setBusy] = useState(false)
  const running = (p: Post) => queue.some((j) => j.key === `${p.article_id}:${p.channel_id}` || j.key === p.id)
  const chOf = (p: Post) => ctx.channels.find((c) => c.id === p.channel_id)
  // 已经交给平台、没拿到结果的：只能核对，不进下面的「重试」「立即发布」
  const uncertain = posts.filter((p) => !running(p) && (instagramPublishRecovery(p as any, chOf(p)) || facebookPublishRecovery(p as any, chOf(p))))
  const settled = (p: Post) => !running(p) && !uncertain.includes(p)
  const scheduled = posts.filter((p) => p.status === 'scheduled' && settled(p)), failed = posts.filter((p) => p.status === 'failed' && settled(p))
  const name = (id: string) => ctx.channels.find((c) => c.id === id)?.name ?? ''
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); onChanged() } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) } }
  const recover = (p: Post) => (input: { post_id: string; check_only?: true; confirm_unpublished?: true }) => { enqueue([{ article_id: a.id, article_title: a.title, channel_id: p.channel_id, channel_name: name(p.channel_id), ...input }]); onChanged() }
  const checks = uncertain.length ? <div className="space-y-2 border-b border-border px-6 py-3">
    {uncertain.map((p) => <div key={p.id} className="space-y-1.5">
      <p className="text-xs font-semibold">{name(p.channel_id)}</p>
      <InstagramPublishRecovery post={p as any} channel={chOf(p)} disabled={busy} onAction={recover(p)} />
      <FacebookPublishRecovery post={p as any} channel={chOf(p)} disabled={busy} onAction={recover(p)} />
    </div>)}
  </div> : null
  const bar = statusBar()
  return checks || bar ? <>{checks}{bar}</> : null

  function statusBar() {
  if (failed.length) return <Bar tone="bad">
    <AlertTriangle className="size-4 shrink-0" /><b className="shrink-0">{s('st_failed')}</b>
    <span className="min-w-0 flex-1 truncate" title={failed.map((p) => `${name(p.channel_id)}：${p.error || ''}`).join('\n')}>{failed.map((p) => `${name(p.channel_id)}：${p.error || s('st_unknown')}`).join('；')}</span>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => enqueuePosts(a, failed, ctx.channels))}><RefreshCw />{s('st_retry')}</Button>
  </Bar>
  if (scheduled.length) {
    const at = scheduled.map((p) => String(p.scheduled_at)).sort()[0]
    return <Bar tone="sch">
      <Clock className="size-4 shrink-0" /><b className="shrink-0">{s('st_scheduled')}</b>
      <span className="min-w-0 flex-1 truncate">{fmtTime(at)} · {scheduled.map((p) => name(p.channel_id)).join('、')}</span>
      <SchedulePopover size="sm" current={at} disabled={busy}
        onSchedule={(iso) => Promise.all(scheduled.map((p) => dbPatch('social_posts', p.id, { status: 'scheduled', scheduled_at: iso }))).then(onChanged)}
        onUnschedule={() => Promise.all(scheduled.map((p) => dbPatch('social_posts', p.id, { status: 'approved', scheduled_at: '' }))).then(onChanged)} />
      <Button size="sm" disabled={busy} onClick={() => run(async () => enqueuePosts(a, scheduled, ctx.channels))}><Send />{s('st_now')}</Button>
    </Bar>
  }
  return null
  }
}

function Bar({ tone, children }: { tone: 'sch' | 'bad' | 'ok' | 'info'; children: React.ReactNode }) {
  return <div className={cx('flex flex-wrap items-center gap-2.5 border-b px-6 py-2 text-xs', tone === 'sch' && 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200',
    tone === 'bad' && 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200', tone === 'ok' && 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
    tone === 'info' && 'border-border bg-muted/40 text-muted-foreground')}>{children}</div>
}

const statusTone = (st: string) => (st === 'published' ? 'ok' : st === 'failed' ? 'bad' : st === 'scheduled' || st === 'publishing' ? 'primary' : 'default') as 'ok' | 'bad' | 'primary' | 'default'

/**
 * 一个账号发出去的那一版（只读）：状态栏（已发布时间、在平台打开、更新数据）、数据、正文和媒体。
 * PostedView（所有账号都发完了）和编辑器里已发布账号的页签都用它
 */
export function SentContent({ ctx, post, data, onChanged, hint = true }: { ctx: Ctx; post: Post; data: ContentData; onChanged: () => void; hint?: boolean }) {
  const ch = ctx.channels.find((c) => c.id === post.channel_id)
  const published = post.status === 'published'
  const images = parseList(post.images), tags = parseList(post.tags)
  const gain = data.post_gains?.[post.id]
  const metrics = (SOCIAL[ch?.type as keyof typeof SOCIAL]?.metrics?.map((m) => m.key) ?? [...metricKeys]).filter((k) => (metricKeys as readonly string[]).includes(k))
  const nameOf = (id: string) => ctx.channels.find((c) => c.id === id)?.name ?? tr('content.removed_channel')
  return <>
    {published
      ? <Bar tone="ok"><Check className="size-4 shrink-0" /><b className="shrink-0">{s('st_published', { name: ch ? CHANNEL_TYPES[ch.type]?.label : '' })}</b><span>{fmtTime(post.published_at)}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <FacebookPostActions key={post.id} post={post as any} channel={ch} onChanged={onChanged} />
          {post.post_url && <a href={post.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-text hover:underline">{s('open_post')}<ArrowUpRight className="size-3" /></a>}
          <RunButton inline watch fn="social/social.collect" input={{ channel_id: post.channel_id }} icon={RefreshCw} variant="outline" size="sm" onDone={(r) => { const note = (r as any)?.channels?.find((c: any) => c?.note)?.note; if (note) toast(note, 'ok', { ms: 10000 }); onChanged() }}>{s('refresh_data')}</RunButton></span></Bar>
      : <Bar tone={post.status === 'failed' ? 'bad' : 'info'}><span>{s('st_not_published', { name: nameOf(post.channel_id) })}</span></Bar>}
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {published && <div className="mb-5 flex overflow-hidden rounded-xl border border-border bg-muted/20">
        {metrics.map((k) => <div key={k} className="min-w-0 flex-1 border-r border-border px-4 py-2.5 last:border-r-0">
          <b className="block text-lg tabular-nums">{Number(post[k] ?? 0).toLocaleString(numLocale())}</b>
          <span className="text-[11px] text-muted-foreground">{tr(`article.metric_${k}`)}</span>{!!gain?.[k as keyof typeof gain] && <em className="ml-1 text-[11px] text-emerald-600 not-italic">+{Number(gain[k as keyof typeof gain]).toLocaleString(numLocale())}</em>}</div>)}
      </div>}
      {published && <p className="-mt-3 mb-4 text-xs text-muted-foreground">{post.metrics_at ? tr('article.metrics_at', { when: fmtTime(post.metrics_at) }) : tr('article.metrics_none')}{gain ? ' · ' + s('gain_7d') : ''}</p>}
      <div className="flex gap-3">
        <div className="shrink-0">{ch ? <ChannelAvatar ch={ch} /> : <span className="block size-7 rounded-full bg-muted" />}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{ch?.name}</p>
          {post.title && ch && SOCIAL[ch.type as keyof typeof SOCIAL]?.title && <p className="mt-1 text-base font-semibold">{post.title}</p>}
          <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-wrap">{post.body}{!!tags.length && <span className="text-sky-600"> {tags.map((t) => '#' + t).join(' ')}</span>}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {post.video && <video src={videoSrc(post.video)} poster={videoSrc(post.video_cover) || undefined} controls preload="metadata" className="max-h-72 max-w-sm rounded-xl border border-border bg-black" />}
            {images.map((u, i) => <img key={u + i} src={fileSrc(u)} alt="" className="size-32 rounded-xl border border-border object-cover" />)}
          </div>
        </div>
      </div>
      {hint && <p className="mt-6 text-xs text-muted-foreground">{facebookPostActions(post as any, ch) ? tr('published_post.edit_hint') : s('readonly_hint')}</p>}
    </div>
  </>
}

/**
 * 已发布：只读，和草稿同一个版式。账号页签（每个账号发出去的那一版），状态栏，数据，正文和媒体；右栏是各账号的发布记录。
 * 改文案、换图走「复制再发一条」
 */
export function PostedView({ ctx, a, posts, data, order, focus, onChanged, onCopy, menu }: { ctx: Ctx; a: Article; posts: Post[]; data: ContentData; order: string[]; focus?: string; onChanged: () => void; onCopy: () => Promise<void>; menu: React.ReactNode }) {
  const groups = postsByChannel(posts, order)
  const [active, setActive] = useState(groups.find((g) => g.posts.some((p) => p.id === focus))?.id || groups.find((g) => g.posts.some((p) => p.status === 'published'))?.id || groups[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const queue = usePublishQueue()
  const group = groups.find((g) => g.id === active) || groups[0]
  const ch = ctx.channels.find((c) => c.id === group?.id)
  const post = group?.posts.find((p) => p.id === focus) || group?.posts.find((p) => p.status === 'published') || group?.posts[0]
  const failed = posts.filter((p) => p.status === 'failed' && !queue.some((j) => j.key === `${p.article_id}:${p.channel_id}` || j.key === p.id))
  const first = groups.flatMap((g) => g.posts).filter((p) => p.status === 'published').map((p) => String(p.published_at)).sort()[0]
  const nameOf = (id: string) => ctx.channels.find((c) => c.id === id)?.name ?? tr('content.removed_channel')
  return <div className="flex h-full min-h-0">
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
        <div role="tablist" className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl bg-muted p-1">
          {groups.map((g) => { const c = ctx.channels.find((x) => x.id === g.id); const Icon = c && CHANNEL_TYPES[c.type]?.icon
            return <button key={g.id} type="button" role="tab" aria-selected={g.id === group?.id} onClick={() => setActive(g.id)} title={nameOf(g.id)}
              className={cx('flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors', g.id === group?.id ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {Icon && <Icon size={14} />}<span className="max-w-28 truncate">{nameOf(g.id)}</span></button> })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await onCopy() } finally { setBusy(false) } }}>{busy ? <Loader2 className="animate-spin" /> : <Copy />}{s('copy_again')}</Button>
          {menu}
        </div>
      </div>
      {post && <SentContent ctx={ctx} post={post} data={data} onChanged={onChanged} />}
    </div>
    <aside className="hidden w-72 shrink-0 space-y-3 overflow-y-auto border-l border-border bg-muted/20 p-4 xl:block">
      <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground">{s('records')}</h4>
      {groups.flatMap((g) => g.posts).map((p) => { const c = ctx.channels.find((x) => x.id === p.channel_id); const Icon = c && CHANNEL_TYPES[c.type]?.icon
        return <div key={p.id} className="space-y-1.5 rounded-xl border border-border bg-background p-3 text-xs">
          <p className="flex items-center gap-2">{Icon && <Icon size={14} />}<b className="min-w-0 flex-1 truncate text-sm">{nameOf(p.channel_id)}</b><Badge tone={statusTone(p.status)}>{tr(`meta.social_status.${p.status}`)}</Badge></p>
          <p className="text-muted-foreground">{p.status === 'scheduled' ? fmtTime(p.scheduled_at) : fmtTime(p.published_at || p.updated_at)}</p>
          {p.post_url && p.status === 'published' && <a href={p.post_url} target="_blank" rel="noreferrer" className="block truncate text-primary-text hover:underline">{p.post_url}</a>}
          {p.error && p.status !== 'published' && <p className="text-destructive">{p.error}</p>}
        </div> })}
      {!!failed.length && <Button size="sm" variant="outline" className="w-full" onClick={() => { enqueuePosts(a, failed, ctx.channels); onChanged() }}><RefreshCw />{s('st_retry')}</Button>}
      {first && <p className="text-xs text-muted-foreground">{s('first_published', { when: fmtTime(first) })}</p>}
    </aside>
  </div>
}
