import { L } from "./_i18n";
import { profile, projectBrief } from "./_ai";
import { contents } from "./_creght";
import { wp } from "./_wp";
import { evidenceFor, json, requireRow } from "./_research";
import {
  htmlImages,
  htmlText,
  isType,
  parseList,
  platformsFor,
  tagsOf,
  typeOf,
  type ArticleType,
} from "./_types";
import { FIELDS } from "../plugins/social/local/_fields";

/** 选题中的简报仅保存用户填写的内容和自有产品。 */
export function saveBrief(
  input: {
    topic_id: string;
    title: string;
    angle?: string;
    keywords?: string;
    brief: any;
  },
  ctx: any,
) {
  const topic = requireRow(ctx, "topics", input.topic_id);
  if (!input.title?.trim())
    throw new Error(L(ctx, "请填写选题", "Enter a topic title."));
  const b = input.brief || {};
  const product_ids = Array.isArray(b.product_ids)
    ? [...new Set(b.product_ids.map(String))]
    : [];
  product_ids.forEach((id) => requireRow(ctx, "products", id));
  const brief: any = { product_ids };
  const original = json<any>(topic.brief, {});
  for (const key of [
    "proof",
    "account_strategy",
    "account_name",
    "account_role_key",
    "target_account_id",
    "tracking_url",
    "historical_notes",
    "source_assets",
    "source_snapshot",
  ])
    if (original[key] !== undefined) brief[key] = original[key];
  for (const key of [
    "audience",
    "buyer_question",
    "outline",
    "language",
    "channels",
    "cta",
    "gaps",
  ])
    brief[key] = String(b[key] || "").trim();
  ctx.db.update("topics", topic.id, {
    title: input.title.trim(),
    angle: String(input.angle || "").trim(),
    keywords: String(input.keywords || "").trim(),
    brief: JSON.stringify(brief),
  });
  return { topic_id: topic.id };
}

// 文章（本机函数，Annulo 在用户电脑上执行，不经过模型）。一篇文章一种类型（local/_types.ts）：
// article 长文（HTML 正文，图在正文里，网站和知乎发它）、post 图文笔记（纯文字正文 + 一组配图）、video 视频（标题 + 简介 + 视频）。
//
//   content.context({ topic_id?, subject?, type?, channel_id? })  写文章要的上下文：项目资料、选题（没给选题也没给主题就列出选题池让助手挑）、网站、站点已有文章、写过的标题、能配的图、这种类型在各平台的限制
//   content.images({})                           能配进文章的图（资料库的图片、产品图），改文章时配图用
//   content.save({ type, topic_id?, source_id?, channel_id?, title, body, … })
//   content.rewriteContext({ article_id, type })  改写成另一种类型要的上下文（任务 tasks/rewrite-article.md）
//                                                 存一篇写好的文章（待审），选题标成已写。写文章本身由助手按任务 tasks/write-article.md 做
//   content.update({ article_id, title?, summary?, slug?, keywords?, body?, tags?, images?, … })
//                                                 改一篇文章（助手按任务 tasks/revise-article.md 改完用它存）；没发布的改完回到待审
//
// 发布到网站不在这里：每个网站一个发布脚本 local/pub_<网站 id>.ts（助手按 tasks/setup-publish.md 写），一篇文章可以发到多个网站，
// 发布记录在 publications 表（见 local/_publish.ts、local/publishing.ts）。

type Article = {
  id: string;
  type?: string;
  channel_id?: string;
  title: string;
  summary?: string;
  body?: string;
  keywords?: string;
  slug?: string;
  status: string;
  url?: string;
};
type Channel = {
  id: string;
  name: string;
  type: string;
  project_id?: string;
  site_id?: string;
  preview_url?: string;
  wp_user?: string;
  wp_secret?: string;
  article_collection?: string;
  publish_status?: string;
};

/** 能发文章的网站渠道 */
const SITE_TYPES = ["creght_site", "wordpress"];
/** 网站上最近的两篇文章（学语气和结构）；creght 站点要先配置过发布（知道文章在哪个集合）才有 */
function productsOf(ctx: any) {
  try {
    return ctx.db
      .query("products", { limit: 200 })
      .list.filter((p: any) => p.status !== "hidden")
      .map((p: any) => ({
        name: p.name,
        summary: p.summary,
        audience: p.audience,
        features: p.features,
        limitations: p.limitations,
        price: p.price,
        proof: p.proof,
        source_url: p.source_url,
        verified_at: p.verified_at,
        url: p.url,
        keywords: p.keywords,
      }));
  } catch {
    return []; // 还没有产品表
  }
}

export function images(_input: {}, ctx: any) {
  return { images: imagesOf(ctx) };
}

/** 能配进文章的图：资料库的图片（名称、说明、标签帮助挑）和产品图。只用这些，不去外站找图、不盗链 */
function imagesOf(ctx: any) {
  const out: {
    url: string;
    name: string;
    text?: string;
    tags?: string;
    from: string;
  }[] = [];
  try {
    for (const a of ctx.db.query("assets", {
      where: { kind: "image" },
      limit: 200,
    }).list)
      if (/^https?:\/\//.test(a.url ?? ""))
        out.push({
          url: a.url,
          name: a.name ?? "",
          text: a.text ?? "",
          tags: a.tags ?? "",
          from: "assets",
        });
  } catch {}
  try {
    for (const p of ctx.db.query("products", { limit: 200 }).list) {
      if (p.status === "hidden") continue;
      let imgs: string[] = [];
      try {
        imgs = JSON.parse(p.images || "[]");
      } catch {}
      for (const u of imgs.slice(0, 3))
        if (/^https?:\/\//.test(u))
          out.push({
            url: u,
            name: `${p.name}${p.model ? " " + p.model : ""}`,
            from: "products",
          });
    }
  } catch {}
  return out.slice(0, 120);
}

async function samples(ch: Channel | null, ctx: any): Promise<string> {
  if (ch?.type === "wordpress") {
    try {
      const list = await wp(
        ctx,
        ch,
        "/wp/v2/posts?per_page=2&_fields=slug,title,content",
        { auth: false },
      );
      return (list ?? [])
        .map(
          (p: any) =>
            `### ${p.title?.rendered ?? p.slug}（slug: ${p.slug}）\n${String(p.content?.rendered ?? "").slice(0, 1500)}`,
        )
        .join("\n\n");
    } catch {
      return "";
    }
  }
  // creght 站点：配置发布时助手记下的文章集合（channels.article_collection）；字段名各站不同，标题取 title / name，正文取最长的文本字段
  if (!ch?.project_id || !ch.article_collection) return "";
  try {
    const list = await contents(ctx, ch.project_id, ch.article_collection, 2);
    return list
      .map((c: any) => {
        const vals = Object.values(c.body ?? {}).filter(
          (v): v is string => typeof v === "string",
        );
        const longest = vals.sort((x, y) => y.length - x.length)[0] ?? "";
        return `### ${c.body?.title ?? c.body?.name ?? c.slug}（slug: ${c.slug}）\n${longest.slice(0, 1500)}`;
      })
      .join("\n\n");
  } catch {
    return "";
  }
}

/** 资料库里的视频（视频类型挑视频用） */
function videosOf(ctx: any) {
  try {
    return ctx.db
      .query("assets", { where: { kind: "video" }, limit: 200 })
      .list.map((v: any) => ({
        url: v.url,
        name: v.name ?? "",
        text: v.text ?? "",
        tags: v.tags ?? "",
      }));
  } catch {
    return [];
  }
}

/** 这种类型在各平台的限制：有账号的社媒平台（没有账号就是所有支持的平台）。写的时候照最严的写，发布时各平台还会再查一遍。长文还能发网站，网站没有字数限制 */
function limitsOf(ctx: any, t: ArticleType) {
  let mine: string[] = [];
  try {
    mine = [
      ...new Set<string>(
        ctx.db
          .query("social_accounts", { limit: 200 })
          .list.map((c: any) => c.type),
      ),
    ];
  } catch {}
  const all = platformsFor(t);
  const list = mine.filter((p) => all.includes(p)).length
    ? all.filter((p) => mine.includes(p))
    : all;
  return list.map((p) => {
    const f = FIELDS[p];
    return {
      platform: p,
      title:
        f.title === "publish"
          ? `发出去，最多 ${f.titleMax} 字`
          : "平台上没有标题（只在后台列表里显示）",
      body_max: f.bodyMax,
      tags_max: f.tags,
      ...(t === "post" ? { images_max: f.images, text_cover: f.cover } : {}),
      ...(t === "video" && f.category ? { category: true } : {}),
    };
  });
}

const TYPE_NOTE: Record<ArticleType, string> = {
  article:
    "长文：body 是 HTML（<h2> <h3> <p> <ul> <ol> <li> <blockquote> <strong> <a> <img>），图片插在正文里；网站和知乎发它",
  post: "图文笔记：body 是纯文字（不要 HTML、不要 Markdown 标记，可以用换行和 emoji），配图单独放在 images 数组（顺序就是轮播顺序，第一张是封面）",
  video:
    "视频：body 是视频简介（纯文字），视频放在 video（资料库视频的地址）；视频本身由用户提供，没有就留空、提醒用户补",
};

/** 写文章要的上下文（任务 tasks/write-article.md 里助手先跑它）：给了选题就是那个选题，给了主题就照主题写，都没给列出选题池让助手挑 */
export async function context(
  input: {
    topic_id?: string;
    subject?: string;
    type?: string;
    channel_id?: string;
  },
  ctx: any,
) {
  const project = profile(ctx);
  let t: ArticleType = isType(input?.type) ? input.type : "article";
  const topics: any[] = ctx.db.query("topics", { limit: 500 }).list;
  const topic = input?.topic_id
    ? topics.find((x) => x.id === input.topic_id)
    : null;
  if (input?.topic_id && !topic)
    throw new Error(
      L(ctx, "没有这个选题：", "No such topic: ") + input.topic_id,
    );
  if (!input?.type && isType(topic?.content_type)) t = topic.content_type;
  const subject = String(input?.subject ?? "").trim();
  const ideas =
    topic || subject
      ? []
      : topics
          .filter((x) => x.status === "idea")
          .map((x) => ({
            id: x.id,
            title: x.title,
            angle: x.angle ?? "",
            keywords: x.keywords ?? "",
          }));
  if (!topic && !subject && !ideas.length)
    throw new Error(
      L(
        ctx,
        "选题池是空的：先点「出选题」",
        'The topic pool is empty: click "Suggest topics" first',
      ),
    );
  const channels: Channel[] = (
    ctx.db.query("channels", { limit: 200 }).list as Channel[]
  ).filter((c) => SITE_TYPES.includes(c.type));
  const ch =
    t === "article"
      ? (channels.find((c) => c.id === input?.channel_id) ??
        channels.find((c) => c.publish_status === "ready") ??
        channels[0] ??
        null)
      : null;
  const published: any[] = ctx.db.query("articles", { limit: 200 }).list;
  // 写作上下文留存一份不可变依据。保存时传 evidence_id，来源随后更新也不改变本次依据。
  const research = topic ? evidenceFor(ctx, topic) : null;
  const evidence =
    research &&
    (research.findings.length ||
      research.sources.length ||
      research.products.length ||
      topic.brief)
      ? ctx.db.insert("content_references", {
          kind: "generation",
          target_type: "topic",
          target_id: topic.id,
          snapshot: JSON.stringify(research),
          created_at: research.captured_at,
        })
      : null;
  return {
    type: t,
    type_note: TYPE_NOTE[t],
    limits: limitsOf(ctx, t),
    project: projectBrief(project),
    topic: topic
      ? {
          id: topic.id,
          title: topic.title,
          angle: topic.angle ?? "",
          keywords: topic.keywords ?? "",
        }
      : null,
    subject,
    ideas,
    campaign: topic?.campaign_id
      ? ctx.db.get("campaigns", topic.campaign_id)
      : null,
    target_platform: topic?.target_platform || "",
    target_account: topic?.target_account_id
      ? (() => {
          const a = ctx.db.get(
            topic.target_platform === "website"
              ? "channels"
              : "social_accounts",
            topic.target_account_id,
          );
          return a
            ? {
                id: a.id,
                name: a.name,
                type: a.type,
                profile: a.profile,
                login_status: a.login_status,
              }
            : null;
        })()
      : null,
    account_strategy: topic?.account_role_key
      ? ctx.db.query("channel_strategies", {
          where: { key: topic.account_role_key },
          limit: 1,
        }).list[0] || null
      : null,
    marketing_plan: topic?.marketing_plan_id
      ? ctx.db.get("marketing_plans", topic.marketing_plan_id)
      : null,
    source_assets: topic ? json<any>(topic.brief, {}).source_assets || [] : [],
    use_cases: ctx.db.query("use_cases", { limit: 200 }).list,
    opportunity: topic?.opportunity_id
      ? ctx.db.get("growth_opportunities", topic.opportunity_id)
      : null,
    // 长文发网站时参照的网站和它已有文章的写法（图文笔记、视频不发网站，没有）
    channel: ch
      ? { id: ch.id, name: ch.name, type: ch.type, url: ch.preview_url ?? "" }
      : null,
    samples: ch ? (await samples(ch, ctx)) || "" : "",
    written_titles: published.map((a) => a.title),
    // 产品目录：写到产品时只用这里的事实（功能、边界、价格与真实案例），没有的不要编
    products: productsOf(ctx),
    research,
    evidence_id: evidence?.id || "",
    // 能配的图（资料库、产品图）：长文插进正文、图文笔记放进 images；没有合适的就不配
    images: imagesOf(ctx),
    ...(t === "video" ? { videos: videosOf(ctx) } : {}),
  };
}

type Fields = {
  title?: string;
  summary?: string;
  slug?: string;
  keywords?: string;
  body?: string;
  tags?: string[];
  images?: string[];
  cover_text?: string;
  video?: string;
  category?: string;
};
type SaveInput = Fields & {
  type?: string;
  topic_id?: string;
  source_id?: string;
  channel_id?: string;
  title: string;
  body: string;
  evidence_id?: string;
};

const cleanSlug = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
const isAsset = (u: string) =>
  /^(https?:\/\/|\/_(annulo|shuttle)\/uploaded\/)\S+$/.test(u);
const cleanTags = (v: unknown) => [
  ...new Set(
    parseList(v)
      .map((x) => x.replace(/^#/, "").trim())
      .filter(Boolean),
  ),
];

/** 文章字段的校验（按类型）：标题不能空；长文正文是 HTML、像写完的文章；图文笔记、视频正文是纯文字。只校验传了的字段 */
function checkFields(f: Fields, t: ArticleType, ctx: any) {
  if (f.title !== undefined && !String(f.title).trim())
    throw new Error(L(ctx, "缺标题（title）", "Missing title"));
  if (f.body !== undefined) {
    const body = String(f.body).trim();
    if (t === "article") {
      if (body.length < 200)
        throw new Error(
          L(
            ctx,
            "正文（body）太短了，不像一篇写完的文章",
            "The body is too short to be a finished article",
          ),
        );
      if (
        /^\s*#{1,6}\s|\n#{1,6}\s/.test(body) &&
        !/<(p|h2|h3)[\s>]/i.test(body)
      )
        throw new Error(
          L(
            ctx,
            "长文的正文要用 HTML（<h2> <p> <ul> …），不是 Markdown",
            "An article body must be HTML (<h2> <p> <ul> …), not Markdown",
          ),
        );
    } else {
      if (t === "post" && !body)
        throw new Error(
          L(ctx, "图文笔记的正文不能是空的", "A post needs body text"),
        );
      if (/<(p|h\d|ul|ol|li|div|br|img)[\s/>]/i.test(body))
        throw new Error(
          L(
            ctx,
            "图文笔记、视频简介的正文是纯文字，不要 HTML；配图放进 images",
            "Post and video bodies are plain text, not HTML; put images in images",
          ),
        );
    }
  }
  if (f.images?.some((u) => !isAsset(u)))
    throw new Error(
      L(
        ctx,
        "配图（images）只能用资料库里的图片地址",
        "images must be image URLs from the Library",
      ),
    );
}

/** 只留这种类型用得上的字段 */
function pick(input: any, t: ArticleType): Record<string, any> {
  const f: Record<string, any> = {};
  for (const k of ["title", "summary", "body"] as const)
    if (input[k] !== undefined) f[k] = String(input[k] ?? "").trim();
  if (input.tags !== undefined) f.tags = JSON.stringify(cleanTags(input.tags));
  if (t === "article") {
    if (input.keywords !== undefined)
      f.keywords = String(input.keywords ?? "").trim();
    if (input.slug !== undefined) f.slug = cleanSlug(input.slug);
  }
  if (t === "post") {
    if (input.images !== undefined)
      f.images = JSON.stringify([
        ...new Set(
          parseList(input.images)
            .map((u) => u.trim())
            .filter(Boolean),
        ),
      ]);
    if (input.cover_text !== undefined)
      f.cover_text = String(input.cover_text ?? "").trim();
  }
  if (t === "video") {
    if (input.video !== undefined) f.video = String(input.video ?? "").trim();
    if (input.category !== undefined)
      f.category = String(input.category ?? "").trim();
  }
  return f;
}

/** 存一篇写好的文章（草稿，标成新文章）；从选题写的把选题标成已写，改写的记下原文（source_id）。字段不对就报错，别让坏数据进表 */
export function save(input: SaveInput, ctx: any) {
  const t: ArticleType = isType(input?.type) ? input.type : "article";
  const source = input?.source_id
    ? ctx.db.get("articles", input.source_id)
    : null;
  if (input?.source_id && !source)
    throw new Error(
      L(ctx, "source_id 不对：没有这篇文章", "Bad source_id: no such article"),
    );
  const topic = input?.topic_id
    ? ctx.db.get("topics", input.topic_id)
    : source?.topic_id
      ? ctx.db.get("topics", source.topic_id)
      : null;
  if (input?.topic_id && !topic)
    throw new Error(
      L(ctx, "topic_id 不对：没有这个选题", "Bad topic_id: no such topic"),
    );
  if (input?.channel_id && !ctx.db.get("channels", input.channel_id))
    throw new Error(
      L(
        ctx,
        "channel_id 不对：没有这个渠道",
        "Bad channel_id: no such channel",
      ),
    );
  const f = pick(
    { ...input, title: input?.title ?? "", body: input?.body ?? "" },
    t,
  );
  checkFields(
    {
      ...f,
      tags: undefined,
      images: input.images === undefined ? undefined : parseList(f.images),
    },
    t,
    ctx,
  );
  const evidence = input.evidence_id
    ? ctx.db.get("content_references", input.evidence_id)
    : null;
  if (
    input.evidence_id &&
    (!evidence ||
      evidence.kind !== "generation" ||
      evidence.target_type !== (source ? "article" : "topic") ||
      evidence.target_id !== (source ? source.id : topic?.id))
  )
    throw new Error(
      L(
        ctx,
        "写作依据不属于这个主题，请重新获取上下文",
        "Writing evidence does not belong to this topic. Reload the context.",
      ),
    );
  const existing = input.evidence_id
    ? ctx.db.query("articles", {
        where: { evidence_id: input.evidence_id },
        limit: 1,
      }).list[0]
    : null;
  const now = new Date().toISOString();
  const article =
    existing ||
    ctx.db.insert("articles", {
      ...f,
      type: t,
      channel_id: input.channel_id ?? "",
      ...(topic
        ? {
            topic_id: topic.id,
            campaign_id: topic.campaign_id || "",
            opportunity_id: topic.opportunity_id || "",
            product_id: topic.product_id || "",
            target_platform: topic.target_platform || "",
            target_account_id: topic.target_account_id || "",
            account_role_key: topic.account_role_key || "",
            marketing_plan_id: topic.marketing_plan_id || "",
            plan_key: topic.plan_key || "",
          }
        : {}),
      ...(source ? { source_id: source.id } : {}),
      status: "draft",
      unread: true,
      evidence_id: input.evidence_id || "",
      evidence_snapshot:
        evidence?.snapshot ||
        (source?.evidence_snapshot ??
          (topic ? JSON.stringify(evidenceFor(ctx, topic)) : "")),
      created_at: now,
      updated_at: now,
    });
  if (topic && !source)
    ctx.db.update("topics", topic.id, {
      status: "done",
      article_id: article.id,
    });
  return { article_id: article.id, type: t, title: f.title };
}

/** 改文章要的上下文（任务 tasks/revise-article.md）：文章本身、类型和限制、调研依据、产品、能配的图 */
export function revisionContext(input: { article_id: string }, ctx: any) {
  const a = ctx.db.get("articles", input.article_id);
  if (!a) throw new Error(L(ctx, "没有这篇文章", "Article not found"));
  const topic = a.topic_id ? ctx.db.get("topics", a.topic_id) : null;
  const current = evidenceFor(ctx, topic, a.id);
  const previous: any = json(a.evidence_snapshot, null);
  // 保留曾用依据，再加入明确选入本文的新参考。未关联主题的旧稿也可以补依据。
  const research = {
    ...current,
    sources: [
      ...(previous?.sources || []),
      ...current.sources.filter(
        (s: any) =>
          !(previous?.sources || []).some(
            (p: any) => p.source_id === s.source_id,
          ),
      ),
    ],
    findings: [
      ...(previous?.findings || []),
      ...current.findings.filter(
        (f: any) =>
          !(previous?.findings || []).some(
            (p: any) => p.finding_id === f.finding_id,
          ),
      ),
    ],
    products: current.products.length
      ? current.products
      : previous?.products || [],
  };
  const ref = ctx.db.insert("content_references", {
    kind: "generation",
    target_type: "article",
    target_id: a.id,
    snapshot: JSON.stringify(research),
    created_at: research.captured_at,
  });
  const t = typeOf(a);
  return {
    article: a,
    type: t,
    type_note: TYPE_NOTE[t],
    limits: limitsOf(ctx, t),
    project: projectBrief(profile(ctx)),
    research,
    evidence_id: ref.id,
    products: productsOf(ctx),
    images: imagesOf(ctx),
  };
}

/** 改一篇文章：只改传了的字段（按文章的类型校验）。已经发出去的不受影响，要更新就在文章页再发一次 */
export function update(
  input: Fields & { article_id: string; evidence_id?: string },
  ctx: any,
) {
  const a: Article | null = ctx.db.get("articles", input?.article_id);
  if (!a)
    throw new Error(
      L(ctx, "没有这篇文章：", "No such article: ") + input?.article_id,
    );
  const t = typeOf(a);
  const f = pick(input, t);
  if (!Object.keys(f).length)
    throw new Error(L(ctx, "没有要改的字段", "Nothing to change"));
  checkFields(
    {
      ...f,
      tags: undefined,
      images: f.images === undefined ? undefined : parseList(f.images),
    },
    t,
    ctx,
  );
  const ref = input.evidence_id
    ? ctx.db.get("content_references", input.evidence_id)
    : null;
  if (
    input.evidence_id &&
    (!ref ||
      ref.kind !== "generation" ||
      ref.target_type !== "article" ||
      ref.target_id !== a.id)
  )
    throw new Error(
      L(
        ctx,
        "改写依据不属于本文",
        "Revision evidence does not belong to this article",
      ),
    );
  ctx.db.update("articles", a.id, {
    ...f,
    ...(ref ? { evidence_id: ref.id, evidence_snapshot: ref.snapshot } : {}),
    updated_at: new Date().toISOString(),
  });
  return {
    article_id: a.id,
    title: f.title ?? a.title,
    changed: Object.keys(f),
  };
}

/** 改写成另一种类型要的上下文（任务 tasks/rewrite-article.md）：原文（富文本给 html 和纯文字、笔记给配图）、目标类型和它在各平台的限制 */
export function rewriteContext(
  input: { article_id: string; type: string },
  ctx: any,
) {
  const a = ctx.db.get("articles", input?.article_id);
  if (!a)
    throw new Error(
      L(ctx, "没有这篇文章：", "No such article: ") + input?.article_id,
    );
  if (!isType(input?.type))
    throw new Error(
      L(
        ctx,
        "type 要是 article / post / video",
        "type must be article / post / video",
      ),
    );
  const to = input.type as ArticleType;
  const from = typeOf(a);
  const body = String(a.body ?? "");
  const previous: any = json(a.evidence_snapshot, {});
  const current = evidenceFor(
    ctx,
    a.topic_id ? ctx.db.get("topics", a.topic_id) : null,
    a.id,
  );
  const research = {
    ...current,
    sources: [
      ...(previous.sources || []),
      ...current.sources.filter(
        (s: any) =>
          !(previous.sources || []).some(
            (p: any) => p.source_id === s.source_id,
          ),
      ),
    ],
    findings: [
      ...(previous.findings || []),
      ...current.findings.filter(
        (s: any) =>
          !(previous.findings || []).some(
            (p: any) => p.finding_id === s.finding_id,
          ),
      ),
    ],
  };
  const evidence = ctx.db.insert("content_references", {
    kind: "generation",
    target_type: "article",
    target_id: a.id,
    snapshot: JSON.stringify(research),
    created_at: research.captured_at,
  });
  return {
    source: {
      id: a.id,
      type: from,
      title: a.title,
      summary: a.summary ?? "",
      ...(from === "article"
        ? {
            html: body.slice(0, 60000),
            text: htmlText(body).slice(0, 12000),
            images: htmlImages(body),
          }
        : { text: body, images: parseList(a.images) }),
      tags: tagsOf(a),
      video: a.video ?? "",
    },
    type: to,
    type_note: TYPE_NOTE[to],
    limits: limitsOf(ctx, to),
    project: projectBrief(profile(ctx)),
    research,
    evidence_id: evidence.id,
    products: productsOf(ctx),
    images: imagesOf(ctx),
    ...(to === "video" ? { videos: videosOf(ctx) } : {}),
  };
}

/** 旧版从社媒页直接写的文章补一篇文章归属。幂等，不碰平台采集的历史内容。 */
export function adoptOrphans(_input: {}, ctx: any) {
  const posts = ctx.db
    .query("social_posts", { limit: 1000 })
    .list.filter((p: any) => !p.article_id && p.source !== "platform");
  const adopted: { article_id: string; post_id: string }[] = [];
  for (const p of posts) {
    const title = String(p.title || p.body || "未命名内容").slice(0, 120);
    const body = String(p.body || "")
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map(
        (x) =>
          `<p>${x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`,
      )
      .join("");
    const a = ctx.db.insert("articles", {
      title,
      body,
      summary: "",
      status: p.status === "published" ? "published" : "draft",
      created_at: p.created_at || new Date().toISOString(),
      updated_at: p.updated_at || new Date().toISOString(),
    });
    ctx.db.update("social_posts", p.id, { article_id: a.id });
    adopted.push({ article_id: a.id, post_id: p.id });
  }
  return { adopted, count: adopted.length };
}

/**
 * 社媒插件的写作任务 social/write-<平台> 取文章内容用（任务参数 source.fn = 'content.socialSource'）。页面上已经不用它（文章直接发），
 * 留给助手在对话里按插件的任务写。插件不读模板的表，文章、配图、候选视频、项目资料都从这里给：
 * { id, title, summary, text（纯文本正文）, html, url, images, videos, project, research（调研证据快照） }
 */
export function socialSource(input: { id: string }, ctx: any) {
  const a = ctx.db.get("articles", input?.id);
  if (!a)
    throw new Error(L(ctx, "没有这篇文章：", "No such article: ") + input?.id);
  const rich = typeOf(a) === "article";
  const body = String(a.body ?? "");
  return {
    id: a.id,
    title: a.title,
    summary: a.summary ?? "",
    text: (rich ? htmlText(body) : body).slice(0, 8000),
    // 正文原样的富文本（HTML）：知乎这类富文本平台照它改写，图片留在原来的位置
    ...(rich ? { html: body.slice(0, 60000) } : {}),
    url: /^https?:\/\//.test(a.url ?? "") ? a.url : "",
    // 公开地址，或离线项目传到本机的 /_annulo/uploaded/…（发帖时 b.upload 认它）
    images: (rich ? htmlImages(body) : parseList(a.images)).filter(isAsset),
    videos: a.video
      ? [{ url: a.video, name: a.title }, ...videosOf(ctx)]
      : videosOf(ctx),
    project: projectBrief(profile(ctx)),
    research: json(a.evidence_snapshot, null),
  };
}
