import { PageHeader, Segmented } from "../ui";
import { m, SeoMap } from "../MarketingWorkspace";
import Opportunities from "./Opportunities";
import type { Ctx } from "./types";

export default function GrowthPlanning({
  ctx,
  params,
  setParam,
}: {
  ctx: Ctx;
  params: Record<string, string>;
  setParam: (k: string, v: string) => void;
}) {
  const tab = params.tab === "opportunities" ? "opportunities" : "map";
  return (
    <div className="space-y-5">
      <PageHeader title={m("growth_title")} desc={m("growth_desc")} />
      <div className="overflow-x-auto">
        <Segmented
          value={tab}
          onChange={(v) => setParam("tab", v)}
          options={[
            { value: "map", label: m("map_tab") },
            { value: "opportunities", label: m("opportunities_tab") },
          ]}
        />
      </div>
      {tab === "map" ? (
        <SeoMap ctx={ctx} params={params} />
      ) : (
        <Opportunities ctx={ctx} />
      )}
    </div>
  );
}
