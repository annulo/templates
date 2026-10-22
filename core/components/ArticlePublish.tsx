import { metricText } from '../lib/apiMetrics'
import { facebookPublishRecovery } from '../lib/facebookPublishRecovery'
import FacebookPublishRecovery from './FacebookPublishRecovery'
import FacebookComments from './FacebookComments'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, Bookmark, Eye, Film, Heart, Loader2, MessageCircle, RefreshCw, Send, Share2, Trash2 } from 'lucide-react'
import RunButton from './RunButton'
import { fileSrc } from '../lib/files'
import SchedulePopover, { ScheduledLine } from './SchedulePopover'
import { TYPE_META, typeOf } from './ArticleTypes'
import { Badge, Button, Dialog, Notice, cx, fmtTime, toast } from './ui'
import DateTimeField from './DateTimePicker'
import { enqueue, reveal, stop, usePublishQueue, type PublishJob } from '../lib/publishQueue'
import WatchControls from './WatchControls'

/** 后台队列里这条的状态：排队中、发布中（正在做哪一步）；在发的能打开看、停止，排队的能取消 */
function JobLine({ job }: { job?: PublishJob }) {
  if (!job || (job.state !== 'queued' && job.state !== 'running')) return null
  const fail = (e: unknown) => toast((e as Error).message, 'error')
  return <div className="flex items-center gap-1">
    <p className="flex min-w-0 items-center gap-1.5 text-xs leading-relaxed text-primary-text">{job.state === 'running' ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <span className="size-1.5 shrink-0 rounded-full bg-primary" />}<span className="truncate">{job.state === 'running' ? (job.step || tr('article.pub_running')) : tr('article.pub_queued')}</span></p>
    <WatchControls onShow={job.state === 'running' ? () => reveal(job.key).catch(fail) : undefined} onStop={() => stop(job.key).catch(fail)} />
  </div>
}
import { CHANNEL_TYPES, type ChannelMeta } from '../lib/channels'
import { tr } from '../lib/i18n'
import { dbDelete, dbPatch, isSite, openChat, runLocal, runTask, shuttleImage, type Article, type Channel, type Publication, type SocialPost } from '../lib/shuttle'
import { SOCIAL, loggedInElsewhere, useElsewhere } from '../lib/social'
import { FIELDS } from '../plugins/social/local/_fields'
import { lengthOn, supports } from '../local/_types'
import type { Ctx } from './views/types'

// 文章的发布：一篇文章就是要发的内容，「发布」里勾选支持这种类型的账号（可以多选），现在发或者定个时间；
// 每个账号一条发布记录（社媒插件的 social_posts，article_id 指回文章），记录里看发没发出去、链接、互动数据。
// 有网站的模板（外贸）：网站（creght 站点、WordPress）只发长文，跑网站自己的发布脚本 <publisher>.publish，记录在 publications；再发就是更新。
// 网站也能排期：发布记录记上 scheduled_at，到点由定时任务 publishing.publishScheduled 发（发过的是更新）。
// 没有网站的模板（自媒体）渠道里没有网站、publications 是空的，这些分支都走不到。

/** 让助手给一个网站配置（或修）文章发布：任务 setup-publish（有网站的模板才有），开一段对话、在右侧打开 */
async function setupPublish(channelId: string, note?: string) {
  const r = await runTask('setup-publish', { channel_id: channelId, ...(note ? { note } : {}) })
  openChat(r.chat_id)
}

const statusTone = (s?: string) => s === 'published' ? 'ok' as const : s === 'failed' ? 'bad' as const : s === 'scheduled' || s === 'publishing' ? 'primary' as const : 'default' as const
const metricsLine = (p: SocialPost) => tr('versions.metrics', { v: metricText(p, 'views'), l: metricText(p, 'likes'), c: metricText(p, 'comments') })

/** 已发布记录的删除：点开一个小菜单二选一。「从平台删除」去平台上删帖子；「只删记录」平台上的不动（平台上已经手动删过、
 *  或者同一条重复记了两次时用，从平台删除会报找不到） */
function DeleteMenu({ label, busy, disabled, onRemote, onRecord }: { label: string; busy: boolean; disabled: boolean; onRemote: () => void; onRecord: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const item = 'flex w-full cursor-pointer flex-col items-start rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted'
  return (
    <div ref={ref} className="relative shrink-0">
      <Button size="icon-sm" variant="ghost" className="text-destructive" disabled={disabled} title={tr('article.delete_menu')} aria-label={tr('article.delete_menu')} aria-expanded={open} onClick={() => setOpen(!open)}>
        {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-30 mt-1 w-64 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          <button type="button" role="menuitem" className={cx(item, 'text-destructive')} onClick={() => { setOpen(false); onRemote() }}>
            {tr('article.delete_from_platform', { p: label })}
            <span className="text-xs text-muted-foreground">{tr('article.delete_from_platform_hint', { p: label })}</span>
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onRecord() }}>
            {tr('article.delete_record_only')}
            <span className="text-xs text-muted-foreground">{tr('article.delete_record_only_hint', { p: label })}</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** 平台标签：图标 + 平台名（「B站」「抖音」），跟在账号名后面（发布记录、发布弹窗的账号列表） */
export function PlatformTag({ type }: { type: string }) {
  const t = (CHANNEL_TYPES as Partial<Record<string, ChannelMeta>>)[type]
  const Icon = t?.icon
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{Icon && <Icon size={11} />}{t?.label}</span>
}

export function ChannelAvatar({ ch }: { ch: Channel }) {
  const Icon = CHANNEL_TYPES[ch.type]?.icon
  return ch.avatar ? <img src={shuttleImage(ch.avatar)} alt="" loading="lazy" className="size-7 shrink-0 rounded-full object-cover" /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{Icon && <Icon size={13} />}</span>
}

/** datetime-local 的默认值：下一个整点 */
function nextHour() {
  const d = new Date(Date.now() + 3600_000)
  d.setMinutes(0, 0, 0)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type RowState = 'queued' | 'scheduled' | string

/** 发布：勾选账号（只有支持这种类型的能选，别的灰掉、写明原因），现在发或者排期；一条条发，结果逐个显示 */
export function PublishDialog({ open, ctx, article, posts, pubs, onClose, onRewrite, scope }: { open: boolean; ctx: Ctx; article: Article; posts: SocialPost[]; pubs: Publication[]; scope?: 'website' | 'social'; onClose: () => void; onRewrite: () => void }) {
  const t = typeOf(article)
  const machine = useElsewhere(ctx.channels)
  // 网站在前，社媒账号在后
  const accounts = [...ctx.channels.filter(isSite), ...ctx.channels.filter((ch) => !!SOCIAL[ch.type])].filter(ch => !scope || (scope === 'website' ? isSite(ch) : !isSite(ch)))
  const targetAccountId = String((article as any).target_account_id || '')
  const targetAccount = accounts.find(ch => ch.id === targetAccountId)
  const takes = (ch: Channel) => (isSite(ch) ? t === 'article' : supports(FIELDS[ch.type], t))
  const [picked, setPicked] = useState<string[]>([])
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState(nextHour())
  const [result, setResult] = useState<Record<string, RowState>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setPicked(targetAccount && !blocked(targetAccount) ? [targetAccount.id] : []); setResult({}); setError(''); setWhen('now'); setAt(nextHour()) } }, [open, article.id, targetAccountId])

  // 不能选的原因：平台不支持这种类型、网站没配好发布、登录在别的电脑、登录过期
  const blocked = (ch: Channel) => !takes(ch) ? tr('article.pub_unsupported', { type: TYPE_META[t].label })
    : isSite(ch) ? (ch.publish_status !== 'ready' || !ch.publisher ? tr('article.pub_site_setup') : '')
    : loggedInElsewhere(ch, machine) ? tr('social.on_machine', { name: loggedInElsewhere(ch, machine) })
    : ch.login_status === 'expired' ? tr('article.pub_expired') : ''
  const usable = accounts.filter((ch) => !blocked(ch))
  const unsupported = accounts.filter((ch) => !takes(ch))
  const toggle = (id: string) => setPicked((l) => l.includes(id) ? l.filter((x) => x !== id) : [...l, id])

  // 发布放到后台排队（lib/publishQueue）：这里只做准备（建发布记录、过平台检查），马上关掉弹窗；
  // 没通过检查的账号留在弹窗里写原因，别的照常进后台。进度在发布记录和右下角看
  const go = async () => {
    setRunning(true); setError('')
    const ts = when === 'later' ? Date.parse(at) : 0
    if (when === 'later' && !(ts > Date.now())) { setError(tr('versions.future_time')); setRunning(false); return }
    try {
      const r = await runLocal<{ ready: { channel_id: string; post_id?: string; publisher?: string }[]; problems: { channel_id: string; problems: string[] }[] }>('publish.prepare', { article_id: article.id, channel_ids: picked, ...(ts ? { scheduled_at: new Date(ts).toISOString() } : {}) })
      const name = (id: string) => accounts.find((c) => c.id === id)?.name ?? ''
      if (!ts && r.ready.length) enqueue(r.ready.map((p) => ({ article_id: article.id, article_title: article.title, channel_id: p.channel_id, channel_name: name(p.channel_id), post_id: p.post_id, publisher: p.publisher })))
      if (r.ready.length) toast(ts ? tr('article.pub_scheduled_toast', { n: r.ready.length }) : tr('article.pub_started_toast', { n: r.ready.length }))
      if (!r.problems.length) { onClose(); return }
      const out: Record<string, RowState> = {}
      for (const p of r.ready) out[p.channel_id] = ts ? 'scheduled' : 'queued'
      for (const p of r.problems) out[p.channel_id] = p.problems.join('；')
      setResult(out)
      setPicked((l) => l.filter((id) => r.problems.some((p) => p.channel_id === id)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const row = (ch: Channel) => {
    const why = blocked(ch)
    const r = result[ch.id]
    const sent = isSite(ch) ? pubs.find((p) => p.channel_id === ch.id && p.status === 'published') : posts.filter((p) => p.channel_id === ch.id && p.status === 'published').sort((a, b) => Date.parse(b.published_at || '') - Date.parse(a.published_at || ''))[0]
    const { length, max } = lengthOn(article, ch.type)
    const tooLong = !why && max > 0 && length > max
    const note = r && !['queued', 'scheduled'].includes(r) ? <span className="text-destructive">{r}</span>
      : why ? why
      : tooLong ? <span className="text-amber-700 dark:text-amber-400">{tr('article.pub_too_long', { n: length, max })}</span>
      : sent ? (isSite(ch) ? tr('article.pub_site_update') : tr('article.pub_sent_before', { when: fmtTime(sent.published_at) }))
      : CHANNEL_TYPES[ch.type]?.label
    return <label key={ch.id} className={cx('flex items-center gap-3 rounded-lg border px-3 py-2', why ? 'cursor-default border-border opacity-60' : picked.includes(ch.id) ? 'cursor-pointer border-primary/50 bg-primary/5' : 'cursor-pointer border-border hover:bg-accent/50')}>
      <input type="checkbox" disabled={!!why || running} checked={picked.includes(ch.id)} onChange={() => toggle(ch.id)} className="size-4 accent-primary" />
      <ChannelAvatar ch={ch} />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{ch.name}</span><span className="block text-xs leading-relaxed text-muted-foreground">{note}</span></span>
      {isSite(ch) && takes(ch) && (ch.publish_status !== 'ready' || !ch.publisher) && <Button size="sm" variant="outline" needsShuttle onClick={(e) => { e.preventDefault(); void setupPublish(ch.id) }}>{tr('publish.setup')}</Button>}
      {r === 'queued' ? <Badge tone="primary">{tr('article.pub_queued')}</Badge> : r === 'scheduled' ? <Badge tone="primary">{tr('meta.social_status.scheduled')}</Badge> : r ? <Badge tone="bad">{tr('article.pub_not_passed')}</Badge> : null}
    </label>
  }

  return <Dialog open={open} onClose={onClose} title={tr('article.pub_title', { type: TYPE_META[t].label })} width={580} footer={<>
    <Button variant="ghost" size="sm" onClick={onClose}>{Object.keys(result).length ? tr('common.close') : tr('common.cancel')}</Button>
    <Button fn="publish.prepare" size="sm" disabled={running || !picked.length} onClick={go}>{running ? <Loader2 className="animate-spin" /> : <Send />}{when === 'later' ? tr('article.pub_schedule_go', { n: picked.length }) : tr('article.pub_go', { n: picked.length })}</Button>
  </>}>
    <div className="space-y-4">
      {!accounts.length ? <Notice>{tr('versions.no_channels')}<button type="button" className="ml-1 cursor-pointer text-primary-text hover:underline" onClick={() => { onClose(); ctx.go('channels') }}>{tr('versions.go_add', { name: tr('nav.channels') })}</button></Notice> : <>
        <p className="text-sm text-muted-foreground">{tr(scope ? 'article.pub_hint_' + scope : 'article.pub_hint')}</p>
        {targetAccountId && <Notice>{tr('article.pub_target_account', {name:targetAccount?.name || tr('article.pub_target_missing')})}</Notice>}
        <div className="max-h-80 space-y-1 overflow-y-auto">{[...usable, ...accounts.filter((ch) => !usable.includes(ch))].map(row)}</div>
        {!!unsupported.length && <p className="text-xs leading-relaxed text-muted-foreground">{tr(scope ? 'article.pub_rewrite_hint_' + scope : 'article.pub_rewrite_hint', { type: TYPE_META[t].label })}<button type="button" className="ml-1 cursor-pointer text-primary-text hover:underline" onClick={() => { onClose(); onRewrite() }}>{tr('article.rewrite')}</button></p>}
        {<div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex cursor-pointer items-center gap-2"><input type="radio" name="when" checked={when === 'now'} disabled={running} onChange={() => setWhen('now')} className="accent-primary" />{tr('social.publish_now')}</label>
            <label className="inline-flex cursor-pointer items-center gap-2"><input type="radio" name="when" checked={when === 'later'} disabled={running} onChange={() => setWhen('later')} className="accent-primary" />{tr('article.pub_later')}</label>
          </div>
          {when === 'later' && <><DateTimeField value={at} disabled={running} onChange={setAt} /><p className="text-xs leading-relaxed text-muted-foreground">{tr('social.time_hint', { rate: '' })}</p></>}
        </div>}
        {error && <Notice tone="error">{error}</Notice>}
      </>}
    </div>
  </Dialog>
}

/** detailed 的发布记录：这次发出去的是什么（第一张图或视频、标题），一条内容能发好几次、每次发的不一样 */
function PostSnapshot({ p }: { p: SocialPost }) {
  const img = (() => { try { return (JSON.parse(String(p.images || '[]')) as string[])[0] ?? '' } catch { return '' } })()
  const video = String((p as SocialPost & { video?: string }).video ?? '')
  if (!img && !video && !p.title) return null
  return <div className="flex min-w-0 items-center gap-2.5 rounded-md bg-muted/40 p-1.5">
    {video ? <span className="relative size-10 shrink-0 overflow-hidden rounded bg-black/40"><video src={`${fileSrc(video)}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" /><Film className="absolute right-0.5 bottom-0.5 size-3 text-white" /></span>
      : img ? <img src={fileSrc(img)} alt="" loading="lazy" className="size-10 shrink-0 rounded object-cover" /> : null}
    <span className="min-w-0 flex-1 truncate text-xs">{p.title || String(p.body ?? '').slice(0, 60)}</span>
  </div>
}

/**
 * detailed 的发布记录：互动数据一个个列出来（阅读、点赞、评论、收藏、分享），旁边能马上重新采集这个账号。
 * 手机上五项排成等宽的一行、只留图标和数（名字在 title 里），采集时间和更新按钮另起一行，不挤在一起折行
 */
function PostMetrics({ p, onChanged }: { p: SocialPost; onChanged: () => void }) {
  const items: [typeof Eye, 'views' | 'likes' | 'comments' | 'collects' | 'shares'][] = [[Eye, 'views'], [Heart, 'likes'], [MessageCircle, 'comments'], [Bookmark, 'collects'], [Share2, 'shares']]
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
    <div className="grid w-full grid-cols-5 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-x-4 sm:gap-y-1.5">
      {items.map(([Icon, k]) => <span key={k} className="inline-flex min-w-0 items-center gap-1.5 text-sm tabular-nums" title={tr(`article.metric_${k}`)}><Icon className="size-3.5 shrink-0 text-muted-foreground" /><span className="hidden text-xs text-muted-foreground sm:inline">{tr(`article.metric_${k}`)}</span><span className="truncate">{metricText(p, k)}</span></span>)}
    </div>
    <span className="flex w-full min-w-0 items-center justify-between gap-1 text-xs text-muted-foreground sm:ml-auto sm:w-auto sm:justify-start">
      <span className="shrink-0">{p.metrics_at ? tr('article.metrics_at', { when: fmtTime(p.metrics_at) }) : tr('article.metrics_none')}</span>
      <span className="flex min-w-0 justify-end"><RunButton inline watch fn="social/social.collect" input={{ channel_id: p.channel_id }} icon={RefreshCw} variant="ghost" onDone={onChanged}>{tr('article.metrics_refresh')}</RunButton></span>
    </span>
  </div>
}

/**
 * 发布记录：这篇发到了哪些账号、发没发出去。失败的重发、排期的改时间或马上发、没发出去的删记录。
 * detailed（自媒体的内容文件夹）：每条还显示这次发的是什么，互动数据一个个列出来、能马上更新
 */
export function PublishRecords({ ctx, article, posts, pubs, focus, onChanged, onPublish, linkedRecords, detailed = false }: { ctx: Ctx; article: Article; posts: SocialPost[]; pubs: Publication[]; focus?: string; onChanged: () => void; onPublish: () => void; linkedRecords?: ReactNode; detailed?: boolean }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const queue = usePublishQueue()
  const jobOf = (key: string) => queue.find((j) => j.key === key && (j.state === 'queued' || j.state === 'running'))
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError('')
    try { await fn(); onChanged() } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  useEffect(() => { if (focus) document.getElementById(`pub-${focus}`)?.scrollIntoView({ block: 'center' }) }, [focus, posts.length])
  // 网站再发一次就是更新：先清掉以前网站版本单独改的字段（publish.prepare），再跑网站的发布脚本
  // 网站再发一次就是更新：先清掉以前网站版本单独改的字段（publish.prepare），再放进后台队列跑网站的发布脚本
  const resend = (ch: Channel) => act('site' + ch.id, async () => {
    const r = await runLocal<{ ready: { channel_id: string; publisher?: string }[]; problems: { problems: string[] }[] }>('publish.prepare', { article_id: article.id, channel_ids: [ch.id] })
    if (r.problems.length) throw new Error(r.problems.flatMap((p) => p.problems).join('；'))
    enqueue([{ article_id: article.id, article_title: article.title, channel_id: ch.id, channel_name: ch.name, publisher: r.ready[0].publisher }])
  })
  const list = [...posts].sort((a, b) => String(b.published_at || b.scheduled_at || b.updated_at || '').localeCompare(String(a.published_at || a.scheduled_at || a.updated_at || '')))
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{tr('article.records')}</h2>
      {!!(list.length || pubs.length || linkedRecords) && <Button size="sm" variant="outline" feedback={false} onClick={onPublish}><Send />{tr('article.publish')}</Button>}
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    {!!pubs.length && <div className="overflow-hidden rounded-lg border border-border">{pubs.map((p) => {
      const ch = ctx.channels.find((c) => c.id === p.channel_id)
      const ready = !!ch && ch.publish_status === 'ready' && !!ch.publisher
      return <div key={p.id} id={`pub-${p.channel_id}`} className={cx('space-y-2 border-b border-border px-3 py-3 last:border-b-0', (focus === p.id || focus === p.channel_id) && 'bg-primary/5')}>
        <div className="flex min-w-0 items-center gap-3">
          {ch ? <ChannelAvatar ch={ch} /> : <span className="size-7 shrink-0 rounded-full bg-muted" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{ch?.name ?? tr('content.removed_channel')}</span>
            <span className="block truncate text-xs text-muted-foreground">{ch ? CHANNEL_TYPES[ch.type]?.label : ''}{p.published_at ? ` · ${fmtTime(p.published_at)}` : ''}</span>
          </span>
          {p.url && p.status === 'published' && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-primary-text">{tr('content.view_live')}<ArrowUpRight className="size-3" /></a>}
          <Badge tone={statusTone(p.status)}>{p.status === 'published' ? tr('versions.published') : p.status === 'failed' ? tr('versions.failed') : p.status === 'publishing' ? tr('meta.social_status.publishing') : p.status === 'scheduled' ? tr('meta.social_status.scheduled') : tr('versions.draft')}</Badge>
        </div>
        {p.scheduled_at && p.status !== 'publishing' && <ScheduledLine at={p.scheduled_at} fromArticle />}
        <JobLine job={jobOf(`${p.article_id}:${p.channel_id}`)} />
        {!jobOf(`${p.article_id}:${p.channel_id}`) && p.error && p.status !== 'published' && <p className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{p.error}</p>}
        {ch && !jobOf(`${p.article_id}:${p.channel_id}`) && <div className="flex flex-wrap items-center gap-2">
          {ready ? <Button size="sm" variant="outline" fn={`${ch.publisher}.publish`} disabled={!!busy} onClick={() => resend(ch)}>{busy === 'site' + ch.id ? <Loader2 className="animate-spin" /> : <Send />}{p.status === 'published' ? tr('publish.update') : p.status === 'scheduled' ? tr('social.publish_now') : tr('article.retry')}</Button>
            : <Button size="sm" variant="outline" needsShuttle onClick={() => void setupPublish(ch.id)}>{tr('publish.setup')}</Button>}
          {/* 排了期的改时间、取消：没发过的取消就删掉这条记录，发过的只清掉排期 */}
          {p.scheduled_at && ready && <SchedulePopover size="sm" current={p.scheduled_at} onSchedule={(iso) => dbPatch('publications', p.id, { scheduled_at: iso }).then(onChanged)} onUnschedule={() => (p.status === 'scheduled' ? dbDelete('publications', p.id) : dbPatch('publications', p.id, { scheduled_at: '' })).then(onChanged)} />}
          {p.status === 'failed' && ready && <Button size="sm" variant="ghost" needsShuttle onClick={() => void setupPublish(ch.id, p.error)}>{tr('publish.fix')}</Button>}
        </div>}
      </div>
    })}</div>}
    {!list.length && !pubs.length && !linkedRecords ? <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{tr('article.records_empty')}<div className="mt-3"><Button size="sm" feedback={false} onClick={onPublish}><Send />{tr('article.publish')}</Button></div></div>
      : !!list.length && <div className="overflow-hidden rounded-lg border border-border">{list.map((p) => {
        const ch = ctx.channels.find((c) => c.id === p.channel_id)
        const recovery = facebookPublishRecovery(p, ch)
        const legacy = ['draft', 'pending_review', 'rejected'].includes(p.status)
        return <div key={p.id} id={`pub-${p.id}`} className={cx('space-y-2 border-b border-border px-3 py-3 last:border-b-0', focus === p.id && 'bg-primary/5')}>
          <div className="flex min-w-0 items-center gap-3">
            {/* 账号头像和名字点了去「社交媒体 → 数据表现」看这个账号：打开主页、重新采集都在那里 */}
            {ch ? <button type="button" onClick={() => ctx.go('social', { section: 'data', account: ch.id })} title={tr('article.open_account_data')} className="shrink-0 cursor-pointer rounded-full"><ChannelAvatar ch={ch} /></button> : <span className="size-7 shrink-0 rounded-full bg-muted" />}
            <span className="min-w-0 flex-1">
              {/* 名字后面跟一个平台标签：几个账号可能同名（bysir / Bysir），只看名字分不清发到了哪个平台 */}
              {ch ? <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                  <button type="button" onClick={() => ctx.go('social', { section: 'data', account: ch.id })} title={tr('article.open_account_data')} className="min-w-0 cursor-pointer truncate text-left text-sm font-medium hover:text-primary-text hover:underline">{ch.name}</button>
                  {CHANNEL_TYPES[ch.type] && <PlatformTag type={ch.type} />}
                </span>
                : <span className="block truncate text-sm font-medium">{tr('content.removed_channel')}</span>}
              <span className="block truncate text-xs text-muted-foreground">
                {p.status === 'published' ? <>{fmtTime(p.published_at)}{p.metrics_at && !detailed ? ` · ${metricsLine(p)}` : ''}</> : p.status === 'removed' ? tr('social.removed_from', { when: fmtTime(p.removed_at), p: ch ? CHANNEL_TYPES[ch.type]?.label : '' }) : legacy ? tr('article.legacy_version') : ch ? CHANNEL_TYPES[ch.type]?.label : ''}
              </span>
            </span>
            {p.post_url && p.status === 'published' && <a href={p.post_url} target="_blank" rel="noreferrer" aria-label={tr('content.view_live')} title={tr('content.view_live')} className="inline-flex shrink-0 items-center gap-1 text-xs text-primary-text"><span className="hidden sm:inline">{tr('content.view_live')}</span><ArrowUpRight className="size-4 sm:size-3" /></a>}
            {jobOf(p.id) ? <Badge tone="primary">{jobOf(p.id)!.state === 'running' ? tr('meta.social_status.publishing') : tr('article.pub_queued')}</Badge> : <Badge tone={statusTone(p.status)}>{tr(`meta.social_status.${p.status}`)}</Badge>}
            {p.status === 'published' && !jobOf(p.id) && ch && (
              <DeleteMenu label={CHANNEL_TYPES[ch.type]?.label ?? ''} busy={busy === 'remove' + p.id} disabled={!!busy}
                onRemote={() => act('remove' + p.id, () => runLocal('social/social.remove', { post_id: p.id }))}
                onRecord={() => act('remove' + p.id, async () => {
                  // 插件的 purge 不删「已发布」的（怕平台上还挂着、这里查不到）；用户明确选了只删记录，先标成已删除再清
                  await dbPatch('social_posts', p.id, { status: 'removed', removed_at: new Date().toISOString() })
                  await runLocal('social/social.purge', { post_id: p.id })
                })} />
            )}
          </div>
          {detailed && <PostSnapshot p={p} />}
          {detailed && p.status === 'published' && <PostMetrics p={p} onChanged={onChanged} />}
          {p.status === 'scheduled' && <ScheduledLine at={p.scheduled_at} fromArticle />}
          <JobLine job={jobOf(p.id)} />
          <FacebookComments post={p} channel={ch} />
          {!jobOf(p.id) && p.error && p.status !== 'published' && <p className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{p.error}</p>}
          {!jobOf(p.id) && <FacebookPublishRecovery post={p} channel={ch} disabled={!!busy} onAction={(input) => enqueue([{ article_id: article.id, article_title: article.title, channel_id: p.channel_id, channel_name: ch?.name ?? '', ...input }])} />}
          {/* 已经从平台删掉的：留着记录能看到删过，不要了就删记录 */}
          {p.status === 'removed' && !jobOf(p.id) && <div className="flex justify-end"><Button fn="social/social.purge" size="sm" variant="ghost" className="text-muted-foreground" disabled={!!busy} onClick={() => act('purge' + p.id, () => runLocal('social/social.purge', { post_id: p.id }))}><Trash2 />{tr('article.delete_record')}</Button></div>}
          {p.status !== 'published' && p.status !== 'removed' && !jobOf(p.id) && <div className="flex flex-wrap items-center gap-2">
            {!recovery && (p.status === 'failed' || p.status === 'approved' || p.status === 'scheduled') && <Button size="sm" variant="outline" fn="social/social.publish" feedback={false} onClick={() => enqueue([{ article_id: article.id, article_title: article.title, channel_id: p.channel_id, channel_name: ch?.name ?? '', post_id: p.id }])}><Send />{p.status === 'failed' ? tr('article.retry') : tr('social.publish_now')}</Button>}
            {p.status === 'scheduled' && !recovery && <SchedulePopover size="sm" current={p.scheduled_at} onSchedule={(iso) => dbPatch('social_posts', p.id, { status: 'scheduled', scheduled_at: iso }).then(onChanged)} onUnschedule={() => dbPatch('social_posts', p.id, { status: 'approved', scheduled_at: '' }).then(onChanged)} />}
            {p.status === 'publishing' && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act('stuck' + p.id, () => dbPatch('social_posts', p.id, { status: 'failed', error: tr('social.stuck_error') }))}>{tr('social.mark_failed')}</Button>}
            {p.status !== 'publishing' && <Button fn="social/social.purge" size="sm" variant="ghost" className="ml-auto text-muted-foreground" disabled={!!busy} onClick={() => act('purge' + p.id, () => runLocal('social/social.purge', { post_id: p.id }))}><Trash2 />{tr('article.delete_record')}</Button>}
          </div>}
        </div>
      })}</div>}
    {linkedRecords}
  </section>
}
