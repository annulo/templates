import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, BarChart3, Plus, RefreshCw, Trash2, UserRound } from 'lucide-react'
import AddChannelDialog from '../AddChannelDialog'
import RunButton from '../RunButton'
import AskButton from '../AskButton'
import { brokenOf, ProbeLine, PublishProblems, usePlatformHealth } from '../PlatformHealth'
import { Button, ErrorDetails, Notice, PageHeader, cx, fmtTime, type Tone } from '../ui'
import { dbList, removeChannel, shuttleImage, type Channel, type PlatformHealth, type SocialPost } from '../../lib/shuttle'
import { CHANNEL_TYPES } from '../../lib/channels'
import { isSocial, loggedInElsewhere, platformOf, useElsewhere, type Elsewhere } from '../../lib/social'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

/** 卡片上的连接状态：这一页只回答「哪个账号要处理」，数据在社交媒体页看 */
function connection(c: Channel, health: PlatformHealth[], posts: SocialPost[], machine: Elsewhere): { label: string; tone: Tone } {
  if (isSocial(c)) {
    const other = loggedInElsewhere(c, machine)
    if (other) return { label: tr('social.on_machine', { name: other }), tone: 'default' }
    if (c.login_status === 'expired') return { label: tr('social.login_expired'), tone: 'warn' }
    if (brokenOf(health, c.id).length || posts.some((p) => p.channel_id === c.id && p.status === 'failed')) return { label: tr('meta.social_status.failed'), tone: 'bad' }
    return c.login_status === 'ok' ? { label: tr('social.connected'), tone: 'ok' } : { label: tr('social.not_connected'), tone: 'default' }
  }
  return { label: tr('channels.not_enabled'), tone: 'warn' }
}

const DOT: Record<Tone, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-destructive', primary: 'bg-primary', default: 'bg-muted-foreground/50' }

/** 账号：只管连接（添加、移除、登录、自检），不放数据 */
export default function Channels({ ctx, current, setCurrent }: { ctx: Ctx; current: string; setCurrent: (id: string) => void }) {
  const [adding, setAdding] = useState(false)
  // 添加前已有的账号：列表重新读回来后选中多出来的那个（对话框只告诉我们加了哪种，一次勾好几个时选第一个）
  const before = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!before.current) return
    const added = ctx.channels.find((c) => !before.current!.has(c.id))
    if (!added) return
    before.current = null
    setCurrent(added.id)
  }, [ctx.channels])
  const [confirm, setConfirm] = useState(false)
  const removeBtn = <Button fn="channels.remove" variant="ghost" size="sm" onClick={() => setConfirm(true)} disabled={confirm} className="text-muted-foreground"><Trash2 />{tr('channels.remove')}</Button>
  const [error, setError] = useState('')
  const health = usePlatformHealth(ctx.rev)
  const machine = useElsewhere(ctx.channels)
  const [posts, setPosts] = useState<SocialPost[]>([])
  const loadPosts = () => { dbList('social_posts').then(setPosts).catch(() => {}) }
  useEffect(loadPosts, [ctx.rev])
  const selected = ctx.channels.find((c) => c.id === current) ?? ctx.channels[0]
  useEffect(() => setConfirm(false), [selected?.id])

  const remove = async () => {
    if (!selected) return
    try {
      await removeChannel(selected.id)
      ctx.reloadChannels()
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }
  const confirmBox = confirm && selected ? (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">{tr('channels.remove_confirm', { name: selected.name })}</span>
      <Button size="sm" variant="destructive" onClick={remove}>{tr('channels.remove_ok')}</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>{tr('common.cancel')}</Button>
    </div>
  ) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('channels.title')}
        desc={tr('channels.desc')}
        actions={
          <Button onClick={() => { before.current = null; setAdding(true) }} disabled={ctx.offline} title={ctx.offline ? tr('channels.add_offline') : undefined}>
            <Plus /> {tr('channels.add')}
          </Button>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      {ctx.channels.length === 0 ? (
        <Notice>{tr('channels.empty')}</Notice>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {ctx.channels.map((c) => {
              const on = c.id === selected?.id
              const Icon = CHANNEL_TYPES[c.type]?.icon
              const st = connection(c, health.rows, posts, machine)
              return (
                <button
                  key={c.id}
                  onClick={() => setCurrent(c.id)}
                  className={cx(
                    'flex min-w-56 cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] p-2 pr-4 text-left transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    on ? 'border-blue-500 bg-background' : 'border-border bg-background hover:bg-accent',
                  )}
                >
                  {/* 左边是账号头像（网站、没采到头像的用平台图标占位），平台图标缩小放到第二行平台名前面；选中看外框 */}
                  {c.avatar ? <img src={shuttleImage(c.avatar)} alt="" loading="lazy" className="size-8 shrink-0 rounded-full object-cover" /> : <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{Icon && <Icon size={14} strokeWidth={2.5} />}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{c.name}</span>
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-[10px] font-medium text-muted-foreground">{Icon && <Icon size={10} className="shrink-0" />}{CHANNEL_TYPES[c.type]?.label}{st.label && <><span aria-hidden>·</span><span className={cx('size-1.5 shrink-0 rounded-full', DOT[st.tone])} /><span className="truncate">{st.label}</span></>}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {selected && (
            <div className="space-y-4">
              {/* 每个账号一张卡片：头部是头像、名字、状态和操作（看数据、移除），下面是发布自检 */}
              {confirmBox}
              {isSocial(selected) ? (
                <AccountConnection key={selected.id} actions={<><Button variant="outline" size="sm" onClick={() => ctx.go('social', { section: 'data', account: selected.id })}><BarChart3 />{tr('channels.view_data')}</Button>{removeBtn}</>} ch={selected} other={loggedInElsewhere(selected, machine)} health={health.rows} posts={posts} onOpenPost={(p) => p.article_id ? ctx.go('content', { article: p.article_id, version: p.id }) : ctx.go('social', { post: p.id })} onDone={() => { health.reload(); loadPosts(); ctx.reloadChannels() }} />
              ) : (
                <NotEnabled ch={selected} actions={removeBtn} onDone={ctx.reloadChannels} />
              )}
            </div>
          )}
        </>
      )}

      {adding && (
        <AddChannelDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            before.current = new Set(ctx.channels.map((c) => c.id))
            setAdding(false)
            ctx.reloadChannels()
          }}
        />
      )}
    </div>
  )
}

/** 社媒账号的连接：登录状态、重新登录、打开主页、发布自检。采集和数据在社交媒体页 */
function AccountConnection({ ch, actions, other, health, posts, onOpenPost, onDone }: { ch: Channel; actions: ReactNode; other: string; health: PlatformHealth[]; posts: SocialPost[]; onOpenPost: (p: SocialPost) => void; onDone: () => void }) {
  const [error, setError] = useState('')
  const expired = !other && ch.login_status === 'expired'
  const home = !other && platformOf(ch)?.profileUrl(ch)
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-3">
        {ch.avatar ? <img src={shuttleImage(ch.avatar)} alt="" className="size-10 rounded-full object-cover" /> : <div className="size-10 rounded-full bg-muted" />}
        <div className="min-w-40 flex-1">
          <div className="truncate text-sm font-semibold">{ch.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {other ? tr('social.elsewhere_hint', { name: other }) : expired ? tr('channels.expired_hint') : ch.login_status === 'ok' ? tr('social.logged_in') : tr('social.not_connected')}
            {ch.collected_at ? ` · ${tr('social.collected_at', { when: fmtTime(ch.collected_at) })}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {home && (
            <RunButton inline fn="social/social.openProfile" input={{ channel_id: ch.id }} icon={ArrowUpRight} variant="ghost" onError={setError}>
              {tr('social.open_profile')}
            </RunButton>
          )}
          {/* 登录正常时能直接采集（和社交媒体页的账号卡片一样）；没登录或登录过期先登录 */}
          {!other && !expired && ch.login_status === 'ok' && (
            <RunButton inline watch fn="social/social.collect" input={{ channel_id: ch.id }} icon={RefreshCw} variant="ghost" onError={setError} onDone={onDone}>
              {tr('social.collect')}
            </RunButton>
          )}
          <RunButton inline watch fn="social/social.login" input={{ channel_id: ch.id }} icon={UserRound} variant={other || expired ? 'default' : 'ghost'} onError={setError} onDone={onDone}>
            {other ? tr('social.login_here') : tr('social.relogin')}
          </RunButton>
          {actions}
        </div>
      </div>
      {error && <ErrorDetails message={error} />}
      <PublishProblems account={ch} rows={health} posts={posts} onOpenPost={onOpenPost} onChanged={onDone} />
      {platformOf(ch)?.probe && !expired && !other && <ProbeLine ch={ch} rows={health} onChanged={onDone} />}
    </div>
  )
}

/** 账号的平台在这个项目的社媒插件里还没有（plugins/social/local/_platforms.ts 没有它）：发布、采集都用不了，交给助手接进来 */
function NotEnabled({ ch, actions, onDone }: { ch: Channel; actions: ReactNode; onDone: () => void }) {
  const platform = CHANNEL_TYPES[ch.type]?.label ?? ch.type
  const prompt = `这个项目里有${platform}账号「${ch.name}」（channel_id: ${ch.id}，渠道类型 ${ch.type}），但项目还没接入${platform}这个平台，发布和采集都用不了。请把${platform}接入这个项目：
1. 先读 plugins/social/PLUGIN.md：照已有平台在社媒插件里加这个平台（plugins/social/local/<平台>.ts 和 _platforms.ts），lib/edition.ts 的 CHANNELS 里也加上 ${ch.type}；
2. 补上这个平台的写作任务、写法和定时采集（照插件里已有平台的做法）；
3. 用 annulo run social/social.login 登录这个账号、social/social.collect 采集一次，确认能用；
4. annulo push 推送，告诉我接好了没有、还差什么。`
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 text-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{tr('channels.not_enabled_title', { platform })}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tr('channels.not_enabled_desc')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AskButton prompt={prompt} title={tr('channels.enable_title', { platform })} variant="default" onFinished={onDone}>
          {tr('channels.enable', { platform })}
        </AskButton>
        {actions}
      </div>
    </div>
  )
}
