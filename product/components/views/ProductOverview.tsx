import { useState } from "react";
import { CalendarDays, FileText, Lightbulb, Target } from "lucide-react";
import { PageHeader, Panel, Button, RangeToggle } from "../ui";
import TodayCard from "../TodayCard";
import Checklist from "../Checklist";
import { g } from "../ProductFields";
import { GrowthOverview } from "../MarketingWorkspace";
import GrowthDashboard from "../GrowthDashboard";
import { PlanCard } from "./Plan";
import { tr } from "../../lib/i18n";
import type { Ctx, View } from "./types";

/**
 * 工作台：最上面「今天要做的事」和 90 天增长计划并排（一件一行，占位小），下面是数据看板、起步清单、增长概览。
 * 每周总结是单独的一页（侧栏「每周总结」，view=reports）。
 */
export default function ProductOverview({ ctx }: { ctx: Ctx }) {
  return (
    <div className="@container/overview min-w-0 space-y-6">
      <PageHeader
        title={g("workbench_title")}
        desc={
          ctx.profile.name
            ? g("overview_product", { name: ctx.profile.name })
            : g("overview_desc")
        }
      />
      <Today ctx={ctx} />
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
      {/* 今天要做的事 + 90 天增长计划，内容区够 560px 就并排一行（计划那栏窄，三个目标改成上下排） */}
      <div className="grid gap-4 @min-[560px]/overview:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
        <TodayCard ctx={ctx} />
        <div className="[&>*]:h-full [&_.grid]:grid-cols-1!">
          <PlanCard ctx={ctx} />
        </div>
      </div>
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
