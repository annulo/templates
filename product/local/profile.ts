import { L } from "./_i18n";
import { profile, siteBase, siteDigest } from "./_ai";
import { url } from "./_growth";
export const cloud = ["save"];
export const remote = ["context"];
export async function context(input: { url?: string; channel_id?: string }, ctx: any) {
  const p = profile(ctx);
  const channel = input?.channel_id ? ctx.db.get("channels", input.channel_id) : null;
  if (input?.channel_id && (!channel || !["creght_site", "wordpress"].includes(channel.type)))
    throw new Error(L(ctx, "所选网站不存在，请重新选择", "The selected website is missing. Select it again."));
  const address = url(ctx, input?.url || (channel ? await siteBase(channel, ctx) : (p as any).website_url));
  if (!address)
    throw new Error(L(ctx, "请先选择网站或填写官网地址", "Select a website or enter its URL first."));
  const digest = await siteDigest(address.replace(/\/$/, ""), ctx, 6);
  if (!digest)
    throw new Error(L(ctx, "读不到所选网站，请检查网址或稍后重试", "The selected website could not be read. Check its URL or try again."));
  return {
    current: p,
    url: address,
    digest,
    products: ctx.db.query("products", { limit: 200 }).list,
    use_cases: ctx.db.query("use_cases", { limit: 200 }).list,
  };
}
export function save(input: any, ctx: any) {
  const current = profile(ctx);
  const patch: any = {};
  for (const k of [
    "name",
    "positioning",
    "business",
    "advantages",
    "customer_types",
    "markets",
    "buyer_concerns",
    "tone",
    "keywords",
    "brand_terms",
    "activation_event",
    "signup_event",
    "paid_event",
    "goal",
    "pricing",
    "competitors",
    "verified_at",
  ])
    if (input?.[k] !== undefined) patch[k] = String(input[k] ?? "").trim();
  for (const k of ["website_url", "source_url"])
    if (input?.[k] !== undefined) patch[k] = url(ctx, input[k]);
  if (!String(patch.name ?? current.name).trim())
    throw new Error(L(ctx, "请填写产品名称", "Enter a product name."));
  if (patch.verified_at && !Number.isFinite(Date.parse(patch.verified_at)))
    throw new Error(L(ctx, "核实时间无效", "Invalid verification time."));
  if (current.id) {
    ctx.db.update("profile", current.id, patch);
    return ctx.db.get("profile", current.id);
  }
  return ctx.db.insert("profile", {
    ...patch,
    created_at: new Date().toISOString(),
  });
}
