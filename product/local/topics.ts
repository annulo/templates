import { L } from "./_i18n";
import { context as growthContext } from "./growth";
export const cloud = ["context", "save"];
export function context(input: any, ctx: any) {
  return { ...growthContext({}, ctx), channel_id: input?.channel_id || "" };
}
export function save(
  input: {
    ideas: { title: string; angle?: string; keywords?: string }[];
    source?: string;
  },
  ctx: any,
) {
  const old = ctx.db.query("topics", { limit: 1000 }).list;
  const seen = new Set(
    old.map((t: any) => String(t.title).trim().toLowerCase()),
  );
  const saved: string[] = [],
    skipped: string[] = [];
  for (const x of input?.ideas || []) {
    const title = String(x.title || "").trim();
    if (!title || seen.has(title.toLowerCase())) {
      skipped.push(title);
      continue;
    }
    seen.add(title.toLowerCase());
    ctx.db.insert("topics", {
      title,
      angle: String(x.angle || ""),
      keywords: String(x.keywords || ""),
      source: input.source || "agent",
      status: "idea",
      created_at: new Date().toISOString(),
    });
    saved.push(title);
  }
  if (!saved.length)
    throw new Error(
      L(
        ctx,
        "没有新增选题，请检查标题是否重复",
        "No new topics. Check for duplicate titles.",
      ),
    );
  return { saved, skipped };
}
