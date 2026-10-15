import { useState } from "react";
import { ArrowRight, Check, ExternalLink, Upload } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Field,
  Notice,
  Panel,
  Segmented,
  inputCls,
} from "./ui";
import Select from "./Select";
import {
  DataState,
  MetricCard,
  TaskTools,
  useProductData,
} from "./ProductFields";
import { runLocal } from "../lib/shuttle";
import { tr } from "../lib/i18n";
import type { Ctx } from "./views/types";
import { contentEntries, platformWorkspace, reviewWorkspace, type ContentData, type ContentEntry, type ContentWorkspace } from "../lib/contentWorkspace";
import ContentStatus, { PublicationLinks } from './ContentStatus';

export const m = (key: string, vars?: Record<string, unknown>) =>
  tr("marketing." + key, vars);
export const useMarketing = (ctx: Ctx) =>
  useProductData<any>("marketing.context", {}, ctx.rev);
const stages = [
  "planned",
  "creating",
  "review",
  "ready",
  "reported_published",
  "blocked",
  "published",
];
export function MarketingImport({
  data,
  onDone,
}: {
  data: any;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(""),
    [product, setProduct] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState("");
  const args = () => {
    const input = {
      ...JSON.parse(value),
      product_id: product || data?.products[0]?.id,
    };
    if (new TextEncoder().encode(JSON.stringify(input)).length > 900_000)
      throw new Error(m("file_large"));
    return input;
  };
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        {m("import")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={m("import_title")}
        width={800}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {m("cancel")}
            </Button>
            <Button
              fn="marketing.importPack"
              disabled={!value || !data?.products.length}
              onClick={async () => {
                try {
                  const r = await runLocal("marketing.importPack", {
                    ...args(),
                    preview: true,
                  });
                  setPreview(r);
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {m("preview")}
            </Button>
            <Button
              fn="marketing.importPack"
              disabled={!preview}
              onClick={async () => {
                await runLocal("marketing.importPack", args());
                setOpen(false);
                setPreview(null);
                onDone();
              }}
            >
              {m("apply")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Notice>{m("import_note")}</Notice>
          {error && <Notice tone="error">{error}</Notice>}
          <Field label={m("product")}>
            <Select
              ariaLabel={m("product")}
              value={product || data?.products[0]?.id || ""}
              options={(data?.products || []).map((p: any) => ({
                value: p.id,
                label: p.name,
              }))}
              onChange={(v) => {
                setProduct(v);
                setPreview(null);
              }}
            />
          </Field>
          <Field label={m("import_file")}>
            <input
              aria-label={m("import_file")}
              className={inputCls}
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 900_000) {
                  setError(m("file_large"));
                  return;
                }
                setValue(await f.text());
                setPreview(null);
              }}
            />
          </Field>
          <textarea
            aria-label={m("import_json")}
            className={inputCls}
            rows={8}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setPreview(null);
            }}
          />
          {preview && (
            <Panel title={m("preview")}>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(preview.counts).map(([key, count]) => (
                  <div key={key} className="text-sm">
                    {m("table_" + key)}：{String(count)} {m("new")} ·{" "}
                    {preview.skipped[key]} {m("existing")}
                  </div>
                ))}
              </div>
              {preview.changed_existing.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {m("preserved", { n: preview.changed_existing.length })}
                </p>
              )}
            </Panel>
          )}
        </div>
      </Dialog>
    </>
  );
}
export function AccountStrategies({
  ctx,
  data,
  reload,
}: {
  ctx: Ctx;
  data: any;
  reload: () => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {data?.roles.map((r: any) => (
        <Panel
          key={r.id}
          title={r.name}
          aside={
            <Badge tone={r.account ? "ok" : "warn"}>
              {r.account ? m("bound") : m("unbound")}
            </Badge>
          }
        >
          <p className="text-sm">{r.purpose}</p>
          <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
            {r.guidance}
          </p>
          <div className="mt-3">
            <Select
              ariaLabel={m("account_for", { name: r.name })}
              value={r.account_id || ""}
              options={[
                { value: "", label: m("choose_account") },
                ...data.accounts
                  .filter((a: any) => a.type === r.platform)
                  .map((a: any) => ({ value: a.id, label: a.name })),
              ]}
              onChange={async (id) => {
                await runLocal("marketing.bindRole", {
                  id: r.id,
                  account_id: id,
                });
                reload();
              }}
            />
          </div>
          {!r.account && (
            <Button
              variant="ghost"
              className="mt-2"
              onClick={() => ctx.go("social")}
            >
              {m("connect_account")}
            </Button>
          )}
        </Panel>
      ))}
    </div>
  );
}
export function MarketingPlans({
  ctx,
  params,
  setParam,
  detailsOnly = false,
  contentEntry,
  workspace,
  onChanged,
}: {
  ctx: Ctx;
  params: Record<string, string>;
  setParam: (k: string, v: string) => void;
  detailsOnly?: boolean;
  contentEntry?: ContentEntry;
  workspace?: ContentWorkspace;
  onChanged?: () => void;
}) {
  const { data, error, reload } = useMarketing(ctx);
  const [filter, setFilter] = useState("all"),
    [receipt, setReceipt] = useState<any>(null);
  const active = data?.plans.find((p: any) => p.id === params.plan);
  const list = (data?.plans || []).filter(
    (p: any) => filter === "all" || p.stage === filter,
  );
  return (
    <div className="space-y-5">
      <DataState loading={!data} error={error} />
      {!detailsOnly && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{m("plans_desc")}</p>
        <MarketingImport data={data} onDone={reload} />
      </div>
      {data && !data.plans.length && <Notice>{m("plans_empty")}</Notice>}
      <AccountStrategies ctx={ctx} data={data} reload={reload} />
      {data && (
        <div className="overflow-x-auto">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: m("all") },
              ...stages
                .filter((s) => data.counts.stages[s])
                .map((s) => ({
                  value: s,
                  label: `${m("stage_" + s)} ${data.counts.stages[s]}`,
                })),
            ]}
          />
        </div>
      )}
      <div className="divide-y divide-border rounded-xl border border-border">
        {list.map((p: any) => (
          <button
            key={p.id}
            className="flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-muted/40"
            onClick={() => setParam("plan", p.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{p.title}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {p.content_id} · {tr("growth.platform_" + p.platform)} ·{" "}
                {p.role_name || m("account_unconfirmed")} ·{" "}
                {p.target_account?.name || m("unbound")}
                {p.article ? ` · ${m("draft_exists")}` : ""}
              </p>
            </div>
            <Badge tone={p.stage === "blocked" ? "warn" : "default"}>
              {m("stage_" + p.stage)}
            </Badge>
            <ArrowRight className="mt-1 size-4 shrink-0" />
          </button>
        ))}
      </div>
      </>}
      <Dialog
        open={!!active}
        onClose={() => setParam("plan", "")}
        title={active?.title || ""}
        width={900}
      >
        {active && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge>{active.content_id}</Badge>
              <Badge>{tr("growth.platform_" + active.platform)}</Badge>
              {contentEntry && workspace ? <ContentStatus entry={contentEntry} workspace={workspace} onChanged={() => { reload(); onChanged?.() }} /> : <Badge>{m("stage_" + active.stage)}</Badge>}
              <Badge>{active.role_name || m("account_unconfirmed")}</Badge>
            </div>
            <Notice>{m("historical_note")}</Notice>
            <div className="grid gap-4 sm:grid-cols-2">
              <Panel title={m("audience")}>
                <p className="text-sm">{active.audience || "—"}</p>
              </Panel>
              <Panel title={m("proof")}>
                <p className="whitespace-pre-line text-sm">
                  {active.proof || m("proof_missing")}
                </p>
              </Panel>
            </div>
            {active.notes && (
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {active.notes}
              </p>
            )}
            {active.body && (
              <Field label={m("source_body")}>
                <textarea
                  className={inputCls}
                  aria-label={m("source_body")}
                  value={active.body}
                  readOnly
                  rows={8}
                />
              </Field>
            )}
            {active.media.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {active.media.map((a: any, i: number) => (
                  <div key={a.url + i}>
                    {a.kind === "video" ? (
                      <video
                        className="aspect-[3/4] w-full rounded-lg bg-muted object-contain"
                        src={a.url}
                        controls
                        preload="none"
                      />
                    ) : (
                      <img
                        className="aspect-[3/4] w-full rounded-lg bg-muted object-contain"
                        src={a.url}
                        alt={a.name || active.title}
                        loading="lazy"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            <Panel title={m("cta")}>
              <p className="text-sm">{active.cta || "—"}</p>
              {active.tracking_url && (
                <a
                  className="mt-2 block break-all text-xs text-primary-text"
                  href={active.tracking_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {active.tracking_url}
                </a>
              )}
            </Panel>
            {active.legacy_publication && (
              <Panel title={m("legacy_receipt")}>
                <p className="text-xs text-muted-foreground">
                  {m("legacy_receipt_note")}
                </p>
                {active.legacy_publication.url && (
                  <a
                    className="mt-2 block break-all text-xs text-primary-text"
                    target="_blank"
                    rel="noreferrer"
                    href={active.legacy_publication.url}
                  >
                    {active.legacy_publication.url}
                  </a>
                )}
                <div className="mt-3 flex flex-wrap gap-4">
                  {Object.entries(active.legacy_publication.metrics || {})
                    .filter(([, v]) => v != null)
                    .map(([k, v]) => (
                      <span className="text-xs" key={k}>
                        {m("metric_" + k)}：{String(v)}
                      </span>
                    ))}
                </div>
              </Panel>
            )}
            {active.receipt && <Panel title={tr('workspace.verified_receipt')}>
              <p className="text-sm">{m('actual_account')}：{[...(data.accounts || []), ...(data.site_accounts || [])].find((a: any) => a.id === active.receipt.account_id)?.name || tr('content.removed_channel')}</p>
              <a href={active.receipt.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-primary-text">{active.receipt.url}</a>
              <p className="mt-2 text-xs text-muted-foreground">{m('published_time')}：{new Date(active.receipt.published_at).toLocaleString(undefined, { timeZone: 'Asia/Shanghai' })}</p>
            </Panel>}
            {!!contentEntry?.publicationUrls.length && <Panel title={tr('article.records')}><PublicationLinks urls={contentEntry.publicationUrls} /></Panel>}
            <div className="flex flex-wrap items-center gap-2">
              {active.article ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    ctx.go("content", { article: active.article.id })
                  }
                >
                  {m("open_draft")}
                </Button>
              ) : (
                <>
                  <TaskTools
                    task="write-article"
                    label="write_draft"
                    beforeRun={() =>
                      runLocal("marketing.prepareTopic", { plan_id: active.id })
                    }
                    onFinished={reload}
                  />
                  {active.body && (
                    <Button
                      fn="marketing.importDraft"
                      variant="outline"
                      onClick={async () => {
                        const r: any = await runLocal("marketing.importDraft", {
                          plan_id: active.id,
                        });
                        ctx.go("content", { article: r.article_id });
                      }}
                    >
                      {m("import_draft")}
                    </Button>
                  )}
                </>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  setReceipt({
                    plan_id: active.id,
                    account_id: active.target_account?.id || "",
                    url: active.legacy_publication?.url || "",
                    published_at: "",
                  })
                }
              >
                {m("confirm_receipt")}
              </Button>
            </div>
            {!active.target_account && active.platform !== "website" && (
              <Notice>{m("account_note")}</Notice>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title={m("confirm_receipt")}
        footer={
          <Button
            fn="marketing.confirmReceipt"
            onClick={async () => {
              await runLocal("marketing.confirmReceipt", {
                ...receipt,
                published_at: receipt.published_at
                  ? new Date(receipt.published_at + "+08:00").toISOString()
                  : "",
              });
              setReceipt(null);
              reload();
            }}
          >
            {m("save_receipt")}
          </Button>
        }
      >
        {receipt && (
          <div className="space-y-4">
            <Notice>{m("receipt_note")}</Notice>
            <Field label={m("actual_account")}>
              <Select
                ariaLabel={m("actual_account")}
                value={receipt.account_id}
                options={(active?.platform === "website"
                  ? data?.site_accounts || []
                  : (data?.accounts || []).filter(
                      (a: any) => a.type === active?.platform,
                    )
                ).map((a: any) => ({ value: a.id, label: a.name }))}
                onChange={(v) => setReceipt({ ...receipt, account_id: v })}
              />
            </Field>
            <Field label={m("published_url")}>
              <input
                className={inputCls}
                aria-label={m("published_url")}
                value={receipt.url}
                onChange={(e) =>
                  setReceipt({ ...receipt, url: e.target.value })
                }
              />
            </Field>
            <Field label={m("published_time")}>
              <input
                type="datetime-local"
                className={inputCls}
                aria-label={m("published_time")}
                value={receipt.published_at}
                onChange={(e) =>
                  setReceipt({ ...receipt, published_at: e.target.value })
                }
              />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
export function SeoMap({
  ctx,
  params,
}: {
  ctx: Ctx;
  params: Record<string, string>;
}) {
  const { data, error, reload } = useMarketing(ctx);
  const [selected, setSelected] = useState(params.target || ""),
    [language, setLanguage] = useState("all");
  const list = (data?.seo_targets || []).filter(
    (s: any) => language === "all" || s.language === language,
  );
  const active = data?.seo_targets.find((s: any) => s.id === selected);
  const grouped: any[] = [];
  for (const s of list) {
    let group = grouped.find(
      (g) => g.url === s.primary_url && g.language === s.language,
    );
    if (!group) {
      group = { url: s.primary_url, language: s.language, items: [] };
      grouped.push(group);
    }
    group.items.push(s);
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{m("seo_desc")}</p>
        <MarketingImport data={data} onDone={reload} />
      </div>
      <DataState loading={!data} error={error} />
      <div className="flex flex-wrap gap-3">
        <Select
          ariaLabel={m("language")}
          value={language}
          options={[
            { value: "all", label: m("all_languages") },
            { value: "zh", label: m("zh") },
            { value: "en", label: m("en") },
          ]}
          onChange={setLanguage}
        />
        <Badge>{m("keyword_count", { n: data ? list.length : "—" })}</Badge>
        <Badge>{m("page_count", { n: data ? grouped.length : "—" })}</Badge>
      </div>
      {data && !list.length && <Notice>{m("seo_empty")}</Notice>}
      <div className="grid gap-3 lg:grid-cols-2">
        {grouped.map((group) => (
          <Panel
            key={group.language + group.url}
            title={
              <a
                href={group.url}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm"
              >
                {group.url.replace(/^https?:\/\//, "")}{" "}
                <ExternalLink className="inline size-3" />
              </a>
            }
            aside={<Badge>{group.language}</Badge>}
          >
            <div className="flex flex-wrap gap-2">
              {group.items.map((s: any) => (
                <button
                  key={s.id}
                  className="rounded-md border border-border px-2 py-1 text-left text-xs hover:bg-muted"
                  onClick={() => setSelected(s.id)}
                >
                  {s.keyword}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {group.items[0].search_page
                ? m("search_available")
                : m("search_unknown")}
            </p>
          </Panel>
        ))}
      </div>
      <Dialog
        open={!!active}
        onClose={() => setSelected("")}
        title={active?.keyword || ""}
        width={800}
      >
        {active && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge>{active.intent}</Badge>
              <Badge>{active.priority}</Badge>
              <Badge>{active.language}</Badge>
            </div>
            <Panel title={m("primary_page")}>
              <a
                href={active.primary_url}
                className="break-all text-sm text-primary-text"
                target="_blank"
                rel="noreferrer"
              >
                {active.primary_url}
              </a>
            </Panel>
            <p className="text-sm">{active.next_action}</p>
            <Panel title={m("supporting")}>
              <p className="text-sm">{active.supporting}</p>
            </Panel>
            <Notice>
              {m("difficulty_note", {
                n: active.serp_difficulty || "—",
                date: active.checked_at || "—",
              })}
            </Notice>
            {active.search_page && (
              <p className="text-xs text-muted-foreground">
                {m("search_period", {
                  start: active.search_page.period_start || "—",
                  end: active.search_page.period_end || "—",
                  synced: active.search_page.synced_at
                    ? new Date(active.search_page.synced_at).toLocaleString(
                        "zh-CN",
                        { timeZone: "Asia/Shanghai" },
                      )
                    : "—",
                })}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {["impressions", "clicks", "ctr", "position"].map((k) => (
                <MetricCard
                  key={k}
                  label={m("metric_" + k)}
                  value={
                    k === "ctr" && active.search_page?.ctr != null
                      ? active.search_page.ctr * 100
                      : active.search_page?.[k]
                  }
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {m("page_metrics_note")}
            </p>
            <TaskTools
              task="seo-page-plan"
              label="plan_page"
              beforeRun={() =>
                runLocal("marketing.prepareOpportunity", {
                  target_id: active.id,
                })
              }
              onFinished={reload}
            />
            <Button variant="outline" onClick={() => ctx.go("search")}>
              {m("view_search")}
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
export function GrowthOverview({ ctx }: { ctx: Ctx }) {
  const { data, error, reload } = useProductData<ContentData>('content-workspace.context', {}, ctx.rev);
  const entries = data ? contentEntries(data) : [];
  const due = (workspace: ContentWorkspace) => data?.reviews.filter((r: any) => r.status === 'pending' && r.due_at <= new Date().toISOString() && reviewWorkspace(r, data) === workspace).length;
  const cw = (key: string, vars?: Record<string, unknown>) => tr('workspace.' + key, vars);
  const actions: any[] = [];
  for (const item of ctx.checklist.data?.daily || [])
    if (item.key === "d_issues")
      actions.push({
        key: item.key,
        title: item.title,
        why: item.why,
        view: "audit",
        extra: {},
        label: item.action_label,
      });
  for (const workspace of ['website', 'social'] as const) if (due(workspace))
    actions.push({
      key: "reviews:" + workspace,
      title: cw(workspace + '_reviews'),
      why: m("review_rule"),
      view: workspace === 'website' ? 'metrics' : 'social-metrics',
      extra: {},
      label: m("record_review"),
    });
  for (const r of data?.roles || [])
    if (!r.account)
      actions.push({
        key: "role:" + r.id,
        title: m("bind_role", { name: r.name }),
        why: r.purpose,
        view: "social",
        extra: {},
        label: m("bind_account"),
      });
  for (const p of data?.plans || [])
    if (p.stage === "blocked")
      actions.push({
        key: p.id,
        title: p.title,
        why: p.notes,
        view: (p.workspace || platformWorkspace(p.platform)) === 'website' ? 'website-content' : 'social-content',
        extra: { plan: p.id },
        label: m("handle_blocker"),
      });
  for (const p of data?.plans || [])
    if (p.stage === "reported_published" && !p.receipt)
      actions.push({
        key: p.id,
        title: p.title,
        why: m("receipt_missing"),
        view: (p.workspace || platformWorkspace(p.platform)) === 'website' ? 'website-content' : 'social-content',
        extra: { plan: p.id },
        label: m("confirm_receipt"),
      });
  if (data?.seo_targets.length)
    actions.push({
      key: "seo",
      title: m("advance_seo"),
      why: m("advance_seo_why"),
      view: "opportunities",
      extra: {},
      label: m("view_map"),
    });
  return (
    <div className="space-y-4">
      <Panel
        title={m("today_title")}
        aside={<MarketingImport data={data} onDone={reload} />}
      >
        <DataState loading={!data} error={error} />
        {data && !actions.length && (
          <p className="text-sm text-muted-foreground">{m("today_empty")}</p>
        )}
        <div className="divide-y divide-border">
          {actions.slice(0, 3).map((a) => (
            <div className="flex flex-wrap items-center gap-3 py-3" key={a.key}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{a.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{a.why}</p>
              </div>
              <Button variant="outline" onClick={() => ctx.go(a.view, a.extra)}>
                {a.label}
                <ArrowRight />
              </Button>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
      <Panel title={cw('website_ops')}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard
          label={m("seo_targets")}
          value={data?.counts.seo}
          onClick={() => ctx.go("opportunities", { tab: "map" })}
        />
        <MetricCard
          label={cw('website_content')}
          value={data ? entries.filter(e => e.workspaces.includes('website')).length : undefined}
          onClick={() => ctx.go("website-content")}
        />
        <MetricCard label={m('due_reviews')} value={due('website')} onClick={() => ctx.go('metrics')} />
      </div>
      </Panel>
      <Panel title={cw('social_ops')}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard label={cw('social_content')} value={data ? entries.filter(e => e.workspaces.includes('social')).length : undefined} onClick={() => ctx.go('social-content')}
        />
        <MetricCard
          label={m("account_gaps")}
          value={data?.counts.account_gaps}
          onClick={() => ctx.go("social")}
        />
        <MetricCard
          label={m("due_reviews")}
          value={due('social')}
          onClick={() => ctx.go("social-metrics")}
        />
      </div>
      </Panel>
      </div>
      {!!entries.filter(e => !e.workspaces.length).length && <Button variant="ghost" onClick={() => ctx.go('social-content', { ownership: 'unassigned' })}>{cw('unassigned_count', { n: entries.filter(e => !e.workspaces.length).length })}</Button>}
    </div>
  );
}
export function GrowthReviews({ ctx, workspace }: { ctx: Ctx; workspace?: ContentWorkspace }) {
  const { data: original, error, reload } = useMarketing(ctx);
  const data = original && workspace ? { ...original,
    plans: original.plans.filter((p: any) => (p.workspace || platformWorkspace(p.platform)) === workspace),
    reviews: original.reviews.filter((r: any) => !reviewWorkspace(r, original) || reviewWorkspace(r, original) === workspace),
  } : original;
  const [edit, setEdit] = useState<any>(null);
  const pipeline = data
    ? [
        data.plans.length,
        data.plans.filter((p: any) => p.topic_id).length,
        data.plans.filter((p: any) => p.article).length,
        data.plans.filter((p: any) => p.receipt).length,
        data.reviews.filter((r: any) => r.status === "done").length,
      ]
    : [];
  const labels = [
    "pipeline_plan",
    "pipeline_topic",
    "pipeline_draft",
    "pipeline_receipt",
    "pipeline_review",
  ];
  return (
    <div className="space-y-4">
      <Panel
        title={m("pipeline")}
        aside={
          <Button
            fn="marketing.planReviews"
            variant="outline"
            onClick={async () => {
              await runLocal("marketing.planReviews", {});
              reload();
            }}
          >
            {m("refresh_reviews")}
          </Button>
        }
      >
        <DataState loading={!data} error={error} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {labels.map((key, i) => (
            <div key={key}>
              <span className="text-xs text-muted-foreground">{m(key)}</span>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {pipeline[i] ?? "—"}
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: Math.max(...pipeline, 0)
                      ? `${((pipeline[i] || 0) / Math.max(...pipeline)) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {m("pipeline_note")}
        </p>
      </Panel>
      <Panel title={m("review_queue")}>
        <p className="mb-3 text-xs text-muted-foreground">{m("review_rule")}</p>
        {data && !data.reviews.length && <Notice>{m("review_empty")}</Notice>}
        <div className="divide-y divide-border">
          {data?.reviews.map((r: any) => (
            <div className="flex flex-wrap items-center gap-3 py-3" key={r.id}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.offset_hours < 168
                    ? `${r.offset_hours}h`
                    : `${r.offset_hours / 24}d`}{" "}
                  ·{" "}
                  {new Date(r.due_at).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}
                </p>
              </div>
              <Badge tone={r.status === "done" ? "ok" : "default"}>
                {r.status === "done" ? m("review_done") : m("review_pending")}
              </Badge>
              {workspace && !reviewWorkspace(r, original) && <Badge tone="warn">{tr('workspace.unassigned')}</Badge>}
              <Button
                variant="outline"
                onClick={() => {
                  let saved: any = {};
                  try {
                    saved = JSON.parse(r.result || "{}");
                  } catch {}
                  setEdit({
                    id: r.id,
                    note: saved.note || "",
                    provenance: saved.provenance || "",
                    metrics: saved.metrics || {},
                    views: saved.metrics?.views ?? "",
                    likes: saved.metrics?.likes ?? "",
                    clicks: saved.metrics?.clicks ?? "",
                  });
                }}
              >
                {m("record_review")}
              </Button>
            </div>
          ))}
        </div>
      </Panel>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={m("record_review")}
        footer={
          <Button
            fn="marketing.saveReview"
            onClick={async () => {
              await runLocal("marketing.saveReview", {
                ...edit,
                observed_at: new Date().toISOString(),
                metrics: {
                  ...edit.metrics,
                  views: edit.views,
                  likes: edit.likes,
                  clicks: edit.clicks,
                },
              });
              setEdit(null);
              reload();
            }}
          >
            {m("save")}
          </Button>
        }
      >
        {edit && (
          <div className="space-y-3">
            {["views", "likes", "clicks", "provenance", "note"].map((k) => (
              <Field
                key={k}
                label={m(
                  k === "provenance" || k === "note" ? k : "metric_" + k,
                )}
              >
                <input
                  className={inputCls}
                  type={
                    ["views", "likes", "clicks"].includes(k) ? "number" : "text"
                  }
                  aria-label={m(
                    k === "provenance" || k === "note" ? k : "metric_" + k,
                  )}
                  value={edit[k]}
                  onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}
