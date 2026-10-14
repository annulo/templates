import { useState } from "react";
import { Download, Upload } from "lucide-react";
import {
  Button,
  Dialog,
  Field,
  Notice,
  PageHeader,
  Panel,
  RangeToggle,
  inputCls,
} from "../ui";
import {
  Choice,
  DataState,
  Empty,
  g,
  MetricCard,
  useProductData,
} from "../ProductFields";
import TrendChart from "../charts/TrendChart";
import { runLocal, type Campaign } from "../../lib/shuttle";
import type { Ctx } from "./types";
import { GrowthReviews } from "../MarketingWorkspace";
type Summary = {
  start: string;
  end: string;
  has_data: boolean;
  note: string;
  totals: any;
  sources: any[];
  daily: any[];
  campaigns: Campaign[];
};
const keys = ["visits", "signups", "activations", "payments"] as const;
export default function ProductMetrics({
  ctx,
  params,
  setParam,
}: {
  ctx: Ctx;
  params: Record<string, string>;
  setParam: (k: string, v: string) => void;
}) {
  const [days, setDays] = useState(30),
    [open, setOpen] = useState(false),
    [csv, setCsv] = useState(""),
    [saveError, setSaveError] = useState(""),
    [importNote, setImportNote] = useState("");
  const { data, error, reload } = useProductData<Summary>(
    "metrics.context",
    { days, campaign_id: params.campaign || "" },
    ctx.rev,
  );
  const download = () => {
    const text =
      "date,source,campaign_id,visits,signups,activations,payments,provenance\n";
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const address = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = address;
    a.download = "product-metrics.csv";
    a.click();
    URL.revokeObjectURL(address);
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title={g("metrics_title")}
        desc={g("metrics_desc")}
        actions={
          <>
            <Button variant="outline" onClick={download}>
              <Download />
              {g("download_csv")}
            </Button>
            <Button
              onClick={() => {
                setSaveError("");
                setOpen(true);
              }}
            >
              <Upload />
              {g("import_csv")}
            </Button>
          </>
        }
      />
      <GrowthReviews ctx={ctx} workspace="website" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Choice
          name="campaign_id"
          value={params.campaign || ""}
          onChange={(v) => setParam("campaign", v)}
          options={[
            { value: "", label: g("all_campaigns") },
            ...(data?.campaigns || []).map((c) => ({
              value: c.id,
              label: c.title,
            })),
          ]}
        />
        <RangeToggle
          value={days}
          onChange={setDays}
          options={[7, 30, 90].map((v) => ({
            value: v,
            label: g("last_days", { n: v }),
          }))}
        />
      </div>
      {importNote && <Notice>{importNote}</Notice>}
      <DataState loading={!data} error={error} />
      {data && (
        <>
          <Notice>{data.note}</Notice>
          {!ctx.profile.activation_event && (
            <Notice>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{g("define_events")}</span>
                <Button variant="outline" onClick={() => ctx.go("company")}>
                  {g("define_goal")}
                </Button>
              </div>
            </Notice>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {keys.map((k) => (
              <MetricCard
                key={k}
                label={g("metric_" + k)}
                value={data.totals[k]}
              />
            ))}
          </div>
          {!data.has_data ? (
            <Empty text="metrics_empty" />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {data.start} — {data.end} · {g("coverage_note")}
              </p>
              <Panel title={g("metric_signups")}>
                <TrendChart
                  days={data.daily
                    .filter((d) => d.signups != null)
                    .map((d) => d.date)}
                  series={[
                    {
                      name: g("metric_signups"),
                      values: data.daily
                        .filter((d) => d.signups != null)
                        .map((d) => d.signups),
                      color: "var(--series-1)",
                    },
                  ]}
                />
              </Panel>
              <Panel title={g("by_source")}>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2">{g("field_source")}</th>
                        {keys.map((k) => (
                          <th key={k} className="px-3 py-2 text-right">
                            {g("metric_" + k)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.sources.map((s) => (
                        <tr key={s.source} className="border-t border-border">
                          <td className="py-3">{s.source}</td>
                          {keys.map((k) => (
                            <td
                              key={k}
                              className="px-3 py-3 text-right tabular-nums"
                            >
                              {s[k] == null ? "—" : s[k].toLocaleString()}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
        </>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={g("import_csv")}
        width={800}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {g("cancel")}
            </Button>
            <Button
              fn="metrics.importDaily"
              disabled={!csv.trim()}
              onClick={async () => {
                try {
                  const r = await runLocal<{
                    created: number;
                    updated: number;
                  }>("metrics.importDaily", { csv });
                  setImportNote(
                    g("import_result", {
                      created: r.created,
                      updated: r.updated,
                    }),
                  );
                  setOpen(false);
                  setCsv("");
                  reload();
                } catch (e) {
                  setSaveError((e as Error).message);
                  return false;
                }
              }}
            >
              {g("import")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {saveError && <Notice tone="error">{saveError}</Notice>}
          <p className="text-sm text-muted-foreground">{g("csv_hint")}</p>
          <Field label={g("csv_file")}>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label={g("csv_file")}
              className={inputCls}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  if (f.size > 2_000_000) {
                    setSaveError(g("csv_too_large"));
                    return;
                  }
                  setCsv(await f.text());
                }
              }}
            />
          </Field>
          <Field label={g("csv_text")}>
            <textarea
              aria-label={g("csv_text")}
              rows={12}
              className={`${inputCls} font-mono text-xs`}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder="date,source,campaign_id,visits,signups,activations,payments,provenance"
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
