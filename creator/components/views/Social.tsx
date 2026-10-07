import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, HardDrive, Loader2, Pencil, Plus, RefreshCw, Send, Trash2, TrendingUp, UserRound, Users, X } from 'lucide-react'
import RunButton from '../RunButton'
import SocialOverview from '../SocialOverview'
import WorkspaceTabs from '../WorkspaceTabs'
import RichEditor from '../RichEditor'
import SchedulePopover, { ScheduledLine } from '../SchedulePopover'
import { Badge, Button, Dialog, ErrorDetails, Field, Notice, PageHeader, RangeToggle, Segmented, Skeleton, cx, fmtTime, inputCls, type Tone } from '../ui'
import { dbList, dbPatch, runLocal, shuttleImage, type Article, type Channel, type PlatformHealth, type SocialDaily, type SocialPost, type SocialPostStatus, uploadLocalFile, videoSrc } from '../../lib/shuttle'
import { SOCIAL, isSocial, type MetricKey, fieldsOf, isRich, isVideoPost, loggedInElsewhere, postText, richImages, toRich, platformOf, postTitle, socialTypes, useElsewhere, type SocialPlatform } from '../../lib/social'
import Select from '../Select'
import AssetPicker from '../AssetPicker'
import { CHANNEL_TYPES } from '../../lib/channels'
import type { Ctx } from './types'
import { numLocale, tr } from '../../lib/i18n'
import { brokenOf, ProbeLine, PublishProblems, usePlatformHealth } from '../PlatformHealth'

// label 按当前语言取（getter）
const lbl = (key: string, tone: Tone) => ({ get label() { return tr(key) }, tone })
const STATUS: Record<SocialPostStatus, { label: string; tone: Tone }> = {
  draft: lbl('content.a_draft', 'default'),
  pending_review: lbl('meta.social_status.pending_review', 'warn'),
  approved: lbl('social.st_approved', 'primary'),
  scheduled: lbl('meta.social_status.scheduled', 'primary'),
  publishing: lbl('meta.social_status.publishing', 'warn'),
  published: lbl('meta.social_status.published', 'ok'),
  failed: lbl('meta.social_status.failed', 'bad'),
  rejected: lbl('meta.social_status.rejected', 'default'),
  removed: lbl('meta.social_status.removed', 'default'),
}

const parse = <T,>(s: string | undefined, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d
  } catch {
    return d
  }
}
const n = (v?: number) => (v ?? 0).toLocaleString(numLocale())

/** 本机时区的日期 YYYY-MM-DD（和采集时记的日期一致） */
function localDay(d: Date) {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 社交媒体：账号的状态和数据（粉丝、互动、采集）。内容的编辑、审核、发布、排期在内容页（各渠道版本）和发布日历，这里不重复。
 * 旧链接的 ?tab=… 已经没有对应的页签，落到账号概览；?post=<id> 仍然打开那一条（从平台采回来、不属于任何文章的帖子只在这里看得到）。
 */
export default function Social({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  type Section = 'overview' | 'data'
  const section: Section = params.section === 'data' ? 'data' : 'overview'
  const [posts, setPosts] = useState<SocialPost[] | null>(null)
  const [daily, setDaily] = useState<SocialDaily[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [error, setError] = useState('')
  const [days, setDays] = useState(ctx.days)
  const accounts = useMemo(() => ctx.channels.filter(isSocial), [ctx.channels])
  const selected = accounts.find((a) => a.id === params.account) ?? accounts[0]
  const load = useCallback(() => {
    setError('')
    dbList('social_posts')
      .then((ps) => setPosts(ps.map((p) => p.status === 'rejected' && /^已从.+删除$/.test(p.review_note ?? '') ? { ...p, status: 'removed' as const } : p)))
      .catch((e) => setError(e.message))
    dbList('social_daily').then(setDaily).catch(() => {})
    dbList('articles').then(setArticles).catch(() => {})
  }, [])
  useEffect(load, [load, ctx.rev])
  const health = usePlatformHealth(ctx.rev)
  const machine = useElsewhere(ctx.channels)
  const onChanged = () => { load(); health.reload(); ctx.reloadChannels() }
  const owned = useMemo(() => {
    const ids = new Set(accounts.map((a) => a.id))
    return (posts ?? []).filter((p) => ids.has(p.channel_id))
  }, [posts, accounts])
  // 近 30 天粉丝涨了多少：和 social/stats.summary 一样，最近一次采集减去期初（30 天前那天之前的最后一次）；期初前没记录就不算
  const gain = useMemo(() => {
    const start = localDay(new Date(Date.now() - 29 * 86400_000))
    const out: Record<string, number | null> = {}
    for (const a of accounts) {
      const ds = daily.filter((d) => d.channel_id === a.id).sort((x, y) => x.date.localeCompare(y.date))
      const base = [...ds].reverse().find((d) => d.date < start)
      const last = ds[ds.length - 1]
      out[a.id] = base && last ? (last.followers ?? 0) - (base.followers ?? 0) : null
    }
    return out
  }, [accounts, daily])
  const gains = Object.values(gain).filter((g): g is number => g !== null)
  const other = (a: Channel) => !!loggedInElsewhere(a, machine)
  const expired = (a: Channel) => !other(a) && a.login_status === 'expired'
  const broken = (a: Channel) => brokenOf(health.rows, a.id).some((r) => r.op === 'publish') || owned.some((p) => p.channel_id === a.id && p.status === 'failed')
  // 要人处理的账号：登录过期，或者发布出了问题（自检失败、有发失败的帖子）。统计卡片叫「待处理账号」，不只是发布异常
  const issues = accounts.filter((a) => expired(a) || broken(a))
  const collectable = accounts.filter((a) => !other(a) && a.login_status === 'ok')
  const oldest = collectable.map((a) => a.collected_at).filter((t): t is string => !!t).sort()[0]
  const openSection = (next: Section, extra: Record<string, string> = {}) => ctx.go('social', { section: next, ...extra })
  const manage = () => ctx.go('channels', selected ? { channel: selected.id } : {})
  const focused = owned.find((p) => p.id === params.post)
  const openPost = (p: SocialPost) => p.article_id ? ctx.go('content', { article: p.article_id, version: p.id }) : setParam('post', p.id)
  const tableHead = 'px-4 py-2.5 text-left text-xs font-medium text-muted-foreground'
  const tableCell = 'px-4 py-3 text-sm'
  const num = 'px-4 py-3 text-right text-sm tabular-nums'
  const login = (a: Channel) => other(a) ? <Badge>{tr('social.on_machine', { name: loggedInElsewhere(a, machine) })}</Badge> : <Badge tone={a.login_status === 'ok' ? 'ok' : a.login_status === 'expired' ? 'warn' : 'default'}>{tr(a.login_status === 'ok' ? 'social.connected' : a.login_status === 'expired' ? 'social.login_expired' : 'social.not_connected')}</Badge>
  const latest = (a: Channel) => [...owned].filter((p) => p.channel_id === a.id && p.status === 'published' && p.published_at).sort((x, y) => Date.parse(y.published_at!) - Date.parse(x.published_at!))[0]
  const lastPublished = (a: Channel) => broken(a) ? <span className="text-amber-700 dark:text-amber-400">{tr('meta.social_status.failed')}</span> : <span className="text-muted-foreground">{latest(a) ? fmtTime(latest(a)!.published_at) : tr('social.never_published')}</span>
  const followers = (a: Channel) => a.followers == null ? <span className="text-muted-foreground">{tr('social.not_collected')}</span> : <span className="inline-flex items-baseline gap-1.5"><span className="tabular-nums">{n(a.followers)}</span>{/* 列里是累计粉丝；旁边的箭头是近 30 天的增减，悬停说明 */}{gain[a.id] != null && <span title={tr('social.followers_gain_30_title', { sign: gain[a.id]! > 0 ? '+' : gain[a.id]! < 0 ? '-' : '', n: n(Math.abs(gain[a.id]!)) })} className={cx('text-xs tabular-nums', gain[a.id]! > 0 ? 'text-emerald-600 dark:text-emerald-400' : gain[a.id]! < 0 ? 'text-destructive' : 'text-muted-foreground')}>{gain[a.id]! > 0 ? '↑' : gain[a.id]! < 0 ? '↓' : ''}{n(Math.abs(gain[a.id]!))}</span>}</span>
  const action = (a: Channel) => {
    const link = 'cursor-pointer text-sm font-medium text-primary-text hover:underline'
    if (other(a) || expired(a)) return <RunButton inline fn="social/social.login" input={{ channel_id: a.id }} icon={UserRound} variant="ghost" onError={setError} onDone={onChanged}>{other(a) ? tr('social.login_here') : tr('social.relogin')}</RunButton>
    return <button type="button" className={link} onClick={() => openSection('data', { account: a.id })}>{broken(a) ? tr('social.fix_publish') : tr('social.view_data')}</button>
  }
  const avatar = (a: Channel) => a.avatar ? <img src={shuttleImage(a.avatar)} alt="" loading="lazy" className="size-7 shrink-0 rounded-full object-cover" /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserRound className="size-4" /></span>
  const recent = [...owned].filter((p) => p.status === 'published').sort((x, y) => Date.parse(y.published_at || '') - Date.parse(x.published_at || '')).slice(0, 5)

  return <div className="space-y-6">
    <PageHeader title={tr('social.hub_title')} desc={tr('social.hub_desc')} actions={<>
      <Button variant="outline" onClick={manage}>{tr('social.manage_accounts')}</Button>
      <Button onClick={() => ctx.go('content', { tab: 'articles', new: '1' })}><Plus />{tr('social.create_social')}</Button>
    </>} />
    <WorkspaceTabs id="social" label={tr('social.hub_title')} value={section} onChange={(next) => openSection(next, selected ? { account: selected.id } : {})} options={[{ value: 'overview', label: tr('social.tab_overview') }, { value: 'data', label: tr('social.tab_data') }]} />
    {error && <ErrorDetails message={error} />}
    <div id="social-panel" role="tabpanel" aria-labelledby={`social-${section}`} className="space-y-6">
      {accounts.length === 0 ? <Notice>{tr('social.hub_empty', { name: tr('nav.channels') })}</Notice> : section === 'overview' ? <>
        <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border py-5">
          {([
            [Users, 'accounts_n', accounts.length, () => openSection('overview')],
            [TrendingUp, 'followers_gain_30', gains.length ? (gains.reduce((x, y) => x + y, 0) > 0 ? '+' : '') + n(gains.reduce((x, y) => x + y, 0)) : '—', () => openSection('data')],
            [AlertCircle, 'publishing_issues', posts === null ? '—' : issues.length, () => issues[0] && openSection('data', { account: issues[0].id })],
          ] as const).map(([Icon, label, value, onClick]) => <button type="button" key={label} onClick={onClick} className="flex cursor-pointer items-center gap-4 px-4 text-left md:px-6">
            <span className={cx('hidden size-11 shrink-0 items-center justify-center rounded-full sm:flex', label === 'publishing_issues' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-primary/5 text-primary-text')}><Icon className="size-5" strokeWidth={1.8} /></span>
            <div><div className="text-xs text-muted-foreground">{tr('social.' + label)}</div><div className="mt-1 text-[28px] leading-tight font-semibold tabular-nums">{value}</div></div>
          </button>)}
        </div>
        <section className="space-y-3" aria-labelledby="social-accounts-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="social-accounts-title" className="text-lg font-semibold">{tr('social.accounts_status')}</h2>
            {collectable.length > 0 && <CollectAll accounts={collectable} oldest={oldest} onDone={onChanged} />}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-border sm:block"><table className="w-full min-w-[720px] border-collapse">
            <thead className="border-b border-border bg-muted/40"><tr>{['platform', 'account', 'followers_30', 'connection_status', 'last_publish', 'todo'].map((key) => <th key={key} scope="col" className={tableHead}>{tr('social.' + key)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">{accounts.map((a) => <tr key={a.id} className="hover:bg-muted/30">
              <td className={tableCell}><PlatformName type={a.type} name={platformOf(a)?.label ?? ''} /></td>
              {/* 头像和总览「渠道与账号」表一样：有就显示，没有用占位 */}
              <td className={tableCell}><button type="button" onClick={() => openSection('data', { account: a.id })} className="flex max-w-56 cursor-pointer items-center gap-2.5 text-left font-medium hover:text-primary-text">{avatar(a)}<span className="truncate">{a.name}</span></button></td>
              <td className={tableCell}><button type="button" onClick={() => openSection('data', { account: a.id })} className="cursor-pointer hover:text-primary-text">{followers(a)}</button></td>
              <td className={tableCell}>{login(a)}</td><td className={tableCell}>{lastPublished(a)}</td><td className={tableCell}>{action(a)}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="divide-y divide-border rounded-lg border border-border sm:hidden">{accounts.map((a) => <div key={a.id} className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2"><button type="button" onClick={() => openSection('data', { account: a.id })} className="min-w-0 cursor-pointer text-left text-sm font-medium"><PlatformName type={a.type} name={a.name} /></button>{login(a)}</div>
            <div className="flex items-center justify-between gap-2 text-xs">{followers(a)}{lastPublished(a)}{action(a)}</div>
          </div>)}</div>
        </section>
        <section className="space-y-3" aria-labelledby="social-recent-title">
          <h2 id="social-recent-title" className="text-lg font-semibold">{tr('social.recent_performance')}</h2>
          {posts === null ? <Skeleton className="h-24" /> : recent.length ? <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] border-collapse">
              <thead className="border-b border-border bg-muted/40"><tr>
                <th scope="col" className={tableHead}>{tr('social.content_title')}</th>
                <th scope="col" className={tableHead}>{tr('social.platform')}</th>
                {(['m_views', 'm_likes', 'm_comments'] as const).map((k) => <th key={k} scope="col" className={cx(tableHead, 'text-right')}>{tr('social_ov.' + k)}</th>)}
                <th scope="col" className={tableHead}>{tr('social.action')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">{recent.map((p) => {
                const owner = accounts.find((a) => a.id === p.channel_id)
                return <tr key={p.id} className="hover:bg-muted/30">
                  <td className={tableCell}><button type="button" onClick={() => openPost(p)} className="block max-w-80 cursor-pointer truncate text-left font-medium hover:text-primary-text" title={postTitle(p)}>{postTitle(p)}</button><span className="mt-0.5 block text-xs text-muted-foreground">{owner?.name} · {fmtTime(p.published_at)}</span></td>
                  <td className={tableCell}><PlatformName type={owner?.type} name={platformOf(owner)?.label ?? ''} /></td>
                  <td className={num}>{p.metrics_at ? n(p.views) : '—'}</td><td className={num}>{p.metrics_at ? n(p.likes) : '—'}</td><td className={num}>{p.metrics_at ? n(p.comments) : '—'}</td>
                  <td className={tableCell}>{p.post_url ? <a href={p.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-primary-text hover:underline">{tr('social.view_live')}<ArrowUpRight className="size-3" /></a> : <button type="button" className="cursor-pointer whitespace-nowrap font-medium text-primary-text hover:underline" onClick={() => openPost(p)}>{tr('social.view_content')}</button>}</td>
                </tr>
              })}</tbody>
            </table>
          </div> : <p className="text-sm text-muted-foreground">{tr('social.no_recent_published')}</p>}
        </section>
      </> : selected ? <>
        {/* 账号和时间段粘在顶部，往下看帖子时也能随时换。-top-4 和 -mx 抵掉滚动区（pages/Index.tsx）的内边距，下面的内容不会从上方和两边漏出来。
            -mt-6 抵掉和页签之间的 space-y-6：上下都只剩 py-3，文字到页签线和到自己底线一样远 */}
        <div className="sticky -top-4 -mx-4 -mt-6 px-4 md:-mx-6 md:px-6 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background py-3">
          <Select value={selected.id} onChange={(v) => setParam('account', v)} ariaLabel={tr('social.account')} title={tr('social.account')} variant="inline" options={accounts.map((a) => { const I = CHANNEL_TYPES[a.type]?.icon; return { value: a.id, label: a.name, sub: platformOf(a)?.label, icon: I ? <I size={14} /> : undefined } })} />
          <RangeToggle value={days} onChange={setDays} options={[7, 30, 90].map((d) => ({ value: d, label: tr('common.last_days', { n: d }) }))} />
        </div>
        <PublishProblems account={selected} rows={health.rows} posts={posts ?? []} onOpenPost={openPost} onChanged={onChanged} />
        <Account ch={selected} other={loggedInElsewhere(selected, machine)} health={health.rows} selected={false} onSelect={() => ctx.go('channels', { channel: selected.id })} onDone={onChanged} />
        <SocialOverview key={`${selected.id}:${selected.collected_at ?? ''}:${ctx.rev}`} channel={selected} days={days} />
        <AllPosts key={selected.id} ch={selected} days={days} posts={posts === null ? null : owned.filter((p) => p.channel_id === selected.id && p.status === 'published')} onOpen={openPost} />
      </> : null}
      {focused && <div className="rounded-lg border border-border bg-background"><div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2"><span className="text-sm font-semibold">{tr('social.view_content')}</span><Button variant="ghost" size="sm" onClick={() => setParam('post', '')}><X />{tr('common.close')}</Button></div><PostRow key={focused.id} p={focused} owner={accounts.find((a) => a.id === focused.channel_id)} showAccount articles={articles} onChanged={onChanged} focus onUnfocus={() => setParam('post', '')} /></div>}
    </div>
  </div>
}

/** 「全部重新采集」：一个一个账号跑 social.collect（采集要开浏览器，不并发），跑完刷新 */
function CollectAll({ accounts, oldest, onDone }: { accounts: Channel[]; oldest?: string; onDone: () => void }) {
  const [at, setAt] = useState(-1)
  const [failed, setFailed] = useState<string[]>([])
  const run = async () => {
    setFailed([])
    const bad: string[] = []
    for (let i = 0; i < accounts.length; i++) {
      setAt(i)
      try { await runLocal('social/social.collect', { channel_id: accounts[i].id }) } catch (e) { bad.push(`${accounts[i].name}：${(e as Error).message}`) }
    }
    setAt(-1)
    setFailed(bad)
    onDone()
  }
  return <div className="flex min-w-0 flex-col items-end gap-1">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{oldest ? tr('social.data_as_of', { when: fmtTime(oldest) }) : tr('social.never_collected')}</span>
      <Button fn="social/social.collect" variant="ghost" size="sm" disabled={at >= 0} onClick={run}>{at >= 0 ? <Loader2 className="animate-spin" /> : <RefreshCw />}{at >= 0 ? tr('social.collecting_n', { i: at + 1, n: accounts.length }) : tr('social.collect_all')}</Button>
    </div>
    {failed.length > 0 && <ErrorDetails message={failed.join('\n')} />}
  </div>
}

/** 平台图标使用仓库现有的真实品牌图标。 */
function PlatformIcon({ type, size = 12 }: { type?: Channel['type']; size?: number }) {
  const I = type ? CHANNEL_TYPES[type]?.icon : undefined
  return I ? <I size={size} className="shrink-0" /> : null
}

const PAGE = 20

/** 一个账号发的帖子：可以只看上面选的时间段里发的，也可以看全部；数字是最近一次采集的值；默认最新的在前，点表头按那一列排 */
function AllPosts({ ch, days, posts, onOpen }: { ch: Channel; days: number; posts: SocialPost[] | null; onOpen: (p: SocialPost) => void }) {
  const [sort, setSort] = useState<'published_at' | MetricKey>('published_at')
  const [scope, setScope] = useState<'range' | 'all'>('range')
  const [shown, setShown] = useState(PAGE)
  const metrics = SOCIAL[ch.type]?.metrics ?? []
  // 和 social/stats.summary 的「这段时间发的」一样：从 days 天前那天的 0 点起
  const since = new Date(new Date().setHours(0, 0, 0, 0) - (days - 1) * 86400_000).getTime()
  const rows = useMemo(() => (posts ?? []).filter((p) => scope === 'all' || (Date.parse(p.published_at || '') || 0) >= since).sort((a, b) => sort === 'published_at'
    ? (Date.parse(b.published_at || '') || 0) - (Date.parse(a.published_at || '') || 0)
    : (Number(b[sort]) || 0) - (Number(a[sort]) || 0)), [posts, scope, since, sort])
  const head = 'whitespace-nowrap px-4 py-2.5 text-xs font-medium'
  const sortBtn = (key: typeof sort, label: string, right = false) => <th scope="col" className={cx(head, right ? 'text-right' : 'text-left')} aria-sort={sort === key ? 'descending' : 'none'}>
    <button type="button" onClick={() => { setSort(key); setShown(PAGE) }} className={cx('inline-flex cursor-pointer items-center gap-1 whitespace-nowrap hover:text-foreground', sort === key ? 'text-foreground' : 'text-muted-foreground')}>{label}{sort === key && <ChevronDown className="size-3" />}</button>
  </th>
  return <section className="space-y-3" aria-labelledby="social-all-posts">
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="social-all-posts" className="text-lg font-semibold">{tr('social.all_posts', { n: rows.length })}</h2>
        <Segmented<'range' | 'all'> value={scope} onChange={(v) => { setScope(v); setShown(PAGE) }} options={[{ value: 'range', label: tr('social.posts_in_range', { n: days }) }, { value: 'all', label: tr('social.posts_all') }]} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{tr('social.all_posts_hint')}</p>
    </div>
    {posts === null ? <Skeleton className="h-24" /> : !rows.length ? <p className="text-sm text-muted-foreground">{scope === 'range' ? tr('social.no_posts_in_range', { n: days }) : tr('social.no_recent_published')}</p> : <>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] border-collapse">
          <thead className="border-b border-border bg-muted/40"><tr>
            {sortBtn('published_at', tr('social.content_title'))}
            {metrics.map((m) => <Fragment key={m.key}>{sortBtn(m.key, m.label, true)}</Fragment>)}
            <th scope="col" className={cx(head, 'text-left text-muted-foreground')}>{tr('social.action')}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">{rows.slice(0, shown).map((p) => <tr key={p.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 text-sm"><button type="button" onClick={() => onOpen(p)} className="block max-w-96 cursor-pointer truncate text-left font-medium hover:text-primary-text" title={postTitle(p)}>{postTitle(p)}</button><span className="mt-0.5 block text-xs text-muted-foreground">{fmtTime(p.published_at)}</span></td>
            {metrics.map((m) => <td key={m.key} className="px-4 py-3 text-right text-sm tabular-nums">{p.metrics_at ? n(Number(p[m.key]) || 0) : '—'}</td>)}
            <td className="px-4 py-3 text-sm">{p.post_url ? <a href={p.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-primary-text hover:underline">{tr('social.view_live')}<ArrowUpRight className="size-3" /></a> : <button type="button" className="cursor-pointer whitespace-nowrap font-medium text-primary-text hover:underline" onClick={() => onOpen(p)}>{tr('social.view_content')}</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {rows.length > shown && <Button variant="outline" size="sm" onClick={() => setShown(shown + PAGE)}>{tr('social.load_more', { n: rows.length - shown })}</Button>}
    </>}
  </section>
}

/** logo + 名字（账号名或平台名） */
function PlatformName({ type, name }: { type?: Channel['type']; name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <PlatformIcon type={type} />
      <span className="truncate">{name}</span>
    </span>
  )
}

function Account({ ch, other, health, selected, onSelect, onDone }: { ch: Channel; other: string; health: PlatformHealth[]; selected: boolean; onSelect: () => void; onDone: () => void }) {
  const [error, setError] = useState('')
  // 登录态在别的电脑上：这台电脑上看不到它登没登录，采集、自检、打开主页也做不了，只给「在这台电脑登录」
  const expired = !other && ch.login_status === 'expired'
  const home = !other && platformOf(ch)?.profileUrl(ch)
  return (
    <div className={cx('min-w-0 rounded-xl border bg-background p-4 transition-colors', selected ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border')}>
      <button type="button" onClick={onSelect} aria-pressed={selected} title={selected ? tr('social.show_all') : tr('social.only_this')} className="flex w-full cursor-pointer items-center gap-3 text-left">
        {ch.avatar ? <img src={shuttleImage(ch.avatar)} alt="" className="size-10 rounded-full object-cover" /> : <div className="size-10 rounded-full bg-muted" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{ch.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <PlatformName type={ch.type} name={platformOf(ch)?.label ?? ''} />
            {other ? <Badge>{tr('social.on_machine', { name: other })}</Badge> : <Badge tone={expired ? 'bad' : ch.login_status === 'ok' ? 'ok' : 'default'}>{expired ? tr('social.login_expired') : ch.login_status === 'ok' ? tr('social.logged_in') : tr('common.unknown')}</Badge>}
            {ch.followers != null && <span className="tabular-nums">{tr('social.followers_n', { n: n(ch.followers) })}</span>}
          </div>
        </div>
      </button>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{other ? tr('social.elsewhere_hint', { name: other }) : ch.collected_at ? tr('social.collected_at', { when: fmtTime(ch.collected_at) }) : tr('social.never_collected')}</span>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
          {home && (
            <RunButton inline fn="social/social.openProfile" input={{ channel_id: ch.id }} icon={ArrowUpRight} variant="ghost" onError={setError}>
              {tr('social.open_profile')}
            </RunButton>
          )}
          {other || expired ? (
            <RunButton inline fn="social/social.login" input={{ channel_id: ch.id }} icon={UserRound} onError={setError} onDone={onDone}>
              {other ? tr('social.login_here') : tr('social.relogin')}
            </RunButton>
          ) : (
            <RunButton inline fn="social/social.collect" input={{ channel_id: ch.id }} icon={RefreshCw} variant="ghost" onError={setError} onDone={onDone}>
              {tr('social.collect')}
            </RunButton>
          )}
        </div>
      </div>
      {error && <div className="mt-2"><ErrorDetails message={error} /></div>}
      {platformOf(ch)?.probe && !expired && !other && (
        <div className="mt-3">
          <ProbeLine ch={ch} rows={health} onChanged={onDone} />
        </div>
      )}
    </div>
  )
}

function PostRow({ p, owner, showAccount, articles, onChanged, focus, onUnfocus }: { p: SocialPost; owner?: Channel; showAccount: boolean; articles: Article[]; onChanged: () => void; focus?: boolean; onUnfocus?: () => void }) {
  const account = showAccount ? owner : undefined
  const pf = platformOf(owner) ?? Object.values(SOCIAL)[0]!
  // 正在发布：上一次留在表里的报错先不显示，跑完重新读表再说
  const [publishingNow, setPublishingNow] = useState(false)
  const [previewing, setPreviewingRaw] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  // 从排期日历点过来（?post=<id>）：滚到这一条并打开预览；关掉预览时把参数去掉
  useEffect(() => {
    if (!focus) return
    rowRef.current?.scrollIntoView({ block: 'center' })
    setPreviewingRaw(true)
  }, [focus])
  const setPreviewing = (v: boolean) => {
    setPreviewingRaw(v)
    if (!v && focus) onUnfocus?.()
  }
  const [editing, setEditing] = useState(false)
  const [purging, setPurging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const tags = parse<string[]>(p.tags, [])
  const images = parse<string[]>(p.images, [])
  const st = STATUS[p.status]
  const patch = async (data: Partial<SocialPost>) => {
    setBusy(true)
    setErr('')
    try {
      await dbPatch('social_posts', p.id, { ...data, updated_at: new Date().toISOString() })
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rowRef} className={cx('flex gap-4 border-b border-border p-4 last:border-b-0', focus && 'bg-primary/5')}>
      <button type="button" onClick={() => setPreviewing(true)} title={tr('social.preview')} className="w-20 shrink-0 self-start cursor-pointer rounded-lg transition-opacity hover:opacity-80">
        {isVideoPost(pf, p) && p.video ? (
          <video src={videoSrc(p.video)} muted preload="metadata" className="aspect-[3/4] w-20 rounded-lg bg-black object-cover" />
        ) : images[0] ? (
          <img src={shuttleImage(images[0])} alt="" className="aspect-[3/4] w-20 rounded-lg object-cover" />
        ) : isRich(pf) ? (
          <RichCard p={p} owner={owner} tags={tags} />
        ) : !pf.cover ? (
          <div className="flex aspect-[3/4] w-20 items-center justify-center rounded-lg bg-muted text-muted-foreground" title={pf.label}>
            <PlatformIcon type={owner?.type} size={24} />
          </div>
        ) : (
          <div className="flex aspect-[3/4] w-20 items-center justify-center rounded-lg bg-[#f6efe6] p-2 text-center text-[11px] leading-snug font-semibold text-[#2f2620]">{p.cover_text || p.title}</div>
        )}
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPreviewing(true)} className="cursor-pointer text-left text-sm font-semibold hover:text-primary-text">
            {postTitle(p)}
          </button>
          <Badge tone={st.tone}>{st.label}</Badge>
          {p.source === 'platform' && <Badge>{tr('social.posted_on_platform', { p: pf.label })}</Badge>}
          {account && <span className="text-xs text-muted-foreground">{account.name}</span>}
        </div>
        {p.body && <p className="line-clamp-3 text-sm whitespace-pre-line text-muted-foreground">{postText(pf, p.body)}</p>}
        {tags.length > 0 && <div className="flex flex-wrap gap-1.5 text-xs text-primary-text">{tags.map((t) => <span key={t}>#{t}</span>)}</div>}

        {p.status === 'published' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {pf.metrics.map((m) => (
              <span key={m.key}>
                {m.label} {n(p[m.key])}
              </span>
            ))}
            {p.published_at && <span>{tr('social.published_at', { when: fmtTime(p.published_at) })}</span>}
            {p.metrics_at && <span>{tr('social.metrics_at', { when: fmtTime(p.metrics_at) })}</span>}
          </div>
        )}
        {p.status === 'scheduled' && <ScheduledLine at={p.scheduled_at} />}
        {!publishingNow && (p.status === 'failed' || (p.status === 'scheduled' && p.error)) && p.error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{p.error}</div>}
        {p.status === 'publishing' && <div className="text-xs text-muted-foreground">{tr('social.stuck_hint')}</div>}
        {p.status === 'removed' && <div className="text-xs text-muted-foreground">{tr('social.removed_from', { when: p.removed_at ? fmtTime(p.removed_at) : '', p: pf.label })}</div>}
        {p.status === 'rejected' && p.review_note && <div className="text-xs text-muted-foreground">{tr('social.review_note', { note: p.review_note })}</div>}
        {err && <div className="text-xs text-destructive">{err}</div>}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={() => setPreviewing(true)}>
            <Eye />
            {tr('social.preview')}
          </Button>
          {p.status === 'pending_review' && (
            <>
              <Button size="sm" onClick={() => patch({ status: 'approved' })} disabled={busy}>
                <Check />
                {tr('social.approve')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil />
                {tr('social.edit')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => patch({ status: 'rejected' })} disabled={busy}>
                <X />
                {tr('social.reject')}
              </Button>
            </>
          )}
          {(p.status === 'approved' || p.status === 'failed') && (
            <>
              <RunButton inline onError={setErr} fn="social/social.publish" input={{ post_id: p.id }} icon={Send} onStart={() => setPublishingNow(true)} onDone={() => { setPublishingNow(false); onChanged() }}>
                {p.status === 'failed' ? tr('social.republish') : tr('social.publish_now')}
              </RunButton>
              <SchedulePopover size="sm" hint={tr('social.time_hint', { p: pf.label, rate: pf.rateHint })} onSchedule={(at) => patch({ status: 'scheduled', scheduled_at: at, error: null as unknown as string })} />
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil />
                {tr('social.edit')}
              </Button>
            </>
          )}
          {p.status === 'publishing' && (
            <Button size="sm" variant="outline" onClick={() => patch({ status: 'failed', error: tr('social.stuck_error') })} disabled={busy}>
              {tr('social.mark_failed')}
            </Button>
          )}
          {p.status === 'scheduled' && (
            <>
              <RunButton inline onError={setErr} fn="social/social.publish" input={{ post_id: p.id }} icon={Send} onStart={() => setPublishingNow(true)} onDone={() => { setPublishingNow(false); onChanged() }}>
                {tr('social.publish_now')}
              </RunButton>
              <SchedulePopover size="sm" current={p.scheduled_at} hint={tr('social.time_hint', { p: pf.label, rate: pf.rateHint })} onSchedule={(at) => patch({ status: 'scheduled', scheduled_at: at, error: null as unknown as string })} onUnschedule={() => patch({ status: 'approved', scheduled_at: null as unknown as string })} />
            </>
          )}
          {(p.status === 'removed' || p.status === 'rejected') &&
            (purging ? (
              <>
                <RunButton inline onError={setErr} fn="social/social.purge" input={{ post_id: p.id }} icon={Trash2} variant="outline" onDone={onChanged}>
                  {tr('social.purge_confirm')}
                </RunButton>
                <Button size="sm" variant="ghost" onClick={() => setPurging(false)}>
                  {tr('common.cancel')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setPurging(true)} title={tr('social.purge_title')}>
                <Trash2 />
                {tr('social.purge')}
              </Button>
            ))}
          {p.status === 'published' && p.post_url && (
            <>
              <a href={p.post_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
                {tr('social.open_post', { noun: pf.noun })} <ArrowUpRight className="size-4" />
              </a>
              <RunButton inline onError={setErr} fn="social/social.remove" input={{ post_id: p.id }} icon={Trash2} variant="ghost" onDone={onChanged}>
                {tr('social.delete_from', { p: pf.label })}
              </RunButton>
            </>
          )}
        </div>
      </div>
      <PreviewDialog
        open={previewing}
        p={p}
        pf={pf}
        owner={owner}
        article={articles.find((a) => a.id === p.article_id)}
        onClose={() => setPreviewing(false)}
        onApprove={async () => { await patch({ status: 'approved' }); setPreviewing(false) }}
        onReject={async () => { await patch({ status: 'rejected' }); setPreviewing(false) }}
        onEdit={() => { setPreviewing(false); setEditing(true) }}
      />
      <EditDialog open={editing} p={p} pf={pf} onClose={() => setEditing(false)} onSave={async (d) => { await patch({ ...d, status: 'pending_review' }); setEditing(false) }} />
    </div>
  )
}

function EditDialog({ open, p, pf, onClose, onSave }: { open: boolean; p: SocialPost; pf: SocialPlatform; onClose: () => void; onSave: (d: Partial<SocialPost>) => Promise<void> }) {
  const bodyOf = (x: SocialPost) => (isRich(pf) ? toRich(x.body) : x.body)
  const [title, setTitle] = useState(p.title)
  const [body, setBody] = useState(bodyOf(p))
  const [tags, setTags] = useState(parse<string[]>(p.tags, []).join(' '))
  const [cover, setCover] = useState(p.cover_text ?? '')
  const [images, setImages] = useState<string[]>(parse<string[]>(p.images, []))
  const [video, setVideo] = useState(p.video ?? '')
  const [picking, setPicking] = useState(false)
  // 只发视频的平台（YouTube、B 站）一直是视频；图文、视频都能发的（小红书、X…）用户切换，这条带了视频就按视频发
  const [mode, setMode] = useState<'images' | 'video'>(isVideoPost(pf, p) ? 'video' : 'images')
  const isVideo = pf.video === 'only' || (pf.video === 'optional' && mode === 'video')
  useEffect(() => {
    if (!open) return
    setVideo(p.video ?? '')
    setMode(isVideoPost(pf, p) ? 'video' : 'images')
    setTitle(p.title)
    setBody(bodyOf(p))
    setTags(parse<string[]>(p.tags, []).join(' '))
    setCover(p.cover_text ?? '')
    setImages(parse<string[]>(p.images, []))
  }, [open])
  const len = (s: string) => [...s].length
  const tagList = tags.split(/[\s,，#]+/).filter(Boolean)
  const bodyLen = pf.len(body, tagList)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr('social.edit_title', { noun: pf.noun })}
      width={560}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => onSave({ title: title.trim(), body: body.trim(), cover_text: cover.trim(), tags: JSON.stringify(tagList), images: JSON.stringify(isRich(pf) ? richImages(body) : images), ...(pf.video ? { video: isVideo ? video : '' } : {}) })} disabled={isVideo && !video}>
            {tr('social.save_review')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={fieldsOf(pf).title === 'publish' ? tr('social.f_title') : tr('social.f_title_x')} hint={String(len(title))}>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field group={isRich(pf)} label={tr('social.f_body')} hint={`${bodyLen} · ${pf.bodyHint}`}>
          {isRich(pf) ? <div className="rounded-lg border border-border">{open && <RichEditor value={body} onChange={setBody} />}</div> : <textarea className={cx(inputCls, 'min-h-48 py-2')} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <Field label={tr('social.f_tags')} hint={tr('social.tags_hint', { n: pf.tagsMax })}>
          <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {pf.video === 'optional' && (
          <Segmented<'images' | 'video'> value={mode} onChange={setMode} options={[{ value: 'images', label: tr('social.mode_images') }, { value: 'video', label: tr('social.mode_video') }]} />
        )}
        {isVideo && <VideoField video={video} onChange={setVideo} />}
        {!isVideo && fieldsOf(pf).images > 0 && <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm leading-none font-medium">{tr('social.f_images')}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)} disabled={images.length >= pf.imagesMax}>
              <Plus />
              {tr('social.pick_assets')}
            </Button>
          </div>
          {images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((u, i) => (
                <div key={u + i} className="group relative">
                  <img src={shuttleImage(u)} alt="" className="size-16 rounded-md border border-border object-cover" />
                  <button type="button" aria-label={tr('social.remove_image')} onClick={() => setImages((l) => l.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-foreground text-background opacity-80 hover:opacity-100">
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <span className="text-xs leading-relaxed text-muted-foreground">
            {tr('social.images_n', { n: images.length, max: pf.imagesMax })}{pf.cover && !images.length ? tr('social.cover_fallback') : ''}
          </span>
        </div>}
        {!isVideo && <AssetPicker open={picking} max={pf.imagesMax - images.length} onClose={() => setPicking(false)} onPick={(urls) => { setImages((l) => [...l, ...urls.filter((u) => !l.includes(u))].slice(0, pf.imagesMax)); setPicking(false) }} />}
        {pf.cover && !isVideo && (
          <Field label={tr('social.f_cover')} hint={tr('social.cover_hint')}>
            <input className={inputCls} value={cover} onChange={(e) => setCover(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  )
}

/** 发布时没配图用的文字封面，和社媒插件 plugins/social/local/xhs.ts 的 textCard 同一个样式（1080×1440 等比缩小） */
function TextCover({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx('flex aspect-[3/4] items-center justify-center bg-[#f6efe6] p-[11%] text-center font-bold text-[#2f2620]', className)} style={{ lineHeight: 1.35, containerType: 'inline-size' }}>
      <span style={{ fontSize: '9.6cqw' }}>{text}</span>
    </div>
  )
}

/** 预览：小红书按笔记页、X 按推文的样子排出来，旁边是规格检查（和发布时同一个检查，social.check）和审核按钮 */
function PreviewDialog({ open, p, pf, owner, article, onClose, onApprove, onReject, onEdit }: {
  open: boolean
  p: SocialPost
  pf: SocialPlatform
  owner?: Channel
  article?: Article
  onClose: () => void
  onApprove: () => Promise<void>
  onReject: () => Promise<void>
  onEdit: () => void
}) {
  const images = parse<string[]>(p.images, [])
  const tags = parse<string[]>(p.tags, [])
  const [i, setI] = useState(0)
  const [problems, setProblems] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setI(0)
    setProblems(null)
    runLocal<{ problems: string[] }>('social/social.check', { post_id: p.id })
        .then((r) => setProblems(r.problems))
        .catch(() => setProblems([]))
  }, [open, p.id, p.title, p.body, p.tags])
  const len = (s: string) => [...(s ?? '')].length
  const act = async (f: () => Promise<void>) => {
    setBusy(true)
    try {
      await f()
    } finally {
      setBusy(false)
    }
  }
  const pending = p.status === 'pending_review'

  return (
    <Dialog open={open} onClose={onClose} title={tr('social.preview_title', { noun: pf.noun })} width={820}>
      <div className="flex flex-col gap-6 md:flex-row">
        {isVideoPost(pf, p) ? (
          <VideoCard p={p} owner={owner} tags={tags} />
        ) : !pf.cover ? (
          <TweetCard p={p} owner={owner} images={images} tags={tags} />
        ) : (
        /* 手机上的笔记页 */
        <div className="mx-auto w-[320px] shrink-0 overflow-hidden rounded-[28px] border-[6px] border-neutral-800 bg-white text-neutral-900 shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2.5">
            {owner?.avatar ? <img src={shuttleImage(owner.avatar)} alt="" className="size-7 rounded-full object-cover" /> : <div className="size-7 rounded-full bg-neutral-200" />}
            <span className="flex-1 truncate text-[13px] font-medium">{owner?.name ?? tr('social.xhs_account')}</span>
            <span className="rounded-full border border-[#ff2442] px-3 py-0.5 text-[12px] text-[#ff2442]">{tr('social.follow')}</span>
          </div>
          <div className="relative">
            {images.length ? (
              <img src={shuttleImage(images[i])} alt="" className="aspect-[3/4] w-full object-cover" />
            ) : (
              <TextCover text={p.cover_text || p.title} className="w-full" />
            )}
            {images.length > 1 && (
              <>
                <button type="button" aria-label={tr('social.prev')} onClick={() => setI((x) => (x + images.length - 1) % images.length)} className="absolute top-1/2 left-1 -translate-y-1/2 rounded-full bg-black/30 p-1 text-white">
                  <ChevronLeft className="size-4" />
                </button>
                <button type="button" aria-label={tr('social.next')} onClick={() => setI((x) => (x + 1) % images.length)} className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full bg-black/30 p-1 text-white">
                  <ChevronRight className="size-4" />
                </button>
                <span className="absolute top-2 right-2 rounded-full bg-black/40 px-2 py-0.5 text-[11px] text-white tabular-nums">
                  {i + 1}/{images.length}
                </span>
              </>
            )}
          </div>
          <div className="max-h-[300px] space-y-2 overflow-y-auto px-3.5 py-3">
            <div className="text-[15px] leading-snug font-semibold">{p.title}</div>
            <div className="text-[13.5px] leading-relaxed whitespace-pre-line">{p.body}</div>
            {tags.length > 0 && <div className="flex flex-wrap gap-x-1.5 text-[13.5px] text-[#13386c]">{tags.map((t) => <span key={t}>#{t}</span>)}</div>}
            <div className="pt-1 text-[11px] text-neutral-400">{p.published_at ? fmtTime(p.published_at) : tr('social.time_after')}</div>
          </div>
        </div>
        )}

        {/* 检查和审核 */}
        <div className="min-w-0 flex-1 space-y-4 text-sm">
          <div className="space-y-2 rounded-xl border border-border p-4">
            <div className="font-semibold">{tr('social.spec')}</div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground tabular-nums">
              {pf.title && <span>{tr('social.f_title')} · {len(p.title)}</span>}
              <span>{tr('social.f_body')} · {pf.len(p.body, tags)}</span>
              <span className={cx(tags.length > pf.tagsMax && 'text-destructive')}>{tr('social.spec_tags', { n: tags.length, max: pf.tagsMax })}</span>
            </div>
            {problems === null ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> {tr('social.checking')}
              </div>
            ) : problems.length === 0 ? (
              <div className="text-xs text-ok">{pf.cover ? tr('social.ok_xhs') : tr('social.ok_x')}</div>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                {problems.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
            <div className="text-xs text-muted-foreground">{images.length ? tr('social.images_count', { n: images.length }) : pf.cover ? tr('social.no_images_cover') : tr('social.no_images')}</div>
          </div>
          {article && (
            <div className="rounded-xl border border-border p-4 text-xs text-muted-foreground">
              {tr('social.from_article_title', { title: article.title })}{article.url && (
                <a href={article.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 font-semibold text-foreground hover:text-primary-text">
                  {tr('social.view_source')} <ArrowUpRight className="size-3" />
                </a>
              )}
            </div>
          )}
          {p.status === 'rejected' && p.review_note && <div className="text-xs text-muted-foreground">{tr('social.review_note', { note: p.review_note })}</div>}
          <div className="flex flex-wrap gap-2">
            {pending && (
              <Button size="sm" onClick={() => act(onApprove)} disabled={busy || !!problems?.length}>
                <Check />
                {tr('social.approve')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil />
              {tr('social.edit')}
            </Button>
            {pending && (
              <Button size="sm" variant="ghost" onClick={() => act(onReject)} disabled={busy}>
                <X />
                {tr('social.reject')}
              </Button>
            )}
          </div>
          {pending && !!problems?.length && <p className="text-xs text-muted-foreground">{tr('social.fix_first')}</p>}
        </div>
      </div>
    </Dialog>
  )
}

/**
 * 视频：从素材库选（云端地址，换台电脑也能用），或者上传本机视频（只存在这台电脑上，不传云端，最多 8 GB；
 * 存的是 local:<name>，发布时本机函数的 b.upload 直接从这台电脑传给平台）
 */
function VideoField({ video, onChange }: { video: string; onChange: (v: string) => void }) {
  const [picking, setPicking] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const upload = async (f?: File) => {
    if (!f) return
    setErr('')
    setProgress(0)
    try {
      const r = await uploadLocalFile(f, setProgress)
      onChange(r.ref)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setProgress(null)
    }
  }
  const busy = progress != null
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm leading-none font-medium">
          {tr('social.f_video')}
          {video.startsWith('local:') && <span className="ml-2 text-xs font-normal text-muted-foreground">{tr('social.local_file')}</span>}
        </span>
        <div className="flex gap-1">
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <HardDrive />}
            {busy ? tr('social.uploading_pct', { n: Math.round((progress ?? 0) * 100) }) : tr('social.upload_local')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)} disabled={busy}>
            <Plus />
            {video ? tr('social.change_video') : tr('social.pick_video')}
          </Button>
        </div>
      </div>
      {video ? <video src={videoSrc(video)} controls className="max-h-48 w-full rounded-md border border-border bg-black" /> : <span className="text-xs text-muted-foreground">{tr('social.no_video')}</span>}
      {err && <Notice tone="error">{err}</Notice>}
      <span className="text-xs leading-relaxed text-muted-foreground">{tr('social.local_hint')}</span>
      <AssetPicker open={picking} kind="video" max={1} onClose={() => setPicking(false)} onPick={(urls) => { if (urls[0]) onChange(urls[0]); setPicking(false) }} />
    </div>
  )
}

/** 视频的预览（YouTube、B 站，和带视频的小红书、X…）：视频、标题、账号、描述和标签 */
function VideoCard({ p, owner, tags }: { p: SocialPost; owner?: Channel; tags: string[] }) {
  return (
    <div className="mx-auto w-[380px] shrink-0 self-start overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-lg">
      {p.video ? <video src={videoSrc(p.video)} controls className="aspect-video w-full bg-black" /> : <div className="flex aspect-video w-full items-center justify-center bg-neutral-900 text-sm text-neutral-400">{tr('social.no_video')}</div>}
      <div className="space-y-2 p-3">
        <div className="text-[15px] leading-snug font-semibold">{p.title}</div>
        <div className="flex items-center gap-2 text-[13px] text-neutral-600">
          {owner?.avatar ? <img src={shuttleImage(owner.avatar)} alt="" className="size-6 rounded-full object-cover" /> : <div className="size-6 rounded-full bg-neutral-200" />}
          <span className="truncate">{owner?.name}</span>
        </div>
        <div className="max-h-40 overflow-y-auto rounded-lg bg-neutral-100 p-2 text-[13px] leading-relaxed whitespace-pre-line">{p.body}</div>
        {tags.length > 0 && <div className="text-[12px] text-neutral-500">{tags.join(', ')}</div>}
      </div>
    </div>
  )
}

/** 富文本平台（知乎文章）的预览：标题、作者、排好版的正文（图片在正文里）、话题 */
function RichCard({ p, owner, tags }: { p: SocialPost; owner?: Channel; tags: string[] }) {
  return (
    <div className="mx-auto w-[420px] max-w-full shrink-0 self-start overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-lg">
      <div className="max-h-[560px] space-y-3 overflow-y-auto p-5">
        <div className="text-[20px] leading-snug font-semibold">{p.title}</div>
        <div className="flex items-center gap-2 text-[13px] text-neutral-600">
          {owner?.avatar ? <img src={shuttleImage(owner.avatar)} alt="" className="size-6 rounded-full object-cover" /> : <div className="size-6 rounded-full bg-neutral-200" />}
          <span className="truncate">{owner?.name}</span>
        </div>
        <div className="rich-content text-neutral-900 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded" dangerouslySetInnerHTML={{ __html: toRich(p.body) }} />
        {tags.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1">{tags.map((t) => <span key={t} className="rounded-full bg-[#e8f1fe] px-2.5 py-0.5 text-[12px] text-[#056de8]">{t}</span>)}</div>}
      </div>
    </div>
  )
}

/** 推文预览：按 X 时间线上一条推文的样子排出来（发出去的是正文 + #话题，标题不发） */
/** 文字类平台（X、LinkedIn）的预览卡片：头像、名字、正文（链接和话题上色）、配图 */
function TweetCard({ p, owner, images, tags }: { p: SocialPost; owner?: Channel; images: string[]; tags: string[] }) {
  const parts = p.body.split(/(https?:\/\/\S+)/g)
  const li = owner?.type === 'linkedin'
  const accent = li ? 'text-[#0a66c2]' : 'text-[#1d9bf0]'
  return (
    <div className="mx-auto w-[360px] shrink-0 self-start rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-lg">
      <div className="flex gap-3">
        {owner?.avatar ? <img src={shuttleImage(owner.avatar)} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <div className="size-10 shrink-0 rounded-full bg-neutral-200" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1 text-[15px]">
            <span className="truncate font-bold">{owner?.name ?? tr('social.x_account')}</span>
            {owner?.handle && !li && <span className="truncate text-neutral-500">@{owner.handle}</span>}
          </div>
          <div className="mt-0.5 text-[15px] leading-normal break-words whitespace-pre-line">
            {parts.map((x, i) => (i % 2 ? <span key={i} className={accent}>{x}</span> : x))}
            {tags.length > 0 && (
              <>
                {'\n\n'}
                <span className={accent}>{tags.map((t) => '#' + t).join(' ')}</span>
              </>
            )}
          </div>
          {images.length > 0 && (
            <div className={cx('mt-3 grid gap-0.5 overflow-hidden rounded-2xl border border-neutral-200', images.length > 1 && 'grid-cols-2')}>
              {images.map((u) => (
                <img key={u} src={shuttleImage(u)} alt="" className="aspect-video w-full object-cover" />
              ))}
            </div>
          )}
          <div className="mt-3 text-[13px] text-neutral-500">{p.published_at ? fmtTime(p.published_at) : tr('social.time_after')}</div>
        </div>
      </div>
    </div>
  )
}
