import { L } from "./_i18n";
import { profile } from "./_ai";
import { onboarding } from "./_onboarding";
export function setupSteps(ctx: any) {
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
    step(
      "channels",
      "连接网站和账号",
      "Connect websites and accounts",
      "添加官网、小红书、抖音或 X 账号。",
      "Add your website, Xiaohongshu, Douyin or X accounts.",
      has("channels") || has("social_accounts"),
      "channels",
    ),
    step(
      "search",
      "连接搜索数据",
      "Connect search data",
      "读取真实搜索表现，帮助判断机会。",
      "Use measured search performance to identify opportunities.",
      has("search_pages") || has("search_daily"),
      "search",
    ),
    step(
      "goal",
      "定义增长目标",
      "Define growth goals",
      "在产品定位中写清注册、激活与付费事件。",
      "Define signup, activation and payment events in your profile.",
      !!p.goal && !!p.activation_event,
      "company",
    ),
    step(
      "opportunity",
      "研究第一个增长机会",
      "Research your first opportunity",
      "从用户问题出发，记录关键词、页面类型和研究证据。",
      "Start from a user problem and record keywords, page types and evidence.",
      has("growth_opportunities"),
      "opportunities",
    ),
    step(
      "campaign",
      "创建第一组内容",
      "Create your first campaign content",
      "为一个运营主题保存内容计划和第一篇草稿。",
      "Save a campaign plan and its first draft.",
      has("campaigns") && has("articles"),
      "campaigns",
    ),
  ];
}
