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
  ChartNoAxesCombined,
  LayoutTemplate,
  UserRound,
  Activity,
  Target,
  Share2,
  BookOpen,
  ClipboardList,
} from "lucide-react";
import type { View } from "../components/views/types";
import type { ChannelType } from "./shuttle";
/** 一项导航：页面和它的图标（侧栏里组内的页面不显示图标，图标给别处用） */
export type NavItem = { view: View; icon: typeof Globe };
/** 左侧导航：一组一个标题（messages 的 nav.<group>，没写 group 是「工作台」）和图标，组能折叠；每项显示 nav.<view> 和 nav.<view>_sub。外壳（pages/Index.tsx）和外贸共用这个结构 */
export type NavGroup = { group?: string; icon?: typeof Globe; items: NavItem[] };
// 从上到下按使用频率：工作台 → 网站运营 → 自媒体运营 → 产品资料（不常改，放最下面）；组内常用的在前
export const NAV: NavGroup[] = [
  { items: [{ view: "overview", icon: LayoutDashboard }, { view: "plan", icon: Target }, { view: "reports", icon: ClipboardList }] },
  {
    group: "g_site",
    icon: Globe,
    items: [
      { view: "website-content", icon: FileText },
      { view: "landing", icon: LayoutTemplate },
      { view: "opportunities", icon: Lightbulb },
      { view: "search", icon: Search },
      { view: "geo", icon: Radar },
      { view: "site", icon: Activity },
      { view: "metrics", icon: ChartNoAxesCombined },
      { view: "audit", icon: ShieldCheck },
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
];
import { lazy } from "react";
import type { WizardScreen } from "../components/wizard/types";
export const WIZARD_SCREENS: Record<string, WizardScreen> = {
  "connect-site": lazy(() => import("../components/wizard/ConnectProductSite")),
  "product-details": lazy(() => import("../components/wizard/ProductDetails")),
};
