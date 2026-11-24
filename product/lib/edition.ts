import {
  CalendarDays,
  Globe,
  FileText,
  Images,
  LayoutDashboard,
  Package,
  Radar,
  Search,
  ShieldCheck,
  Lightbulb,
  LayoutTemplate,
  UserRound,
  Activity,
  Target,
  Share2,
  BookOpen,
  Crosshair,
} from "lucide-react";
import type { View } from "../components/views/types";
import type { ChannelType } from "./shuttle";
/** 一项导航：页面和它的图标（侧栏里组内的页面不显示图标，图标给别处用）；section 是组里从这一项起的小标题（messages 的 nav.<section>） */
export type NavItem = { view: View; icon: typeof Globe; section?: string };
/** 左侧导航：一组一个标题（messages 的 nav.<group>，没写 group 是「工作台」）和图标，组能折叠；每项显示 nav.<view> 和 nav.<view>_sub。外壳（pages/Index.tsx）和外贸共用这个结构 */
export type NavGroup = { group?: string; icon?: typeof Globe; items: NavItem[] };
// 从上到下按使用频率：工作台 → 网站运营 → 自媒体运营 → 产品资料（不常改，放最下面）；组内常用的在前。
// 「接下来做什么」只有增长计划一个入口（每周总结是它的标签）；网站运营分三段：内容、搜索流量、体检
export const NAV: NavGroup[] = [
  { items: [{ view: "overview", icon: LayoutDashboard }, { view: "plan", icon: Target }] },
  {
    group: "g_site",
    icon: Globe,
    items: [
      { view: "website-content", icon: FileText, section: "s_content" },
      { view: "landing", icon: LayoutTemplate },
      { view: "search", icon: Search, section: "s_traffic" },
      { view: "geo", icon: Radar },
      { view: "site", icon: Activity },
      { view: "audit", icon: ShieldCheck, section: "s_health" },
      { view: "competitors", icon: Crosshair },
    ],
  },
  {
    group: "g_social",
    icon: Share2,
    items: [
      { view: "social-content", icon: FileText },
      { view: "inspiration", icon: Lightbulb },
      { view: "calendar", icon: CalendarDays },
      // 单篇的数据挂在内容上（内容列表、复盘），这里只放账号：连接、定位、账号的数据
      { view: "social", icon: UserRound },
    ],
  },
  {
    group: "g_library",
    icon: BookOpen,
    items: [
      { view: "company", icon: Package },
      { view: "assets", icon: Images },
    ],
  },
];
export const CHANNELS: ChannelType[] = [
  "creght_site",
  "wordpress",
  "xiaohongshu",
  "douyin",
  "x",
  "instagram",
  "threads",
];
import { lazy } from "react";
import type { WizardScreen } from "../components/wizard/types";
export const WIZARD_SCREENS: Record<string, WizardScreen> = {
  "connect-site": lazy(() => import("../components/wizard/ConnectProductSite")),
  "product-details": lazy(() => import("../components/wizard/ProductDetails")),
};
