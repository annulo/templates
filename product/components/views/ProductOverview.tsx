import { useState, type ReactNode } from "react";
import { CalendarDays, FileText, Lightbulb, Target } from "lucide-react";
import { PageHeader, Panel, Button, RangeToggle, Segmented } from "../ui";
import Checklist from "../Checklist";
import { g } from "../ProductFields";
import { GrowthOverview } from "../MarketingWorkspace";
import GrowthDashboard from "../GrowthDashboard";
import { tr } from "../../lib/i18n";
import type { Ctx, View } from "./types";

/** 工作台：今日任务和每周总结合在一页，用标签切换（每周总结对应 view=reports，旧链接照样能打开） */
export default function ProductOverview({
  ctx,
  tab,
  onTab,
  weekly,
}: {
  ctx: Ctx;
  tab: "today" | "weekly";
  onTab: (v: "today" | "weekly") => void;
  weekly?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={g("workbench_title")}
        desc={
          ctx.profile.name
            ? g("overview_product", { name: ctx.profile.name })
            : g("overview_desc")
        }
      />
      <Segmented
        value={tab}
        onChange={onTab}
        options={[
          { value: "today", label: g("tab_today") },
          { value: "weekly", label: g("tab_weekly") },
        ]}
      />
      {tab === "weekly" ? weekly : <Today ctx={ctx} />}
    </div>
  );
}

function Today({ ctx }: { ctx: Ctx }) {
  const shortcuts: [View, typeof FileText][] = [
    ["website-content", FileText],
    ["social-content", FileText],
    ["calendar", CalendarDays],
    ["opportunities", Lightbulb],
  ];
  const [days, setDays] = useState(30);
  return (
    <div className="space-y-6">
      {/* 先看数据：网站访问和社媒，时间段管整块 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{tr("dash.title")}</h3>
          <RangeToggle
            value={days}
            onChange={setDays}
            options={[7, 30, 90].map((n) => ({ value: n, label: tr("common.last_days", { n }) }))}
          />
        </div>
        <GrowthDashboard ctx={ctx} days={days} />
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          {ctx.checklist.data &&
            ctx.checklist.data.done < ctx.checklist.data.total && (
              <Checklist ctx={ctx} mode="setup" />
            )}
          <GrowthOverview ctx={ctx} />
        </div>
        <aside className="space-y-4">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Target className="size-4 text-muted-foreground" />
                {g("current_goal")}
              </span>
            }
          >
            <p className="text-sm text-muted-foreground">
              {ctx.profile.goal || g("goal_empty")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => ctx.go("company")}
            >
              {g("define_goal")}
            </Button>
          </Panel>
          <Panel title={g("shortcuts")}>
            <div className="grid gap-1">
              {shortcuts.map(([v, Icon]) => (
                <button
                  key={v}
                  onClick={() => ctx.go(v)}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Icon className="size-4 shrink-0" />
                  {g("shortcut_" + v.replace("-", "_"))}
                </button>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
