import { PageHeader, Panel, Button } from "../ui";
import Checklist from "../Checklist";
import {
  DataState,
  g,
  MetricCard,
  TaskTools,
  useProductData,
} from "../ProductFields";
import type { Ctx } from "./types";
export default function ProductOverview({ ctx }: { ctx: Ctx }) {
  const growth = useProductData<any>("growth.context", {}, ctx.rev),
    metrics = useProductData<any>("metrics.summary", { days: 30 }, ctx.rev);
  return (
    <div className="space-y-6">
      <PageHeader
        title={g("overview_title")}
        desc={
          ctx.profile.name
            ? g("overview_product", { name: ctx.profile.name })
            : g("overview_desc")
        }
        actions={
          <TaskTools
            task="seo-research"
            label="research"
            disabled={!growth.data?.products.length}
            onFinished={growth.reload}
          />
        }
      />
      <Panel title={g("current_goal")}>
        <p className="text-sm text-muted-foreground">
          {ctx.profile.goal || g("goal_empty")}
        </p>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => ctx.go("company")}
        >
          {g("define_goal")}
        </Button>
      </Panel>
      <DataState loading={!growth.data} error={growth.error || metrics.error} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={g("active_opportunities")}
          value={
            growth.data?.opportunities.filter(
              (o: any) => !["done", "parked"].includes(o.status),
            ).length
          }
        />
        <MetricCard
          label={g("active_campaigns")}
          value={
            growth.data?.campaigns.filter((c: any) => c.status !== "done")
              .length
          }
        />
        <MetricCard
          label={g("metric_signups")}
          value={metrics.data?.totals.signups}
        />
        <MetricCard
          label={g("metric_activations")}
          value={metrics.data?.totals.activations}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {g("overview_counts_note")}
      </p>
      <Checklist ctx={ctx} />
      <div className="grid gap-3 md:grid-cols-3">
        {(["company", "opportunities", "campaigns"] as const).map((v) => (
          <Panel key={v} title={g("quick_" + v)}>
            <p className="text-sm text-muted-foreground">
              {g("quick_" + v + "_desc")}
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => ctx.go(v)}
            >
              {g("open")}
            </Button>
          </Panel>
        ))}
      </div>
    </div>
  );
}
