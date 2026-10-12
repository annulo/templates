import { L } from "./_i18n";

const now = () => new Date().toISOString();
const text = (v: unknown) => String(v ?? "").trim();
export function error(ctx: any, zh: string, en: string): never {
  throw new Error(L(ctx, zh, en));
}
export function row(ctx: any, table: string, id: unknown) {
  const r = text(id) ? ctx.db.get(table, text(id)) : null;
  if (!r)
    error(
      ctx,
      "关联记录不存在，请刷新后重试",
      "A linked record is missing. Refresh and try again.",
    );
  return r;
}
export function all(ctx: any, table: string): any[] {
  const list: any[] = [];
  let cursor = "";
  do {
    let res: any;
    try {
      res = ctx.db.query(table, { limit: 1000, cursor });
    } catch (e) {
      if (
        table.startsWith("social_") &&
        /table not found|没有这张表/i.test(String(e))
      )
        return [];
      throw e;
    }
    list.push(...(res.list || []));
    cursor = res.next_cursor || "";
  } while (cursor);
  return list;
}
export function choice(
  ctx: any,
  value: unknown,
  choices: string[],
  fallback: string,
) {
  const v = text(value) || fallback;
  if (!choices.includes(v))
    error(ctx, `不支持的选项：${v}`, `Unsupported option: ${v}`);
  return v;
}
export function url(ctx: any, v: unknown) {
  const s = text(v);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (["http:", "https:"].includes(u.protocol)) return u.href;
  } catch {}
  return error(
    ctx,
    "链接必须是 HTTP 或 HTTPS 地址",
    "Links must use HTTP or HTTPS.",
  );
}
export function date(ctx: any, v: unknown) {
  const s = text(v);
  if (!s) return "";
  const d = new Date(s + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s
  )
    error(ctx, "日期必须是有效的 YYYY-MM-DD", "Use a valid YYYY-MM-DD date.");
  return s;
}
