import { L } from "./_i18n";
import { profile } from "./_ai";
export function setupSteps(ctx: any) {
  const p: any = profile(ctx);
  const has = (t: string) => ctx.db.query(t, { limit: 1 }).list.length > 0;
  const step = (
    key: string,
    zh: string,
    en: string,
    whyZh: string,
    whyEn: string,
    done: boolean,
    view: string,
  ) => ({
    key,
    title: L(ctx, zh, en),
    why: L(ctx, whyZh, whyEn),
    done,
    action: { kind: "go", view },
    action_label: L(ctx, "去完成", "Continue"),
  });
  return [
    step(
      "product",
      "整理产品与用户",
      "Define your product and audience",
      "填写产品事实、用户场景与来源。",
      "Record product facts, use cases and their sources.",
      !!p.name && !!p.customer_types && has("products"),
      "company",
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
