import { L } from "./_i18n";
import { context as growthContext } from "./growth";
import { sourceSnapshot, link } from './inspiration';
export const cloud = ["context", "save"];
export function context(input: any, ctx: any) {
  return { ...growthContext({}, ctx), channel_id: input?.channel_id || "", sources: [...new Set<string>(input?.source_ids || [])].map((id) => sourceSnapshot(ctx, id)) };
}
export function save(
  input: {
    ideas: { title: string; angle?: string; keywords?: string; source_ids?: string[] }[];
    source?: string;
    source_ids?: string[];
  },
  ctx: any,
) {
  const old = ctx.db.query("topics", { limit: 1000 }).list;
  const seen = new Set(
    old.map((t: any) => String(t.title).trim().toLowerCase()),
  );
  const sourceIds = new Set<string>([...(input.source_ids || []), ...(input.ideas || []).flatMap((x) => x.source_ids || [])]);
  sourceIds.forEach((id) => sourceSnapshot(ctx, id));
  const topic_ids: string[] = [];
  const saved: string[] = [],
    skipped: string[] = [];
  for (const x of input?.ideas || []) {
    const title = String(x.title || "").trim();
    if (!title || seen.has(title.toLowerCase())) {
      skipped.push(title);
      continue;
    }
    seen.add(title.toLowerCase());
    const row = ctx.db.insert("topics", {
      title,
      angle: String(x.angle || ""),
      keywords: String(x.keywords || ""),
      source: sourceIds.size ? 'inspiration' : input.source || "agent",
      status: "idea",
      created_at: new Date().toISOString(),
    });
    for (const id of new Set([...(input.source_ids || []), ...(x.source_ids || [])])) link({ source_id: id, target_type: 'topic', target_id: row.id }, ctx);
    topic_ids.push(row.id);
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
  return { saved, skipped, topic_ids };
}
