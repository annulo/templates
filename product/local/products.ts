import { L } from "./_i18n";
import { all, row, url } from "./_growth";
export const cloud = ["list", "context", "save", "saveUseCase"];
export function list(_input: {}, ctx: any) {
  return { products: all(ctx, "products"), use_cases: all(ctx, "use_cases") };
}
export function context(input: { id?: string }, ctx: any) {
  return input.id
    ? {
        product: row(ctx, "products", input.id),
        use_cases: all(ctx, "use_cases").filter(
          (c) => c.product_id === input.id,
        ),
      }
    : list({}, ctx);
}
export function save(input: any, ctx: any) {
  const data = {
    ...(input.id ? row(ctx, "products", input.id) : {}),
    ...input,
  };
  if (!String(data.name || "").trim())
    throw new Error(
      L(ctx, "请填写产品或功能名称", "Enter a product or feature name."),
    );
  const patch: any = { updated_at: new Date().toISOString() };
  for (const k of [
    "name",
    "summary",
    "audience",
    "features",
    "limitations",
    "price",
    "proof",
    "keywords",
    "verified_at",
  ])
    patch[k] = String(data[k] || "").trim();
  if (patch.verified_at && !Number.isFinite(Date.parse(patch.verified_at)))
    throw new Error(L(ctx, "核实时间无效", "Invalid verification time."));
  patch.url = url(ctx, data.url);
  patch.source_url = url(ctx, data.source_url);
  patch.status = data.status === "hidden" ? "hidden" : "active";
  patch.source = data.source === "site" ? "site" : "manual";
  let images: unknown = data.images || [];
  if (typeof images === "string") {
    try {
      images = JSON.parse(images);
    } catch {
      throw new Error(L(ctx, "图片列表格式无效", "Invalid image list."));
    }
  }
  if (!Array.isArray(images))
    throw new Error(
      L(ctx, "图片必须是地址数组", "Images must be a URL array."),
    );
  patch.images = JSON.stringify(images.map((v) => url(ctx, v)).filter(Boolean));
  if (input.id) {
    ctx.db.update("products", input.id, patch);
    return ctx.db.get("products", input.id);
  }
  return ctx.db.insert("products", { ...patch, created_at: patch.updated_at });
}
export function saveUseCase(input: any, ctx: any) {
  const data = {
    ...(input.id ? row(ctx, "use_cases", input.id) : {}),
    ...input,
  };
  row(ctx, "products", data.product_id);
  if (!String(data.title || "").trim())
    throw new Error(L(ctx, "请填写场景名称", "Enter a use case title."));
  const patch: any = {
    updated_at: new Date().toISOString(),
    proof_url: url(ctx, data.proof_url),
    status: data.status === "hidden" ? "hidden" : "active",
  };
  for (const k of [
    "title",
    "product_id",
    "audience",
    "problem",
    "workflow",
    "outcome",
  ])
    patch[k] = String(data[k] || "").trim();
  if (input.id) {
    ctx.db.update("use_cases", input.id, patch);
    return ctx.db.get("use_cases", input.id);
  }
  return ctx.db.insert("use_cases", { ...patch, created_at: patch.updated_at });
}
