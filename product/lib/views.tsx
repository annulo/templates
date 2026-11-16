// 行业文件：产品运营有哪些页面、每个页面渲染什么、老链接怎么认、侧栏上额外的数字。
// 外壳（pages/Index.tsx，外贸和产品运营共用的 business 模块）读它；左侧导航怎么分组在 lib/edition.ts。
import { useEffect, useState, type ReactNode } from 'react'
import ProductOverview from '../components/views/ProductOverview'
import PlanView from '../components/views/Plan'
import ProductFacts from '../components/views/ProductFacts'
import { seoKeywords } from '../components/SeoKeywords'
import Backlinks from '../components/Backlinks'
import { AccountStrategies, GrowthReviews, MarketingImport, MarketingPlans, useMarketing } from '../components/MarketingWorkspace'
import Campaigns from '../components/views/Campaigns'
import ProductMetrics from '../components/views/ProductMetrics'
import ContentWorkspace, { type Marketing } from '../components/views/ContentWorkspace'
import InspirationLibrary from '../components/InspirationLibrary'
import Calendar from '../components/views/Calendar'
import Assets from '../components/views/Assets'
import Reports from '../components/views/Reports'
import Social from '../components/views/Social'
import Channels from '../components/views/Channels'
import Search from '../components/views/Search'
import Audit from '../components/views/Audit'
import Geo from '../components/views/Geo'
import SiteVisits from '../components/views/SiteVisits'
import Landing from '../components/views/Landing'
import Competitors from '../components/views/Competitors'
import Help from '../components/views/Help'
import Assistant from '../components/views/Assistant'
import { Notice } from '../components/ui'
import { runLocal } from './shuttle'
import { tr } from './i18n'
import type { Ctx, View } from '../components/views/types'

/** 侧栏收起了哪些分组记在浏览器里的键（各模板一个，改了用户收起的分组会全部展开） */
export const NAV_COLLAPSED = 'annulo:product-nav-collapsed'

/** 地址栏 view= 认的页面；别的都当总览 */
export const VIEWS: View[] = ['overview', 'plan', 'company', 'campaigns', 'content', 'website-content', 'landing', 'social-content', 'inspiration', 'social-metrics', 'calendar', 'assets', 'search', 'geo', 'audit', 'social', 'channels', 'site', 'competitors', 'help', 'assistant', 'settings']

/**
 * 并掉的老页面换成现在的位置（外壳打开地址、跳转时都过一遍）：
 * 每周总结在增长计划的标签里；SEO 规划（页面地图、页面机会）并进了「SEO 与关键词 → 关键词」；网站效果复盘是网站访问的「转化数据」；
 * 关键词地图、外链从增长计划挪到「SEO 与关键词」；GA4 从谷歌排名挪到网站访问
 */
export function redirectOf(p: Record<string, string>): Record<string, string> | null {
  if (p.view === 'reports') return { ...p, view: 'plan', tab: 'reports' }
  // SEO 规划（页面地图、页面机会）并进了关键词地图（campaigns 模块的 seomap.ts）
  if (p.view === 'opportunities' || (p.view === 'search' && (p.tab === 'seo' || p.tab === 'map'))) return { ...p, view: 'search', tab: 'keywords', seo_tab: '' }
  if (p.view === 'metrics') return { ...p, view: 'site', tab: 'conversions' }
  // 关键词地图并进了「关键词」标签（按主题看）
  if (p.view === 'plan' && p.tab === 'map') return { ...p, view: 'search', tab: 'keywords' }
  if (p.view === 'plan' && p.tab === 'links') return { ...p, view: 'search' }
  if (p.view === 'search' && p.tab === 'ga4') return { ...p, view: 'site' }
  return null
}

/** 页面写了表（db:changed）时整个后台重拉一遍：产品运营的几个页面（增长机会、运营主题、灵感库）靠它刷新 */
export const REFRESH_ON_DB_CHANGE = true

/** 老的「内容中心」（view=content）拆成了网站文章、社媒内容和灵感库：按要去的工作区、当前在哪一边跳过去 */
export function contentView(extra: Record<string, string>, current: View): View {
  if (extra.tab === 'inspiration') return 'inspiration'
  if (extra.workspace === 'website' || (!extra.workspace && ['website-content', 'landing', 'search', 'geo', 'audit', 'site', 'competitors'].includes(current))) return 'website-content'
  if (extra.workspace === 'social' || (!extra.workspace && ['social', 'social-content', 'inspiration', 'social-metrics', 'calendar'].includes(current))) return 'social-content'
  return 'content'
}

/** 侧栏亮哪一项：老的「自媒体数据」亮账号页；老链接 view=content 按 workspace 亮网站文章或社媒内容 */
export function navViewOf(view: View, params: Record<string, string>): View {
  if (view === 'social-metrics') return 'social'
  if (view === 'settings') return 'company'
  if (view === 'content') return params.tab === 'inspiration' ? 'inspiration' : params.workspace === 'website' ? 'website-content' : 'social-content'
  return view
}

export type PageProps = { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void; bumpRev: () => void }

/** 当前页面 */
export function renderView(view: View, { ctx, params, setParam, bumpRev }: PageProps): ReactNode {
  const p = { ctx, params, setParam }
  switch (view) {
    case 'plan': return <PlanView {...p} tabs={[{ value: 'reports', label: tr('nav.reports'), render: () => <Reports {...p} embedded /> }]} />
    case 'company': case 'settings': return <ProductFacts {...p} />
    case 'campaigns': return <Campaigns {...p} />
    case 'inspiration': return <InspirationLibrary {...p} workspace="social" onChanged={bumpRev} />
    case 'content':
      if (params.tab === 'inspiration') return <InspirationLibrary {...p} workspace="social" onChanged={bumpRev} />
      return <ContentWorkspace key={view} {...p} marketing={marketing(ctx)} />
    case 'website-content': case 'social-content':
      return <ContentWorkspace key={view} {...p} workspace={view === 'website-content' ? 'website' : 'social'} marketing={marketing(ctx)} />
    case 'landing': return <Landing {...p} />
    case 'calendar': return <Calendar {...p} scope="social" />
    case 'assets': return <Assets {...p} />
    // 老的「自媒体数据与复盘」并进了账号页的「数据」（复盘在自媒体内容的「待复盘」），旧链接打开账号数据
    case 'social': case 'social-metrics': return <SocialAccounts ctx={ctx} params={view === 'social-metrics' ? { ...params, section: 'data' } : params} setParam={setParam} />
    case 'channels': return <Channels ctx={ctx} current={params.channel || ''} setCurrent={(v) => setParam('channel', v)} />
    case 'search':
      return <Search {...p}
        // 关键词和外贸一个样；产品运营多两件事：读之前把导入的 SEO 页面地图、研究出的页面机会并进关键词表，卡片上能「创建运营主题」
        keywords={seoKeywords(ctx)}
        extraTabs={[
          { value: 'links', label: tr('plan.tab_links'), render: () => <Backlinks ctx={ctx} /> },
        ]} />
    case 'audit': return <Audit {...p} />
    case 'geo': return <Geo {...p} />
    case 'competitors': return <Competitors ctx={ctx} />
    case 'site': return <SiteVisits {...p} extraTabs={[{ value: 'conversions', label: tr('nav.conversions'), render: () => <ProductMetrics {...p} embedded /> }]} />
    case 'help': return <Help {...p} />
    case 'assistant': return <Assistant {...p} />
    default: return <ProductOverview ctx={ctx} />
  }
}

/** 内容页里的营销计划和复盘（运营主题模块）：导入营销资料、社媒的待复盘、营销计划详情、文章能从灵感库选参考 */
function marketing(ctx: Ctx): Marketing {
  return {
    Import: ({ data, onDone }) => <MarketingImport data={data} onDone={onDone} />,
    Reviews: ({ targets }) => <GrowthReviews ctx={ctx} workspace="social" targets={targets} />,
    Plan: ({ params, setParam, entry, workspace, onChanged, performance }) => <MarketingPlans ctx={ctx} params={params} setParam={setParam} detailsOnly contentEntry={entry} workspace={workspace} onChanged={onChanged} performance={performance} />,
    inspiration: true,
  }
}

/** 账号页：社媒账号（共用的 Social）下面加上账号的内容策略（运营主题模块） */
function SocialAccounts({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const { data, error, reload } = useMarketing(ctx)
  return (
    <div className="space-y-6">
      <Social ctx={ctx} params={params} setParam={setParam} title={tr('nav.social')}
        onSectionChange={(section, extra) => ctx.go('social', { ...(section === 'data' ? { section } : {}), ...extra })} />
      {params.section !== 'data' && <>
        {error && <Notice tone="error">{error}</Notice>}
        <h2 className="text-lg font-semibold">{tr('workspace.account_strategies')}</h2>
        <AccountStrategies ctx={ctx} data={data} reload={reload} />
      </>}
    </div>
  )
}

/** 侧栏上额外的数字（新文章、AI 搜索的「新」是外壳自己算的）：灵感库里自动同步进来、还没看过的笔记数，看过就去掉 */
export function useNavBadges({ ready, rev, params }: { ready: boolean; rev: number; navView: View; params: Record<string, string> }): Partial<Record<View, { count: number; title: string }>> {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!ready) return
    runLocal<{ count: number }>('inspiration.unread', {}).then((r) => setN(r.count), () => {})
  }, [ready, rev, params.source])
  return n > 0 ? { inspiration: { count: n, title: tr('nav.inspiration') } } : {}
}
