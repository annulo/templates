import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, BarChart3, Plus, RefreshCw, Settings, Trash2, UserRound } from 'lucide-react'
import { PublishSetup } from '../PublishTargets'
import AddChannelDialog from '../AddChannelDialog'
import WpCredential from '../WpCredential'
import RunButton from '../RunButton'
import EditSiteButton from '../EditSiteButton'
import AskButton from '../AskButton'
import { brokenOf, ActivityLine, PublishProblems, usePlatformHealth } from '../PlatformHealth'
import { Button, ErrorDetails, Notice, PageHeader, cx, fmtTime, type Tone } from '../ui'
import { dbList, isSite, openShuttleSettings, removeChannel, runLocal, shuttleImage, type Channel, type PlatformHealth, type SocialPost } from '../../lib/shuttle'
import { CHANNEL_TYPES } from '../../lib/channels'
import { FacebookConnectionButton } from '../FacebookAccountFlow'
import { isSocial, loggedInElsewhere, platformOf, useElsewhere, type Elsewhere } from '../../lib/social'
import { hostOf, siteURL } from '../../lib/format'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'
import { useCanRun } from '../../lib/useShuttle'

/** 卡片上的连接状态：这一页只回答「哪个网站、账号要处理」，数据在社交媒体页、网站访问页看 */
function connection(c: Channel, health: PlatformHealth[], posts: SocialPost[], machine: Elsewhere): { label: string; tone: Tone } {
  if (isSocial(c)) {
    const other = loggedInElsewhere(c, machine)
    if (other) return { label: tr('social.on_machine', { name: other }), tone: 'default' }
    if (c.login_status === 'expired') return { label: tr('social.login_expired'), tone: 'warn' }
    if (brokenOf(health, c.id).length || posts.some((p) => p.channel_id === c.id && p.status === 'failed')) return { label: tr('meta.social_status.failed'), tone: 'bad' }
    return c.login_status === 'ok' ? { label: tr('social.connected'), tone: 'ok' } : { label: tr('social.not_connected'), tone: 'default' }
  }
  if (isSite(c)) {
    if (c.publish_status === 'broken') return { label: tr('channels.publish_broken'), tone: 'bad' }
    return c.publish_status === 'ready' && c.publisher ? { label: tr('channels.publish_ready'), tone: 'ok' } : { label: tr('channels.publish_unset'), tone: 'default' }
  }
  return { label: tr('channels.not_enabled'), tone: 'warn' }
}

const DOT: Record<Tone, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-destructive', primary: 'bg-primary', default: 'bg-muted-foreground/50' }

/** 账号和网站：只管连接（添加、移除、登录、网站的发布设置），不放数据 */
export default function Channels({ ctx, current, setCurrent }: { ctx: Ctx; current: string; setCurrent: (id: string) => void }) {
  const [adding, setAdding] = useState(false)
  // 添加前已有的账号：列表重新读回来后选中多出来的那个（对话框只告诉我们加了哪种，社媒还可能一次勾好几个，选第一个）
  const before = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!before.current) return
    const added = ctx.channels.find((c) => !before.current!.has(c.id))
    if (!added) return
    before.current = null
    setCurrent(added.id)
  }, [ctx.channels])
  const [confirm, setConfirm] = useState(false)
  const canWp = useCanRun('channels.wpVerify') // WordPress 的应用密码存在本机密钥里
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
              {/* 每个渠道一张卡片：头部是头像/图标、名字、状态和操作（看数据、移除），下面分隔线隔开的是这个渠道的设置——网站是文章发布，社媒是上次发布、采集成没成 */}
              {isSite(selected) ? (
                <SiteCard ctx={ctx} ch={selected} confirm={confirmBox} actions={<>{selected.type === 'creght_site' && <EditSiteButton channelId={selected.id} />}{selected.type === 'creght_site' && <Button variant="outline" size="sm" onClick={() => ctx.go('site', { channel: selected.id })}><BarChart3 />{tr('channels.view_visits')}</Button>}{removeBtn}</>} />
              ) : confirmBox}
              {selected.type === 'wordpress' ? (
                <WpCredential channel={selected} disabled={!canWp} />
              ) : isSocial(selected) ? (
                <AccountConnection key={selected.id} actions={<><Button variant="outline" size="sm" onClick={() => ctx.go('social', { section: 'data', account: selected.id })}><BarChart3 />{tr('channels.view_data')}</Button>{removeBtn}</>} ch={selected} other={loggedInElsewhere(selected, machine)} health={health.rows} posts={posts} onOpenPost={(p) => p.article_id ? ctx.go('content', { article: p.article_id, version: p.id }) : ctx.go('social', { post: p.id })} onDone={() => { health.reload(); loadPosts(); ctx.reloadChannels() }} />
              ) : !isSite(selected) ? (
                <NotEnabled ch={selected} actions={removeBtn} onDone={ctx.reloadChannels} />
              ) : null}
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

/** 网站的卡片：和社媒账号卡片（AccountConnection）同一个样子，分隔线下面是文章发布设置 */
function SiteCard({ ctx, ch, actions, confirm }: { ctx: Ctx; ch: Channel; actions: ReactNode; confirm: ReactNode }) {
  const Icon = CHANNEL_TYPES[ch.type]?.icon
  const url = siteURL(ch)
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{Icon && <Icon size={18} />}</div>
        <div className="min-w-40 flex-1">
          <div className="truncate text-sm font-semibold">{ch.name}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="shrink-0">{CHANNEL_TYPES[ch.type]?.label}</span>
            {url && <><span aria-hidden>·</span><a href={url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-0.5 hover:text-primary-text"><span className="truncate">{hostOf(url)}</span><ArrowUpRight className="size-3 shrink-0" /></a></>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">{actions}</div>
      </div>
      {confirm}
      {ch.type === 'creght_site' && <CreghtAccess ch={ch} onLive={ctx.reloadChannels} />}
      <div className="border-t border-border pt-3"><PublishSetup ctx={ctx} channel={ch} bare /></div>
    </div>
  )
}

/** 社媒账号的连接：登录状态、重新登录、打开主页、上次发布和采集的结果。采集和数据在社交媒体页 */
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
          {ch.type === 'facebook' ? <FacebookConnectionButton channel={ch} onDone={onDone} /> : <RunButton inline watch fn="social/social.login" input={{ channel_id: ch.id }} icon={UserRound} variant={other || expired ? 'default' : 'ghost'} onError={setError} onDone={onDone}>
            {other ? tr('social.login_here') : tr('social.relogin')}
          </RunButton>}
          {actions}
        </div>
      </div>
      {error && <ErrorDetails message={error} />}
      <PublishProblems account={ch} rows={health} posts={posts} onOpenPost={onOpenPost} onChanged={onDone} />
      {!expired && !other && <ActivityLine ch={ch} rows={health} />}
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

type Access = { state: 'ok' | 'no_mcp' | 'needs_auth' | 'not_in_account' | 'failed'; error?: string; live_url?: string }

/** creght 站点：输入网址加进来的不一定读得到（creght MCP 停用了、还没授权、站点不在当前连接的账号下），说清楚并给去处理的入口 */
function CreghtAccess({ ch, onLive }: { ch: Channel; onLive: () => void }) {
  const [access, setAccess] = useState<Access | null>(null)
  // 读到的正式地址和表里的不一样（刚发布、换了域名）：access 已写回表，重拉渠道让卡片上的地址跟着变
  const load = () => { runLocal<Access>('channels.access', { id: ch.id }).then((r) => { setAccess(r); if (r.state === 'ok' && (r.live_url ?? '') !== (ch.live_url ?? '')) onLive() }).catch((e: Error) => setAccess({ state: 'failed', error: e.message })) }
  useEffect(load, [ch.id])
  if (!access || access.state === 'ok') return null
  const go = access.state === 'not_in_account' ? 'connections' : 'mcp'
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{tr(`channels.creght_${access.state}`)}</div>
        {access.state === 'failed' && access.error && <div className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{access.error}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {access.state === 'failed'
          ? <Button size="sm" variant="outline" onClick={load}><RefreshCw />{tr('channels.creght_retry')}</Button>
          : <Button size="sm" variant="outline" onClick={() => openShuttleSettings(go)}><Settings />{tr('ui.go_settings')}</Button>}
      </div>
    </div>
  )
}
