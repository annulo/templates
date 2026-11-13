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
} from "lucide-react";
import type { View } from "../components/views/types";
import type { ChannelType } from "./shuttle";
/** 一项导航：section 给了就在它上面显示组内的小标题（messages 的 nav.<section>），把长的组分出层次 */
export type NavItem = { view: View; icon: typeof Globe; section?: string };
/** 左侧导航：一组一个标题（messages 的 nav.<group>），每项显示 nav.<view> 和 nav.<view>_sub。外壳（pages/Index.tsx）和外贸共用这个结构 */
export type NavGroup = { group?: string; items: NavItem[] };
// 从上到下按使用频率：工作台 → 网站运营 → 自媒体运营 → 产品资料（不常改，放最下面）；组内常用的在前
export const NAV: NavGroup[] = [
  { items: [{ view: "overview", icon: LayoutDashboard }, { view: "plan", icon: Target }] },
  {
    group: "g_site",
    items: [
      { view: "website-content", icon: FileText, section: "s_content" },
      { view: "landing", icon: LayoutTemplate },
      { view: "opportunities", icon: Lightbulb },
      { view: "search", icon: Search, section: "s_performance" },
      { view: "geo", icon: Radar },
      { view: "site", icon: Activity },
      { view: "metrics", icon: ChartNoAxesCombined },
      { view: "audit", icon: ShieldCheck, section: "s_health" },
    ],
  },
  {
    group: "g_social",
    items: [
      { view: "social-content", icon: FileText, section: "s_content" },
      { view: "inspiration", icon: Lightbulb },
      { view: "calendar", icon: CalendarDays },
      // 单篇的数据挂在内容上（内容列表、复盘），这里只放账号：连接、定位、账号的数据
      { view: "social", icon: UserRound, section: "s_accounts" },
    ],
  },
  {
    group: "g_library",
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
