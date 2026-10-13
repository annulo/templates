import * as onboarding from "./onboarding";
import { onboarding as state, parse, write } from "./_onboarding";
import { siteBase } from "./_ai";
import { context as profileContext, save as saveProfile } from "./profile";
import { list as listProducts, save as saveProduct, saveUseCase } from "./products";
import { error, url } from "./_growth";

export const cloud = ["get", "saveDetails"];
export const remote = ["sites", "preview", "selectSite", "selectURL", "context"];
const fields = ["name", "positioning", "business", "advantages", "customer_types", "markets", "buyer_concerns", "tone", "keywords", "brand_terms", "goal", "pricing", "competitors", "signup_event", "activation_event", "paid_event", "website_url", "source_url", "verified_at"] as const;
type ProductFact = Record<string, string>;
export type ProductBrief = { profile: ProductFact; products: ProductFact[]; use_cases: ProductFact[] };
const now = () => new Date().toISOString();
const text = (value: unknown) => String(value ?? "").trim();

function checked(input: { revision: number }, ctx: any) {
  const row = state(ctx);
  if (input?.revision !== row.revision)
    error(ctx, "资料已修改，请刷新后重新执行", "The brief changed. Refresh and restart this task.");
  if (!row.website_url && !row.channel_id)
    error(ctx, "请先选择要运营的网站", "Select the website you want to operate first.");
  return row;
}
function normalize(input: Partial<ProductBrief>, ctx: any): ProductBrief {
  const p: ProductFact = {};
  for (const key of fields) p[key] = text(input.profile?.[key]);
  for (const key of ["website_url", "source_url"]) p[key] = url(ctx, p[key]);
  if (p.verified_at && !Number.isFinite(Date.parse(p.verified_at)))
    error(ctx, "核实时间无效", "Invalid verification time.");
  if (!Array.isArray(input.products ?? []) || !Array.isArray(input.use_cases ?? []))
    error(ctx, "产品与场景必须是数组", "Products and use cases must be arrays.");
  const products = (input.products || []).map((item) => {
    const value: ProductFact = {};
    for (const key of ["name", "summary", "audience", "features", "limitations", "price", "proof", "keywords"])
      value[key] = text(item[key]);
    if (!value.name) error(ctx, "请填写产品名称", "Enter a product name.");
    value.url = url(ctx, item.url);
    value.source_url = url(ctx, item.source_url || p.source_url);
    value.verified_at = text(item.verified_at || p.verified_at);
    if (value.verified_at && !Number.isFinite(Date.parse(value.verified_at)))
      error(ctx, "产品核实时间无效", "Invalid product verification time.");
    return value;
  });
  const names = products.map((item) => item.name.toLowerCase());
  if (new Set(names).size !== names.length)
    error(ctx, "产品名称重复，请合并后再保存", "Merge duplicate product names before saving.");
  const use_cases = (input.use_cases || []).map((item) => {
    const value: ProductFact = {};
    for (const key of ["title", "product_name", "audience", "problem", "workflow", "outcome"])
      value[key] = text(item[key]);
    value.proof_url = url(ctx, item.proof_url);
    if (!value.title || !names.includes(value.product_name.toLowerCase()))
      error(ctx, "用户场景需要名称和本次整理的关联产品", "Each use case needs a title and a product from this brief.");
    return value;
  });
  const caseKeys = use_cases.map((item) => `${item.product_name.toLowerCase()}\0${item.title.toLowerCase()}`);
  if (new Set(caseKeys).size !== caseKeys.length)
    error(ctx, "用户场景重复，请合并后再保存", "Merge duplicate use cases before saving.");
  return { profile: p, products, use_cases };
}
export function get(_input: {}, ctx: any) {
  const current = onboarding.get({}, ctx);
  const draft = parse<ProductBrief | null>(state(ctx).company_draft, null);
  return { ...current, company_draft: draft?.profile || null, draft, ...listProducts({}, ctx) };
}
export async function sites(input: {}, ctx: any) { return onboarding.sites(input, ctx); }
export async function preview(input: { project_id: string; site_id: string }, ctx: any) { return onboarding.preview(input, ctx); }
export async function selectSite(input: { project_id: string; site_id: string; refresh?: boolean }, ctx: any) {
  const old = state(ctx).revision;
  await onboarding.selectSite(input, ctx);
  if (state(ctx).revision !== old) write(ctx, { company_refresh: true });
  return get({}, ctx);
}
export async function selectURL(input: { url: string; refresh?: boolean }, ctx: any) {
  const old = state(ctx).revision;
  await onboarding.selectURL(input, ctx);
  if (state(ctx).revision !== old) write(ctx, { company_refresh: true });
  return get({}, ctx);
}
export function begin(input: { revision: number; stage: "company"; refresh?: boolean }, ctx: any) {
  checked(input, ctx);
  onboarding.begin({ ...input, refresh: true }, ctx);
  return get({}, ctx);
}
export async function context(input: { revision: number }, ctx: any) {
  const row = checked(input, ctx);
  const result = await profileContext(row.website_url ? { url: row.website_url } : { channel_id: row.channel_id }, ctx);
  checked(input, ctx);
  return result;
}
export async function saveDraft(input: Partial<ProductBrief> & { revision: number; note?: string }, ctx: any) {
  const row = checked(input, ctx);
  const ch = row.channel_id ? ctx.db.get("channels", row.channel_id) : null;
  const address = row.website_url || (ch ? await siteBase(ch, ctx) : "");
  if (!address) error(ctx, "所选网站没有可读取的地址", "The selected website has no readable URL.");
  const draft = normalize({ ...input, profile: { ...input.profile, website_url: address, source_url: input.profile?.source_url || address, verified_at: now() } }, ctx);
  checked(input, ctx);
  write(ctx, { company_status: "needs_review", company_draft: JSON.stringify(draft), company_note: text(input.note) });
  return get({}, ctx);
}
export function failed(input: { revision: number; stage: "company"; error: string }, ctx: any) {
  checked(input, ctx);
  onboarding.failed(input, ctx);
  return get({}, ctx);
}
export function saveDetails(input: Partial<ProductBrief> & { revision: number }, ctx: any) {
  const row = checked(input, ctx);
  const draft = normalize(input, ctx);
  if (!draft.profile.name || !draft.profile.business || !draft.profile.customer_types)
    error(ctx, "请填写产品名称、解决的问题和目标用户", "Enter the product name, problem it solves and target users.");
  if (!draft.profile.website_url)
    error(ctx, "请确认所选网站地址", "Confirm the selected website URL.");
  // 所有字段、链接和场景关联先校验，再写入；解析阶段始终只保存待确认资料。
  saveProfile(draft.profile, ctx);
  const existing = listProducts({}, ctx);
  const ids = new Map<string, string>();
  for (const item of draft.products) {
    const old = existing.products.find((p: any) => p.name?.toLowerCase() === item.name.toLowerCase());
    const saved = saveProduct({ ...item, ...(old ? { id: old.id } : {}), source: "site" }, ctx);
    ids.set(item.name.toLowerCase(), saved.id);
  }
  for (const item of draft.use_cases) {
    const product_id = ids.get(item.product_name.toLowerCase())!;
    const old = existing.use_cases.find((c: any) => c.product_id === product_id && c.title?.toLowerCase() === item.title.toLowerCase());
    saveUseCase({ ...item, product_id, ...(old ? { id: old.id } : {}) }, ctx);
  }
  write(ctx, { revision: row.revision + 1, details_saved_at: now(), company_status: "done", company_draft: "", company_refresh: false });
  return get({}, ctx);
}
