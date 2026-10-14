import { PageHeader, Panel, Button } from "../ui";
import Checklist from "../Checklist";
import { g } from "../ProductFields";
import { GrowthOverview } from "../MarketingWorkspace";
import type { Ctx } from "./types";
export default function ProductOverview({ ctx }: { ctx: Ctx }) {
  return (
    <div className="space-y-5">
      <PageHeader
        title={g("overview_title")}
        desc={
          ctx.profile.name
            ? g("overview_product", { name: ctx.profile.name })
            : g("overview_desc")
        }
      />
      <GrowthOverview ctx={ctx} />
      {ctx.checklist.data &&
        ctx.checklist.data.done < ctx.checklist.data.total && (
          <Checklist ctx={ctx} mode="setup" />
        )}
      <Panel title={g("current_goal")}>
        <p className="text-sm text-muted-foreground">
          {ctx.profile.goal || g("goal_empty")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => ctx.go("company")}>
            {g("define_goal")}
          </Button>
          <Button variant="outline" onClick={() => ctx.go("campaigns")}>
            {g("quick_campaigns")}
          </Button>
          <Button variant="outline" onClick={() => ctx.go("metrics")}>
            {g("view_conversion")}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
