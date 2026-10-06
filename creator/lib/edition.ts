// 这个模板的页面配置：自媒体工作台（从外贸助手模板复制来，去掉了网站、搜索、GEO、询盘、产品）。
// 只放模板之间不一样的东西：左侧导航怎么分组、能添加哪些账号。用词在 messages/*.json。
import { CalendarDays, ClipboardList, FileText, Images, LayoutDashboard, Share2, UserRound } from 'lucide-react'
import type { View } from '../components/views/types'
import type { ChannelType } from './shuttle'

export type NavItem = { view: View; icon: typeof LayoutDashboard }
/** 左侧导航：一组一个标题（messages 的 nav.<group>），每项显示 nav.<view> 和 nav.<view>_sub */
export type NavGroup = { group?: string; presentation?: 'social'; items: NavItem[] }

// 社交媒体是独立能力入口；内容生产、知识资料各一组。
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
  { group: 'g_knowledge', items: [{ view: 'company', icon: UserRound }, { view: 'assets', icon: Images }] },
]

/** 能添加的账号：只有社媒（社媒插件支持的平台） */
export const CHANNELS: ChannelType[] = ['x', 'linkedin', 'facebook', 'instagram', 'youtube', 'xiaohongshu', 'douyin', 'bilibili']

import { lazy } from 'react'
import type { WizardScreen } from '../components/wizard/types'
export const WIZARD_SCREENS: Record<string, WizardScreen> = {
  profile: lazy(() => import('../components/wizard/CreatorProfile')),
}
