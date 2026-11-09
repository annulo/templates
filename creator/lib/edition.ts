// 这个模板的页面配置：自媒体工作台（从外贸助手模板复制来，去掉了询盘、产品；网站运营用共用模块 core/features/websites）。
// 只放模板之间不一样的东西：左侧导航怎么分组、能添加哪些账号。用词在 messages/*.json。
import { Activity, CalendarDays, ClipboardList, FileText, Images, LayoutDashboard, Radar, Search, Share2, ShieldCheck, UserRound } from 'lucide-react'
import type { View } from '../components/views/types'
import type { ChannelType } from './shuttle'

export type NavItem = { view: View; icon: typeof LayoutDashboard }
/** 左侧导航：一组一个标题（messages 的 nav.<group>），每项显示 nav.<view> 和 nav.<view>_sub；sites：加了网站才显示这一组 */
export type NavGroup = { group?: string; presentation?: 'social'; sites?: boolean; items: NavItem[] }

// 社交媒体是独立能力入口；内容生产、网站、知识资料各一组。网站在「账号」里添加，没加网站时不显示网站这一组。
export const NAV: NavGroup[] = [
  { items: [{ view: 'overview', icon: LayoutDashboard }, { view: 'reports', icon: ClipboardList }] },
  { group: 'g_social', presentation: 'social', items: [{ view: 'social', icon: Share2 }] },
  {
    group: 'g_content',
    items: [
      { view: 'content', icon: FileText },
      { view: 'calendar', icon: CalendarDays },
    ],
  },
  { group: 'g_site', sites: true, items: [{ view: 'site', icon: Activity }, { view: 'search', icon: Search }, { view: 'geo', icon: Radar }, { view: 'audit', icon: ShieldCheck }] },
  { group: 'g_knowledge', items: [{ view: 'company', icon: UserRound }, { view: 'assets', icon: Images }] },
]

/** 能添加的账号：网站（creght 站点、WordPress）和社媒（社媒插件支持的平台） */
export const CHANNELS: ChannelType[] = ['creght_site', 'wordpress', 'x', 'linkedin', 'facebook', 'instagram', 'youtube', 'xiaohongshu', 'douyin', 'bilibili', 'zhihu']

import { lazy } from 'react'
import type { WizardScreen } from '../components/wizard/types'
export const WIZARD_SCREENS: Record<string, WizardScreen> = {
  profile: lazy(() => import('../components/wizard/CreatorProfile')),
}
