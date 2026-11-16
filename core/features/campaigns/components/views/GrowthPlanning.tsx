import { PageHeader, Segmented } from "../ui";
import { m, SeoMap } from "../MarketingWorkspace";
import Opportunities from "./Opportunities";
import type { Ctx } from "./types";

export default function GrowthPlanning({
  ctx,
  params,
  setParam,
  embedded = false,
}: {
  ctx: Ctx;
  params: Record<string, string>;
  setParam: (k: string, v: string) => void;
  /** 放在「SEO 与关键词」页的「SEO 规划」标签里：标题小一号，自己的标签记在 seo_tab（tab 是外面那一层的） */
  embedded?: boolean;
}) {
  const key = embedded ? "seo_tab" : "tab";
  const tab = params[key] === "opportunities" ? "opportunities" : "map";
  return (
    <div className="space-y-5">
      <PageHeader level={embedded ? 2 : 1} title={m("growth_title")} desc={m("growth_desc")} />
      <div className="overflow-x-auto">
        <Segmented
          value={tab}
          onChange={(v) => setParam(key, v)}
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
