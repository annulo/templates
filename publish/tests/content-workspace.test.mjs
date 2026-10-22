import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-workspace-'));
fs.cpSync(path.join(root, 'product'), temp, { recursive: true });
fs.cpSync(path.join(root, 'core/local'), path.join(temp, 'local'), { recursive: true });
fs.cpSync(path.join(root, 'core/lib'), path.join(temp, 'lib'), { recursive: true });
fs.cpSync(path.join(root, 'core/features/websites'), temp, { recursive: true });
await build({ stdin: { contents: "export * from './lib/contentWorkspace'; export * as workspace from './local/content-workspace'; export * as topics from './local/topics';", resolveDir: temp },
  bundle: true, platform: 'node', format: 'esm', outfile: path.join(temp, 'test.mjs'), logLevel: 'silent',
  // These read/classification tests never invoke the installed social transport or format adapters.
  plugins: [{ name: 'social-fixture', setup(b) {
    b.onResolve({ filter: /plugins\/social\// }, a => ({ path: a.path, namespace: 'social-fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'social-fixture' }, () => ({ loader: 'ts', contents: "export const FIELDS={}; export const CONTENT_TYPES=['article','post','video']; export const contentType=c=>c?.type || 'article'; export const parseList=v=>Array.isArray(v)?v:JSON.parse(v || '[]'); export const lengthOn=c=>String(c.body || '').length; export const platformsFor=()=>[]; export const htmlImages=()=>[]; export const supports=()=>false; export const fromContent=c=>c; export async function summary(){return []}" }));
  } }] });
const { contentEntries, entryAccountIds, entryMetrics, legacyContentWorkspace, reviewWorkspace, publishedUrl, workspace, topics } = await import(pathToFileURL(path.join(temp, 'test.mjs')));
const empty = () => ({ articles: [], topics: [], plans: [], posts: [], publications: [], channels: [] });

test('destination evidence determines ownership, including long social content; format alone stays unassigned', () => {
  const data = empty();
  data.channels = [{ id: 'site', type: 'creght_site' }, { id: 'account', type: 'zhihu' }];
  data.articles = [{ id: 'long-social', type: 'article', target_account_id: 'account' }, { id: 'site-draft', channel_id: 'site' }, { id: 'old-video', type: 'video' }];
  const rows = contentEntries(data);
  assert.deepEqual(rows.find(r => r.article.id === 'long-social').workspaces, ['social']);
  assert.deepEqual(rows.find(r => r.article.id === 'site-draft').workspaces, ['website']);
  assert.deepEqual(rows.find(r => r.article.id === 'old-video').workspaces, []);
});
test('old article/topic/plan links resolve their own destination rather than matching missing parameters', () => {
  const data = empty(); data.plans = [{ id: 'first-plan', platform: 'xiaohongshu' }]; data.topics = [{ id: 'site-topic', source: 'search' }]; data.articles = [{ id: 'site-article', target_platform: 'website' }];
  const rows = contentEntries(data);
  assert.equal(legacyContentWorkspace({ article: 'site-article' }, rows), 'website');
  assert.equal(legacyContentWorkspace({ topic: 'site-topic' }, rows), 'website');
  assert.equal(legacyContentWorkspace({ plan: 'first-plan' }, rows), 'social');
  assert.equal(legacyContentWorkspace({ workspace: 'website' }, rows), 'website');
});
test('linked plan, topic and article are one workflow; equal titles are not merged', () => {
  const data = empty();
  data.plans = [{ id: 'plan', platform: 'website', topic_id: 'topic', article_id: 'article', title: 'Same' }];
  data.topics = [{ id: 'topic', article_id: 'article', title: 'Same' }, { id: 'unrelated', title: 'Same' }];
  data.articles = [{ id: 'article', topic_id: 'topic', title: 'Same' }];
  const before = JSON.stringify(data), rows = contentEntries(data);
  assert.equal(rows.length, 2); assert.equal(rows[0].plan.id, 'plan'); assert.equal(rows[0].topic.id, 'topic'); assert.equal(rows[0].article.id, 'article');
  assert.equal(JSON.stringify(data), before);
});
test('copied drafts and multiple actual versions remain separately accessible', () => {
  const data = empty();
  data.plans = [{ id: 'plan', platform: 'xiaohongshu', topic_id: 'topic', article_id: 'original' }];
  data.topics = [{ id: 'topic', marketing_plan_id: 'plan' }];
  data.articles = [{ id: 'original', topic_id: 'topic' }, { id: 'copy', topic_id: 'topic', source_id: 'original' }, { id: 'other-version', topic_id: 'topic' }];
  const rows = contentEntries(data);
  assert.equal(rows.length, 3); assert.deepEqual(new Set(rows.map(r => r.article.id)), new Set(['original', 'copy', 'other-version']));
});
test('shared originals retain both destinations and all publication records; stage is workspace-specific', () => {
  const data = empty(); data.articles = [{ id: 'article', target_platform: 'website' }];
  data.publications = [{ id: 'site-record', article_id: 'article', status: 'draft', url: 'https://example.com' }];
  data.posts = [{ id: 'social-record', article_id: 'article', status: 'published', post_url: 'https://social.example.com/post' }];
  const before = JSON.stringify(data);
  assert.deepEqual(new Set(contentEntries(data)[0].workspaces), new Set(['website', 'social']));
  assert.equal(contentEntries(data, 'website')[0].stage, 'draft'); assert.equal(contentEntries(data, 'social')[0].stage, 'published');
  assert.equal(JSON.stringify(data), before);
});
test('account filters and labels retain receipt/native publication destinations without mixing workspaces', () => {
  const data = empty(); data.plans = [{ id: 'plan', platform: 'xiaohongshu', article_id: 'article', receipt: { account_id: 'social-account', url: 'https://social.example/post' } }]; data.articles = [{ id: 'article' }];
  data.publications = [{ id: 'publication', article_id: 'article', channel_id: 'site-account', status: 'published' }];
  const entry = contentEntries(data)[0];
  assert.deepEqual(entryAccountIds(entry, data, 'social', true), ['social-account']);
  assert.deepEqual(entryAccountIds(entry, data, 'website', true), ['site-account']);
  assert.ok(entryAccountIds(entry, data, 'social').includes('social-account'));
});
test('existing review checkpoints use their persisted target relationship to select the workspace', () => {
  const data = { plans: [{ id: 'social-plan', platform: 'douyin' }, { id: 'site-plan', platform: 'website' }] };
  assert.equal(reviewWorkspace({ target_kind: 'plan', target_id: 'social-plan' }, data), 'social');
  assert.equal(reviewWorkspace({ target_kind: 'plan', target_id: 'site-plan' }, data), 'website');
  assert.equal(reviewWorkspace({ target_kind: 'publication', target_id: 'article' }, data), 'website');
  assert.equal(reviewWorkspace({ target_kind: 'post', target_id: 'article' }, data), 'social');
  assert.equal(reviewWorkspace({ target_kind: 'plan', target_id: 'removed-plan' }, data), undefined);
});
test('historical claims, completed topics and prepared media do not fabricate successful publication', () => {
  const data = empty(); data.plans = [{ id: 'claim', stage: 'reported_published' }, { id: 'ready', stage: 'ready' }];
  data.topics = [{ id: 'done', status: 'done' }, { id: 'dropped', status: 'dropped' }]; data.articles = [{ id: 'legacy', status: 'published' }];
  const rows = contentEntries(data);
  assert.equal(rows.find(r => r.key === 'plan:claim').stage, 'verify'); assert.equal(rows.find(r => r.key === 'plan:ready').stage, 'ready');
  assert.equal(rows.find(r => r.key === 'topic:done').stage, 'verify'); assert.equal(rows.find(r => r.key === 'topic:dropped').stage, 'archived');
  assert.equal(rows.find(r => r.key === 'article:legacy').stage, 'verify'); assert.ok(rows.every(r => r.stage !== 'published'));
});
function fixture() {
  const tables = { products: [], channels: [], social_accounts: [], articles: [{ id: 'article', topic_id: 'topic', body: '<p>Original body</p>', images: '["asset"]', status: 'draft' }], topics: [{ id: 'topic', status: 'done', article_id: 'article' }], marketing_plans: [], social_posts: [], publications: [], channel_strategies: [], search_pages: [], seo_targets: [], growth_reviews: [] };
  const updates = [];
  const ctx = { db: { query: table => ({ list: tables[table] || [] }), get: (table, id) => (tables[table] || []).find(r => r.id === id),
    insert: (table, value) => { const row = { ...value, id: 'new-' + (tables[table] || []).length }; (tables[table] ||= []).push(row); return row; },
    update: (table, id, patch) => { updates.push({ table, id, patch }); const row = tables[table].find(r => r.id === id); Object.assign(row, patch); return row; } } };
  return { ctx, tables, updates };
}
test('reading the workspaces does not migrate or rewrite any stored record', () => {
  const { ctx, tables, updates } = fixture(), before = JSON.stringify(tables);
  const data = workspace.context({}, ctx); assert.equal(contentEntries(data).length, 1);
  assert.equal(JSON.stringify(tables), before); assert.equal(updates.length, 0);
});
test('explicit classification only updates ownership, preserves content and publication data, and is idempotent', () => {
  const { ctx, tables, updates } = fixture(); const original = structuredClone(tables);
  workspace.assign({ key: 'topic:topic', workspace: 'social' }, ctx);
  assert.equal(tables.articles[0].body, original.articles[0].body); assert.equal(tables.articles[0].images, original.articles[0].images);
  assert.equal(tables.articles[0].status, original.articles[0].status); assert.deepEqual(tables.publications, original.publications);
  assert.ok(updates.every(u => Object.keys(u.patch).join() === 'workspace'));
  const n = updates.length; workspace.assign({ key: 'topic:topic', workspace: 'social' }, ctx); assert.equal(updates.length, n);
});
test('new topic generation keeps its workspace and allows a different channel treatment of the same title', () => {
  const { ctx, tables } = fixture();
  tables.topics = [{ id: 'site', title: 'Same subject', workspace: 'website' }];
  topics.save({ workspace: 'social', ideas: [{ title: 'Same subject', angle: 'An account-specific treatment' }] }, ctx);
  assert.equal(tables.topics.length, 2); assert.equal(tables.topics[1].workspace, 'social');
  assert.throws(() => topics.save({ workspace: 'social', ideas: [{ title: 'Same subject' }] }, ctx));
  assert.equal(tables.topics.length, 2);
});
test('ownership assignment cannot relocate content that already has another destination', () => {
  const { ctx, tables, updates } = fixture(); tables.articles[0].target_platform = 'website';
  assert.throws(() => workspace.assign({ key: 'topic:topic', workspace: 'social' }, ctx)); assert.equal(updates.length, 0);
});
test('editing task progress persists through reload, uses filters, and preserves content and creation status', () => {
  const { ctx, tables, updates } = fixture();
  tables.articles[0].workspace = 'social';
  const before = structuredClone(tables);
  workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: 'ready' }, ctx);
  const reloaded = contentEntries(workspace.context({}, ctx), 'social');
  assert.equal(reloaded.filter(e => e.stage === 'ready').length, 1);
  assert.equal(tables.articles[0].body, before.articles[0].body);
  assert.equal(tables.articles[0].images, before.articles[0].images);
  assert.equal(tables.articles[0].status, before.articles[0].status);
  assert.deepEqual(tables.topics, before.topics);
  assert.deepEqual(tables.social_posts, before.social_posts);
  assert.deepEqual(tables.publications, before.publications);
  assert.deepEqual(updates.map(u => Object.keys(u.patch)), [['workflow_stages']]);
  workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: 'ready' }, ctx);
  assert.equal(updates.length, 1);
  workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: '' }, ctx);
  assert.equal(contentEntries(workspace.context({}, ctx), 'social')[0].stage, 'draft');
  assert.equal(tables.articles[0].workflow_stages, '');
});
test('manual progress works for plans and topics and preserves the other workspace on a shared record', () => {
  const { ctx, tables } = fixture();
  tables.marketing_plans = [{ id: 'plan', platform: 'xiaohongshu', topic_id: 'topic', article_id: 'article', stage: 'creating', workflow_stages: '{"website":"blocked"}' }];
  tables.publications = [{ id: 'pub', article_id: 'article', status: 'draft' }];
  workspace.setStage({ key: 'plan:plan', workspace: 'social', stage: 'archived' }, ctx);
  const data = workspace.context({}, ctx);
  assert.equal(contentEntries(data, 'social')[0].stage, 'archived');
  assert.equal(contentEntries(data, 'website')[0].stage, 'blocked');
  assert.equal(tables.marketing_plans[0].stage, 'creating');
  tables.topics.push({ id: 'new-topic', workspace: 'social', status: 'idea' });
  workspace.setStage({ key: 'topic:new-topic', workspace: 'social', stage: 'creating' }, ctx);
  assert.equal(contentEntries(workspace.context({}, ctx), 'social').find(e => e.key === 'topic:new-topic').stage, 'creating');
});
test('status editing rejects invalid progress and other workspaces before writing', () => {
  const { ctx, tables, updates } = fixture();
  tables.articles[0].workspace = 'social';
  for (const stage of ['made-up', undefined]) assert.throws(() => workspace.setStage({ key: 'topic:topic', workspace: 'social', stage }, ctx));
  assert.throws(() => workspace.setStage({ key: 'topic:topic', workspace: 'website', stage: 'ready' }, ctx));
  assert.throws(() => workspace.setStage({ key: 'missing', workspace: 'social', stage: 'ready' }, ctx));
  assert.equal(updates.length, 0);
});
test('every task state can be edited repeatedly without changing publication records; automatic status can be restored', () => {
  const { ctx, tables, updates } = fixture();
  tables.articles[0].workspace = 'social';
  for (const originalStatus of ['scheduled', 'published']) {
    tables.social_posts = [{ id: 'post', article_id: 'article', status: originalStatus, post_url: 'https://example.com/post', scheduled_at: '2026-10-20T12:00:00Z' }];
    const originalPosts = structuredClone(tables.social_posts);
    for (const stage of ['planned', 'creating', 'draft', 'ready', 'scheduled', 'published', 'verify', 'blocked', 'archived']) {
      workspace.setStage({ key: 'topic:topic', workspace: 'social', stage }, ctx);
      assert.equal(contentEntries(workspace.context({}, ctx), 'social')[0].stage, stage);
      assert.deepEqual(tables.social_posts, originalPosts);
      assert.equal(tables.growth_reviews.length, 0);
    }
    workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: '' }, ctx);
    assert.equal(contentEntries(workspace.context({}, ctx), 'social')[0].stage, originalStatus);
  }
  assert.ok(updates.every(u => Object.keys(u.patch).join() === 'workflow_stages'));
});
test('manually marking a plan published or scheduled creates no publication or schedule', () => {
  const { ctx, tables } = fixture();
  tables.marketing_plans = [{ id: 'plan', platform: 'xiaohongshu', stage: 'ready', body: 'Keep the original copy' }];
  for (const stage of ['published', 'scheduled', 'archived', 'draft', 'creating']) {
    workspace.setStage({ key: 'plan:plan', workspace: 'social', stage }, ctx);
    assert.equal(contentEntries(workspace.context({}, ctx), 'social').find(e => e.key === 'plan:plan').stage, stage);
  }
  assert.equal(tables.marketing_plans[0].body, 'Keep the original copy');
  assert.equal(tables.marketing_plans[0].stage, 'ready');
  assert.deepEqual(tables.social_posts, []);
  assert.deepEqual(tables.publications, []);
  assert.deepEqual(tables.growth_reviews, []);
});
test('database rows wrapped afresh by the local runtime do not loop over cyclic topic/article links', () => {
  const { ctx, tables } = fixture();
  const query = ctx.db.query;
  ctx.db.query = table => ({ list: new Proxy(query(table).list, {
    get(target, key) {
      const value = Reflect.get(target, key);
      return typeof key === 'string' && /^\d+$/.test(key) ? { ...value } : value;
    }
  }) });
  workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: 'ready' }, ctx);
  assert.equal(JSON.parse(tables.articles[0].workflow_stages).social, 'ready');
  workspace.assign({ key: 'topic:topic', workspace: 'social' }, ctx);
  assert.equal(tables.articles[0].workspace, 'social');
  assert.equal(tables.topics[0].workspace, 'social');
});
test('published task links save atomically, survive reload and status changes, and never fabricate transport receipts', () => {
  const { ctx, tables, updates } = fixture();
  tables.articles[0].workspace = 'social';
  tables.articles[0].publication_links = JSON.stringify({ website: ['https://example.com/site'] });
  const before = structuredClone(tables.articles[0]);
  const input = { key: 'topic:topic', workspace: 'social', stage: 'published', published_url: ' https://social.example.com/post/1 ' };
  workspace.setStage(input, ctx);
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0].patch).sort(), ['publication_links', 'workflow_stages']);
  assert.deepEqual(JSON.parse(tables.articles[0].publication_links), { website: ['https://example.com/site'], social: ['https://social.example.com/post/1'] });
  assert.equal(tables.articles[0].body, before.body); assert.equal(tables.articles[0].status, before.status);
  workspace.setStage(input, ctx); assert.equal(updates.length, 1);
  workspace.setStage({ ...input, stage: 'draft', published_url: undefined }, ctx);
  let entry = contentEntries(workspace.context({}, ctx), 'social')[0];
  assert.equal(entry.stage, 'draft'); assert.deepEqual(entry.publicationUrls, ['https://social.example.com/post/1']);
  workspace.setStage({ ...input, stage: '', published_url: undefined }, ctx);
  assert.equal(contentEntries(workspace.context({}, ctx), 'social')[0].stage, 'published');
  assert.deepEqual(tables.social_posts, []); assert.deepEqual(tables.publications, []); assert.deepEqual(tables.growth_reviews, []);
});
test('publication URLs follow original topic, plan and article IDs without leaking between workspaces', () => {
  const { ctx, tables } = fixture();
  tables.articles = []; tables.topics = [{ id: 'topic', title: 'Topic', workspace: 'social' }];
  workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: 'published', published_url: 'https://social.example/topic' }, ctx);
  tables.articles.push({ id: 'article', title: 'Draft', topic_id: 'topic', publication_links: '{"social":["https://social.example/draft"]}' });
  tables.marketing_plans.push({ id: 'plan', platform: 'xiaohongshu', topic_id: 'topic', article_id: 'article' });
  workspace.setStage({ key: 'plan:plan', workspace: 'social', stage: 'published', published_url: 'https://social.example/plan' }, ctx);
  const entry = contentEntries(workspace.context({}, ctx), 'social')[0];
  assert.deepEqual(new Set(entry.publicationUrls), new Set(['https://social.example/topic', 'https://social.example/draft', 'https://social.example/plan']));
  assert.deepEqual(contentEntries(workspace.context({}, ctx), 'website')[0].publicationUrls, []);
});
test('credential URLs are rejected with the local runtime URL shim as well as the browser URL class', () => {
  const OriginalURL = globalThis.URL;
  try {
    globalThis.URL = class { constructor(value) { const url = new OriginalURL(value); this.href = url.href; this.hostname = url.hostname; } };
    assert.equal(publishedUrl('https://u:p@example.com/post'), '');
    assert.equal(publishedUrl('https://example.com/post'), 'https://example.com/post');
  } finally { globalThis.URL = OriginalURL; }
});
test('invalid publication links and inappropriate status or scope fail before any write', () => {
  const { ctx, tables, updates } = fixture(); tables.articles[0].workspace = 'social';
  const input = { key: 'topic:topic', workspace: 'social', stage: 'published' };
  for (const published_url of ['javascript:alert(1)', '//example.com/post', 'https://user:secret@example.com/post', 'https://', 123, 'https://example.com/' + 'x'.repeat(4000)])
    assert.throws(() => workspace.setStage({ ...input, published_url }, ctx));
  assert.throws(() => workspace.setStage({ ...input, stage: 'draft', published_url: 'https://example.com/post' }, ctx));
  assert.throws(() => workspace.setStage({ ...input, workspace: 'website', published_url: 'https://example.com/post' }, ctx));
  assert.equal(updates.length, 0);
});
test('real native and confirmed plan links are reused and unsafe or unpublished URLs stay hidden', () => {
  const { ctx, tables, updates } = fixture(); tables.articles[0].workspace = 'social';
  tables.social_posts = [
    { id: 'native', article_id: 'article', status: 'published', post_url: 'https://social.example/post' },
    { id: 'draft', article_id: 'article', status: 'draft', post_url: 'https://social.example/draft' },
    { id: 'unsafe', article_id: 'article', status: 'published', post_url: 'javascript:alert(1)' },
  ];
  tables.marketing_plans = [{ id: 'plan', platform: 'xiaohongshu', article_id: 'article', receipt: JSON.stringify({ url: 'https://social.example/confirmed' }) }];
  workspace.setStage({ key: 'plan:plan', workspace: 'social', stage: 'published', published_url: 'https://social.example/post' }, ctx);
  const entry = contentEntries(workspace.context({}, ctx), 'social')[0];
  assert.deepEqual(new Set(entry.publicationUrls), new Set(['https://social.example/post', 'https://social.example/confirmed']));
  assert.deepEqual(Object.keys(updates[0].patch), ['workflow_stages']);
});
test('standalone articles keep repeated publication links distinct and enforce the append limit', () => {
  const { ctx, tables, updates } = fixture(); tables.topics = [];
  tables.articles[0].workspace = 'social'; tables.articles[0].topic_id = '';
  const urls = Array.from({ length: 20 }, (_, i) => `https://social.example/post/${i}`);
  tables.articles[0].publication_links = JSON.stringify({ social: urls });
  const input = { key: 'article:article', workspace: 'social', stage: 'published' };
  assert.throws(() => workspace.setStage({ ...input, published_url: 'https://social.example/overflow' }, ctx));
  assert.equal(updates.length, 0);
  workspace.setStage({ ...input, published_url: urls[0] }, ctx);
  assert.equal(contentEntries(workspace.context({}, ctx), 'social')[0].publicationUrls.length, 20);
});
test('every original ID survives the joined view even with stale links and record cycles', () => {
  const data = empty(); data.plans = [{ id: 'p', topic_id: 't', article_id: 'a', platform: 'website' }, { id: 'stale', topic_id: 'missing' }];
  data.topics = [{ id: 't', marketing_plan_id: 'p', article_id: 'a' }, { id: 'old', article_id: 'missing' }]; data.articles = [{ id: 'a', topic_id: 't', marketing_plan_id: 'p' }, { id: 'orphan' }];
  const rows = contentEntries(data);
  for (const [table, field] of [['articles', 'article'], ['topics', 'topic'], ['plans', 'plan']]) for (const original of data[table]) assert.ok(rows.some(row => row[field]?.id === original.id));
});
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
test('confirmed links can be edited and removed in any workspace; records and receipts stay untouched', () => {
  const { ctx, tables } = fixture(); tables.articles[0].workspace = 'social';
  tables.articles[0].publication_links = JSON.stringify({ website: ['https://example.com/site'], social: ['https://social.example/old'] });
  tables.social_posts = [{ id: 'native', article_id: 'article', status: 'published', post_url: 'https://social.example/native' }];
  const posts = structuredClone(tables.social_posts);
  workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: '', links: [' https://social.example/new ', '', 'https://social.example/new'] }, ctx);
  let entry = contentEntries(workspace.context({}, ctx), 'social')[0];
  assert.deepEqual(entry.linkedUrls, ['https://social.example/new']);
  assert.deepEqual(new Set(entry.publicationUrls), new Set(['https://social.example/new', 'https://social.example/native']));
  assert.deepEqual(JSON.parse(tables.articles[0].publication_links).website, ['https://example.com/site']);
  workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: 'draft', links: [] }, ctx);
  entry = contentEntries(workspace.context({}, ctx), 'social')[0];
  assert.deepEqual(entry.linkedUrls, []); assert.deepEqual(entry.publicationUrls, ['https://social.example/native']);
  assert.deepEqual(JSON.parse(tables.articles[0].publication_links), { website: ['https://example.com/site'] });
  assert.deepEqual(tables.social_posts, posts);
  assert.throws(() => workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: '', links: ['javascript:alert(1)'] }, ctx));
  assert.throws(() => workspace.setStage({ key: 'topic:topic', workspace: 'social', stage: '', links: Array.from({ length: 21 }, (_, i) => 'https://social.example/' + i) }, ctx));
});
test('editing links on a merged entry moves older topic and draft links to the plan, so removed ones stay removed', () => {
  const { ctx, tables } = fixture();
  tables.topics = [{ id: 'topic', title: 'Topic', workspace: 'social', publication_links: '{"social":["https://social.example/topic"]}' }];
  tables.articles = [{ id: 'article', title: 'Draft', topic_id: 'topic', publication_links: '{"social":["https://social.example/draft"],"website":["https://example.com/site"]}' }];
  tables.marketing_plans = [{ id: 'plan', platform: 'xiaohongshu', topic_id: 'topic', article_id: 'article' }];
  workspace.setStage({ key: 'plan:plan', workspace: 'social', stage: '', links: ['https://social.example/draft'] }, ctx);
  const entry = contentEntries(workspace.context({}, ctx), 'social')[0];
  assert.deepEqual(entry.linkedUrls, ['https://social.example/draft']);
  assert.deepEqual(JSON.parse(tables.marketing_plans[0].publication_links), { social: ['https://social.example/draft'] });
  assert.equal(tables.topics[0].publication_links, '');
  assert.deepEqual(JSON.parse(tables.articles[0].publication_links), { website: ['https://example.com/site'] });
});
test('posts without an original are their own social rows; data sums each published post of an entry', () => {
  const data = empty();
  data.channels = [{ id: 'xhs', type: 'xiaohongshu' }];
  data.articles = [{ id: 'article', target_account_id: 'xhs' }];
  data.posts = [
    { id: 'p1', article_id: 'article', channel_id: 'xhs', status: 'published', views: 100, likes: 5, comments: 1 },
    { id: 'p2', article_id: 'article', channel_id: 'x', status: 'published', views: 50, likes: 1, comments: 0 },
    { id: 'draft', article_id: 'article', channel_id: 'x', status: 'draft', views: 999 },
    { id: 'native', channel_id: 'xhs', source: 'platform', status: 'published', title: '', body: 'First line\nmore', post_url: 'https://www.xiaohongshu.com/explore/1', views: 7 },
  ];
  data.post_gains = { p1: { views: 30, likes: 2, comments: 0, collects: 0, shares: 0 } };
  const social = contentEntries(data, 'social'), native = social.find(r => r.key === 'post:native');
  assert.deepEqual(native.workspaces, ['social']); assert.equal(native.stage, 'published'); assert.equal(native.title, 'First line');
  assert.deepEqual(native.publicationUrls, ['https://www.xiaohongshu.com/explore/1']); assert.deepEqual(entryAccountIds(native, data, 'social', true), ['xhs']);
  assert.ok(!contentEntries(data, 'website').some(r => r.post));
  const m = entryMetrics(social.find(r => r.article?.id === 'article'), data);
  assert.equal(m.views, 150); assert.equal(m.likes, 6); assert.equal(m.posts, 2); assert.equal(m.gain.views, 30);
  assert.equal(entryMetrics(native, data).gain, null);
  data.posts = []; assert.equal(entryMetrics(contentEntries(data, 'social')[0], data), null);
});
test('a platform post can be linked to existing content or saved as content; only its article_id changes', () => {
  const { ctx, tables, updates } = fixture();
  tables.social_accounts = [{ id: 'xhs', type: 'xiaohongshu' }];
  tables.social_posts = [{ id: 'a', channel_id: 'xhs', source: 'platform', status: 'published', body: 'Hello\nworld', images: '["i"]', published_at: '2026-10-01T00:00:00Z', views: 3 },
    { id: 'b', channel_id: 'xhs', source: 'platform', status: 'published', title: 'B' }];
  assert.throws(() => workspace.assign({ key: 'post:a', workspace: 'social' }, ctx));
  assert.equal(workspace.adoptPost({ post_id: 'a', article_id: 'article' }, ctx).article_id, 'article');
  assert.equal(tables.social_posts[0].article_id, 'article'); assert.equal(tables.social_posts[0].views, 3);
  assert.throws(() => workspace.adoptPost({ post_id: 'a' }, ctx));
  assert.throws(() => workspace.adoptPost({ post_id: 'b', article_id: 'missing' }, ctx));
  const { article_id } = workspace.adoptPost({ post_id: 'b' }, ctx), saved = tables.articles.find(r => r.id === article_id);
  assert.equal(saved.title, 'B'); assert.equal(saved.type, 'post'); assert.equal(saved.workspace, 'social'); assert.equal(saved.target_account_id, 'xhs'); assert.equal(saved.status, 'published');
  assert.ok(updates.filter(u => u.table === 'social_posts').every(u => Object.keys(u.patch).join() === 'article_id'));
  const rows = contentEntries(workspace.context({}, ctx), 'social');
  assert.ok(!rows.some(r => r.post)); assert.ok(rows.some(r => r.article?.id === article_id));
});
test('7-day growth is latest minus the last record before the window; older posts without a baseline are left out', () => {
  const { ctx, tables } = fixture();
  const day = n => { const d = new Date(Date.now() - n * 86400000), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` };
  tables.social_posts = [{ id: 'old', article_id: 'article', status: 'published', published_at: '2020-01-01T00:00:00Z' },
    { id: 'new', article_id: 'article', status: 'published', published_at: new Date().toISOString() },
    { id: 'gap', article_id: 'article', status: 'published', published_at: '2020-01-01T00:00:00Z' }];
  const daily = [{ post_id: 'old', date: day(10), views: 100 }, { post_id: 'old', date: day(0), views: 160 }, { post_id: 'new', date: day(0), views: 40 }, { post_id: 'gap', date: day(1), views: 9 }];
  ctx.db.aggregate = (_t, q) => {
    const rows = daily.filter(r => !q.filter || r.date < q.filter[0].value), last = {};
    for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) last[r.post_id] = r;
    return { list: Object.values(last) };
  };
  const gains = workspace.context({}, ctx).post_gains;
  assert.equal(gains.old.views, 60); assert.equal(gains.new.views, 40); assert.equal(gains.gap, undefined);
});
test('collected posts behind a confirmed link count toward that content by platform id, without becoming separate rows', () => {
  const data = empty();
  data.plans = [{ id: 'plan', platform: 'xiaohongshu', publication_links: JSON.stringify({ social: ['https://www.xiaohongshu.com/explore/abc123?xsec_token=t'] }) }];
  data.posts = [{ id: 'hit', post_id: 'abc123', channel_id: 'xhs', status: 'published', views: 12, post_url: 'https://www.xiaohongshu.com/explore/abc123' },
    { id: 'partial', post_id: 'abc', channel_id: 'xhs', status: 'published', views: 99 }];
  const rows = contentEntries(data, 'social'), plan = rows.find(r => r.key === 'plan:plan');
  assert.deepEqual(plan.linkedPosts.map(p => p.id), ['hit']); assert.equal(entryMetrics(plan, data).views, 12);
  assert.deepEqual(entryAccountIds(plan, data, 'social', true), ['xhs']);
  assert.deepEqual(rows.filter(r => r.post).map(r => r.post.id), ['partial']);
});
test('ranking compares content within each platform, only recent posts, and topics.context carries it for social topics', () => {
  const { ctx, tables } = fixture();
  const ago = d => new Date(Date.now() - d * 86400000).toISOString();
  tables.social_accounts = [{ id: 'xhs', name: 'XHS', type: 'xiaohongshu' }, { id: 'dy', name: 'DY', type: 'douyin' }];
  tables.social_posts = [
    { id: 'a', article_id: 'article', channel_id: 'xhs', status: 'published', published_at: ago(20), views: 900, likes: 90 },
    { id: 'b', article_id: 'article', channel_id: 'dy', status: 'published', published_at: ago(20), views: 50000 },
    { id: 'c', channel_id: 'xhs', status: 'published', published_at: ago(30), views: 10, body: 'Quiet post' },
    { id: 'd', channel_id: 'xhs', status: 'published', published_at: ago(400), views: 99999 },
    { id: 'e', channel_id: 'xhs', status: 'draft', views: 5 },
  ];
  const r = workspace.ranking({}, ctx);
  assert.equal(r.published, 3);
  assert.deepEqual(r.platforms.xiaohongshu.top.map(x => x.views), [900, 10]);
  assert.equal(r.platforms.xiaohongshu.top[0].engagement_rate, 10);
  assert.equal(r.platforms.douyin.top[0].views, 50000);
  assert.equal(r.platforms.xiaohongshu.top[1].excerpt, 'Quiet post');
  assert.ok(topics.context({ workspace: 'social' }, ctx).performance.platforms.douyin);
  assert.equal(topics.context({ workspace: 'website' }, ctx).performance, undefined);
});
test('performance returns each post\'s daily totals in date order, capped and de-duplicated', () => {
  const { ctx } = fixture(); const asked = [];
  ctx.db.query = (table, q) => { asked.push(q.where.post_id); return { list: table === 'social_post_daily' ? [{ post_id: q.where.post_id, date: '2026-10-01', views: '5' }] : [] } };
  const r = workspace.performance({ post_ids: ['p', 'p', 'q', 3] }, ctx);
  assert.deepEqual(asked, ['p', 'q']); assert.equal(r.days.p[0].views, 5); assert.equal(r.days.q[0].likes, 0);
});
