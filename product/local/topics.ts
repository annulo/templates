import { L } from "./_i18n";
import { context as growthContext } from "./growth";
import { sourceSnapshot, link } from './inspiration';
import { platformWorkspace } from '../lib/contentWorkspace';
import { ranking } from './content-workspace';
export const cloud = ["context", "save"];
export function context(input: any, ctx: any) {
  const workspace = input?.workspace || (input?.channel_id ? 'website' : '');
  // 自媒体选题参考已发内容的表现：哪些主题、形式、切入点数据好，哪些差（读不到社媒数据就没有这项）
  let performance;
  if (workspace !== 'website') try { performance = ranking({}, ctx) } catch {}
  return { ...growthContext({}, ctx), workspace, channel_id: input?.channel_id || "", sources: [...new Set<string>(input?.source_ids || [])].map((id) => sourceSnapshot(ctx, id)), ...(performance?.published ? { performance } : {}) };
}
export function save(
  input: {
    ideas: { title: string; angle?: string; keywords?: string; source_ids?: string[] }[];
    source?: string;
    source_ids?: string[];
    workspace?: 'website' | 'social';
  },
  ctx: any,
) {
  const old = ctx.db.query("topics", { limit: 1000 }).list;
  const seen = new Set(
    old.filter((t: any) => {
      const workspace = t.workspace || platformWorkspace(t.target_platform) || (['search', 'geo'].includes(t.source) ? 'website' : '');
      return !input.workspace || !workspace || workspace === input.workspace;
    }).map((t: any) => String(t.title).trim().toLowerCase()),
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
      ...(input.workspace ? { workspace: input.workspace, ...(input.workspace === 'website' ? { target_platform: 'website', content_type: 'article' } : {}) } : {}),
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
