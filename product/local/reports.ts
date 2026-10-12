import { L } from "./_i18n";
import { stats } from "./channels";
import { summary as searchSummary } from "./gsc";
import { summary as metricSummary } from "./metrics";
import { all, date } from "./_growth";
export const cloud = ["save"];
export const remote = ["data"];
const day = (n: number) =>
  new Date(n + 8 * 3600_000).toISOString().slice(0, 10);
export async function data(input: { days?: number }, ctx: any) {
  const days = Math.max(1, Math.min(90, Math.floor(Number(input?.days) || 7)));
  const end = day(Date.now()),
    start = day(Date.now() - (days - 1) * 86400_000);
  const prevEnd = day(Date.parse(start + "T00:00:00+08:00") - 86400_000),
    prevStart = day(Date.parse(start + "T00:00:00+08:00") - days * 86400_000);
  let channels: any, search: any;
  try {
    channels = await stats({ days }, ctx);
  } catch (e) {
    channels = { error: (e as Error).message };
  }
  try {
    search = {
      ...searchSummary({}, ctx),
      note: L(
        ctx,
        "搜索数据按其原始日期窗口统计，不能直接当作本周结果。",
        "Search data uses its own date window; it is not automatically this week’s result.",
      ),
    };
  } catch (e) {
    search = { error: (e as Error).message };
  }
  const publications = all(ctx, "publications"),
    posts = all(ctx, "social_posts");
  const inPeriod = (s: string) =>
    s?.slice(0, 10) >= start && s?.slice(0, 10) <= end;
  return {
    period_start: start,
    period_end: end,
    days,
    channels,
    search,
    conversion: metricSummary({ start, end }, ctx),
    previous_conversion: metricSummary({ start: prevStart, end: prevEnd }, ctx),
    profile: all(ctx, "profile")[0] || {},
    opportunities: all(ctx, "growth_opportunities"),
    campaigns: all(ctx, "campaigns"),
    content: {
      website: publications.filter(
        (p) => p.status === "published" && inPeriod(p.published_at),
      ),
      social: posts.filter(
        (p) => p.status === "published" && inPeriod(p.published_at),
      ),
    },
    previous_report:
      all(ctx, "reports")
        .filter((r) => r.period_end < start)
        .sort((a, b) => b.period_end.localeCompare(a.period_end))[0] || null,
  };
}
export function save(input: any, ctx: any) {
  const period_start = date(ctx, input.period_start),
    period_end = date(ctx, input.period_end);
  if (
    !period_start ||
    !period_end ||
    period_start > period_end ||
    !String(input.title || "").trim() ||
    !String(input.body || "").trim()
  )
    throw new Error(
      L(
        ctx,
        "请提供有效周期、标题和总结正文",
        "Provide a valid period, title and report body.",
      ),
    );
  const patch: any = {
    period_start,
    period_end,
    title: String(input.title).trim(),
    summary: String(input.summary || "").trim(),
    body: String(input.body),
    highlights: JSON.stringify(input.highlights || []),
    suggestions: JSON.stringify(input.suggestions || []),
    chat_id: ctx.chat_id || "",
    updated_at: new Date().toISOString(),
  };
  const old = ctx.db.query("reports", {
    where: { period_start, period_end },
    limit: 1,
  }).list[0];
  if (old) {
    ctx.db.update("reports", old.id, patch);
    return { id: old.id, updated: true };
  }
  return ctx.db.insert("reports", { ...patch, created_at: patch.updated_at });
}
