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
  Target,
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
    ],
  },
  {
    group: "g_product",
    items: [
      { view: "company", icon: Package },
      { view: "opportunities", icon: Lightbulb },
      { view: "campaigns", icon: Target },
      { view: "metrics", icon: ChartNoAxesCombined },
    ],
  },
  {
    group: "g_social",
    presentation: "social",
    items: [{ view: "social", icon: Share2 }],
  },
  {
    group: "g_content",
    items: [
      { view: "content", icon: FileText },
      { view: "calendar", icon: CalendarDays },
      { view: "assets", icon: Images },
    ],
  },
  {
    group: "g_site",
    items: [
      { view: "site", icon: Globe },
      { view: "search", icon: Search },
      { view: "geo", icon: Radar },
      { view: "audit", icon: ShieldCheck },
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
