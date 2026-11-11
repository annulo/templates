import { useState } from "react";
import { ArrowRight, Pencil, Plus } from "lucide-react";
import { Badge, Button, Dialog, Notice, PageHeader, Panel } from "../ui";
import {
  Choice,
  DataState,
  Empty,
  g,
  TaskTools,
  TextFields,
  useProductData,
} from "../ProductFields";
import {
  runLocal,
  type Campaign,
  type GrowthOpportunity,
  type Product,
  type UseCase,
} from "../../lib/shuttle";
import type { Ctx } from "./types";

type Data = {
  products: Product[];
  use_cases: UseCase[];
  opportunities: GrowthOpportunity[];
};
export default function Opportunities({ ctx }: { ctx: Ctx }) {
  const { data, error, reload } = useProductData<Data>(
    "growth.context",
    {},
    ctx.rev,
  );
  const [edit, setEdit] = useState<any>(null),
    [filter, setFilter] = useState("all"),
    [saveError, setSaveError] = useState("");
  const change = (key: string) => (value: string) =>
    setEdit({ ...edit, [key]: value });
  const options = (values: string[], prefix: string) =>
    values.map((v) => ({ value: v, label: g(prefix + v) }));
  const list = (data?.opportunities || [])
    .filter((o) => filter === "all" || o.status === filter)
    .sort(
      (a, b) =>
        (({ high: 0, medium: 1, low: 2 })[a.priority || "medium"] ?? 1) -
        ({ high: 0, medium: 1, low: 2 }[b.priority || "medium"] ?? 1),
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title={g("opportunities_title")}
        desc={g("opportunities_desc")}
        actions={
          <>
            <TaskTools
              task="seo-research"
              label="research"
              disabled={!data?.products.length}
              onFinished={reload}
            />
            <Button
              onClick={() => {
                setSaveError("");
                setEdit({
                  product_id: data?.products[0]?.id || "",
                  status: "candidate",
                  priority: "medium",
                  intent: "informational",
                  page_type: "tutorial",
                  language: "zh",
                });
              }}
              disabled={!data?.products.length}
            >
              <Plus />
              {g("add_opportunity")}
            </Button>
          </>
        }
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {g("seo_flow")}
          </p>
          <Button variant="outline" onClick={() => ctx.go("search")}>
            {g("view_search")}
          </Button>
        </div>
      </Panel>
      <Choice
        name="status"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: g("all") },
          ...options(
            [
              "candidate",
              "validated",
              "planned",
              "running",
              "review",
              "done",
              "parked",
            ],
            "status_",
          ),
        ]}
      />
      <DataState loading={!data} error={error} />
      {data && !list.length && (
        <Empty
          text={data.products.length ? "opportunity_empty" : "product_first"}
        />
      )}
      <div className="space-y-3">
        {list.map((o) => (
          <Panel
            key={o.id}
            title={o.title}
            aside={
              <div className="flex gap-2">
                <Badge tone={o.status === "candidate" ? "warn" : "default"}>
                  {g("status_" + (o.status || "candidate"))}
                </Badge>
                <Badge>{g("priority_" + (o.priority || "medium"))}</Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={g("edit")}
                  onClick={() => {
                    setSaveError("");
                    setEdit(o);
                  }}
                >
                  <Pencil />
                </Button>
              </div>
            }
          >
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {o.problem || o.recommendation}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                <span>
                  {g("field_keyword")}：{o.keyword || "—"}
                </span>
                <span>
                  {g("field_page_type")}：
                  {g("page_" + (o.page_type || "tutorial"))}
                </span>
                <span>
                  {g("field_search_volume")}：
                  {o.search_volume ?? g("unverified")}
                </span>
                <span>
                  {g("field_difficulty")}：{o.difficulty ?? g("unverified")}
                </span>
              </div>
              {o.evidence && (
                <p className="text-sm whitespace-pre-line">{o.evidence}</p>
              )}
              {o.source_url && (
                <a
                  className="text-xs text-primary-text hover:underline"
                  target="_blank"
                  rel="noreferrer"
                  href={o.source_url}
                >
                  {g("view_source")}
                </a>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  fn="growth.createCampaign"
                  variant="outline"
                  onClick={async () => {
                    const c = await runLocal<Campaign>(
                      "growth.createCampaign",
                      { opportunity_id: o.id },
                    );
                    ctx.go("campaigns", { campaign: c.id });
                  }}
                >
                  <ArrowRight />
                  {g("create_campaign")}
                </Button>
                <TaskTools
                  task="seo-page-plan"
                  label="plan_page"
                  input={{ opportunity_id: o.id }}
                  onFinished={reload}
                />
                <TaskTools
                  task="seo-page-implement"
                  label="implement_page"
                  input={{ opportunity_id: o.id }}
                  onFinished={reload}
                />
              </div>
            </div>
          </Panel>
        ))}
      </div>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={g("edit_opportunity")}
        width={820}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              {g("cancel")}
            </Button>
            <Button
              fn="growth.saveOpportunity"
              onClick={async () => {
                try {
                  await runLocal("growth.saveOpportunity", edit);
                  setEdit(null);
                  reload();
                } catch (e) {
                  setSaveError((e as Error).message);
                  return false;
                }
              }}
            >
              {g("save")}
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            {saveError && <Notice tone="error">{saveError}</Notice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice
                name="product_id"
                value={edit.product_id}
                onChange={(v) =>
                  setEdit({ ...edit, product_id: v, use_case_id: "" })
                }
                options={(data?.products || []).map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
              />
              <Choice
                name="use_case_id"
                value={edit.use_case_id || ""}
                onChange={change("use_case_id")}
                options={[
                  { value: "", label: g("none") },
                  ...(data?.use_cases || [])
                    .filter((c) => c.product_id === edit.product_id)
                    .map((c) => ({ value: c.id, label: c.title })),
                ]}
              />
            </div>
            <TextFields
              value={edit}
              onChange={setEdit}
              fields={[
                { key: "title" },
                { key: "keyword" },
                { key: "language" },
                { key: "audience" },
                { key: "problem", long: true },
                { key: "recommendation", long: true },
                { key: "goal" },
                { key: "target_url", type: "url" },
              ]}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice
                name="intent"
                value={edit.intent || "informational"}
                onChange={change("intent")}
                options={options(
                  ["informational", "commercial", "transactional"],
                  "intent_",
                )}
              />
              <Choice
                name="page_type"
                value={edit.page_type || "tutorial"}
                onChange={change("page_type")}
                options={options(
                  [
                    "feature",
                    "usecase",
                    "template",
                    "comparison",
                    "tutorial",
                    "case",
                    "tool",
                  ],
                  "page_",
                )}
              />
              <Choice
                name="status"
                value={edit.status || "candidate"}
                onChange={change("status")}
                options={options(
                  [
                    "candidate",
                    "validated",
                    "planned",
                    "running",
                    "review",
                    "done",
                    "parked",
                  ],
                  "status_",
                )}
              />
              <Choice
                name="priority"
                value={edit.priority || "medium"}
                onChange={change("priority")}
                options={options(["high", "medium", "low"], "priority_")}
              />
            </div>
            <TextFields
              value={edit}
              onChange={setEdit}
              fields={[
                { key: "evidence", long: true },
                { key: "source_url", type: "url" },
                { key: "checked_at" },
                { key: "data_source" },
                { key: "effort" },
                { key: "search_volume", type: "number", hint: "numbers_hint" },
                { key: "difficulty", type: "number" },
                { key: "review_at", type: "date" },
                { key: "result", long: true },
              ]}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}
