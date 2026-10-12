import { L } from "./_i18n";
import { setupSteps } from "./_checklist";
import { all } from "./_growth";
export const cloud = [
  "list",
  "skip",
  "unskip",
  "dismiss",
  "setupPanel",
  "openWizard",
  "closeWizard",
];
function state(ctx: any, key: string, data: any) {
  const old = ctx.db.query("checklist", { where: { key }, limit: 1 }).list[0];
  if (old) ctx.db.update("checklist", old.id, data);
  else ctx.db.insert("checklist", { key, ...data });
}
export function list(_input: {}, ctx: any) {
  const states = all(ctx, "checklist");
  const setup = setupSteps(ctx).map((s) => ({
    ...s,
    skipped: states.some((r) => r.key === s.key && r.status === "skipped"),
  }));
  const daily: any[] = [];
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const add = (
    key: string,
    n: number,
    zh: string,
    en: string,
    whyZh: string,
    whyEn: string,
    view: string,
  ) => {
    if (
      !n ||
      states.some(
        (s) => s.key === key && s.status === "dismissed" && s.value >= n,
      )
    )
      return;
    daily.push({
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
    all(ctx, "campaigns").filter(
      (c) => c.review_at && c.review_at <= today && c.status !== "done",
    ).length,
    "有运营主题到了复查时间",
    "Campaigns are due for review",
    "查看内容表现和产品转化，记录下一步。",
    "Review content and conversion data, then record next steps.",
    "campaigns",
  );
  add(
    "d_opportunity_review",
    all(ctx, "growth_opportunities").filter(
      (o) =>
        o.review_at &&
        o.review_at <= today &&
        !["done", "parked"].includes(o.status),
    ).length,
    "有增长机会需要复查",
    "Growth opportunities are due for review",
    "核对搜索意图、页面表现与需求证据是否变化。",
    "Recheck search intent, page performance and demand evidence.",
    "opportunities",
  );
  add(
    "d_issues",
    all(ctx, "site_issues").filter(
      (i) => i.status === "open" && i.severity === "high",
    ).length,
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
    "检查登录状态和发布自检结果。",
    "Check account login and publishing health.",
    "channels",
  );
  const complete = setup.filter((s) => s.done).length;
  return {
    setup,
    daily,
    done: complete,
    total: setup.length,
    current: setup.find((s) => !s.done && !s.skipped)?.key || null,
    setup_hidden: states.some(
      (s) => s.key === "setup-panel" && s.status === "hidden",
    ),
    wizard: {
      steps: setup.filter((s) => s.wizard),
      current: setup.find((s) => s.wizard && !s.done && !s.skipped)?.key || null,
      closed: states.some((s) => s.key === "wizard" && s.status === "dismissed"),
    },
  };
}
export function skip(input: { key: string }, ctx: any) {
  state(ctx, input.key, { status: "skipped" });
  return list({}, ctx);
}
export function unskip(input: { key: string }, ctx: any) {
  state(ctx, input.key, { status: "" });
  return list({}, ctx);
}
export function dismiss(input: { key: string; value: number }, ctx: any) {
  state(ctx, input.key, { status: "dismissed", value: input.value });
  return list({}, ctx);
}
export function setupPanel(input: { open: boolean }, ctx: any) {
  state(ctx, "setup-panel", { status: input.open ? "" : "hidden" });
  return list({}, ctx);
}
export function openWizard(_input: {}, ctx: any) {
  state(ctx, "wizard", { status: "" });
  return list({}, ctx);
}
export function closeWizard(_input: {}, ctx: any) {
  state(ctx, "wizard", { status: "dismissed" });
  return list({}, ctx);
}
