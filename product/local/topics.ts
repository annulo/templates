import { L } from "./_i18n";
import { context as growthContext } from "./growth";
import { sourceSnapshot, link } from './inspiration';
import { platformWorkspace } from '../lib/contentWorkspace';
import { ranking } from './content-workspace';
import { checkOrigins, mergeOrigins, questionOrigins, uncitedQuestions } from './_origins';
import { originsJson, type Origin } from '../lib/origins';
export const cloud = ["context", "save"];
// 出选题（任务 tasks/suggest-topics.md）的取数和存表。每个选题记下出处（origins）和出它的对话（chat_id），设计见仓库根目录 docs/content-origins.md：
//   topics.context({ workspace?, channel_id?, question_ids?, source_ids? })   带 channel_id 时给 AI 搜索里没被引用的问题（geo_questions）
//   topics.save({ ideas: [{ title, angle?, keywords?, question_ids?, source_ids?, origins? }], source?, question_ids?, source_ids?, origins?, workspace? })
//     从 AI 搜索出的（source=geo）每个都要带 question_ids；标题重复的不另建，把出处并进已有的那个（linked）
export function context(input: any, ctx: any) {
  const workspace = input?.workspace || (input?.channel_id ? 'website' : '');
  // 自媒体选题参考已发内容的表现：哪些主题、形式、切入点数据好，哪些差（读不到社媒数据就没有这项）
  let performance;
  if (workspace !== 'website') try { performance = ranking({}, ctx) } catch {}
  const geo_questions = input?.channel_id ? uncitedQuestions(ctx, input.channel_id, input.question_ids) : undefined;
  return { ...growthContext({}, ctx), workspace, channel_id: input?.channel_id || "", sources: [...new Set<string>(input?.source_ids || [])].map((id) => sourceSnapshot(ctx, id)), ...(geo_questions ? { geo_questions } : {}), ...(performance?.published ? { performance } : {}) };
}
export function save(
  input: {
    ideas: { title: string; angle?: string; keywords?: string; source_ids?: string[]; question_ids?: string[]; origins?: Origin[] }[];
    source?: string;
    source_ids?: string[];
    question_ids?: string[];
    origins?: Origin[];
    workspace?: 'website' | 'social';
  },
  ctx: any,
) {
  const old = ctx.db.query("topics", { limit: 1000 }).list;
  const seen = new Map<string, any>(
    old.filter((t: any) => {
      const workspace = t.workspace || platformWorkspace(t.target_platform) || (['search', 'geo'].includes(t.source) ? 'website' : '');
      return !input.workspace || !workspace || workspace === input.workspace;
    }).map((t: any) => [String(t.title).trim().toLowerCase(), t]),
  );
  const shared: Origin[] = [...questionOrigins(ctx, input.question_ids), ...checkOrigins(ctx, input.origins)];
  const chat_id = String(ctx.chat_id ?? "");
  const linked: string[] = [];
  const sourceIds = new Set<string>([...(input.source_ids || []), ...(input.ideas || []).flatMap((x) => x.source_ids || [])]);
  sourceIds.forEach((id) => sourceSnapshot(ctx, id));
  const topic_ids: string[] = [];
  const saved: string[] = [],
    skipped: string[] = [];
  for (const x of input?.ideas || []) {
    const title = String(x.title || "").trim();
    const ids = [...new Set([...(input.source_ids || []), ...(x.source_ids || [])])];
    const origins: Origin[] = [...shared, ...questionOrigins(ctx, x.question_ids), ...checkOrigins(ctx, x.origins), ...ids.map((id) => ({ type: 'inspiration_source', id, label: sourceSnapshot(ctx, id)?.title || '' }))];
    if (title && input.source === 'geo' && !origins.some((o) => o.type === 'geo_question'))
      throw new Error(L(ctx, `「${title}」没写回答的是哪几个 AI 搜索问题：每个选题带上 question_ids`, `"${title}" doesn't say which AI search questions it answers: give each idea question_ids`));
    const dup = title ? seen.get(title.toLowerCase()) : null;
    if (!title || dup) {
      if (dup && mergeOrigins(ctx, dup, origins)) linked.push(title);
      else skipped.push(title);
      continue;
    }
    const row = ctx.db.insert("topics", {
      title,
      angle: String(x.angle || ""),
      keywords: String(x.keywords || ""),
      source: sourceIds.size ? 'inspiration' : input.source || "agent",
      status: "idea",
      ...(origins.length ? { origins: originsJson(origins) } : {}),
      ...(chat_id ? { chat_id } : {}),
      ...(input.workspace ? { workspace: input.workspace, ...(input.workspace === 'website' ? { target_platform: 'website', content_type: 'article' } : {}) } : {}),
      created_at: new Date().toISOString(),
    });
    for (const id of ids) link({ source_id: id, target_type: 'topic', target_id: row.id }, ctx);
    seen.set(title.toLowerCase(), row);
    topic_ids.push(row.id);
    saved.push(title);
  }
  if (!saved.length && !linked.length)
    throw new Error(
      L(
        ctx,
        "没有新增选题，请检查标题是否重复",
        "No new topics. Check for duplicate titles.",
      ),
    );
  return { saved, skipped, linked, topic_ids };
}
