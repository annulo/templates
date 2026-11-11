// 行业文件：产品运营有哪些页面、每个页面渲染什么、老链接怎么认、侧栏上额外的数字。
// 外壳（pages/Index.tsx，外贸和产品运营共用的 business 模块）读它；左侧导航怎么分组在 lib/edition.ts。
import { useEffect, useState, type ReactNode } from 'react'
import ProductOverview from '../components/views/ProductOverview'
import ProductFacts from '../components/views/ProductFacts'
import GrowthPlanning from '../components/views/GrowthPlanning'
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
import Help from '../components/views/Help'
import Assistant from '../components/views/Assistant'
import { Button, Notice } from '../components/ui'
import { g, TaskTools } from '../components/ProductFields'
import { runLocal } from './shuttle'
import { tr } from './i18n'
import type { Ctx, View } from '../components/views/types'

/** 侧栏收起了哪些分组记在浏览器里的键（各模板一个，改了用户收起的分组会全部展开） */
export const NAV_COLLAPSED = 'annulo:product-nav-collapsed'

/** 地址栏 view= 认的页面；别的都当总览 */
export const VIEWS: View[] = ['overview', 'reports', 'company', 'opportunities', 'campaigns', 'metrics', 'content', 'website-content', 'landing', 'social-content', 'inspiration', 'social-metrics', 'calendar', 'assets', 'search', 'geo', 'audit', 'social', 'channels', 'site', 'help', 'assistant', 'settings']

/** 页面写了表（db:changed）时整个后台重拉一遍：产品运营的几个页面（增长机会、运营主题、灵感库）靠它刷新 */
export const REFRESH_ON_DB_CHANGE = true

/** 老的「内容中心」（view=content）拆成了网站文章、社媒内容和灵感库：按要去的工作区、当前在哪一边跳过去 */
export function contentView(extra: Record<string, string>, current: View): View {
  if (extra.tab === 'inspiration') return 'inspiration'
  if (extra.workspace === 'website' || (!extra.workspace && ['website-content', 'landing', 'opportunities', 'search', 'geo', 'audit', 'site', 'metrics'].includes(current))) return 'website-content'
  if (extra.workspace === 'social' || (!extra.workspace && ['social', 'social-content', 'inspiration', 'social-metrics', 'calendar'].includes(current))) return 'social-content'
  return 'content'
}

/** 侧栏亮哪一项：每周总结并进了工作台（旧的 view=reports 亮工作台）；老的「自媒体数据」亮账号页；老链接 view=content 按 workspace 亮网站文章或社媒内容 */
export function navViewOf(view: View, params: Record<string, string>): View {
  if (view === 'reports') return 'overview'
  if (view === 'social-metrics') return 'social'
  if (view === 'settings') return 'company'
  if (view === 'content') return params.tab === 'inspiration' ? 'inspiration' : params.workspace === 'website' ? 'website-content' : 'social-content'
  return view
}

export type PageProps = { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void; bumpRev: () => void }

/** 当前页面 */
export function renderView(view: View, { ctx, params, setParam, bumpRev }: PageProps): ReactNode {
  const p = { ctx, params, setParam }
  const tabs = (v: string) => ctx.go(v === 'weekly' ? 'reports' : 'overview')
  switch (view) {
    case 'company': case 'settings': return <ProductFacts {...p} />
    case 'opportunities': return <GrowthPlanning {...p} />
    case 'campaigns': return <Campaigns {...p} />
    case 'metrics': return <ProductMetrics {...p} />
    case 'inspiration': return <InspirationLibrary {...p} workspace="social" onChanged={bumpRev} />
    case 'content':
      if (params.tab === 'inspiration') return <InspirationLibrary {...p} workspace="social" onChanged={bumpRev} />
      return <ContentWorkspace key={view} {...p} marketing={marketing(ctx)} />
    case 'website-content': case 'social-content':
      return <ContentWorkspace key={view} {...p} workspace={view === 'website-content' ? 'website' : 'social'} marketing={marketing(ctx)} />
    case 'landing': return <Landing {...p} />
    case 'calendar': return <Calendar {...p} scope="social" />
    case 'assets': return <Assets {...p} />
    // 每周总结是工作台的一个页签
    case 'reports': return <ProductOverview ctx={ctx} tab="weekly" onTab={tabs} weekly={<Reports {...p} embedded />} />
    // 老的「自媒体数据与复盘」并进了账号页的「数据」（复盘在自媒体内容的「待复盘」），旧链接打开账号数据
    case 'social': case 'social-metrics': return <SocialAccounts ctx={ctx} params={view === 'social-metrics' ? { ...params, section: 'data' } : params} setParam={setParam} />
    case 'channels': return <Channels ctx={ctx} current={params.channel || ''} setCurrent={(v) => setParam('channel', v)} />
    case 'search':
      return <Search {...p}
        // 页头上面：去「增长机会」，交给助手做 SEO 研究（产品运营才有，共用的谷歌排名页留了这个位置）
        headerActions={(channel) => <>
          <Button variant="outline" onClick={() => ctx.go('opportunities')}>{g('opportunities_title')}</Button>
          <TaskTools task="seo-research" label="research" input={{ channel_id: channel.id }} />
        </>} />
    case 'audit': return <Audit {...p} />
    case 'geo': return <Geo {...p} />
    case 'site': return <SiteVisits {...p} />
    case 'help': return <Help {...p} />
    case 'assistant': return <Assistant {...p} />
    default: return <ProductOverview ctx={ctx} tab="today" onTab={tabs} />
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
