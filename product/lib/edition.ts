import {
  CalendarDays,
  Globe,
  FileText,
  Images,
  LayoutDashboard,
  Package,
  Radar,
  Search,
  Share2,
  ShieldCheck,
  Lightbulb,
  ChartNoAxesCombined,
  UserRound,
  Activity,
} from "lucide-react";
import type { View } from "../components/views/types";
import type { ChannelType } from "./shuttle";
export type NavItem = { view: View; icon: typeof Globe };
/** 侧栏分组：section 是组内的小标题（内容 / 表现 / 健康），让长分组有层次 */
export type NavSection = { section?: string; items: NavItem[] };
export type NavGroup = {
  group?: string;
  icon?: typeof Globe;
  sections: NavSection[];
};
// 从上到下按使用频率：工作台 → 网站运营 → 自媒体运营 → 产品资料（不常改，放最下面）；组内常用的在前
export const NAV: NavGroup[] = [
  { sections: [{ items: [{ view: "overview", icon: LayoutDashboard }] }] },
  {
    group: "g_site",
    icon: Globe,
    sections: [
      {
        section: "s_content",
        items: [
          { view: "website-content", icon: FileText },
          { view: "opportunities", icon: Lightbulb },
        ],
      },
      {
        section: "s_performance",
        items: [
          { view: "search", icon: Search },
          { view: "geo", icon: Radar },
          { view: "site", icon: Activity },
          { view: "metrics", icon: ChartNoAxesCombined },
        ],
      },
      { section: "s_health", items: [{ view: "audit", icon: ShieldCheck }] },
    ],
  },
  {
    group: "g_social",
    icon: Share2,
    sections: [
      {
        section: "s_content",
        items: [
          { view: "social-content", icon: FileText },
          { view: "inspiration", icon: Lightbulb },
          { view: "calendar", icon: CalendarDays },
        ],
      },
      {
        section: "s_accounts",
        items: [
          { view: "social", icon: UserRound },
          { view: "social-metrics", icon: ChartNoAxesCombined },
        ],
      },
    ],
  },
  {
    group: "g_library",
    icon: Package,
    sections: [
      {
        items: [
          { view: "company", icon: Package },
          { view: "assets", icon: Images },
        ],
      },
    ],
  },
];
export const CHANNELS: ChannelType[] = [
  "creght_site",
  "wordpress",
  "xiaohongshu",
  "douyin",
  "x",
];
import { lazy } from "react";
import type { WizardScreen } from "../components/wizard/types";
export const WIZARD_SCREENS: Record<string, WizardScreen> = {
  "connect-site": lazy(() => import("../components/wizard/ConnectProductSite")),
  "product-details": lazy(() => import("../components/wizard/ProductDetails")),
};
