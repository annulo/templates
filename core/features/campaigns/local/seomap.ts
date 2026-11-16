// 产品运营的 SEO 页面地图（seo_targets）和页面机会（growth_opportunities）并进共用的关键词表（keywords），
// 页面上只剩一份「SEO 与关键词 → 关键词」（plan.keywordMap，外贸也用它）。设计见 docs/marketing-workflow.md「SEO 并进关键词」。
//
//   seomap.sync({})                 把还没并的导入记录、页面机会并进关键词表（能重复跑）：打开「关键词」、导入资料、AI 研究完都会跑
//   seomap.opportunity({cluster})   「关键词」里这个主题挂的页面机会，没有就按主题建一条（候选）：卡片上「创建运营主题」用它
//
// 并的规则：
//   - 关键词表按网站分（channel_id），导入和研究的记录不分网站：并到第一个独立站（creght_site / website）；还没有网站就先不并，下次再并。
//   - 同一个词（不分大小写）已经在关键词表里：只补空着的字段（主题、目标页面、意图、说明、页面机会），不改用户和助手筛过的；
//     raw（还没筛）的提成 idea，dismissed（不要了）的不动。
//   - 导入的记录按「主页面 + 语言」归成一个主题，主题名用其中优先级 A 的词（没有就用第一个）；
//     页面机会按目标页面并进已有的主题，对不上就用它的关键词当主题。
//   - 导入记录写回 keyword_id，页面机会靠关键词上的 opportunity_id 认，并过的不再并。
import { all, error } from "./_growth";
import { saveOpportunity } from "./campaigns";

export const cloud = ["sync", "opportunity"];

const text = (v: any) => String(v ?? "").trim();
const low = (v: any) => text(v).toLowerCase();
const now = () => new Date().toISOString();
const path = (u: any) => low(u).replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";
const samePage = (a: any, b: any) => !!text(a) && !!text(b) && path(a) === path(b);

/** 导入资料里的意图是自由文字，页面机会是 informational / commercial / transactional；关键词表用 buy / compare / research / other */
function keywordIntent(v: any) {
  const s = low(v);
  if (!s) return "";
  if (/transactional|购买|下单|工具|tool|buy|price|价格/.test(s)) return "buy";
  if (/commercial|对比|比较|决策|选型|compar|vs|alternative|替代/.test(s)) return "compare";
  if (/informational|了解|教程|怎么|how|what|guide|研究|research/.test(s)) return "research";
  return "other";
}
const opportunityIntent = (v: any) => (v === "buy" ? "transactional" : v === "compare" ? "commercial" : "informational");

function sites(ctx: any): any[] {
  try {
    return (ctx.db.query("channels", { limit: 500 }).list ?? []).filter((c: any) => c.type === "creght_site" || c.type === "website");
  } catch {
    return [];
  }
}

export function sync(_input: {}, ctx: any) {
  const site = sites(ctx)[0];
  const targets = all(ctx, "seo_targets").filter((s) => !s.keyword_id || !ctx.db.get("keywords", s.keyword_id));
  const known = new Set(all(ctx, "keywords").map((k) => k.opportunity_id).filter(Boolean));
  const opps = all(ctx, "growth_opportunities").filter((o) => o.status !== "parked" && !known.has(o.id) && text(o.keyword || o.title));
  if (!site) return { added: 0, updated: 0, waiting: targets.length + opps.length, reason: "no_site" };
  const kws = all(ctx, "keywords");
  let added = 0, updated = 0;
  const upsert = (keyword: string, fields: Record<string, any>, source: string) => {
    const old = kws.find((k) => low(k.keyword) === low(keyword));
    if (!old) {
      const k = ctx.db.insert("keywords", {
        channel_id: site.id, keyword, status: "idea", sources: source, bucket: "unchecked", seen: false, created_at: now(), reviewed_at: now(),
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => text(v))),
      });
      kws.push(k);
      added++;
      return k;
    }
    // 已有的词：只补空着的字段，筛过的结论（状态、主题、意图）不改
    const patch: Record<string, any> = {};
    for (const [f, v] of Object.entries(fields)) if (text(v) && !text(old[f])) patch[f] = v;
    if (old.status === "raw") patch.status = "idea";
    const srcs = text(old.sources).split(",").filter(Boolean);
    if (!srcs.includes(source)) patch.sources = [...srcs, source].join(",");
    if (Object.keys(patch).length) {
      ctx.db.update("keywords", old.id, patch);
      Object.assign(old, patch);
      updated++;
    }
    return old;
  };

  // 1. 导入的 SEO 页面地图：按「主页面 + 语言」归主题
  const groups = new Map<string, any[]>();
  for (const s of all(ctx, "seo_targets")) {
    const key = path(s.primary_url) + "|" + low(s.language);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const s of targets) {
    const group = groups.get(path(s.primary_url) + "|" + low(s.language)) ?? [s];
    // 同组里已经并过的词有主题就跟它走，组里的词始终是一个主题
    const done = group.map((g) => (g.keyword_id ? kws.find((k) => k.id === g.keyword_id) : null)).find((k) => k?.cluster);
    const cluster = done?.cluster || (group.find((g) => g.priority === "A") ?? group[0]).keyword;
    const k = upsert(s.keyword, {
      cluster, target_page: s.primary_url, intent: keywordIntent(s.intent), note: text(s.next_action || s.evidence).slice(0, 300),
      opportunity_id: s.opportunity_id, priority: s.priority, origin: s.origin, lang: s.language, country: s.market,
    }, "import");
    ctx.db.update("seo_targets", s.id, { keyword_id: k.id, updated_at: now() });
  }

  // 2. 页面机会（AI 研究的、以前手填的）：按目标页面并进已有主题，对不上用它的关键词当主题
  for (const o of opps) {
    const keyword = text(o.keyword) || text(o.title);
    const same = kws.find((k) => k.cluster && samePage(k.target_page, o.target_url)) ?? kws.find((k) => k.cluster && low(k.keyword) === low(keyword));
    const cluster = same?.cluster || keyword;
    const k = upsert(keyword, {
      cluster, target_page: o.target_url, intent: keywordIntent(o.intent), note: text(o.recommendation || o.problem).slice(0, 300),
      opportunity_id: o.id, priority: o.priority, origin: o.source_url, lang: o.language,
    }, "research");
    // 主题里别的词也挂上这个机会：地图上一行一个机会（词原来就有主题的，按它原来的主题）
    for (const other of kws) if (other.cluster === k.cluster && !other.opportunity_id) {
      ctx.db.update("keywords", other.id, { opportunity_id: o.id });
      other.opportunity_id = o.id;
    }
  }
  return { added, updated, waiting: 0 };
}

/** 主题挂的页面机会；没有就按主题建一条候选机会（产品取词上记的，没有用第一个启用中的产品），整个主题的词都挂上 */
export function opportunity(input: { cluster: string }, ctx: any) {
  const list = all(ctx, "keywords").filter((k) => k.cluster === input.cluster && k.status !== "dismissed");
  if (!list.length) error(ctx, "关键词里没有这个主题", "This topic is not in your keywords.");
  const linked = list.map((k) => k.opportunity_id).find((id) => id && ctx.db.get("growth_opportunities", id));
  let id = linked as string | undefined;
  if (!id) {
    const imp = (k: any) => Number(k.gsc_impressions) || 0;
    const main = [...list].sort((a, b) => (b.status === "targeting" ? 1 : 0) - (a.status === "targeting" ? 1 : 0) || imp(b) - imp(a))[0];
    const products = all(ctx, "products").filter((p) => p.status !== "hidden");
    const product = products.find((p) => list.some((k) => k.product_id === p.id)) ?? products[0];
    if (!product) error(ctx, "先在「产品与用户」里添加产品，再规划页面", "Add a product under Product & users first.");
    const intent = opportunityIntent(main.intent);
    const page = list.find((k) => k.target_page)?.target_page || "";
    // 同一产品、同一个词已经有机会（比如以前手填的）：直接用它，不重复建
    const old = all(ctx, "growth_opportunities").find((o) => o.product_id === product.id && low(o.keyword) === low(main.keyword) && o.status !== "parked");
    id = old?.id ?? saveOpportunity({
      product_id: product.id, title: input.cluster, keyword: main.keyword, language: main.lang || "", intent,
      target_url: page, recommendation: text(main.note), status: "candidate",
      page_type: /template/.test(page) ? "template" : /feature/.test(page) ? "feature" : /blog|article|post/.test(page) ? "tutorial" : intent === "commercial" ? "comparison" : "usecase",
      priority: main.priority === "A" || main.priority === "high" ? "high" : "medium", search_volume: null, difficulty: null,
    }, ctx).id;
  }
  for (const k of list) if (k.opportunity_id !== id) ctx.db.update("keywords", k.id, { opportunity_id: id });
  return { opportunity_id: id };
}
