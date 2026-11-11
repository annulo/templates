import { useState } from "react";
import { ArrowLeft, ArrowRight, Pencil, Plus } from "lucide-react";
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
  type Article,
  type Campaign,
  type Product,
  type Topic,
  type UseCase,
} from "../../lib/shuttle";
import type { Ctx } from "./types";

type Data = {
  products: Product[];
  use_cases: UseCase[];
  campaigns: Campaign[];
};
type Detail = {
  campaign: Campaign;
  product: Product;
  topics: Topic[];
  articles: Article[];
};
export default function Campaigns({
  ctx,
  params,
  setParam,
}: {
  ctx: Ctx;
  params: Record<string, string>;
  setParam: (k: string, v: string) => void;
}) {
  const { data, error, reload } = useProductData<Data>(
    "growth.context",
    {},
    ctx.rev,
  );
  const [edit, setEdit] = useState<any>(null),
    [saveError, setSaveError] = useState("");
  const change = (key: string) => (value: string) =>
    setEdit({ ...edit, [key]: value });
  const active = data?.campaigns.find((c) => c.id === params.campaign);
  return (
    <div className="space-y-6">
      <PageHeader
        title={g("campaigns_title")}
        desc={g("campaigns_desc")}
        actions={
          <Button
            disabled={!data?.products.length}
            onClick={() => {
              setSaveError("");
              setEdit({
                product_id: data?.products[0]?.id || "",
                status: "planned",
                channels: JSON.stringify([
                  "website",
                  "xiaohongshu",
                  "douyin",
                  "x",
                ]),
              });
            }}
          >
            <Plus />
            {g("add_campaign")}
          </Button>
        }
      />
      <DataState loading={!data} error={error} />
      {active ? (
        <>
          <Button variant="ghost" onClick={() => setParam("campaign", "")}>
            <ArrowLeft />
            {g("back")}
          </Button>
          <CampaignDetail
            ctx={ctx}
            campaign={active}
            edit={() => {
              setSaveError("");
              setEdit(active);
            }}
          />
        </>
      ) : (
        <>
          {data && !data.campaigns.length && (
            <Empty
              text={data.products.length ? "campaign_empty" : "product_first"}
            />
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {data?.campaigns.map((c) => (
              <Panel
                key={c.id}
                title={c.title}
                aside={<Badge>{g("status_" + (c.status || "planned"))}</Badge>}
              >
                <p className="text-sm text-muted-foreground">
                  {c.problem || c.message}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {g("field_goal")}：{c.goal || "—"}
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setParam("campaign", c.id)}
                >
                  {g("open_campaign")}
                  <ArrowRight />
                </Button>
              </Panel>
            ))}
          </div>
        </>
      )}
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={g("edit_campaign")}
        width={800}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              {g("cancel")}
            </Button>
            <Button
              fn="growth.saveCampaign"
              onClick={async () => {
                try {
                  const c = await runLocal<Campaign>(
                    "growth.saveCampaign",
                    edit,
                  );
                  setEdit(null);
                  reload();
                  setParam("campaign", c.id);
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
                value={edit.product_id || ""}
                onChange={(v) =>
                  setEdit({
                    ...edit,
                    product_id: v,
                    use_case_id: "",
                    opportunity_id: "",
                  })
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
                { key: "audience" },
                { key: "problem", long: true },
                { key: "message", long: true },
                { key: "goal" },
                { key: "cta" },
                { key: "landing_url", type: "url" },
                { key: "review_at", type: "date" },
                { key: "conclusion", long: true },
              ]}
            />
            <Choice
              name="status"
              value={edit.status || "planned"}
              onChange={change("status")}
              options={[
                "planned",
                "creating",
                "ready",
                "active",
                "review",
                "done",
              ].map((v) => ({ value: v, label: g("status_" + v) }))}
            />
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                {g("field_channels")}
              </legend>
              <div className="flex flex-wrap gap-4">
                {["website", "xiaohongshu", "douyin", "x"].map((p) => {
                  const selected: string[] = JSON.parse(edit.channels || "[]");
                  return (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(p)}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            channels: JSON.stringify(
                              e.target.checked
                                ? [...selected, p]
                                : selected.filter((v) => v !== p),
                            ),
                          })
                        }
                      />
                      {g("platform_" + p)}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        )}
      </Dialog>
    </div>
  );
}
function CampaignDetail({
  ctx,
  campaign,
  edit,
}: {
  ctx: Ctx;
  campaign: Campaign;
  edit: () => void;
}) {
  const { data, error, reload } = useProductData<Detail>(
    "growth.campaignContext",
    { campaign_id: campaign.id },
    ctx.rev,
  );
  return (
    <div className="space-y-4">
      <Panel
        title={campaign.title}
        aside={
          <Button variant="outline" onClick={edit}>
            <Pencil />
            {g("edit")}
          </Button>
        }
      >
        <p className="text-sm whitespace-pre-line">
          {campaign.message || campaign.problem}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <TaskTools
            task="plan-campaign"
            label="plan_campaign"
            input={{ campaign_id: campaign.id }}
            onFinished={reload}
          />
          <TaskTools
            task="produce-campaign"
            label="produce_campaign"
            input={{ campaign_id: campaign.id }}
            disabled={!data?.topics.length}
            onFinished={reload}
          />
          <Button
            variant="outline"
            onClick={() => ctx.go("metrics", { campaign: campaign.id })}
          >
            {g("view_conversion")}
          </Button>
          <TaskTools
            task="review-campaign"
            label="review_campaign"
            input={{ campaign_id: campaign.id }}
            onFinished={reload}
          />
        </div>
        {campaign.landing_url && (
          <a
            className="mt-4 block truncate text-xs text-primary-text"
            href={campaign.landing_url}
            target="_blank"
            rel="noreferrer"
          >
            {campaign.landing_url}
          </a>
        )}
        {campaign.conclusion && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              {g("field_conclusion")}
            </p>
            <p className="mt-2 text-sm whitespace-pre-line">
              {campaign.conclusion}
            </p>
          </div>
        )}
      </Panel>
      <DataState loading={!data} error={error} />
      {data && !data.topics.length && <Empty text="plan_empty" />}
      <div className="grid gap-3 lg:grid-cols-2">
        {data?.topics.map((t) => {
          const articles = data.articles.filter((a) => a.topic_id === t.id);
          return (
            <Panel
              key={t.id}
              title={t.title}
              aside={
                <Badge>
                  {g("platform_" + (t.target_platform || "website"))}
                </Badge>
              }
            >
              <p className="text-sm text-muted-foreground">{t.angle}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {articles.length ? (
                  articles.map((a) => (
                    <Button
                      key={a.id}
                      variant="outline"
                      onClick={() => ctx.go("content", { article: a.id })}
                    >
                      {g("open_draft")}
                    </Button>
                  ))
                ) : (
                  <TaskTools
                    task="write-article"
                    label="write_draft"
                    input={{
                      topic_id: t.id,
                      type: t.content_type || "article",
                    }}
                    onFinished={reload}
                  />
                )}
              </div>
              {t.target_platform === "douyin" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {g("video_hint")}
                </p>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
