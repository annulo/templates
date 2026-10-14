import {
  CalendarDays,
  Globe,
  ClipboardList,
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
} from "lucide-react";
import type { View } from "../components/views/types";
import type { ChannelType } from "./shuttle";
export type NavItem = { view: View; icon: typeof Globe };
export type NavGroup = {
  group?: string;
  presentation?: "social";
  items: NavItem[];
};
export const NAV: NavGroup[] = [
  {
    items: [
      { view: "overview", icon: LayoutDashboard },
      { view: "reports", icon: ClipboardList },
      { view: "company", icon: Package },
      { view: "assets", icon: Images },
    ],
  },
  {
    group: "g_site",
    items: [
      { view: "website-content", icon: FileText },
      { view: "opportunities", icon: Lightbulb },
      { view: "search", icon: Search },
      { view: "geo", icon: Radar },
      { view: "audit", icon: ShieldCheck },
      { view: "site", icon: Globe },
      { view: "metrics", icon: ChartNoAxesCombined },
    ],
  },
  {
    group: "g_social",
    items: [
      { view: "social", icon: Share2 },
      { view: "social-content", icon: FileText },
      { view: "inspiration", icon: Lightbulb },
      { view: "calendar", icon: CalendarDays },
      { view: "social-metrics", icon: ChartNoAxesCombined },
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
