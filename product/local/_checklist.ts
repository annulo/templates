import { L } from "./_i18n";
import { profile } from "./_ai";
import { onboarding } from "./_onboarding";
import { setupItem as diagnosisItem } from "./diagnosis";
// 共用清单引擎（today.ts）按 setupSteps(ctx, { all, has }) 调，这里用不到第二个参数
export function setupSteps(ctx: any, _helpers?: Helpers): any[] {
  const p: any = profile(ctx);
  const start = onboarding(ctx);
  const selected = start.channel_id ? ctx.db.get("channels", start.channel_id) : null;
  const has = (t: string) => ctx.db.query(t, { limit: 1 }).list.length > 0;
  const siteSelected = !!start.website_url || !!selected || (!!p.website_url && !!p.name && has("products"));
  const step = (
    key: string,
    zh: string,
    en: string,
    whyZh: string,
    whyEn: string,
    done: boolean,
    view: string,
    wizard = false,
    screen = "",
  ) => ({
    key,
    title: L(ctx, zh, en),
    why: L(ctx, whyZh, whyEn),
    done,
    action: { kind: "go", view },
    action_label: L(ctx, "去完成", "Continue"),
    wizard, screen,
  });
  return [
    step(
      "site", "选择要运营的网站", "Select the website to operate",
      "输入官网网址，或选择已连接的网站。助手会读取所选网站，预填产品定位、功能与用户场景。",
      "Enter the website URL or select a connected site. The assistant will read it and draft product facts and user scenarios.",
      siteSelected, "channels", true, "connect-site",
    ),
    step(
      "company-details",
      "确认产品与用户",
      "Review your product and users",
      "核对网站提取的产品定位、真实功能和用户场景。确认后保存到「产品与用户」。",
      "Review the product positioning, features and user scenarios found on the site, then confirm to save them.",
      !!start.details_saved_at || (siteSelected && !!p.name && !!p.business && !!p.customer_types && has("products")),
      "company", true, "product-details",
    ),
    // 连网站和账号、搜索数据、增长目标、第一个机会和内容都交给「分析网站」：跑完排进 90 天计划第 1 周
    diagnosisItem(ctx),
  ];
}

type Helpers = { all: (ctx: any, table: string) => any[]; has: (ctx: any, table: string) => boolean };

/** 今天要做的（共用清单引擎 today.ts 调）：按数据算，数量是 0 的不出现；用户忽略过、数量没变多的由引擎去掉 */
export function dailyItems(ctx: any, { all }: Helpers) {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const out: any[] = [];
  const add = (key: string, n: number, zh: string, en: string, whyZh: string, whyEn: string, view: string) => {
    if (!n) return;
    out.push({
      key,
      count: n,
      done: false,
      title: L(ctx, zh, en),
      why: L(ctx, whyZh, whyEn),
      action: { kind: "go", view },
      action_label: L(ctx, "查看并处理", "Review"),
    });
  };
  add(
    "d_review",
    all(ctx, "campaigns").filter((c) => c.review_at && c.review_at <= today && c.status !== "done").length,
    "有运营主题到了复查时间",
    "Campaigns are due for review",
    "查看内容表现和产品转化，记录下一步。",
    "Review content and conversion data, then record next steps.",
    "campaigns",
  );
  add(
    "d_opportunity_review",
    all(ctx, "growth_opportunities").filter((o) => o.review_at && o.review_at <= today && !["done", "parked"].includes(o.status)).length,
    "有增长机会需要复查",
    "Growth opportunities are due for review",
    "核对搜索意图、页面表现与需求证据是否变化。",
    "Recheck search intent, page performance and demand evidence.",
    "opportunities",
  );
  add(
    "d_issues",
    all(ctx, "site_issues").filter((i) => i.status === "open" && i.severity === "high").length,
    "有重要的网站问题",
    "Important website issues need attention",
    "优先修复影响访问或搜索收录的问题。",
    "Fix issues affecting access or search visibility.",
    "audit",
  );
  add(
    "d_drafts",
    all(ctx, "articles").filter((a) => a.status === "draft").length,
    "有内容草稿待检查与发布",
    "Content drafts need review",
    "核对产品事实、素材和目标账号，再决定发布。",
    "Check product facts, assets and accounts before publishing.",
    "content",
  );
  add(
    "d_health",
    all(ctx, "social_health").filter((h) => h.ok === false).length,
    "有账号操作失败",
    "Account operations need attention",
    "检查登录状态和最近发布、采集的结果。",
    "Check account login and publishing health.",
    "channels",
  );
  return out;
}
