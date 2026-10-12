// Google Analytics（GA4）的访问数据（本机函数；授权走 Shuttle 的 设置 → 连接 → Google，只读，Shuttle 能力版本 9 起带 GA4 权限）。
// WordPress 站没有平台的访问统计，靠它；creght 站点也可以关联，看转化、来源这些平台统计没有的。
//
//   ga4.properties()                         连着的 Google 账号能看的 GA4 属性：[{ property: 'properties/123', name, account, urls, google }]
//                                            account 是 GA4 的账号名，google 是用哪个 Google 账号看的（能连多个，每个属性用能看到它的那个）
//   ga4.link({ channel_id, property? })      给网站渠道关联 GA4 属性（channels.ga4_property）；不给就按网站域名匹配数据流
//   ga4.overview({ channel_id, days? })      近 days 天：汇总（会话、用户、浏览、关键事件）和上一周期对比、按天趋势、热门页面、来源、国家
//
// 接口：Analytics Admin API（accountSummaries、dataStreams）、Analytics Data API（runReport）。
// 用户的 Google Cloud 项目要开这两个 API；Shuttle 自带的客户端已经开好。

import { L } from "./_i18n";
import { siteBase } from "./_ai";
import { googleAccounts } from "./_gsc";

// 要电脑的（浏览器、本机授权、密钥、外部接口）：手机上点了转给电脑上开着的 Shuttle 跑（设置 → 远程访问）
export const remote = ["link", "overview", "properties"];

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

async function call(ctx: any, url: string, body?: unknown, google = "") {
  const token = await ctx.oauth(
    "google",
    google ? { account: google } : undefined,
  );
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.ok) return r.json();
  const text = await r.text();
  let msg = text.slice(0, 300);
  try {
    msg = JSON.parse(text)?.error?.message ?? msg;
  } catch {}
  if (r.status === 401)
    throw new Error(
      L(
        ctx,
        `Google 的授权失效了：到 Annulo 的 设置 → 连接 里重新连接 Google（${msg}）`,
        `Google authorization expired: reconnect Google in Annulo's Settings → Connections (${msg})`,
      ),
    );
  if (r.status === 403 && /insufficient|scope/i.test(msg))
    throw new Error(
      L(
        ctx,
        "Google 的授权里还没有 GA4 权限：到 Annulo 的 设置 → 连接 里重新连接 Google（要先把 Annulo 更新到最新版）",
        "Your Google authorization doesn't include GA4 yet: reconnect Google in Annulo's Settings → Connections (update Annulo first)",
      ),
    );
  if (r.status === 403 && /has not been used|disabled/i.test(msg))
    throw new Error(
      L(
        ctx,
        `Google 那边还没开 Analytics API：${msg}`,
        `The Analytics API isn't enabled on Google's side: ${msg}`,
      ),
    );
  if (r.status === 403)
    throw new Error(
      L(
        ctx,
        `Google 账号${google ? ` ${google} ` : ""}没有这个 GA4 属性的权限（${msg}）：在 Annulo 的连接设置里再连一个有权限的账号，或者在 GA4 里把它加为用户`,
        `Google account${google ? ` ${google}` : ""} has no access to this GA4 property (${msg}): connect one that does in Annulo's connection settings, or add it as a user in GA4`,
      ),
    );
  throw new Error(
    L(
      ctx,
      `GA4 接口出错（${r.status}）：${msg}`,
      `GA4 API error (${r.status}): ${msg}`,
    ),
  );
}

type Prop = {
  property: string;
  name: string;
  account: string;
  urls: string[];
  google: string;
};

const owner = new Map<string, string>(); // GA4 属性 → 能看到它的 Google 账号（这次运行里列过的）

/** 连着的所有 Google 账号能看的 GA4 属性（不带数据流地址）。几个账号都能看的算最早连的那个；某个账号读不到就跳过，全都读不到才抛 */
async function summaries(ctx: any): Promise<Prop[]> {
  const out: Prop[] = [];
  let failed: unknown = null;
  for (const google of googleAccounts(ctx)) {
    try {
      let token = "";
      for (let i = 0; i < 10; i++) {
        const r = await call(
          ctx,
          `${ADMIN}/accountSummaries?pageSize=200${token ? `&pageToken=${token}` : ""}`,
          undefined,
          google,
        );
        for (const a of r?.accountSummaries ?? [])
          for (const p of a.propertySummaries ?? []) {
            if (owner.has(p.property) && owner.get(p.property) !== google)
              continue;
            owner.set(p.property, google);
            out.push({
              property: p.property,
              name: p.displayName,
              account: a.displayName,
              urls: [],
              google,
            });
          }
        token = r?.nextPageToken ?? "";
        if (!token) break;
      }
    } catch (e) {
      failed ??= e;
    }
  }
  if (failed && !out.length) throw failed;
  return out;
}

/** 读这个属性用哪个 Google 账号：只连了一个就是它，多个时看谁能看到 */
async function accountFor(ctx: any, property: string): Promise<string> {
  const list = googleAccounts(ctx);
  if (list.length < 2) return list[0];
  if (!owner.has(property)) await summaries(ctx);
  return owner.get(property) ?? list[0];
}

export async function properties(
  _: unknown,
  ctx: any,
): Promise<{ list: Prop[] }> {
  const out = await summaries(ctx);
  // 每个属性的网站数据流地址（匹配渠道用）
  for (const p of out.slice(0, 50)) {
    try {
      const r = await call(
        ctx,
        `${ADMIN}/${p.property}/dataStreams?pageSize=50`,
        undefined,
        p.google,
      );
      p.urls = (r?.dataStreams ?? [])
        .map((s: any) => s.webStreamData?.defaultUri)
        .filter(Boolean);
    } catch {
      // 读不到流不影响列属性
    }
  }
  return { list: out };
}

const hostOf = (u: string) =>
  (/^https?:\/\/([^/]+)/.exec(u)?.[1] ?? u).replace(/^www\./, "").toLowerCase();

export async function link(
  input: { channel_id: string; property?: string },
  ctx: any,
) {
  const ch = ctx.db.get("channels", input?.channel_id);
  if (!ch)
    throw new Error(
      L(ctx, "没有这个渠道：", "No such channel: ") + input?.channel_id,
    );
  if (!["creght_site", "wordpress"].includes(ch.type))
    throw new Error(
      L(ctx, "只有网站渠道能关联 GA4", "Only website channels can link GA4"),
    );
  const { list } = await properties({}, ctx);
  let property = input.property ?? "";
  if (property && !list.some((p) => p.property === property))
    throw new Error(
      L(
        ctx,
        `连着的 Google 账号都看不到 GA4 属性 ${property}`,
        `None of the connected Google accounts can see GA4 property ${property}`,
      ),
    );
  if (!property) {
    const base = await siteBase(ch, ctx);
    const host = base ? hostOf(base) : "";
    property =
      list.find((p) => p.urls.some((u) => hostOf(u) === host))?.property ?? "";
    if (!property) {
      const names =
        list
          .map((p) => `${p.name}（${p.urls.map(hostOf).join(", ") || "—"}）`)
          .join(L(ctx, "、", ", ")) || L(ctx, "（一个都没有）", "(none)");
      throw new Error(
        L(
          ctx,
          `没找到和「${ch.name}」（${host || "没有访问地址"}）对应的 GA4 属性。连着的 Google 账号能看的：${names}。在下拉里手动选一个；网站在别的 Google 账号下的话，在 Annulo 的连接设置里再连一个账号；或者先在 GA4 里给这个网站建数据流`,
          `No GA4 property matches "${ch.name}" (${host || "no URL"}). Properties the connected Google accounts can see: ${names}. Pick one from the list; if the site is under another Google account, connect it in Annulo's connection settings; or create a web data stream for this site in GA4 first`,
        ),
      );
    }
  }
  ctx.db.update("channels", ch.id, { ga4_property: property });
  return {
    property,
    name: list.find((p) => p.property === property)?.name ?? "",
  };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: any) => Number(v ?? 0) || 0;

/** runReport 一次：dims 维度、metrics 指标，返回 [{ dims: [...], m: [...] }] */
async function report(
  ctx: any,
  property: string,
  range: { start: string; end: string }[],
  dims: string[],
  metrics: string[],
  limit = 10,
) {
  const body: any = {
    dateRanges: range.map((r) => ({ startDate: r.start, endDate: r.end })),
    dimensions: dims.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    limit,
  };
  if (dims.length && dims[0] !== "date")
    body.orderBys = [{ metric: { metricName: metrics[0] }, desc: true }];
  if (dims[0] === "date")
    body.orderBys = [{ dimension: { dimensionName: "date" } }];
  const r = await call(
    ctx,
    `${DATA}/${property}:runReport`,
    body,
    await accountFor(ctx, property),
  );
  return (r?.rows ?? []).map((row: any) => ({
    dims: (row.dimensionValues ?? []).map((d: any) => d.value),
    m: (row.metricValues ?? []).map((x: any) => num(x.value)),
  }));
}

const METRICS = ["sessions", "totalUsers", "screenPageViews", "keyEvents"];

export async function overview(
  input: { channel_id: string; days?: number },
  ctx: any,
) {
  const ch = ctx.db.get("channels", input?.channel_id);
  if (!ch)
    throw new Error(
      L(ctx, "没有这个渠道：", "No such channel: ") + input?.channel_id,
    );
  if (!ch.ga4_property)
    throw new Error(
      L(
        ctx,
        `「${ch.name}」还没关联 GA4`,
        `"${ch.name}" isn't linked to GA4 yet`,
      ),
    );
  const days = Math.min(Math.max(Math.floor(input.days ?? 30), 1), 365);
  const end = new Date();
  const cur = {
    start: ymd(new Date(end.getTime() - (days - 1) * 86400_000)),
    end: ymd(end),
  };
  const prev = {
    start: ymd(new Date(end.getTime() - (2 * days - 1) * 86400_000)),
    end: ymd(new Date(end.getTime() - days * 86400_000)),
  };
  ctx.progress({ message: L(ctx, "在读 GA4…", "Reading GA4…") });
  // 两个时间段一起查：GA4 会多返回一个 dateRange 维度
  const totals = await report(
    ctx,
    ch.ga4_property,
    [cur, prev],
    [],
    METRICS,
    2,
  );
  const sum = (i: number) => {
    const row =
      totals.find((r: any) => r.dims[0] === `date_range_${i}`) ??
      (i === 0 ? totals[0] : null);
    const m = row?.m ?? [0, 0, 0, 0];
    return { sessions: m[0], users: m[1], views: m[2], key_events: m[3] };
  };
  const trend = (
    await report(
      ctx,
      ch.ga4_property,
      [cur],
      ["date"],
      ["sessions", "totalUsers", "screenPageViews"],
      400,
    )
  ).map((r: any) => ({
    day: r.dims[0],
    sessions: r.m[0],
    users: r.m[1],
    views: r.m[2],
  }));
  const top = async (dim: string) =>
    (
      await report(
        ctx,
        ch.ga4_property,
        [cur],
        [dim],
        ["sessions", "keyEvents"],
        10,
      )
    ).map((r: any) => ({
      key: r.dims[0],
      sessions: r.m[0],
      key_events: r.m[1],
    }));
  return {
    property: ch.ga4_property,
    days,
    current: sum(0),
    previous: sum(1),
    trend,
    pages: await top("pagePath"),
    sources: await top("sessionSourceMedium"),
    countries: await top("country"),
  };
}

/** Event definitions remain separate from GA4 key-event totals. */
export function definitions(_input: {}, ctx: any) {
  const p = ctx.db.query("profile", { limit: 1 }).list[0] || {};
  return {
    signup: p.signup_event || null,
    activation: p.activation_event || null,
    payment: p.paid_event || null,
    mapped: false,
  };
}
export const cloud = ["definitions"];
