import { L } from "./_i18n";
import { json, requireRow, evidenceFor } from "./_research";
import { context as growthContext } from "./growth";
import { all } from "./_growth";

const text = (v: unknown) => String(v ?? "").trim();
const now = () => new Date().toISOString();
const fail = (ctx: any, zh: string, en: string): never => {
  throw new Error(L(ctx, zh, en));
};
const array = (v: unknown): any[] =>
  Array.isArray(v) ? v : json<any[]>(v, []);
const tags = (v: unknown) =>
  [
    ...new Set(
      (Array.isArray(v) ? v : text(v).split(/[,，\n]/))
        .map(text)
        .filter(Boolean),
    ),
  ].slice(0, 30);

function rows(ctx: any, table: string) {
  return all(ctx, table);
}
function address(v: unknown, ctx: any) {
  const s = text(v);
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      !u.hostname ||
      /^https?:\/\/[^/?#]*@/i.test(u.href) ||
      /^(javascript|data|file):/i.test(s)
    )
      throw new Error();
    return u.href;
  } catch {
    return fail(
      ctx,
      "请填写有效的 http 或 https 链接",
      "Enter a valid http or https URL.",
    );
  }
}
export function canonical(v: unknown, ctx: any) {
  const raw = address(v, ctx);
  if (!raw) return "";
  const u = new URL(raw);
  const note = u.pathname.match(/\/(?:explore|discovery\/item)\/([\w-]+)/);
  if (/(^|\.)xiaohongshu\.com$/.test(u.hostname) && note)
    return `https://www.xiaohongshu.com/explore/${note[1]}`;
  // Preserve meaningful query identifiers (e.g. YouTube v, article id).
  const query = u.search
    .replace(/^\?/, "")
    .split("&")
    .filter(Boolean)
    .filter(
      (part) =>
        !/^(utm_|xsec_|share_|shareRedId$|apptime$|timestamp$|source$|from$)/i.test(
          decodeURIComponent(part.split("=")[0]),
        ),
    )
    .sort()
    .join("&");
  const port =
    u.port &&
    !(
      (u.protocol === "http:" && u.port === "80") ||
      (u.protocol === "https:" && u.port === "443")
    )
      ? `:${u.port}`
      : "";
  return `${u.protocol}//${u.hostname.replace(/^www\./, "")}${port}${u.pathname.replace(/\/+$/, "") || "/"}${query ? "?" + query : ""}`;
}
const platformOf = (v: string) =>
  /xiaohongshu|xhslink/.test(v)
    ? "xiaohongshu"
    : /douyin/.test(v)
      ? "douyin"
      : /(?:twitter|x)\.com/.test(v)
        ? "x"
        : "other";
function count(v: unknown, ctx: any) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0)
    return fail(
      ctx,
      "指标需要非负数字，未知值请留空",
      "Metrics must be non-negative. Leave unknown values empty.",
    );
  return n;
}
function date(v: unknown, ctx: any) {
  const s = text(v);
  if (!s) return "";
  if (!Number.isFinite(Date.parse(s)))
    return fail(ctx, "时间格式无效", "Invalid date.");
  return new Date(s).toISOString();
}
function normalizedCreator(input: any, ctx: any) {
  const profile_url = address(input.profile_url, ctx);
  const platform = text(input.platform) || platformOf(profile_url);
  if (!text(input.nickname) || !profile_url)
    fail(ctx, "请填写博主昵称和主页链接", "Enter a nickname and profile URL.");
  const followers_count = count(input.followers_count, ctx),
    likes_count = count(input.likes_count, ctx);
  const snapshot_at = date(input.snapshot_at, ctx);
  if ((followers_count !== null || likes_count !== null) && !snapshot_at)
    fail(ctx, "填写指标时请记录快照时间", "Metrics need a snapshot date.");
  return {
    nickname: text(input.nickname),
    platform,
    profile_url,
    canonical_url: canonical(profile_url, ctx),
    handle: text(input.handle),
    person_key: text(input.person_key),
    creator_type: text(input.creator_type) || "other",
    avatar_url: address(input.avatar_url, ctx),
    bio: text(input.bio),
    content_focus: text(input.content_focus),
    tags: JSON.stringify(tags(input.tags)),
    status: ["watching", "active", "paused", "archived"].includes(input.status)
      ? input.status
      : "watching",
    priority: ["low", "normal", "high"].includes(input.priority)
      ? input.priority
      : "normal",
    followers_count,
    likes_count,
    snapshot_at,
    notes: text(input.notes),
    updated_at: now(),
  };
}
function normalizedSource(input: any, ctx: any) {
  const url = address(input.url, ctx);
  if (!text(input.title))
    fail(ctx, "请填写灵感标题", "Enter an inspiration title.");
  if (!url && !text(input.content))
    fail(ctx, "请填写来源链接或原始文字", "Enter a source URL or source text.");
  if (input.creator_id) requireRow(ctx, "reference_creators", input.creator_id);
  const media = (v: unknown) =>
    array(v)
      .map((m: any) =>
        typeof m === "string"
          ? { url: address(m, ctx) }
          : {
              ...m,
              url: address(m.url, ctx),
              ...(m.coverUrl ? { coverUrl: address(m.coverUrl, ctx) } : {}),
            },
      )
      .filter((m) => m.url);
  return {
    kind: ["article", "social", "product", "text", "file"].includes(input.kind)
      ? input.kind
      : url
        ? "social"
        : "text",
    title: text(input.title),
    source_title: text(input.source_title),
    url,
    canonical_url: canonical(url, ctx),
    platform: text(input.platform) || platformOf(url),
    format: text(input.format) || "post",
    creator_id: text(input.creator_id),
    author_name: text(input.author_name),
    content: text(input.content),
    summary: text(input.summary),
    hook: text(input.hook),
    why_save: text(input.why_save),
    adaptation_idea: text(input.adaptation_idea),
    tags: JSON.stringify(tags(input.tags)),
    library_status: ["inbox", "ready", "archived"].includes(
      input.library_status,
    )
      ? input.library_status
      : "inbox",
    priority: ["low", "normal", "high"].includes(input.priority)
      ? input.priority
      : "normal",
    images: JSON.stringify(media(input.images)),
    videos: JSON.stringify(media(input.videos)),
    notes: text(input.notes),
    collected_at: date(input.collected_at, ctx) || now(),
    status: text(input.content) ? "ready" : "pending",
    updated_at: now(),
  };
}
const creatorKey = (c: any) =>
  `${c.platform}\0${c.handle ? text(c.handle).toLowerCase() : c.canonical_url}`;
const sourceKey = (s: any) =>
  s.canonical_url ? `${s.platform}\0${s.canonical_url}` : "";
export function saveCreator(input: any, ctx: any) {
  const old = input.id ? requireRow(ctx, "reference_creators", input.id) : null;
  const data = normalizedCreator({ ...old, ...input }, ctx);
  const duplicate = rows(ctx, "reference_creators").find(
    (c) =>
      c.id !== old?.id &&
      (creatorKey(c) === creatorKey(data) ||
        (c.platform === data.platform &&
          c.canonical_url === data.canonical_url)),
  );
  if (duplicate)
    fail(
      ctx,
      "这个平台账号已经收录，请编辑已有记录",
      "This account is already saved. Edit the existing record.",
    );
  const row = old
    ? ctx.db.update("reference_creators", old.id, data)
    : ctx.db.insert("reference_creators", { ...data, created_at: now() });
  return { ...old, ...data, id: row?.id || old?.id };
}
export function saveSource(input: any, ctx: any) {
  const old = input.id ? requireRow(ctx, "research_sources", input.id) : null;
  const data = normalizedSource({ ...old, ...input }, ctx);
  const key = sourceKey(data);
  if (
    key &&
    rows(ctx, "research_sources").some(
      (s) => s.id !== old?.id && sourceKey(s) === key,
    )
  )
    fail(
      ctx,
      "这条来源已经收录，请编辑已有灵感",
      "This source is already saved. Edit the existing inspiration.",
    );
  const version =
    (old?.version || 0) +
    (old &&
    [
      "content",
      "summary",
      "hook",
      "why_save",
      "adaptation_idea",
      "url",
      "title",
      "creator_id",
    ].every((k) => text(old[k]) === text((data as any)[k]))
      ? 0
      : 1);
  const row = old
    ? ctx.db.update("research_sources", old.id, { ...data, version })
    : ctx.db.insert("research_sources", {
        ...data,
        version,
        created_at: now(),
      });
  return { ...old, ...data, version, id: row?.id || old?.id };
}
export function archive(
  input: { kind: string; id: string; restore?: boolean },
  ctx: any,
) {
  const table =
    input.kind === "creator"
      ? "reference_creators"
      : input.kind === "source"
        ? "research_sources"
        : fail(ctx, "对象类型无效", "Invalid object type.");
  requireRow(ctx, table, input.id);
  return ctx.db.update(table, input.id, {
    [table === "reference_creators" ? "status" : "library_status"]:
      input.restore
        ? table === "reference_creators"
          ? "watching"
          : "inbox"
        : "archived",
    updated_at: now(),
  });
}
export function sourceSnapshot(ctx: any, id: string) {
  const s = requireRow(ctx, "research_sources", id);
  const c = s.creator_id
    ? ctx.db.get("reference_creators", s.creator_id)
    : null;
  return {
    source_id: s.id,
    title: s.title,
    source_title: s.source_title,
    url: s.url,
    platform: s.platform,
    format: s.format,
    version: s.version,
    content: s.content,
    summary: s.summary,
    hook: s.hook,
    why_save: s.why_save,
    adaptation_idea: s.adaptation_idea,
    images: array(s.images),
    videos: array(s.videos),
    collected_at: s.collected_at,
    notes: s.notes,
    creator: c
      ? {
          id: c.id,
          nickname: c.nickname,
          platform: c.platform,
          profile_url: c.profile_url,
          person_key: c.person_key,
        }
      : { nickname: s.author_name || "" },
  };
}
export function link(
  input: { source_id: string; target_type: string; target_id: string },
  ctx: any,
) {
  if (!["topic", "article"].includes(input.target_type))
    fail(ctx, "只能关联选题或文章", "Only topics and articles can be linked.");
  requireRow(
    ctx,
    input.target_type === "topic" ? "topics" : "articles",
    input.target_id,
  );
  const snapshot = sourceSnapshot(ctx, input.source_id);
  const old = ctx.db.query("content_references", {
    where: {
      kind: "source",
      source_id: input.source_id,
      target_type: input.target_type,
      target_id: input.target_id,
    },
    limit: 1,
  }).list[0];
  return (
    old ||
    ctx.db.insert("content_references", {
      ...input,
      kind: "source",
      snapshot: JSON.stringify(snapshot),
      created_at: now(),
    })
  );
}
export function unlink(input: { id: string }, ctx: any) {
  const ref = requireRow(ctx, "content_references", input.id);
  if (ref.kind !== "source")
    fail(
      ctx,
      "这条历史依据不能移除",
      "This historical evidence cannot be removed.",
    );
  ctx.db.delete("content_references", ref.id);
  return { removed: ref.id };
}
export function references(
  input: { target_type: string; target_id: string },
  ctx: any,
) {
  if (!["topic", "article"].includes(input.target_type))
    fail(ctx, "对象类型无效", "Invalid target type.");
  const target = requireRow(
    ctx,
    input.target_type === "topic" ? "topics" : "articles",
    input.target_id,
  );
  const topic =
    input.target_type === "topic"
      ? target
      : target.topic_id
        ? ctx.db.get("topics", target.topic_id)
        : null;
  const live = evidenceFor(
    ctx,
    topic,
    input.target_type === "article" ? target.id : undefined,
  );
  const saved: any =
    input.target_type === "article"
      ? json(target.evidence_snapshot, null)
      : null;
  const sources = [...(saved?.sources || [])];
  for (const s of live.sources || [])
    if (!sources.some((p: any) => p.source_id === s.source_id)) sources.push(s);
  return {
    sources,
    findings: saved?.findings || live.findings,
    captured_at: saved?.captured_at || "",
    links: ctx.db.query("content_references", {
      where: {
        target_type: input.target_type,
        target_id: target.id,
        kind: "source",
      },
      limit: 1000,
    }).list,
  };
}
export function list(_input: {}, ctx: any) {
  const creators = rows(ctx, "reference_creators"),
    sources = rows(ctx, "research_sources"),
    refs = rows(ctx, "content_references");
  const topics = rows(ctx, "topics"),
    articles = rows(ctx, "articles");
  const uses: Record<string, any[]> = {};
  const add = (id: string, type: string, target: any) => {
    if (!id || !target) return;
    const a = (uses[id] ||= []);
    if (!a.some((x) => x.type === type && x.id === target.id))
      a.push({
        type,
        id: target.id,
        title: target.title,
        status: target.status,
      });
  };
  for (const r of refs)
    if (r.kind === "source")
      add(
        r.source_id,
        r.target_type,
        (r.target_type === "topic" ? topics : articles).find(
          (x) => x.id === r.target_id,
        ),
      );
  for (const a of articles)
    for (const s of json<any>(a.evidence_snapshot, {})?.sources || [])
      add(s.source_id, "article", a);
  return {
    creators,
    sources: sources.map((s) => ({ ...s, uses: uses[s.id] || [] })),
    topics: topics.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
    })),
  };
}
export function context(input: { source_ids: string[] }, ctx: any) {
  if (!Array.isArray(input?.source_ids) || !input.source_ids.length)
    fail(ctx, "请选择至少一条灵感", "Select at least one inspiration.");
  const sources = [...new Set(input.source_ids)].map((id) =>
    sourceSnapshot(ctx, id),
  );
  return { ...growthContext({}, ctx), sources };
}
export function saveReview(input: any, ctx: any) {
  const s = requireRow(ctx, "research_sources", input.source_id);
  if (input.source_version !== s.version)
    fail(ctx, "来源已修改，请重新整理", "The source changed. Review it again.");
  return saveSource(
    {
      id: s.id,
      summary: text(input.summary),
      hook: text(input.hook),
      why_save: text(input.why_save),
      adaptation_idea: text(input.adaptation_idea),
      library_status: "ready",
    },
    ctx,
  );
}

/** Validate the entire file before writing; imports are additive and never overwrite reviewed records. */
export function importLegacy(input: any, ctx: any) {
  if (!text(input.origin))
    fail(
      ctx,
      "请填写旧库标识，用于防止重复导入",
      "Enter an origin identifier to prevent duplicate imports.",
    );
  const origin = address(input.origin, ctx);
  if (!Array.isArray(input.creators) || !Array.isArray(input.inspirations))
    fail(
      ctx,
      "导入文件需要 creators 和 inspirations 数组",
      "The import file needs creators and inspirations arrays.",
    );
  if (input.creators.length + input.inspirations.length > 2000)
    fail(
      ctx,
      "单次最多导入 2000 条，请分批导入",
      "Import up to 2,000 records per batch.",
    );
  const unwrap = (r: any) => ({
    ...(r.body || r),
    legacy_id: text(
      r.id ||
        r.body?.creatorId ||
        r.creatorId ||
        r.body?.inspirationId ||
        r.inspirationId,
    ),
  });
  const rawCreators = input.creators.map(unwrap),
    rawSources = input.inspirations.map(unwrap);
  for (const batch of [rawCreators, rawSources]) {
    const ids = batch.map((record: any) => record.legacy_id);
    if (new Set(ids).size !== ids.length)
      fail(
        ctx,
        "导入文件包含重复原始 ID，请先合并",
        "Merge duplicate original IDs before importing.",
      );
  }
  const creators = rawCreators.map((c: any) => ({
    raw: c,
    data: normalizedCreator(
      {
        nickname: c.nickname,
        platform: c.platform,
        profile_url: c.profileUrl,
        avatar_url: /^blob:/i.test(text(c.avatarUrl)) ? "" : c.avatarUrl,
        handle: c.handle,
        person_key: c.personKey,
        creator_type: c.creatorType,
        bio: c.bio,
        content_focus: c.contentFocus,
        tags: c.tags,
        status: c.status,
        priority: c.priority,
        followers_count: c.snapshotAt ? c.followersCount : null,
        likes_count: c.snapshotAt ? c.likesCount : null,
        snapshot_at: c.snapshotAt,
        notes: c.notes,
      },
      ctx,
    ),
  }));
  const sources = rawSources.map((s: any) => ({
    raw: s,
    data: normalizedSource(
      {
        title: s.title || s.sourceTitle,
        source_title: s.sourceTitle,
        url: s.sourceUrl || s.canonicalUrl,
        platform: s.platform,
        format: s.sourceType,
        author_name: s.authorName,
        content: s.content,
        summary: s.summary,
        hook: s.hook,
        why_save: s.whySave,
        adaptation_idea: s.adaptationIdea,
        tags: s.tags,
        library_status:
          s.status === "archived"
            ? "archived"
            : ["saved", "used"].includes(s.status)
              ? "ready"
              : "inbox",
        priority: s.priority,
        images: s.images,
        videos: s.videos,
        notes: s.notes,
        collected_at: s.collectedAt || s.createdAt,
      },
      ctx,
    ),
  }));
  if ([...creators, ...sources].some((x) => !x.raw.legacy_id))
    fail(
      ctx,
      "每条导入记录需要原始 ID",
      "Every imported record needs its original ID.",
    );
  const creatorAliases = new Set(
    rawCreators
      .flatMap((c: any) => [c.legacy_id, text(c.creatorId)])
      .filter(Boolean),
  );
  const oldCreators = rows(ctx, "reference_creators"),
    oldSources = rows(ctx, "research_sources");
  const creatorMap = new Map<string, string>(),
    warnings: string[] = [];
  const result = { creators: 0, sources: 0, skipped: 0, warnings };
  for (const c of rawCreators)
    if (/^blob:/i.test(text(c.avatarUrl)))
      warnings.push(
        `${c.nickname}: ${L(ctx, "旧头像为临时浏览器地址，需重新上传；原记录已保留", "The old avatar is a temporary browser URL. Upload it again; the original record is preserved.")}`,
      );
  if (input.preview)
    return {
      ...result,
      creators: creators.length,
      sources: sources.length,
      preview: true,
    };
  for (const c of creators) {
    const legacy_key = `${origin}\0creator\0${c.raw.legacy_id}`;
    const old = oldCreators.find(
      (v) =>
        v.legacy_key === legacy_key ||
        creatorKey(v) === creatorKey(c.data) ||
        (v.platform === c.data.platform &&
          v.canonical_url === c.data.canonical_url),
    );
    const row =
      old ||
      ctx.db.insert("reference_creators", {
        ...c.data,
        legacy_key,
        legacy_snapshot: JSON.stringify(c.raw),
        created_at: c.raw.createdAt || now(),
      });
    if (!old) {
      oldCreators.push(row);
      result.creators++;
    } else result.skipped++;
    for (const key of [c.raw.legacy_id, text(c.raw.creatorId)])
      if (key) creatorMap.set(key, row.id);
  }
  for (const s of sources) {
    const legacy_key = `${origin}\0source\0${s.raw.legacy_id}`;
    const old = oldSources.find(
      (v) =>
        v.legacy_key === legacy_key ||
        (sourceKey(s.data) && sourceKey(v) === sourceKey(s.data)),
    );
    if (old) {
      result.skipped++;
      continue;
    }
    const creator_id = creatorMap.get(text(s.raw.creatorId)) || "";
    if (
      s.raw.creatorId &&
      !creator_id &&
      !creatorAliases.has(text(s.raw.creatorId))
    )
      warnings.push(
        `${s.data.title}: ${L(ctx, "原博主引用未匹配，已保留原始记录", "Creator reference was not matched; the original record is preserved.")}`,
      );
    const row = ctx.db.insert("research_sources", {
      ...s.data,
      creator_id,
      legacy_key,
      legacy_snapshot: JSON.stringify(s.raw),
      version: 1,
      created_at: s.raw.createdAt || now(),
    });
    oldSources.push(row);
    result.sources++;
    if (array(s.raw.usedInTaskIds).length)
      warnings.push(
        `${s.data.title}: ${L(ctx, "旧任务引用已保留，需重新关联选题或文章", "Legacy task references were preserved; link a topic or article to count usage.")}`,
      );
  }
  return result;
}
