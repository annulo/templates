import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { Share2, CircleHelp, SlidersHorizontal, BarChart3, Menu, X, Sparkles } from 'lucide-react'
import Wizard from '../components/wizard/Wizard'
import { runLocal } from '../lib/shuttle'
import type { ChecklistData } from '../lib/useChecklist'
import Overview from '../components/views/Overview'
import Content from '../components/views/Content'
import Reports from '../components/views/Reports'
import Calendar from '../components/views/Calendar'
import Assets from '../components/views/Assets'
import Channels from '../components/views/Channels'
import Social from '../components/views/Social'
import CompanyProducts from '../components/views/CompanyProducts'
import SocialNavEntry from '../components/SocialNavEntry'
import ProjectSettings from '../components/views/ProjectSettings'
import Help from '../components/views/Help'
import Assistant from '../components/views/Assistant'
import type { Ctx, View } from '../components/views/types'
import { Notice, Skeleton, cx } from '../components/ui'
import PluginNotice from '../components/PluginNotice'
import { channelStats, dbList, watchComputer, type ComputerStatus, listChannels, loadProfile, memberLoginURL, MemberLoginRequired, openShuttle, ShuttleUnavailable, type Channel, type ChannelStats, type Profile } from '../lib/shuttle'
import { useT } from '../lib/i18n'
import { useInShuttle } from '../lib/useShuttle'
import { NAV } from '../lib/edition'
import { useChecklist } from '../lib/useChecklist'

// 左侧导航分组由行业文件 lib/edition.ts 定义；紧凑单行，辅助说明放在 title 中。
// 还没填项目资料时的占位（放在模块里：引用不变，项目设置的表单不会被重渲染冲掉）
const EMPTY_PROFILE: Profile = { name: '' }

// 页面状态都放在地址栏参数里：刷新、在新标签打开都能回到同一个位置。编辑器画布里 location 不是 http 地址，跳过写入。
function readParams(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const p = Object.fromEntries(new URLSearchParams(window.location.search))
  delete p.project // 以前多项目时的参数，现在不用了
  return p
}
function writeParams(p: Record<string, string>, replace = false) {
  if (typeof window === 'undefined' || !/^https?:/.test(window.location.protocol)) return
  try {
    const url = new URL(window.location.href)
    url.search = new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString()
    if (url.href !== window.location.href) window.history[replace ? 'replaceState' : 'pushState'](null, '', url)
  } catch {
    // 地址不可解析时不影响页面
  }
}

export default function Index() {
  const shuttle = useInShuttle()
  const { t } = useT('nav')
  const [params, setParams] = useState<Record<string, string>>({})
  const [routeReady, setRouteReady] = useState(false)
  // 项目资料（profile 表那一行）；undefined 是还在加载，null 是还没填
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [channels, setChannels] = useState<Channel[]>([])
  // 社媒插件没装时顶部提示（components/PluginNotice.tsx）
  const [socialPlugin, setSocialPlugin] = useState({ plugin: true })
  const [stats, setStats] = useState<Record<string, ChannelStats> | null>(null)
  const [needLogin, setNeedLogin] = useState(false)
  // 不在 Shuttle 里：项目所有者的电脑在不在线（发布、采集转给电脑跑，lib/shuttle.ts computerStatus）
  const [computer, setComputer] = useState<ComputerStatus | null>(null)
  const [error, setError] = useState('')
  const [days] = useState(30)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [wizardSession, setWizardSession] = useState(false)
  const [wizardAway, setWizardAway] = useState(false)
  const [wizardStep, setWizardStep] = useState<string | null>(null)

  useEffect(() => {
    const initial = readParams()
    writeParams(initial, true)
    setParams(initial)
    setRouteReady(true)
    const onHistory = () => setParams(readParams())
    window.addEventListener('popstate', onHistory)
    window.addEventListener('hashchange', onHistory)
    return () => {
      window.removeEventListener('popstate', onHistory)
      window.removeEventListener('hashchange', onHistory)
    }
  }, [])
  useEffect(() => { if (routeReady) writeParams(params) }, [params, routeReady])

  // 不在 Shuttle 里（手机、别的电脑）：图片不经过电脑代取，直接从社媒的图床拿。
  // 小红书、B 站的图床看到别的站点的 Referer 就拒绝，不发 Referer；X、Instagram 在国内网络下常常连不上，取不到的换成灰色占位，不显示裂图
  useEffect(() => {
    if (!routeReady || shuttle || needLogin) return
    return watchComputer(setComputer)
  }, [routeReady, shuttle, needLogin])
  useEffect(() => {
    if (!routeReady || shuttle) return
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    const onError = (e: Event) => {
      const img = e.target
      if (!(img instanceof HTMLImageElement) || img.dataset.broken) return
      img.dataset.broken = '1'
      img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#8884"/></svg>')
    }
    document.addEventListener('error', onError, true)
    return () => {
      meta.remove()
      document.removeEventListener('error', onError, true)
    }
  }, [routeReady, shuttle])

  const loadProfileRow = useCallback(() => {
    loadProfile()
      .then(setProfile)
      .catch((e) => {
        setProfile(null)
        if (e instanceof MemberLoginRequired) setNeedLogin(true)
        else setError(e.message)
      })
  }, [])
  useEffect(loadProfileRow, [loadProfileRow])

  const view: View = (['overview', 'reports', 'company', 'content', 'calendar', 'assets', 'social', 'channels', 'settings', 'help', 'assistant'] as View[]).includes(params.view as View) ? (params.view as View) : 'overview'

  const loadChannels = useCallback(() => {
    listChannels()
      .then((r) => {
        setChannels(r.list)
        setSocialPlugin({ plugin: r.plugin })
      })
      .catch((e) => (e instanceof MemberLoginRequired ? setNeedLogin(true) : setError(e.message)))
  }, [])
  useEffect(loadChannels, [loadChannels])
  // 提示「没装社媒插件」时过几秒再查：刚装好时插件的表晚一点才建好，页面先读到「没有这张表」；从设置切回来也立刻查
  useEffect(() => {
    if (socialPlugin.plugin) return
    const timer = window.setInterval(loadChannels, 5000)
    window.addEventListener('focus', loadChannels)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', loadChannels)
    }
  }, [socialPlugin.plugin, loadChannels])
  const [rev, setRev] = useState(0) // 数据版本，见下面的 shuttle:refresh

  useEffect(() => {
    channelStats(days)
      .then((s) => {
        setStats(s)
        setNeedLogin(false)
      })
      .catch((e) => {
        if (!(e instanceof ShuttleUnavailable)) setError(e.message)
        if (e instanceof MemberLoginRequired) setNeedLogin(true)
      })
  }, [days, channels.length, rev])

  const checklist = useChecklist(rev)

  // 左侧「内容中心」后面的数量：新文章（AI 写好、改写好，还没打开看过的，articles.unread），打开一篇就少一个。
  // 助手改了数据（rev）、页面里改了文章（db:changed）、切回窗口时重拉
  const [pendingReview, setPendingReview] = useState(0)
  const loadPendingReview = useCallback(() => {
    dbList('articles')
      .then((articles) => setPendingReview(articles.filter((a) => a.unread).length))
      .catch(() => setPendingReview(0))
  }, [])
  useEffect(() => {
    if (!routeReady || needLogin) return
    loadPendingReview()
    const onChanged = (e: Event) => { const t = (e as CustomEvent<{ table?: string }>).detail?.table; if (t === 'articles') loadPendingReview() }
    window.addEventListener('db:changed', onChanged)
    window.addEventListener('focus', loadPendingReview)
    return () => {
      window.removeEventListener('db:changed', onChanged)
      window.removeEventListener('focus', loadPendingReview)
    }
  }, [routeReady, needLogin, rev, loadPendingReview])
  const wizard = checklist.data?.wizard
  const autoWizard = !!wizard?.current && !wizard.closed
  useEffect(() => { if (autoWizard) setWizardSession(true) }, [autoWizard])
  const openWizard = async (step?: string) => {
    try {
      checklist.setData(await runLocal<ChecklistData>('today.openWizard', {}))
      setWizardStep(step ?? null)
      setWizardAway(false)
      setWizardSession(true)
      setSetupOpen(false)
    } catch (e) { checklist.setError((e as Error).message) }
  }
  useEffect(() => {
    if (!mobileOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [mobileOpen])
  const go = (v: View, extra: Record<string, string> = {}) => { setParams({ view: v, ...extra }); setMobileOpen(false) }
  // 左侧导航 ⌘ / Ctrl 点击：在新标签页打开那一页（Shuttle 里是新的标签页，浏览器里是新标签），当前页不动
  const goFrom = (e: MouseEvent, v: View) => {
    if (!(e.metaKey || e.ctrlKey)) return go(v)
    const url = new URL(window.location.href)
    url.search = new URLSearchParams({ view: v }).toString()
    window.open(url, '_blank')
  }
  const setParam = (k: string, v: string) => setParams((p) => ({ ...p, [k]: v }))

  // 右侧助手一轮做完、改了数据时，外壳发 shuttle:refresh：重拉数据，不整页刷新
  useEffect(() => {
    const f = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'shuttle:refresh') return
      loadProfileRow()
      loadChannels()
      setRev((r) => r + 1)
    }
    window.addEventListener('message', f)
    return () => window.removeEventListener('message', f)
  }, [loadProfileRow, loadChannels])

  // 还没填项目资料时用空名称占位，总览顶部会提示去「项目设置」填定位
  const ctx: Ctx | null = profile === undefined ? null : { profile: profile ?? EMPTY_PROFILE, channels, stats, days, go, reloadChannels: loadChannels, reloadProfile: loadProfileRow, rev, checklist, setupOpen, openWizard, toggleSetup: () => setSetupOpen((open) => !open) }

  const navView = view
  // 页面标题跟着当前页走：Shuttle 顶栏的标签页、浏览器标签都显示它
  useEffect(() => {
    if (routeReady) document.title = t(navView)
  }, [navView, routeReady, t])
  const group = NAV.find((g) => g.items.some((item) => item.view === navView))
  const socialSection = ['overview', 'content', 'data'].includes(params.section) ? params.section : params.tab || params.post ? 'content' : 'overview'
  const navClass = (active: boolean) => cx(
    'relative flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 md:h-8 text-left text-base transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
    active ? 'bg-sidebar-accent font-semibold text-foreground before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-primary' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
  )
  // 首屏只出一次骨架：整页布局先画出来，内容区用骨架占着，等要用的数据齐了再换成页面。
  // 挂载前（服务端渲染时还不知道在不在 Shuttle 里）、项目资料没读到、Shuttle 里今日清单（决定要不要先进引导）没读到，都算没齐。
  // 以前清单没读到时整页换成一块居中的骨架，挂载前后各画一次，看起来像闪了两次
  const booting = !routeReady || profile === undefined || (shuttle && !checklist.data && !checklist.error)
  if (ctx && wizard && !wizard.closed && (wizardSession || autoWizard) && !wizardAway) return <Wizard initialStep={wizardStep} ctx={{ ...ctx, go: (v, extra) => { setWizardAway(true); go(v, extra) } }} onExit={() => { setWizardStep(null); setWizardSession(false); setWizardAway(false); go('overview') }} />

  return (
    <main className="flex h-dvh min-w-0 overflow-hidden bg-background text-foreground">
      {mobileOpen && <button type="button" aria-label={t('close_nav')} onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 cursor-pointer bg-black/35 md:hidden" />}
      <aside id="workspace-navigation" aria-label={t('navigation')} className={cx('fixed inset-y-0 left-0 z-40 w-[224px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-transform md:static md:z-auto md:translate-x-0', mobileOpen ? 'flex translate-x-0' : 'hidden -translate-x-full md:flex')}>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-3">
          {NAV.map((g, gi) => g.presentation === 'social' ? <div key={g.group} className="mt-4">
            <SocialNavEntry channels={channels} active={view === 'social'} disabled={!ctx} onClick={(e) => goFrom(e, 'social')} />
          </div> : (
            <div key={g.group ?? gi} className={cx(gi > 0 && 'mt-5')}>
              <div className="flex items-center justify-between gap-2 px-3 pb-1.5 text-xs font-medium text-muted-foreground">
                <span>{t(g.group ?? 'g_work')}</span>
                {gi === 0 && <button type="button" onClick={() => setMobileOpen(false)} aria-label={t('close_nav')} className="-mr-1 rounded-md p-1 hover:bg-sidebar-accent md:hidden"><X className="size-4" /></button>}
              </div>
              <div className="space-y-0.5">
                {g.items.map((n) => <button type="button" key={n.view} onClick={(e) => goFrom(e, n.view)} disabled={!ctx} aria-current={n.view === navView ? 'page' : undefined} title={t(n.view + '_sub')} className={navClass(n.view === navView)}>
                  <n.icon className="size-4 shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{t(n.view)}</span>
                  {n.view === 'content' && pendingReview > 0 && <span title={t('pending_badge', { n: pendingReview })} aria-label={t('pending_badge', { n: pendingReview })} className="ml-auto shrink-0 rounded-full bg-primary/15 px-1.5 text-xs leading-5 font-medium tabular-nums text-primary-text">{pendingReview > 99 ? '99+' : pendingReview}</span>}
                </button>)}
              </div>
            </div>
          ))}
        </nav>
        {checklist.data && <button type="button" onClick={() => { go('overview'); setSetupOpen((open) => view === 'overview' ? !open : true) }} aria-expanded={setupOpen && view === 'overview'} aria-controls="setup-checklist" className="mx-5 mb-3 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">{t('setup')}<span className="tabular-nums">{checklist.data.done}/{checklist.data.total}</span></span>
          <progress aria-label={t('setup')} value={checklist.data.done} max={checklist.data.total || 1} className="setup-progress block h-1.5 w-full overflow-hidden rounded-full" />
        </button>}
        <div className="space-y-0.5 border-t border-sidebar-border px-3 py-2">
          {/* 手机上没有右侧的助手：经电脑上的 Shuttle 用它（components/views/Assistant.tsx） */}
          {routeReady && !shuttle && !needLogin && <button type="button" onClick={(e) => goFrom(e, 'assistant')} aria-current={view === 'assistant' ? 'page' : undefined} className={navClass(view === 'assistant')}>
            <Sparkles className="size-4 shrink-0" strokeWidth={1.8} /><span>{t('assistant')}</span>
          </button>}
          {([['channels', Share2], ['help', CircleHelp]] as const).map(([v, Icon]) => <button type="button" key={v} onClick={(e) => goFrom(e, v)} disabled={!ctx && v !== 'help'} aria-current={view === v ? 'page' : undefined} className={navClass(view === v)}>
            <Icon className="size-4 shrink-0" strokeWidth={1.8} /><span>{t(v)}</span>
          </button>)}
          {shuttle && <div className="mt-1.5 grid grid-cols-2 gap-1 border-t border-sidebar-border pt-1.5">
            {([['settings', SlidersHorizontal, 'shuttle_settings'], ['usage', BarChart3, 'usage']] as const).map(([v, Icon, key]) => <button type="button" key={v} onClick={() => openShuttle(v)} className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"><Icon className="size-3.5" />{t(key)}</button>)}
          </div>}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <button type="button" aria-label={t('open_nav')} aria-expanded={mobileOpen} aria-controls="workspace-navigation" onClick={() => setMobileOpen(true)} className="rounded-md p-1 text-muted-foreground hover:bg-accent md:hidden"><Menu className="size-5" /></button>
            <span className="hidden text-muted-foreground sm:inline">{t(group?.group ?? 'g_work')}</span><span className="hidden text-muted-foreground/50 sm:inline">/</span>
            {/* 内容详情多一级：「内容中心」可以点回列表（保留列表的页签和筛选） */}
            {view === 'content' && params.article ? <>
              <button type="button" onClick={() => setParams((p) => ({ ...p, article: '', version: '' }))} className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">{t('content')}</button>
              <span className="text-muted-foreground/50">/</span>
              <span className="truncate font-medium">{t('content_detail')}</span>
            </> : <span className="truncate font-medium">{t(view === 'social' ? 'social_' + socialSection : navView)}</span>}
          </div>
        </header>
        {wizardAway && <div className="border-b border-border px-5 py-3"><button type="button" className="cursor-pointer text-sm text-primary-text underline" onClick={() => { checklist.load(); setWizardAway(false) }}>{t('wizard_return')}</button></div>}
        {/* 所有页面和总览一样的内边距，顶栏的面包屑和内容左边对齐；改了这里，Social、Content 粘在顶部的那条（-top-4 -mx-4 md:-mx-6）也要跟着改 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div className="mx-auto w-full max-w-[1440px] space-y-6">
          {error && <Notice tone="error">{error}</Notice>}
          {shuttle && <PluginNotice plugin={socialPlugin.plugin} />}
          {/* 不在 Shuttle 里（手机）：能看数据，采集、发布、交给助手这些按钮是灰的（手机上没有悬停提示），在这里统一说一句 */}
          {routeReady && !shuttle && !needLogin && (
            <div className="space-y-1 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {computer && (
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <span className={cx('size-2 shrink-0 rounded-full', computer.online ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                  {computer.online ? t('computer_online', { name: computer.name ?? '' }) : t('computer_offline')}
                </p>
              )}
              <p>{computer?.online ? t('remote_hint_online', { name: computer.name ?? '' }) : t('remote_hint')}</p>
            </div>
          )}
          {/* 不在 Shuttle 里、没登录成项目成员：什么数据都读不到，只给登录入口 */}
          {needLogin ? (
            <Notice>
              <p>{t('member_login')}</p>
              <a href={memberLoginURL()} className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">{t('member_login_btn')}</a>
            </Notice>
          ) : !ctx || booting ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
          ) : view === 'reports' ? (
            <Reports ctx={ctx} params={params} setParam={setParam} />
          ) : view === 'content' ? (
            <Content ctx={ctx} params={params} setParam={setParam} />
          ) : view === 'calendar' ? (
            <Calendar ctx={ctx} params={params} setParam={setParam} />
          ) : view === 'assets' ? (
            <Assets ctx={ctx} params={params} setParam={setParam} />
          ) : view === 'company' ? (
            <CompanyProducts ctx={ctx} params={params} setParam={setParam} />
          ) : view === 'social' ? (
            <Social ctx={ctx} params={params} setParam={setParam} />
          ) : view === 'channels' ? (
            <Channels ctx={ctx} current={params.channel ?? ''} setCurrent={(id) => setParam('channel', id)} />
          ) : view === 'settings' ? (
            <ProjectSettings ctx={ctx} />
          ) : view === 'help' ? (
            <Help ctx={ctx} params={params} setParam={setParam} />
          ) : view === 'assistant' ? (
            <Assistant ctx={ctx} params={params} setParam={setParam} />
          ) : (
            <Overview ctx={ctx} />
          )}
          </div>
        </div>
      </section>
    </main>
  )
}
