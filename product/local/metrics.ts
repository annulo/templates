import { L } from "./_i18n";
import { all, date, row } from "./_growth";
export const cloud = ["importDaily", "summary", "context"];
const keys = ["visits", "signups", "activations", "payments"] as const;
const day = (ms: number) =>
  new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
function range(input: any, ctx: any) {
  const days = Math.max(
    1,
    Math.min(365, Math.floor(Number(input?.days) || 30)),
  );
  const end = date(ctx, input?.end || day(Date.now()));
  const start = date(
    ctx,
    input?.start ||
      day(Date.parse(end + "T00:00:00+08:00") - (days - 1) * 86400_000),
  );
  if (start > end)
    throw new Error(
      L(
        ctx,
        "开始日期不能晚于结束日期",
        "The start date must precede the end date.",
      ),
    );
  const span =
    Math.round((Date.parse(end) - Date.parse(start)) / 86400_000) + 1;
  if (span > 366)
    throw new Error(
      L(ctx, "每次最多查看一年数据", "View at most one year at a time."),
    );
  return { start, end, span };
}
// RFC 4180-style CSV, including escaped quotes and newlines inside quoted cells.
export function parseCSV(value: string) {
  const rows: string[][] = [];
  let cells: string[] = [],
    cell = "",
    quoted = false;
  const csv = value.replace(/^\uFEFF/, "");
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell) throw new Error("Unexpected quote in CSV");
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      cells.push(cell);
      if (cells.some((v) => v.trim())) rows.push(cells);
      cells = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  cells.push(cell);
  if (cells.some((v) => v.trim())) rows.push(cells);
  if (!rows.length) throw new Error("Empty CSV");
  const header = rows.shift()!.map((s) => s.trim());
  if (new Set(header).size !== header.length)
    throw new Error("Duplicate CSV columns");
  if (!["date", "source", "provenance"].every((k) => header.includes(k)))
    throw new Error("CSV requires date, source and provenance");
  const allowed = ["date", "source", "campaign_id", "provenance", ...keys];
  if (header.some((h) => !allowed.includes(h)))
    throw new Error("Unknown CSV column");
  return rows.map((r, i) => {
    if (r.length !== header.length)
      throw new Error(`CSV row ${i + 2} has the wrong number of columns`);
    return Object.fromEntries(header.map((h, j) => [h, r[j].trim()]));
  });
}
const keyOf = (r: any) =>
  JSON.stringify([r.date, r.source, r.campaign_id || ""]);
export function importDaily(input: { rows?: any[]; csv?: string }, ctx: any) {
  let incoming: any[];
  try {
    incoming =
      input?.csv !== undefined ? parseCSV(input.csv) : input?.rows || [];
  } catch (e) {
    throw new Error(
      L(ctx, "CSV 格式有误：", "Invalid CSV: ") + (e as Error).message,
    );
  }
  if (!Array.isArray(incoming) || !incoming.length || incoming.length > 1000)
    throw new Error(
      L(ctx, "每次导入 1–1000 行日数据", "Import 1–1000 daily rows at a time."),
    );
  const seen = new Set<string>();
  // Validate the entire batch before writing any row. A retry replaces the same daily source/campaign snapshot.
  const cleaned = incoming.map((r) => {
    const p: any = {
      date: date(ctx, r.date),
      source: String(r.source || "")
        .trim()
        .toLowerCase(),
      campaign_id: String(r.campaign_id || "").trim(),
      provenance: String(r.provenance || "").trim(),
      imported_at: new Date().toISOString(),
    };
    if (!p.date || !p.source || !p.provenance)
      throw new Error(
        L(
          ctx,
          "每行都要有日期、来源和数据出处",
          "Every row needs a date, source and provenance.",
        ),
      );
    if (p.campaign_id) row(ctx, "campaigns", p.campaign_id);
    let known = 0;
    for (const k of keys) {
      const missing = r[k] === "" || r[k] === undefined || r[k] === null;
      const n = missing ? null : Number(r[k]);
      if (n !== null && (!Number.isSafeInteger(n) || n < 0))
        throw new Error(
          L(
            ctx,
            "转化次数必须是非负整数；没有数据请留空",
            "Counts must be nonnegative integers; leave missing data blank.",
          ),
        );
      p[k] = n;
      p[k + "_rows"] = missing ? 0 : 1;
      if (!missing) known++;
    }
    if (!known)
      throw new Error(
        L(
          ctx,
          "每行至少提供一个真实指标",
          "Provide at least one measured metric per row.",
        ),
      );
    const key = keyOf(p);
    if (seen.has(key))
      throw new Error(
        L(
          ctx,
          "同一批次有重复的日期、来源和运营主题",
          "The batch contains duplicate date/source/campaign rows.",
        ),
      );
    seen.add(key);
    return p;
  });
  const existing = new Map(
    all(ctx, "product_metrics_daily").map((r) => [keyOf(r), r]),
  );
  let created = 0,
    updated = 0;
  for (const p of cleaned) {
    const old = existing.get(keyOf(p));
    if (old) {
      ctx.db.update("product_metrics_daily", old.id, p);
      updated++;
    } else {
      ctx.db.insert("product_metrics_daily", p);
      created++;
    }
  }
  return { created, updated };
}
export function summary(
  input: { days?: number; start?: string; end?: string; campaign_id?: string },
  ctx: any,
) {
  const { start, end, span } = range(input, ctx);
  if (input?.campaign_id) row(ctx, "campaigns", input.campaign_id);
  const filter: any = [{ field: "date", op: "between", value: [start, end] }];
  if (input?.campaign_id)
    filter.push({ field: "campaign_id", op: "eq", value: input.campaign_id });
  const metrics = [
    ...keys.map((k) => ({ op: "sum", field: k, as: k })),
    ...keys.map((k) => ({ op: "sum", field: k + "_rows", as: k + "_rows" })),
    { op: "count", as: "rows" },
  ];
  const aggregate = (group_by: any[]) => {
    const res = ctx.db.aggregate("product_metrics_daily", {
      filter,
      group_by,
      metrics,
      limit: 10000,
      timezone: "Asia/Shanghai",
    });
    if (res.truncated)
      throw new Error(
        L(
          ctx,
          "数据超出统计上限，请缩小日期范围",
          "The result is too large. Shorten the date range.",
        ),
      );
    return res.list || [];
  };
  const clean = (r: any) => ({
    ...r,
    ...Object.fromEntries(
      keys.map((k) => [
        k,
        Number(r[k + "_rows"]) > 0 ? Number(r[k]) || 0 : null,
      ]),
    ),
  });
  const totals = clean(aggregate([])[0] || {});
  const sources = aggregate(["source"]).map(clean);
  const daily = aggregate(["date"])
    .map(clean)
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
  return {
    start,
    end,
    days: span,
    has_data: Number(totals.rows) > 0,
    totals,
    sources,
    daily,
    note: L(
      ctx,
      "访问按会话、注册/激活/付费按事件次数统计；跨天相加不代表去重用户。空白表示未采集。同日同来源同主题重复导入会替换。主题明细应互斥，避免把渠道合计与主题明细重复导入。",
      "Visits are sessions; signups, activations and payments are event counts, not distinct users across days. Blank means unmeasured. Reimporting a daily source/campaign replaces its snapshot. Campaign breakdowns must be mutually exclusive; do not also import their channel total.",
    ),
  };
}
export function context(
  input: { days?: number; campaign_id?: string },
  ctx: any,
) {
  return {
    ...summary(input, ctx),
    campaigns: all(ctx, "campaigns").map((c) => ({ id: c.id, title: c.title })),
    schema: {
      columns: [
        "date",
        "source",
        "campaign_id",
        "visits",
        "signups",
        "activations",
        "payments",
        "provenance",
      ],
      missing: "blank",
      timezone: "Asia/Shanghai",
    },
  };
}
