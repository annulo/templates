import type { ChecklistState } from "../../lib/useChecklist";
import type { Channel, ChannelStats, Profile } from "../../lib/shuttle";

export type View =
  | "opportunities"
  | "campaigns"
  | "metrics"
  | "overview"
  | "reports"
  | "company"
  | "products"
  | "content"
  | "calendar"
  | "assets"
  | "geo"
  | "search"
  | "audit"
  | "leads"
  | "social"
  | "channels"
  | "site"
  | "settings"
  | "help"
  | "assistant";

/** 各视图共用的上下文：项目资料、渠道、访问汇总、是否在 Shuttle 里 */
export type Ctx = {
  /** 项目资料（profile 表那一行）；还没填时是 { name: '' } */
  profile: Profile;
  channels: Channel[];
  stats: Record<string, ChannelStats> | null;
  days: number;
  go: (v: View, extra?: Record<string, string>) => void;
  reloadChannels: () => void;
  reloadProfile: () => void;
  /** 数据版本：助手改了数据（写表、跑了本机函数）后外壳发 shuttle:refresh，这里 +1，视图据此静默重拉（不清空、不闪） */
  rev: number;
  checklist: ChecklistState;
  setupOpen: boolean;
  toggleSetup: () => void;
  /** 从起步清单去别的页面做一步：那个页面顶上有「做完回到起步配置」 */
  goFromSetup: (v: View, extra?: Record<string, string>) => void;
  openWizard: (step?: string) => void;
};
