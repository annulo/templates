import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Share2, CircleHelp, SlidersHorizontal, BarChart3, Menu, X, Sparkles, ChevronDown, LayoutDashboard } from 'lucide-react'
import Wizard from '../components/wizard/Wizard'
import { runLocal, runTask } from '../lib/shuttle'
import type { ChecklistData } from '../lib/useChecklist'
import type { Ctx, View } from '../components/views/types'
import { Notice, Skeleton, cx, toast } from '../components/ui'
import SocialMigrateNotice from '../components/SocialMigrateNotice'
import { channelStats, dbList, geoBatchDoneText, geoBatchOf, geoUnseen, watchComputer, type GeoRun, type ComputerStatus, listChannels, loadProfile, memberLoginURL, MemberLoginRequired, openShuttle, ShuttleUnavailable, type Channel, type ChannelStats, type Profile } from '../lib/shuttle'
import { tr, useT } from '../lib/i18n'
import { useInShuttle } from '../lib/useShuttle'
import { NAV } from '../lib/edition'
// 行业文件：有哪些页面、每个页面渲染什么、老链接怎么认、侧栏上额外的数字
import { NAV_COLLAPSED, REFRESH_ON_DB_CHANGE, VIEWS, contentView as contentViewOf, navViewOf, renderView, useNavBadges } from '../lib/views'
import { useChecklist } from '../lib/useChecklist'
import PublishProgress from '../components/PublishProgress'

// 后台的外壳（外贸和产品运营共用的 business 模块）：侧栏、顶栏、起步清单和向导、不在 Annulo 里时的提示。
// 左侧导航分组由行业文件 lib/edition.ts 定义（组名、组的图标），有哪些页面由行业文件 lib/views.tsx 定义；每组能折叠，辅助说明放在 title 中。
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
  // 社媒插件：没装 / 还有没迁移的旧社媒账号时顶部提示（components/SocialMigrateNotice.tsx）
  const [socialPlugin, setSocialPlugin] = useState({ plugin: true, legacy: 0 })
  const [stats, setStats] = useState<Record<string, ChannelStats> | null>(null)
  const [needLogin, setNeedLogin] = useState(false)
  // 不在 Shuttle 里：项目所有者的电脑在不在线（发布、采集转给电脑跑，lib/shuttle.ts computerStatus）
  const [computer, setComputer] = useState<ComputerStatus | null>(null)
  const [error, setError] = useState('')
  const [days] = useState(30)
  const [mobileOpen, setMobileOpen] = useState(false)
  // 侧栏收起的分组（记在这台电脑的浏览器里；读写不了就都展开）。进到一个页面时，它所在的组自动展开
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [collapsedRead, setCollapsedRead] = useState(false)
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(NAV_COLLAPSED) || '[]')
      if (Array.isArray(saved)) setCollapsed(saved.filter((x): x is string => typeof x === 'string'))
    } catch {}
    setCollapsedRead(true)
  }, [])
  const toggleGroup = (group: string) =>
    setCollapsed((c) => {
      const next = c.includes(group) ? c.filter((x) => x !== group) : [...c, group]
      try {
        localStorage.setItem(NAV_COLLAPSED, JSON.stringify(next))
      } catch {}
      return next
    })
  const [setupOpen, setSetupOpen] = useState(false)
  const [wizardSession, setWizardSession] = useState(false)
  const [wizardAway, setWizardAway] = useState(false)
  const [wizardStep, setWizardStep] = useState<string | null>(null)
  // 从起步清单去别的页面做某一步：那个页面顶上显示「做完回到起步配置」
  const [setupAway, setSetupAway] = useState(false)
  // 开始运营时在后台跑的网站检查（onboarding.audit），跑完重拉清单
  const [auditing, setAuditing] = useState(false)

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

  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : 'overview'

  const loadChannels = useCallback(() => {
    listChannels()
      .then((r) => {
        setChannels(r.list)
        setSocialPlugin({ plugin: r.plugin, legacy: r.legacy.length })
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
  // AI 写好、还没看过的文章按工作区记（没记归属的老文章：长文算网站，图文和视频算社媒）
  const [pendingReview, setPendingReview] = useState<('website' | 'social')[]>([])
  const loadPendingReview = useCallback(() => {
    dbList('articles')
      .then((articles) => setPendingReview(articles.filter((a) => a.unread).map((a: any) => (a.workspace === 'website' || (!a.workspace && a.type === 'article') ? 'website' : 'social'))))
      .catch(() => setPendingReview([]))
  }, [])
  useEffect(() => {
    if (!routeReady || needLogin) return
    loadPendingReview()
    const onChanged = (e: Event) => { if ((e as CustomEvent<{ table?: string }>).detail?.table === 'articles') loadPendingReview() }
    window.addEventListener('db:changed', onChanged)
    window.addEventListener('focus', loadPendingReview)
    return () => {
      window.removeEventListener('db:changed', onChanged)
      window.removeEventListener('focus', loadPendingReview)
    }
  }, [routeReady, needLogin, rev, loadPendingReview])
  const wizard = checklist.data?.wizard
  const autoWizard = !!wizard?.current && !wizard.closed
  const setupLeft = !!checklist.data && checklist.data.done < checklist.data.total
  // 起步没做完时总览默认展开起步清单（用户收起过就不展开，记在 checklist 表里）；只在第一次读到清单时决定
  const setupDecided = useRef(false)
  useEffect(() => {
    if (setupDecided.current || !checklist.data) return
    setupDecided.current = true
    if (setupLeft && !checklist.data.setup_hidden) setSetupOpen(true)
  }, [checklist.data, setupLeft])
  // 展开 / 收起起步清单；起步还没做完时记住用户的选择
  const showSetup = (open: boolean) => {
    setSetupOpen(open)
    if (setupLeft && !!checklist.data?.setup_hidden === open) runLocal<ChecklistData>('today.setupPanel', { open }).then(checklist.setData, () => {})
  }
  // 有起步任务在后台跑（网站检查）：每隔几秒重拉清单，跑完自动打勾。
  // 上一次读完再等 3 秒：today.list 在线项目要读好几秒，固定间隔会叠起来占满连接
  const setupRunning = auditing || !!checklist.data?.setup.some((s) => s.running)
  useEffect(() => {
    if (!setupRunning) return
    let stop = false
    let timer = 0
    const next = () => { timer = window.setTimeout(() => { checklist.load().finally(() => { if (!stop) next() }) }, 3000) }
    next()
    return () => { stop = true; clearTimeout(timer) }
  }, [setupRunning, checklist.load])
  // 开始运营：选好的网站还没检查过，就在后台先检查，用户回到总览时这一步可能已经打勾了
  const startAudit = async () => {
    try {
      const list = await runLocal<ChecklistData>('today.list', {})
      const step = list.setup.find((s) => s.key === 'audit')
      if (!step || step.done || step.running || step.action.kind !== 'run' || step.action.fn !== 'onboarding.audit') return
      checklist.setData({ ...list, setup: list.setup.map((s) => s.key === 'audit' ? { ...s, running: true } : s) })
      setAuditing(true)
      runLocal('onboarding.audit', step.action.input ?? {}).catch(() => {}).finally(() => { setAuditing(false); checklist.load() })
    } catch { /* 起不来就留给用户在清单上点 */ }
  }
  // 开始运营：有能用的助手就开一次「分析网站」（任务 site-diagnosis：检查、关键词、AI 搜索、竞品、起草并开始 90 天计划），
  // 在后台的一段对话里跑，总览上的进度卡片看每一步；没有助手（没配模型）就只在后台做网站检查
  const startDiagnosis = async () => {
    try {
      const ai = await runLocal<{ ready: boolean }>('onboarding.ai', {})
      if (!ai.ready) return void startAudit()
      const run = await runLocal<{ id: string; status: string; chat_id: string }>('diagnosis.start', {})
      if (run.status !== 'running' || run.chat_id) return
      const { chat_id } = await runTask('site-diagnosis', { id: run.id })
      await runLocal('diagnosis.attach', { id: run.id, chat_id }).catch(() => {})
      checklist.load()
    } catch {
      void startAudit()
    }
  }
  useEffect(() => { if (autoWizard) setWizardSession(true) }, [autoWizard])
  const openWizard = async (step?: string) => {
    try {
      checklist.setData(await runLocal<ChecklistData>('today.openWizard', {}))
      setWizardStep(step ?? null)
      setWizardAway(false)
      setWizardSession(true)
      setSetupAway(false)
      setSetupOpen(false)
    } catch (e) { checklist.setError((e as Error).message) }
  }
  useEffect(() => {
    if (!mobileOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [mobileOpen])
  // 老的「内容中心」（view=content）：按要去的工作区、当前在哪一边跳到对应的页面（lib/views.tsx）
  const go = (v: View, extra: Record<string, string> = {}) => { setParams({ view: v === 'content' ? contentViewOf(extra, view) : v, ...extra }); setMobileOpen(false) }
  const goFromSetup = (v: View, extra: Record<string, string> = {}) => { setSetupAway(v !== 'overview'); go(v, extra) }
  const backToSetup = () => { setSetupAway(false); checklist.load(); go('overview'); showSetup(true) }
  useEffect(() => { if (view === 'overview') setSetupAway(false) }, [view])
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
    // 有的模板（产品运营）页面写了表也整个重拉（lib/views.tsx 的 REFRESH_ON_DB_CHANGE）
    const onChanged = () => {
      loadProfileRow()
      loadChannels()
      setRev((r) => r + 1)
    }
    if (REFRESH_ON_DB_CHANGE) window.addEventListener('db:changed', onChanged)
    return () => {
      window.removeEventListener('message', f)
      window.removeEventListener('db:changed', onChanged)
    }
  }, [loadProfileRow, loadChannels])

  // 还没填项目资料时用空名称占位，总览顶部会提示去「项目设置」填定位
  const ctx: Ctx | null = profile === undefined ? null : { profile: profile ?? EMPTY_PROFILE, channels, stats, days, go, reloadChannels: loadChannels, reloadProfile: loadProfileRow, rev, checklist, setupOpen, openWizard, toggleSetup: () => showSetup(!setupOpen), goFromSetup }

  // 侧栏亮哪一项：老链接、并进别的页面的页面怎么认在 lib/views.tsx
  const navView = navViewOf(view, params)
  // 左侧「AI 搜索推荐」的点：有跑完、还没看过的检测（每周自动跑的、离开页面后才跑完的）。
  // 有检测在跑时每 15 秒看一次，跑完时用户不在这一页就弹提示，点「去看看」过去；在这一页的话页面自己标成看过
  const [geoRuns, setGeoRuns] = useState<GeoRun[]>([])
  const viewRef = useRef(navView)
  viewRef.current = navView
  const geoRunning = useRef(new Set<string>())
  // t、go 每次渲染都是新的：放进 ref，loadGeo 才能保持不变（依赖它们会让下面的 effect 每次渲染都重跑、反复请求 geo_runs）
  const geoUi = useRef({ t, go })
  geoUi.current = { t, go }
  const loadGeo = useCallback(() => {
    dbList('geo_runs')
      .then((list) => {
        const now = Date.now()
        for (const r of list) {
          const live = !r.finished_at && now - (Date.parse(r.started_at || r.created_at || '') || 0) < 60 * 60 * 1000
          if (live) geoRunning.current.add(r.id)
          else if (geoRunning.current.delete(r.id) && geoUnseen(r) && viewRef.current !== 'geo') {
            // 几个 AI 同时问的一次检测：最后一个跑完才提示一次
            const batch = geoBatchOf(r, list)
            if (batch.some((x) => !x.finished_at && now - (Date.parse(x.started_at || x.created_at || '') || 0) < 60 * 60 * 1000)) continue
            toast(geoBatchDoneText(batch), 'ok', { action: { label: geoUi.current.t('geo_done_go'), onClick: () => geoUi.current.go('geo', { channel: r.channel_id }) } })
          }
        }
        setGeoRuns(list)
      })
      .catch(() => setGeoRuns([]))
  }, [])
  const geoLive = geoRuns.some((r) => geoRunning.current.has(r.id))
  const geoBadge = geoRuns.some(geoUnseen)
  // 侧栏上各模板自己的数字（外贸：增长机会没看过的条数；产品运营：灵感库没看过的笔记）
  const badges = useNavBadges({ ready: routeReady && !needLogin, rev, navView, params })
  useEffect(() => {
    if (!routeReady || needLogin) return
    loadGeo()
    const onChanged = (e: Event) => { if ((e as CustomEvent<{ table?: string }>).detail?.table === 'geo_runs') loadGeo() }
    window.addEventListener('db:changed', onChanged)
    window.addEventListener('focus', loadGeo)
    return () => {
      window.removeEventListener('db:changed', onChanged)
      window.removeEventListener('focus', loadGeo)
    }
  }, [routeReady, needLogin, rev, loadGeo, navView])
  useEffect(() => {
    if (!geoLive) return
    const timer = setInterval(loadGeo, 15000)
    return () => clearInterval(timer)
  }, [geoLive, loadGeo])

  const expandedFor = useRef('')
  useEffect(() => {
    if (!collapsedRead || expandedFor.current === navView) return
    expandedFor.current = navView
    const g = NAV.find((x) => x.items.some((n) => n.view === navView))
    const k = g ? g.group ?? 'g_work' : ''
    if (k && collapsed.includes(k)) toggleGroup(k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navView, collapsedRead])
  // 页面标题跟着当前页走：Shuttle 顶栏的标签页、浏览器标签都显示它
  useEffect(() => {
    if (routeReady) document.title = t(navView)
  }, [navView, routeReady, t])
  const group = NAV.find((g) => g.items.some((item) => item.view === navView))
  const socialSection = ['overview', 'content', 'data'].includes(params.section) ? params.section : params.tab || params.post ? 'content' : 'overview'
  const navClass = (active: boolean) => cx(
    'relative flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 md:h-8 text-left text-base transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
    active ? 'bg-background font-semibold text-primary-text shadow-[var(--card-shadow)] ring-1 ring-border/70' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
  )
  // 侧栏一项后面的标记：数字（各模板自己的、待看的新文章）或「新」（AI 搜索有没看过的检测，count 为空）
  const navBadge = (v: View): { count?: number; title: string } | null => {
    if (v === 'geo' && geoBadge) return { title: t('geo_badge') }
    if (badges[v]) return { count: badges[v]!.count, title: badges[v]!.title }
    const pending = v === 'website-content' ? pendingReview.filter((x) => x === 'website').length : v === 'social-content' ? pendingReview.filter((x) => x === 'social').length : 0
    return pending > 0 ? { count: pending, title: t('pending_badge', { n: pending }) } : null
  }
  // 首屏只出一次骨架：整页布局先画出来，内容区用骨架占着，等要用的数据齐了再换成页面。
  // 挂载前（服务端渲染时还不知道在不在 Shuttle 里）、项目资料没读到、Shuttle 里今日清单（决定要不要先进引导）没读到，都算没齐。
  // 以前清单没读到时整页换成一块居中的骨架，挂载前后各画一次，看起来像闪了两次
  const booting = !routeReady || profile === undefined || (shuttle && !checklist.data && !checklist.error)
  if (ctx && wizard && !wizard.closed && (wizardSession || autoWizard) && !wizardAway) return <Wizard initialStep={wizardStep} ctx={{ ...ctx, go: (v, extra) => { setWizardAway(true); go(v, extra) } }} onExit={(started) => { setWizardStep(null); setWizardSession(false); setWizardAway(false); go('overview'); if (started) { showSetup(true); void startDiagnosis() } }} />

  return (
    <main className="app-canvas flex h-dvh min-w-0 overflow-hidden text-foreground">
      {mobileOpen && <button type="button" aria-label={t('close_nav')} onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 cursor-pointer bg-black/35 md:hidden" />}
      <aside id="workspace-navigation" aria-label={t('navigation')} className={cx('fixed inset-y-0 left-0 z-40 w-[224px] shrink-0 flex-col bg-canvas transition-transform md:static md:z-auto md:translate-x-0', mobileOpen ? 'flex translate-x-0' : 'hidden -translate-x-full md:flex')}>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-3">
          <div className="flex justify-end md:hidden">
            <button type="button" onClick={() => setMobileOpen(false)} aria-label={t('close_nav')} className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent"><X className="size-4" /></button>
          </div>
          {/* 一组一行标题（图标 + 组名 + 箭头），点了折叠 / 展开；组里的页面缩进在下面，左边一条细线。收起的组在标题上显示组里的数字，不漏掉要处理的 */}
          {NAV.map((g, gi) => {
            const key = g.group ?? 'g_work'
            const open = !collapsed.includes(key)
            const GroupIcon = g.icon ?? LayoutDashboard
            const hidden = open ? null : g.items.map((n) => navBadge(n.view)).filter((x): x is NonNullable<typeof x> => !!x)
            const hiddenCount = hidden?.reduce((sum, x) => sum + (x.count ?? 0), 0) ?? 0
            return (
              <div key={key} className={cx(gi > 0 && 'mt-1')}>
                <button type="button" onClick={() => toggleGroup(key)} aria-expanded={open} title={t(open ? 'collapse_group' : 'expand_group')}
                  className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-base font-semibold text-foreground transition-colors outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring md:h-9">
                  <GroupIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate">{t(key)}</span>
                  {!!hidden?.length && <span className="shrink-0 rounded-md bg-primary/10 px-1.5 text-xs leading-5 font-semibold tabular-nums text-primary-text">{hiddenCount ? (hiddenCount > 99 ? '99+' : hiddenCount) : tr('article.new_badge')}</span>}
                  <ChevronDown className={cx('size-3.5 shrink-0 text-muted-foreground/70 transition-transform', !open && '-rotate-90')} />
                </button>
                {open && <div className="mt-0.5 mb-2 ml-[18px] space-y-0.5 border-l border-border pl-2">
                  {g.items.map((n) => {
                    const badge = n.view === navView ? null : navBadge(n.view)
                    return <button type="button" key={n.view} onClick={(e) => goFrom(e, n.view)} disabled={!ctx} aria-current={n.view === navView ? 'page' : undefined} title={t(n.view + '_sub')} className={navClass(n.view === navView)}>
                      <span className="truncate">{t(n.view)}</span>
                      {badge && <span title={badge.title} aria-label={badge.title} className="ml-auto shrink-0 rounded-md bg-primary/10 px-1.5 text-xs leading-5 font-semibold tabular-nums text-primary-text">{badge.count == null ? tr('article.new_badge') : badge.count > 99 ? '99+' : badge.count}</span>}
                    </button>
                  })}
                </div>}
              </div>
            )
          })}
        </nav>
        {checklist.data && <button type="button" onClick={() => { go('overview'); showSetup(view === 'overview' ? !setupOpen : true) }} aria-expanded={setupOpen && view === 'overview'} aria-controls="setup-checklist" className="mx-3 mb-3 cursor-pointer rounded-xl border border-border bg-background p-3 text-left outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring">
          <span className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{t('setup')}</span><span className="tabular-nums">{checklist.data.done}/{checklist.data.total}</span></span>
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
            {['content', 'website-content', 'social-content'].includes(view) && params.article ? <>
              <button type="button" onClick={() => setParams((p) => ({ ...p, article: '', version: '' }))} className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">{t(navView)}</button>
              <span className="text-muted-foreground/50">/</span>
              <span className="truncate font-medium">{t('content_detail')}</span>
            </> : <span className="truncate font-medium">{t(view === 'social' ? 'social_' + socialSection : navView)}</span>}
          </div>
        </header>
        {wizardAway && <div className="border-b border-border px-5 py-3"><button type="button" className="cursor-pointer text-sm text-primary-text underline" onClick={() => { checklist.load(); setWizardAway(false) }}>{t('wizard_return')}</button></div>}
        {setupAway && !wizardAway && view !== 'overview' && checklist.data && <div className="border-b border-border px-5 py-3"><button type="button" className="cursor-pointer text-sm text-primary-text underline" onClick={backToSetup}>{t('setup_return', { n: checklist.data.done, total: checklist.data.total })}</button></div>}
        {/* 所有页面和总览一样的内边距，顶栏的面包屑和内容左边对齐；改了这里，Social、Content 粘在顶部的那条（-top-4 -mx-4 md:-mx-6）也要跟着改 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div className="mx-auto w-full max-w-[1440px] space-y-6">
          {error && <Notice tone="error">{error}</Notice>}
          {shuttle && <SocialMigrateNotice plugin={socialPlugin.plugin} legacy={socialPlugin.legacy} onDone={loadChannels} />}
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
          ) : (
            renderView(view, { ctx, params, setParam, bumpRev: () => setRev((r) => r + 1) })
          )}
          </div>
        </div>
      </section>
      {/* 后台发布的进度（内容中心「发布」放进后台排队）：切到别的页面也一直在 */}
      <PublishProgress onOpen={(id) => go('content', { article: id })} />
    </main>
  )
}
