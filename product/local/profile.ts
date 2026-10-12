import { L } from "./_i18n";
import { profile, siteDigest } from "./_ai";
import { url } from "./_growth";
export const cloud = ["save"];
export const remote = ["context"];
export async function context(input: { url?: string }, ctx: any) {
  const p = profile(ctx);
  const address = url(ctx, input?.url || (p as any).website_url);
  return {
    current: p,
    url: address,
    digest: address ? await siteDigest(address.replace(/\/$/, ""), ctx, 6) : "",
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
