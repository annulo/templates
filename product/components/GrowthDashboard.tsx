import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import TrendChart from "./charts/TrendChart";
import BreakdownTable from "./BreakdownTable";
import { Button, Notice, Panel, Segmented, Skeleton, cx } from "./ui";
import {
  dbList,
  isSite,
  runLocal,
  visitOverview,
  ShuttleUnavailable,
  type Channel,
  type KeyRow,
  type SocialDaily,
} from "../lib/shuttle";
import { isSocial } from "../lib/social";
import { CHANNEL_TYPES } from "../lib/channels";
import { fmtNum } from "../lib/format";
import { tr } from "../lib/i18n";
import type { Ctx } from "./views/types";

const d = (key: string, vars?: Record<string, unknown>) => tr("dash." + key, vars);
const INTERACT = ["likes", "comments", "collects", "shares"] as const;
type Metric = "views" | (typeof INTERACT)[number];

/** 本机时区的日期 YYYY-MM-DD（和社媒采集时记的日期一致） */
function localDay(t: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}
const compact = (day: string) => day.replace(/-/g, "");

/**
 * 首页的数据看板：所有 creght 网站的访问加起来、所有社媒账号的数据加起来，同一个时间段。
 * 网站数字和网站访问页（SiteOverview）一个算法；社媒数字用社媒插件的 social/stats.summary（和「数据表现」页、助手一致），
 * 每天的变化用 social_daily 相邻两次采集相减。
 */
export default function GrowthDashboard({ ctx, days }: { ctx: Ctx; days: number }) {
  const site = useSites(ctx.channels, days, ctx.go);
  const social = useSocial(ctx.channels, days, ctx.rev);
  const [metric, setMetric] = useState<"views" | "interactions" | "followers">("views");

  const socialLine = social.daily?.[metric];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={d("pv")} value={site.data?.pv} delta={site.data?.delta} spark={site.data?.trend.map((t) => t.pv)} loading={site.loading} onClick={() => ctx.go("site")} />
        <Kpi label={d("uv")} value={site.data?.uv} spark={site.data?.trend.map((t) => t.uv)} color="var(--series-2)" loading={site.loading} onClick={() => ctx.go("site")} />
        <Kpi label={d("views")} value={social.totals?.views} signed spark={social.daily?.views.values} loading={social.loading} onClick={() => ctx.go("social-metrics")} />
        <Kpi label={d("interactions")} value={social.totals?.interactions} signed spark={social.daily?.interactions.values} color="var(--series-2)" loading={social.loading} onClick={() => ctx.go("social-metrics")} />
        <Kpi label={d("followers")} value={social.totals?.followers} signed spark={social.daily?.followers.values} loading={social.loading} onClick={() => ctx.go("social-metrics")} />
        <Kpi label={d("published", { days })} value={social.totals?.published} loading={social.loading} onClick={() => ctx.go("social-content")} />
      </div>
      {social.partial && <p className="-mt-1.5 text-[11px] text-muted-foreground">{d("partial_note")}</p>}

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          title={d("site_daily", { n: days })}
          aside={site.data && <Legend items={[[tr("site.pv"), "bg-series-1"], [tr("site.uv"), "bg-series-2"]]} />}
        >
          {site.empty ?? (site.loading ? (
            <Skeleton className="h-[170px]" />
          ) : site.data && site.data.pv > 0 ? (
            <TrendChart
              height={170}
              days={site.data.trend.map((t) => t.day)}
              series={[
                { name: tr("site.pv"), color: "var(--series-1)", values: site.data.trend.map((t) => t.pv) },
                { name: tr("site.uv"), color: "var(--series-2)", values: site.data.trend.map((t) => t.uv) },
              ]}
            />
          ) : (
            <Empty>{tr("site.no_visits")}</Empty>
          ))}
        </Panel>
        <Panel
          title={d("social_daily", { n: days })}
          aside={social.accounts.length > 0 && (
            <Segmented
              value={metric}
              onChange={setMetric}
              options={[
                { value: "views", label: d("m_views") },
                { value: "interactions", label: d("m_interactions") },
                { value: "followers", label: d("m_followers") },
              ]}
            />
          )}
        >
          {social.accounts.length === 0 ? (
            <Empty action={<Button variant="outline" size="sm" onClick={() => ctx.go("social")}>{d("bind_social")}</Button>}>{d("no_social")}</Empty>
          ) : social.loading ? (
            <Skeleton className="h-[170px]" />
          ) : social.error ? (
            <Notice tone="error">{social.error}</Notice>
          ) : socialLine ? (
            <TrendChart
              height={170}
              days={socialLine.days}
              series={[{ name: d("line_" + metric), color: "var(--series-1)", values: socialLine.values }]}
            />
          ) : (
            <Empty>{tr("social_ov.daily_none")}</Empty>
          )}
        </Panel>
      </div>

      {/* 排行：网站来源、热门页面、各账号、表现最好的内容，两列铺开，没有的就不占位 */}
      <div className="grid gap-3 xl:grid-cols-2">
        {site.data && <BreakdownTable title={d("referrers")} keyLabel={tr("site.referrer_key")} rows={site.data.referrers.slice(0, 5)} empty={tr("site.referrer_empty")} />}
        <Accounts ctx={ctx} social={social} />
        {site.data && <BreakdownTable title={d("pages")} keyLabel={tr("site.page")} rows={site.data.pages.slice(0, 5)} format={site.data.multi ? (u) => u.replace(/^https?:\/\//, "") : (u) => u.replace(/^https?:\/\/[^/]+/, "") || "/"} />}
        {social.top.length > 0 && <TopPosts social={social} />}
      </div>
    </div>
  );
}

// ---- 网站：每个 creght 站点取一次，加起来 ----

type SiteData = {
  pv: number;
  uv: number;
  delta: number | null;
  trend: { day: string; pv: number; uv: number }[];
  referrers: KeyRow[];
  pages: KeyRow[];
  multi: boolean;
};

function useSites(channels: Channel[], days: number, go: Ctx["go"]) {
  const sites = channels.filter((c) => c.type === "creght_site" && c.project_id && c.site_id);
  const key = sites.map((c) => c.id).join(",");
  const [data, setData] = useState<SiteData | null>(null);
  const [error, setError] = useState<{ msg: string; offline: boolean } | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    if (!sites.length) return;
    const ids = sites.map((c) => `${c.project_id}/${c.site_id}`);
    Promise.all([Promise.all(ids.map((s) => visitOverview(s, days))), Promise.all(ids.map((s) => visitOverview(s, days * 2).catch(() => null)))])
      .then(([cur, prev]) => {
        const trend = new Map<string, { day: string; pv: number; uv: number }>();
        for (const o of cur)
          for (const r of o.trend ?? []) {
            const day = compact(r.day);
            const t = trend.get(day) ?? { day, pv: 0, uv: 0 };
            t.pv += r.pv_count;
            t.uv += r.uv_count;
            trend.set(day, t);
          }
        // 上一周期：2 倍时长的趋势里，前面那一段；有一个站取不到就不算涨跌
        const prevPV = prev.every(Boolean) ? prev.reduce((a, o) => a + (o!.trend ?? []).slice(0, Math.max(0, o!.trend.length - days)).reduce((s, r) => s + r.pv_count, 0), 0) : null;
        const pv = cur.reduce((a, o) => a + (o.summary?.pv_count ?? 0), 0);
        setData({
          pv,
          uv: cur.reduce((a, o) => a + (o.summary?.uv_count ?? 0), 0),
          // 上一周期不到 20 次时百分比没有意义（和 SiteOverview 一样）
          delta: prevPV === null || prevPV < 20 ? null : (pv - prevPV) / prevPV,
          trend: [...trend.values()].sort((a, b) => a.day.localeCompare(b.day)),
          referrers: merge(cur.map((o) => o.breakdowns.referrer_host)),
          pages: merge(cur.map((o) => o.breakdowns.url)),
          multi: ids.length > 1,
        });
      })
      .catch((e) => setError({ msg: e.message, offline: e instanceof ShuttleUnavailable }));
  }, [key, days]);

  let empty: ReactNode = null;
  if (!sites.length)
    empty = channels.some(isSite) ? (
      <Empty action={<Button variant="outline" size="sm" onClick={() => go("search", { tab: "ga4" })}>{tr("search.tab_ga4")}</Button>}>{tr("channels.wp_no_stats")}</Empty>
    ) : (
      <Empty action={<Button variant="outline" size="sm" onClick={() => go("channels")}>{d("add_site")}</Button>}>{d("no_site")}</Empty>
    );
  else if (error) empty = <Notice tone={error.offline ? "muted" : "error"}>{error.offline ? tr("site.offline") : error.msg}</Notice>;
  return { data, empty, loading: !!sites.length && !data && !error };
}

function merge(lists: (KeyRow[] | undefined)[]) {
  const m = new Map<string, KeyRow>();
  for (const list of lists)
    for (const r of list ?? []) {
      const t = m.get(r.key) ?? { key: r.key, pv_count: 0, uv_count: 0, ip_count: 0 };
      t.pv_count += r.pv_count;
      t.uv_count += r.uv_count;
      t.ip_count += r.ip_count;
      m.set(r.key, t);
    }
  return [...m.values()].sort((a, b) => b.pv_count - a.pv_count);
}

// ---- 社媒：每个账号一份 summary，加起来；每天的变化用 social_daily ----

type Summary = {
  has_base: boolean;
  published: number;
  followers: number | null;
  followers_gain: number | null;
  totals: Record<Metric, number | null>;
  unavailable_metrics?: Metric[];
  top: { id: string; title: string; post_url?: string; views: number; gain: Record<Metric, number> | null }[];
};
type Line = { days: string[]; values: number[] };
type Social = ReturnType<typeof useSocial>;

function useSocial(channels: Channel[], days: number, rev: number) {
  const accounts = channels.filter(isSocial);
  const key = accounts.map((c) => c.id).join(",");
  const [sums, setSums] = useState<Record<string, Summary> | null>(null);
  const [rows, setRows] = useState<SocialDaily[] | null>(null);
  const [error, setError] = useState("");
  const start = localDay(new Date(Date.now() - (days - 1) * 86400_000));
  useEffect(() => {
    setSums(null);
    setError("");
    if (!accounts.length) return;
    Promise.all(accounts.map((c) => runLocal<Summary>("social/stats.summary", { channel_id: c.id, days, start }).then((s) => [c.id, s] as const)))
      .then((list) => setSums(Object.fromEntries(list)))
      .catch((e) => setError(e.message));
  }, [key, days, start, rev]);
  useEffect(() => {
    dbList("social_daily").then(setRows).catch(() => setRows([]));
  }, [rev]);

  const totals = useMemo(() => {
    if (!sums) return null;
    const list = Object.values(sums);
    const add = (f: (s: Summary) => number | null) => {
      const vs = list.map(f).filter((v): v is number => v != null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
    };
    const val = (s: Summary, k: Metric) => (s.unavailable_metrics?.includes(k) ? null : s.totals[k]);
    return {
      views: add((s) => val(s, "views")),
      interactions: add((s) => {
        const vs = INTERACT.map((k) => val(s, k)).filter((v): v is number => v != null);
        return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
      }),
      followers: add((s) => s.followers_gain),
      published: add((s) => s.published),
    };
  }, [sums]);

  // 每天比前一次采集涨了多少，所有账号加起来；只画有采集的日子（中间断了几天，那一次的增量算在断开后的第一天）
  const daily = useMemo(() => {
    if (!rows) return null;
    const ids = new Set(accounts.map((c) => c.id));
    const by = new Map<string, SocialDaily[]>();
    for (const r of rows) if (ids.has(r.channel_id)) by.set(r.channel_id, [...(by.get(r.channel_id) ?? []), r]);
    const acc = new Map<string, { views: number; interactions: number; followers: number }>();
    const diff = (a?: number, b?: number) => (a == null || b == null ? null : Number(a) - Number(b));
    for (const list of by.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < list.length; i++) {
        const [p, c] = [list[i - 1], list[i]];
        if (c.date < start) continue;
        const t = acc.get(c.date) ?? { views: 0, interactions: 0, followers: 0 };
        t.views += Math.max(0, diff(c.views, p.views) ?? 0);
        t.interactions += INTERACT.reduce((s, k) => s + Math.max(0, diff(c[k], p[k]) ?? 0), 0);
        t.followers += diff(c.followers, p.followers) ?? 0;
        acc.set(c.date, t);
      }
    }
    const dates = [...acc.keys()].sort();
    if (dates.length < 2) return null;
    const line = (k: "views" | "interactions" | "followers"): Line => ({ days: dates.map(compact), values: dates.map((x) => acc.get(x)![k]) });
    return { views: line("views"), interactions: line("interactions"), followers: line("followers") };
  }, [rows, key, start]);

  const top = useMemo(() => {
    if (!sums) return [];
    return accounts
      .flatMap((c) => (sums[c.id]?.top ?? []).map((p) => ({ ...p, channel: c, score: p.gain ? p.gain.views : p.views })))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [sums, key]);

  return {
    accounts,
    sums,
    totals,
    daily,
    top,
    error,
    loading: !!accounts.length && !sums && !error,
    partial: !!sums && Object.values(sums).some((s) => !s.has_base),
  };
}

function Accounts({ ctx, social }: { ctx: Ctx; social: Social }) {
  if (!social.accounts.length) return null;
  return (
    <Panel title={d("accounts")}>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">{d("account")}</th>
              <th className="w-20 px-3 py-2 text-right font-medium">{d("m_followers")}</th>
              <th className="w-24 px-3 py-2 text-right font-medium">{d("views")}</th>
              <th className="w-24 px-3 py-2 text-right font-medium">{d("interactions")}</th>
            </tr>
          </thead>
          <tbody>
            {social.accounts.map((c) => {
              const s = social.sums?.[c.id];
              const Icon = CHANNEL_TYPES[c.type]?.icon;
              const interactions = s ? INTERACT.reduce((a, k) => a + (s.totals[k] ?? 0), 0) : null;
              return (
                <tr key={c.id} className="cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40" onClick={() => ctx.go("social-metrics", { account: c.id })}>
                  <td className="px-3 py-1.5">
                    <span className="flex min-w-0 items-center gap-2">
                      {Icon && <Icon size={14} className="shrink-0" />}
                      <span className="truncate">{c.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s?.followers != null ? fmtNum(s.followers) : "—"}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{signed(s?.totals.views ?? null)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{signed(interactions)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TopPosts({ social }: { social: Social }) {
  return (
    <Panel title={d("top_posts")}>
      <div className="divide-y divide-border">
        {social.top.map((p) => {
          const Icon = CHANNEL_TYPES[p.channel.type]?.icon;
          const title = p.title || d("untitled");
          return (
            <div key={p.id} className="flex items-center gap-3 py-1.5 text-sm">
              {Icon && <Icon size={14} className="shrink-0" />}
              {p.post_url ? (
                <a href={p.post_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-primary-text">{title}</a>
              ) : (
                <span className="min-w-0 flex-1 truncate">{title}</span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {p.gain ? d("views_gain", { n: fmtNum(p.score) }) : d("views_total", { n: fmtNum(p.score) })}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ---- 小部件 ----

const signed = (v: number | null) => (v == null ? "—" : (v > 0 ? "+" : "") + fmtNum(v));

function Kpi({ label, value, delta, spark, color = "var(--series-1)", signed: sign, loading, onClick }: { label: string; value?: number | null; delta?: number | null; spark?: number[]; color?: string; signed?: boolean; loading?: boolean; onClick: () => void }) {
  const up = delta != null && delta > 0;
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/40">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-20" />
      ) : (
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-tight tabular-nums">{value == null ? "—" : sign ? signed(value) : fmtNum(value)}</span>
          {delta != null && Number.isFinite(delta) && delta !== 0 && (
            <span className={cx("inline-flex items-center text-xs font-medium tabular-nums", up ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
              {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {Math.abs(delta * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <Spark values={loading ? undefined : spark} color={color} />
    </button>
  );
}

/** 卡片底部的迷你折线：只看走势，不标刻度；不到两个点时留出同样的高度 */
function Spark({ values, color }: { values?: number[]; color: string }) {
  if (!values || values.length < 2) return <div className="mt-1.5 h-5" />;
  const max = Math.max(...values), min = Math.min(0, ...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(28 - ((v - min) / span) * 26 - 1).toFixed(2)}`);
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="mt-1.5 h-5 w-full" aria-hidden>
      <polygon points={`0,28 ${pts.join(" ")} 100,28`} fill={color} opacity={0.1} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      {items.map(([name, bg]) => (
        <span key={name} className="inline-flex items-center gap-1.5">
          <span className={cx("h-0.5 w-3.5 rounded-full", bg)} />
          {name}
        </span>
      ))}
    </div>
  );
}

function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-[170px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
      <p>{children}</p>
      {action}
    </div>
  );
}
