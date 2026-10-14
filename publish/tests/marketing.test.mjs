import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const { build } = createRequire(import.meta.url)(
  process.env.ESBUILD_MODULE || "esbuild",
);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "marketing-test-"));
fs.cpSync(path.join(root, "product"), temp, { recursive: true });
fs.cpSync(path.join(root, "core/local"), path.join(temp, "local"), {
  recursive: true,
});
fs.cpSync(path.join(root, "core/features/websites"), temp, { recursive: true });
await build({
  stdin: {
    contents:
      "export * as marketing from './local/marketing'; export * as growth from './local/growth'; export * as content from './local/content';",
    resolveDir: temp,
  },
  outfile: path.join(temp, "test.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "social-stub",
      setup(b) {
        b.onResolve({ filter: /plugins\/social\// }, (a) => ({
          path: a.path,
          namespace: "social-stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "social-stub" }, () => ({
          contents: `export const FIELDS={}; export const CONTENT_TYPES=['article','post','video']; export const contentType=c=>c?.type || 'article'; export const parseList=v=>Array.isArray(v)?v:JSON.parse(v || '[]'); export const lengthOn=c=>String(c.body || '').length; export const platformsFor=()=>[]; export const htmlImages=()=>[]; export const supports=()=>false; export const fromContent=c=>c; export async function summary(){return []}`,
          loader: "ts",
        }));
      },
    },
  ],
});
const {
  marketing: m,
  growth,
  content,
} = await import(pathToFileURL(path.join(temp, "test.mjs")));
process.on("exit", () => fs.rmSync(temp, { recursive: true, force: true }));
function fixture() {
  const tables = {
      products: [{ id: "product", name: "Example", status: "active" }],
      social_accounts: [
        { id: "brand-account", name: "Brand", type: "xiaohongshu" },
        { id: "other-account", name: "Other", type: "x" },
      ],
    },
    counts = {};
  const ctx = {
    locale: "zh",
    db: {
      query(table, opt = {}) {
        let out = tables[table] || [];
        if (opt.where)
          out = out.filter((r) =>
            Object.entries(opt.where).every(([k, v]) => r[k] === v),
          );
        return { list: out.slice(0, opt.limit || 1000).map((r) => ({ ...r })) };
      },
      get(table, id) {
        const r = tables[table]?.find((r) => r.id === id);
        return r ? { ...r } : null;
      },
      insert(table, data) {
        const r = {
          ...data,
          id: table + "-" + (counts[table] = (counts[table] || 0) + 1),
        };
        (tables[table] ||= []).push(r);
        return { ...r };
      },
      update(table, id, p) {
        Object.assign(
          tables[table].find((r) => r.id === id),
          p,
        );
      },
      delete(table, id) {
        tables[table] = tables[table].filter((r) => r.id !== id);
      },
    },
  };
  return { ctx, tables };
}
const pack = {
  origin: "https://old.example/admin",
  observed_at: "2026-10-13T01:00:00Z",
  product_id: "product",
  roles: [
    {
      key: "brand",
      name: "Brand",
      platform: "xiaohongshu",
      account_id: "brand-account",
    },
  ],
  mothers: [{ external_key: "mother", title: "Our campaign" }],
  plans: [
    {
      external_key: "content:xiaohongshu",
      content_id: "content",
      parent_key: "mother",
      title: "Our source",
      platform: "xiaohongshu",
      role_key: "brand",
      stage: "ready",
      body: "Our original content and a verified product workflow.",
      landing_url: "https://example.com/ai?utm_source=old#demo",
      media: [],
    },
  ],
  seo_targets: [
    {
      external_key: "keyword:one",
      keyword: "Product website builder",
      language: "en",
      primary_url: "https://example.com/tool",
      serp_difficulty: 2,
    },
  ],
  assets: [
    { kind: "text", name: "content-brief.md", text: "Source execution brief" },
    { kind: "text", name: "other-brief.md", text: "Another brief" },
  ],
};
test("preview validates all records without writing; retries preserve local edits and text assets", () => {
  const { ctx, tables } = fixture();
  const preview = m.importPack({ ...pack, preview: true }, ctx);
  assert.equal(preview.counts.marketing_plans, 1);
  assert.equal(tables.marketing_plans, undefined);
  assert.throws(() =>
    m.importPack(
      {
        ...pack,
        seo_targets: [
          ...pack.seo_targets,
          {
            external_key: "bad",
            keyword: "bad",
            language: "zh",
            primary_url: "javascript:alert(1)",
          },
        ],
      },
      ctx,
    ),
  );
  assert.equal(tables.campaigns, undefined);
  m.importPack(pack, ctx);
  assert.equal(tables.assets.length, 2);
  assert.equal(tables.marketing_plans[0].campaign_id, tables.campaigns[0].id);
  ctx.db.update("marketing_plans", tables.marketing_plans[0].id, {
    title: "My reviewed title",
  });
  const again = m.importPack(pack, ctx);
  assert.equal(again.counts.marketing_plans, 0);
  assert.equal(again.counts.assets, 0);
  assert.equal(tables.marketing_plans[0].title, "My reviewed title");
});
test("topic preparation keeps account, source documents and tracking; editing preserves source metadata", () => {
  const { ctx, tables } = fixture();
  m.importPack(pack, ctx);
  const p = tables.marketing_plans[0];
  const first = m.prepareTopic({ plan_id: p.id }, ctx),
    retry = m.prepareTopic({ plan_id: p.id }, ctx);
  assert.equal(first.topic_id, retry.topic_id);
  const topic = tables.topics[0],
    brief = JSON.parse(topic.brief);
  assert.equal(topic.target_account_id, "brand-account");
  assert.equal(brief.source_assets.length, 1);
  assert.match(brief.tracking_url, /utm_source=xiaohongshu/);
  assert.equal((brief.tracking_url.match(/utm_source=/g) || []).length, 1);
  assert.ok(brief.tracking_url.endsWith("#demo"));
  content.saveBrief(
    {
      topic_id: topic.id,
      title: "Edited",
      brief: { product_ids: ["product"], outline: "Edited outline" },
    },
    ctx,
  );
  assert.equal(JSON.parse(tables.topics[0].brief).source_assets.length, 1);
  assert.equal(
    m.sourceMaterial({ ids: brief.source_assets.map((a) => a.id) }, ctx)
      .documents[0].text,
    "Source execution brief",
  );
  assert.throws(() =>
    m.bindRole(
      { id: tables.channel_strategies[0].id, account_id: "other-account" },
      ctx,
    ),
  );
});
test("same platform supports six stable account/angle variants and does not overwrite them on retry", () => {
  const { ctx, tables } = fixture();
  m.importPack(pack, ctx);
  const campaign = tables.campaigns[0];
  const topics = Array.from({ length: 6 }, (_, i) => ({
    target_platform: "xiaohongshu",
    account_role_key: "brand",
    plan_key: "angle-" + i,
    title: "Angle " + i,
    outline: "Real evidence",
  }));
  const first = growth.savePlan({ campaign_id: campaign.id, topics }, ctx);
  assert.equal(first.topics.length, 6);
  assert.equal(tables.topics.length, 6);
  ctx.db.update("topics", first.topics[0].id, { title: "Our edited angle" });
  const again = growth.savePlan({ campaign_id: campaign.id, topics }, ctx);
  assert.equal(tables.topics.length, 6);
  assert.equal(again.topics[0].title, "Our edited angle");
  assert.throws(() =>
    growth.savePlan(
      { campaign_id: campaign.id, topics: [topics[0], topics[0]] },
      ctx,
    ),
  );
  assert.equal(tables.topics.length, 6);
});
test("historical publication claims do not create reviews; verified receipts schedule distinct checkpoints", () => {
  const { ctx, tables } = fixture();
  m.importPack(
    {
      ...pack,
      plans: [
        {
          ...pack.plans[0],
          stage: "reported_published",
          legacy_publication: {
            url: "https://example.com/post",
            metrics: { views: null, likes: 0 },
          },
        },
      ],
    },
    ctx,
  );
  assert.equal(m.planReviews({}, ctx).added, 0);
  assert.equal(tables.growth_reviews, undefined);
  const p = tables.marketing_plans[0];
  assert.throws(() =>
    m.confirmReceipt(
      {
        plan_id: p.id,
        account_id: "",
        url: "https://example.com/post",
        published_at: "2026-09-01T00:00:00Z",
      },
      ctx,
    ),
  );
  m.confirmReceipt(
    {
      plan_id: p.id,
      account_id: "brand-account",
      url: "https://example.com/post",
      published_at: "2026-09-01T00:00:00Z",
    },
    ctx,
  );
  assert.deepEqual(
    tables.growth_reviews.map((r) => r.offset_hours),
    [24, 72, 168],
  );
  assert.equal(m.planReviews({}, ctx).added, 0);
  assert.throws(() =>
    m.saveReview(
      {
        id: tables.growth_reviews[0].id,
        metrics: { views: -1 },
        observed_at: "2026-10-13T00:00:00Z",
        provenance: "report",
        note: "Next action",
      },
      ctx,
    ),
  );
  m.saveReview(
    {
      id: tables.growth_reviews[0].id,
      metrics: { views: "", likes: 0 },
      observed_at: "2026-10-13T00:00:00Z",
      provenance: "platform report",
      note: "Review the CTA",
    },
    ctx,
  );
  const result = JSON.parse(tables.growth_reviews[0].result);
  assert.equal(result.metrics.views, null);
  assert.equal(result.metrics.likes, 0);
});
test("SEO candidate turns into an opportunity without fabricating tool difficulty or search measurements", () => {
  const { ctx, tables } = fixture();
  m.importPack(pack, ctx);
  const target = tables.seo_targets[0];
  const first = m.prepareOpportunity({ target_id: target.id }, ctx);
  assert.equal(
    m.prepareOpportunity({ target_id: target.id }, ctx).opportunity_id,
    first.opportunity_id,
  );
  assert.equal(tables.growth_opportunities[0].difficulty, null);
  assert.equal(tables.growth_opportunities[0].status, "candidate");
  assert.equal(m.context({}, ctx).seo_targets[0].search_page, null);
  assert.throws(() =>
    m.importPack(
      {
        ...pack,
        seo_targets: [
          {
            ...pack.seo_targets[0],
            external_key: "another-import-key",
            primary_url: "https://example.com/another-page",
          },
        ],
      },
      ctx,
    ),
  );
  assert.equal(tables.seo_targets.length, 1);
});
test("late local materials fill blanks and append once while preserving edited copy and historical state", () => {
  const { ctx, tables } = fixture();
  m.importPack({ ...pack, plans: [{ ...pack.plans[0], body: "" }] }, ctx);
  const p = tables.marketing_plans[0];
  const input = {
    plan_id: p.id,
    origin: "local content brief",
    observed_at: pack.observed_at,
    body: "Reviewed local text",
    media: [
      {
        kind: "image",
        name: "slide 1",
        url: "/_annulo/uploaded/1234567890abcdef1234567890abcdef.png",
      },
    ],
  };
  assert.throws(() =>
    m.fillMaterials(
      { ...input, media: [{ url: "/_annulo/uploaded/../../secret" }] },
      ctx,
    ),
  );
  assert.equal(p.body, "");
  assert.equal(m.fillMaterials(input, ctx).body_filled, true);
  const snapshot = p.material_snapshot;
  ctx.db.update("marketing_plans", p.id, { body: "My edited version" });
  assert.equal(m.fillMaterials(input, ctx).existing, true);
  assert.equal(p.material_snapshot, snapshot);
  assert.equal(p.body, "My edited version");
  assert.equal(p.stage, "ready");
  assert.equal(tables.assets.filter((a) => a.kind === "image").length, 1);
  assert.equal(JSON.parse(p.media).length, 1);
});
test("corrected receipt replaces pending review checkpoints without dropping their audit trail", () => {
  const { ctx, tables } = fixture();
  m.importPack(pack, ctx);
  const receipt = {
    plan_id: tables.marketing_plans[0].id,
    account_id: "brand-account",
    url: "https://example.com/post",
    published_at: "2026-09-01T00:00:00Z",
  };
  m.confirmReceipt(receipt, ctx);
  m.confirmReceipt({ ...receipt, published_at: "2026-09-02T00:00:00Z" }, ctx);
  assert.equal(tables.growth_reviews.length, 6);
  assert.equal(
    tables.growth_reviews.filter((r) => r.status === "superseded").length,
    3,
  );
  assert.equal(m.context({}, ctx).reviews.length, 3);
  assert.equal(m.planReviews({}, ctx).added, 0);
});
test("native social publishing supplies receipts while historical collection and incomplete results do not", () => {
  const { ctx, tables } = fixture();
  m.importPack(pack, ctx);
  const p = tables.marketing_plans[0];
  const article = ctx.db.insert("articles", {
    topic_id: "topic",
    title: "Our actual post",
  });
  ctx.db.update("marketing_plans", p.id, { article_id: article.id });
  const post = {
    article_id: article.id,
    channel_id: "brand-account",
    status: "published",
    post_url: "https://example.com/post",
    published_at: "2026-09-01T00:00:00Z",
  };
  ctx.db.insert("social_posts", { ...post, source: "platform" });
  ctx.db.insert("social_posts", { ...post, source: "shuttle", post_url: "" });
  assert.equal(m.planReviews({}, ctx).added, 0);
  ctx.db.insert("social_posts", { ...post, source: "shuttle" });
  assert.equal(m.planReviews({}, ctx).added, 3);
  assert.equal(m.context({}, ctx).plans[0].stage, "published");
  m.confirmReceipt(
    {
      plan_id: p.id,
      account_id: "brand-account",
      url: post.post_url,
      published_at: post.published_at,
    },
    ctx,
  );
  assert.equal(tables.growth_reviews.length, 3);
});
