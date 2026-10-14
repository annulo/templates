import { profile, projectBrief } from "./_ai";

export const cloud = [
  "context",
  "saveOpportunity",
  "createCampaign",
  "saveCampaign",
  "campaignContext",
  "savePlan",
  "review",
  "savePagePlan",
];
import { all, row, url, date, choice, error } from "./_growth";
const now = () => new Date().toISOString();
const text = (v: unknown) => String(v ?? "").trim();
function linked(ctx: any, input: any) {
  const product = row(ctx, "products", input.product_id);
  if (product.status === "hidden")
    error(ctx, "请选择启用中的产品", "Choose an active product.");
  if (
    input.use_case_id &&
    row(ctx, "use_cases", input.use_case_id).product_id !== product.id
  )
    error(
      ctx,
      "用户场景不属于这个产品",
      "The use case belongs to another product.",
    );
  return product;
}
function write(ctx: any, table: string, input: any, data: any) {
  if (input.id) {
    row(ctx, table, input.id);
    ctx.db.update(table, input.id, { ...data, updated_at: now() });
    return ctx.db.get(table, input.id);
  }
  return ctx.db.insert(table, {
    ...data,
    created_at: now(),
    updated_at: now(),
  });
}
export function context(_input: {}, ctx: any) {
  return {
    profile: profile(ctx),
    brief: projectBrief(profile(ctx)),
    products: all(ctx, "products").filter((p) => p.status !== "hidden"),
    use_cases: all(ctx, "use_cases").filter((p) => p.status !== "hidden"),
    opportunities: all(ctx, "growth_opportunities"),
    campaigns: all(ctx, "campaigns"),
    search_pages: all(ctx, "search_pages").map((p) => ({
      url: p.page,
      queries: p.queries,
      clicks: p.clicks,
      impressions: p.impressions,
      position: p.position,
    })),
    existing_topics: all(ctx, "topics").map((t) => ({
      id: t.id,
      title: t.title,
      keywords: t.keywords,
    })),
    sites: all(ctx, "channels").map((c) => ({
      id: c.id,
      name: c.name,
      url: c.preview_url,
    })),
    accounts: all(ctx, "social_accounts").map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      profile: c.profile,
    })),
    account_strategies: all(ctx, "channel_strategies"),
  };
}
export function saveOpportunity(input: any, ctx: any) {
  const old = input.id ? row(ctx, "growth_opportunities", input.id) : null;
  const data = { ...old, ...input };
  linked(ctx, data);
  if (!text(data.title))
    error(ctx, "请填写机会名称", "Enter an opportunity title.");
  const patch: any = {};
  for (const k of [
    "title",
    "product_id",
    "use_case_id",
    "keyword",
    "language",
    "audience",
    "problem",
    "evidence",
    "data_source",
    "recommendation",
    "goal",
    "result",
    "effort",
  ])
    patch[k] = text(data[k]);
  patch.intent = choice(
    ctx,
    data.intent,
    ["informational", "commercial", "transactional"],
    "informational",
  );
  patch.page_type = choice(
    ctx,
    data.page_type,
    [
      "feature",
      "usecase",
      "template",
      "comparison",
      "tutorial",
      "case",
      "tool",
    ],
    "tutorial",
  );
  patch.priority = choice(
    ctx,
    data.priority,
    ["high", "medium", "low"],
    "medium",
  );
  patch.status = choice(
    ctx,
    data.status,
    [
      "candidate",
      "validated",
      "planned",
      "running",
      "review",
      "done",
      "parked",
    ],
    "candidate",
  );
  patch.target_url = url(ctx, data.target_url);
  patch.source_url = url(ctx, data.source_url);
  patch.review_at = date(ctx, data.review_at);
  patch.checked_at = text(data.checked_at);
  if (patch.checked_at && !Number.isFinite(Date.parse(patch.checked_at)))
    error(ctx, "核实时间无效", "Invalid verification time.");
  if (
    patch.status !== "candidate" &&
    patch.status !== "parked" &&
    (!patch.evidence || !patch.source_url || !patch.checked_at)
  )
    error(
      ctx,
      "验证机会后，请补充研究证据、来源链接和核实时间",
      "A validated opportunity needs evidence, a source URL and a verification time.",
    );
  for (const k of ["search_volume", "difficulty"]) {
    if (data[k] === undefined || data[k] === null || data[k] === "") {
      patch[k] = null;
      continue;
    }
    const n = Number(data[k]);
    if (!Number.isFinite(n) || n < 0 || (k === "difficulty" && n > 100))
      error(
        ctx,
        "关键词数据必须是有效的非负数；竞争度为 0–100",
        "Keyword metrics must be nonnegative; difficulty ranges from 0 to 100.",
      );
    if (!patch.data_source || !patch.checked_at)
      error(
        ctx,
        "关键词数字需要数据来源和核实时间",
        "Keyword metrics need a data source and verification time.",
      );
    patch[k] = n;
  }
  // 同一产品、语言、搜索意图和主词只维护一个机会，避免争抢相同关键词。
  const existing = patch.keyword
    ? all(ctx, "growth_opportunities").find(
        (o) =>
          o.id !== old?.id &&
          o.product_id === patch.product_id &&
          text(o.keyword).toLowerCase() === patch.keyword.toLowerCase() &&
          o.language === patch.language &&
          o.intent === patch.intent &&
          o.status !== "parked",
      )
    : null;
  if (existing)
    error(
      ctx,
      `这个关键词已经有增长机会：${existing.title}`,
      `This keyword already has an opportunity: ${existing.title}`,
    );
  return write(ctx, "growth_opportunities", input, patch);
}
export function createCampaign(input: { opportunity_id: string }, ctx: any) {
  const o = row(ctx, "growth_opportunities", input.opportunity_id);
  const existing = all(ctx, "campaigns").find(
    (c) => c.opportunity_id === o.id && c.status !== "done",
  );
  if (existing) return existing;
  return saveCampaign(
    {
      title: o.title,
      product_id: o.product_id,
      use_case_id: o.use_case_id,
      opportunity_id: o.id,
      audience: o.audience,
      problem: o.problem,
      message: o.recommendation,
      goal: o.goal || profile(ctx).goal,
      landing_url: o.target_url,
      channels: ["website", "xiaohongshu", "douyin", "x"],
      status: "planned",
      review_at: o.review_at,
    },
    ctx,
  );
}
export function saveCampaign(input: any, ctx: any) {
  const data = {
    ...(input.id ? row(ctx, "campaigns", input.id) : {}),
    ...input,
  };
  linked(ctx, data);
  if (!text(data.title))
    error(ctx, "请填写运营主题", "Enter a campaign title.");
  if (
    data.opportunity_id &&
    row(ctx, "growth_opportunities", data.opportunity_id).product_id !==
      data.product_id
  )
    error(
      ctx,
      "增长机会不属于这个产品",
      "The opportunity belongs to another product.",
    );
  let channels: unknown = data.channels;
  if (typeof channels === "string") {
    try {
      channels = JSON.parse(channels);
    } catch {
      error(ctx, "渠道格式无效", "Invalid campaign channels.");
    }
  }
  if (channels === undefined)
    channels = ["website", "xiaohongshu", "douyin", "x"];
  if (
    !Array.isArray(channels) ||
    !channels.length ||
    channels.some((c) => !["website", "xiaohongshu", "douyin", "x"].includes(c))
  )
    error(
      ctx,
      "至少选择一个支持的渠道",
      "Choose at least one supported channel.",
    );
  const patch: any = {};
  for (const k of [
    "title",
    "product_id",
    "use_case_id",
    "opportunity_id",
    "audience",
    "problem",
    "message",
    "goal",
    "cta",
    "conclusion",
  ])
    patch[k] = text(data[k]);
  patch.landing_url = url(ctx, data.landing_url);
  patch.review_at = date(ctx, data.review_at);
  patch.channels = JSON.stringify([...new Set(channels)]);
  patch.status = choice(
    ctx,
    data.status,
    ["planned", "creating", "ready", "active", "review", "done"],
    "planned",
  );
  return write(ctx, "campaigns", input, patch);
}
export function campaignContext(input: { campaign_id: string }, ctx: any) {
  const c = row(ctx, "campaigns", input.campaign_id);
  return {
    campaign: c,
    product: row(ctx, "products", c.product_id),
    use_case: c.use_case_id ? row(ctx, "use_cases", c.use_case_id) : null,
    opportunity: c.opportunity_id
      ? row(ctx, "growth_opportunities", c.opportunity_id)
      : null,
    profile: profile(ctx),
    topics: all(ctx, "topics").filter((t) => t.campaign_id === c.id),
    articles: all(ctx, "articles").filter((a) => a.campaign_id === c.id),
    assets: all(ctx, "assets").map((a) =>
      a.kind === "text" ? { ...a, text: text(a.text).slice(0, 180) } : a,
    ),
    accounts: all(ctx, "social_accounts").map((a) => ({
      id: a.id,
      type: a.type,
      profile: a.profile,
      name: a.name,
    })),
    account_strategies: all(ctx, "channel_strategies"),
    marketing_plans: all(ctx, "marketing_plans").filter(
      (p) => p.campaign_id === c.id,
    ),
  };
}
export function savePlan(
  input: { campaign_id: string; topics: any[] },
  ctx: any,
) {
  const c = row(ctx, "campaigns", input.campaign_id);
  const channels: string[] = JSON.parse(c.channels || "[]");
  if (!Array.isArray(input.topics) || !input.topics.length)
    error(ctx, "请提供内容计划", "Provide a content plan.");
  const seen = new Set<string>();
  const plans = input.topics.map((t) => {
    const platform = choice(ctx, t.target_platform, channels, "");
    const role = t.account_role_key
      ? all(ctx, "channel_strategies").find((r) => r.key === t.account_role_key)
      : null;
    if (t.account_role_key && (!role || role.platform !== platform))
      error(
        ctx,
        "账号策略与平台不匹配",
        "The account strategy does not match the platform.",
      );
    const accountId = text(t.target_account_id || role?.account_id);
    if (accountId) {
      const account = row(
        ctx,
        platform === "website" ? "channels" : "social_accounts",
        accountId,
      );
      if (
        platform === "website"
          ? !["creght_site", "wordpress"].includes(account.type)
          : account.type !== platform
      )
        error(
          ctx,
          "账号与平台不匹配",
          "The account does not match the platform.",
        );
    }
    const planKey =
      text(t.plan_key) ||
      [
        platform,
        t.account_role_key || accountId || "default",
        text(t.slot) || "default",
      ].join(":");
    if (seen.has(planKey))
      error(
        ctx,
        "内容版本标识重复，请为同账号的不同角度设置不同 plan_key",
        "Duplicate content variant. Give different angles distinct plan_key values.",
      );
    seen.add(planKey);
    const contentType =
      platform === "website"
        ? "article"
        : platform === "douyin"
          ? "video"
          : "post";
    if (!text(t.title))
      error(ctx, "内容计划缺少标题", "A content plan item needs a title.");
    const brief = {
      audience: c.audience,
      buyer_question: c.problem,
      product_ids: [c.product_id],
      outline: text(t.outline),
      language: text(t.language) || (platform === "x" ? "en" : "zh"),
      channels: platform,
      cta: text(t.cta) || c.cta,
      gaps: text(t.gaps),
      account_strategy: role?.guidance || "",
      account_role_key: text(t.account_role_key),
      target_account_id: accountId,
    };
    return {
      title: text(t.title),
      angle: text(t.angle),
      keywords: text(t.keywords),
      brief: JSON.stringify(brief),
      campaign_id: c.id,
      product_id: c.product_id,
      opportunity_id: c.opportunity_id || "",
      target_platform: platform,
      content_type: contentType,
      source: "campaign",
      status: "idea",
      plan_key: planKey,
      account_role_key: text(t.account_role_key),
      target_account_id: accountId,
    };
  });
  const existing = all(ctx, "topics").filter((t) => t.campaign_id === c.id);
  const saved = plans.map((p) => {
    const old = existing.find(
      (t) =>
        (t.plan_key === p.plan_key ||
          (!t.plan_key &&
            p.plan_key === `${p.target_platform}:default:default` &&
            t.target_platform === p.target_platform)) &&
        t.status !== "dropped",
    );
    if (old) return old; // 重试不会覆盖已有简报或重复创建。
    return ctx.db.insert("topics", { ...p, created_at: now() });
  });
  if (c.status === "planned")
    ctx.db.update("campaigns", c.id, { status: "creating", updated_at: now() });
  return { campaign_id: c.id, topics: saved };
}
export function review(
  input: {
    campaign_id: string;
    conclusion: string;
    review_at?: string;
    status?: string;
  },
  ctx: any,
) {
  if (!text(input.conclusion))
    error(ctx, "请填写复盘结论", "Enter a review conclusion.");
  return saveCampaign(
    {
      id: input.campaign_id,
      conclusion: input.conclusion,
      review_at: input.review_at,
      status: input.status || "review",
    },
    ctx,
  );
}
export function savePagePlan(
  input: {
    opportunity_id: string;
    title: string;
    outline: string;
    cta?: string;
    gaps?: string;
  },
  ctx: any,
) {
  const o = row(ctx, "growth_opportunities", input.opportunity_id);
  if (!text(input.title) || !text(input.outline))
    error(
      ctx,
      "页面规划需要标题和大纲",
      "A page plan needs a title and outline.",
    );
  const old = all(ctx, "topics").find(
    (t) =>
      t.opportunity_id === o.id && t.source === "seo" && t.status !== "dropped",
  );
  if (old) return { topic_id: old.id, existing: true };
  const brief = {
    audience: o.audience,
    buyer_question: o.problem,
    product_ids: [o.product_id],
    outline: input.outline,
    language: o.language || "zh",
    channels: "website",
    cta: input.cta || o.goal,
    gaps: input.gaps || "",
  };
  const t = ctx.db.insert("topics", {
    title: input.title,
    angle: o.recommendation,
    keywords: o.keyword,
    brief: JSON.stringify(brief),
    product_id: o.product_id,
    opportunity_id: o.id,
    target_platform: "website",
    content_type: "article",
    source: "seo",
    status: "idea",
    created_at: now(),
  });
  return { topic_id: t.id, existing: false };
}
