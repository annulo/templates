import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'inspiration-test-'))
fs.cpSync(path.join(root, 'product'), temp, { recursive: true })
fs.cpSync(path.join(root, 'core/local'), path.join(temp, 'local'), { recursive: true })
fs.cpSync(path.join(root, 'core/features/websites'), temp, { recursive: true })
await build({ stdin: { contents: "export * as inspiration from './local/inspiration'; export * as topics from './local/topics'; export * as content from './local/content';", resolveDir: temp }, outfile: path.join(temp, 'test.mjs'), bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'social-stub', setup(b) { b.onResolve({ filter: /plugins\/social\// }, (a) => ({ path: a.path, namespace: 'social-stub' })); b.onLoad({ filter: /.*/, namespace: 'social-stub' }, () => ({ contents: `export const FIELDS = {}; export async function summary() { return [] }
export const CONTENT_TYPES = ['article', 'post', 'video'];
export const contentType = c => c?.type === 'post' || c?.type === 'video' ? c.type : 'article';
export const parseList = v => Array.isArray(v) ? v : JSON.parse(v || '[]');
export const lengthOn = c => String(c.body || '').length;
export const platformsFor = () => [];
export const htmlImages = () => [];
export const supports = () => false;
export const fromContent = c => c;`, loader: 'ts' })) } }] })
const { inspiration: lib, topics, content } = await import(pathToFileURL(path.join(temp, 'test.mjs')))
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }))
function fixture() {
  const tables = {}, counts = {}
  const ctx = { locale: 'zh', db: {
    query(table, opt = {}) { let out = tables[table] || []; if (opt.where) out = out.filter((r) => Object.entries(opt.where).every(([k, v]) => r[k] === v)); return { list: out.slice(opt.offset || 0, (opt.offset || 0) + (opt.limit || 1000)).map((r) => ({ ...r })) } },
    get(table, id) { const r = tables[table]?.find((r) => r.id === id); return r ? { ...r } : null },
    insert(table, data) { const row = { ...data, id: `${table}-${counts[table] = (counts[table] || 0) + 1}` }; (tables[table] ||= []).push(row); return { ...row } },
    update(table, id, patch) { const row = tables[table].find((r) => r.id === id); Object.assign(row, patch); return { ...row } },
    delete(table, id) { tables[table] = tables[table].filter((r) => r.id !== id) },
  } }
  return { tables, ctx }
}
const creator = { nickname: 'Example', platform: 'xiaohongshu', profile_url: 'https://www.xiaohongshu.com/user/profile/123?xsec_token=a' }
const source = { title: 'Source', url: 'https://www.xiaohongshu.com/explore/abc?xsec_token=a', content: 'Original text about a website workflow.', summary: 'Original summary', why_save: 'Useful process', adaptation_idea: 'Use real product footage' }
test('account deduplication uses platform and identity; unknown metrics remain unknown', () => {
  const { ctx } = fixture()
  const c = lib.saveCreator(creator, ctx)
  assert.equal(c.followers_count, null)
  assert.throws(() => lib.saveCreator({ ...creator, profile_url: 'https://xiaohongshu.com/user/profile/123?utm_source=b' }, ctx))
  assert.throws(() => lib.saveCreator({ ...creator, profile_url: 'https://example.com/456', followers_count: 0 }, ctx))
  const second = lib.saveCreator({ ...creator, profile_url: 'https://example.com/456', followers_count: 0, snapshot_at: '2026-10-12T00:00:00Z', person_key: 'example' }, ctx)
  assert.equal(second.followers_count, 0)
  assert.throws(() => lib.saveCreator({ ...second, likes_count: -1 }, ctx))
  assert.throws(() => lib.saveCreator({ ...creator, profile_url: 'javascript:alert(1)' }, ctx))
})
test('source canonicalization deduplicates share URLs while preserving original links', () => {
  const { ctx } = fixture()
  const s = lib.saveSource(source, ctx)
  assert.equal(s.url, source.url)
  assert.throws(() => lib.saveSource({ ...source, url: 'https://xiaohongshu.com/discovery/item/abc?xsec_token=b' }, ctx))
  assert.notEqual(lib.canonical('https://youtube.com/watch?v=one', ctx), lib.canonical('https://youtube.com/watch?v=two', ctx))
  assert.throws(() => lib.saveSource({ ...source, creator_id: 'missing' }, ctx))
  const edited = lib.saveSource({ id: s.id, content: 'Updated source text' }, ctx)
  assert.equal(edited.version, 2)
  assert.throws(() => lib.saveReview({ source_id: s.id, source_version: 1 }, ctx))
})
test('selected sources become topic references, writing snapshots and article usage', async () => {
  const { ctx, tables } = fixture()
  const c = lib.saveCreator(creator, ctx)
  const s = lib.saveSource({ ...source, creator_id: c.id }, ctx)
  const saved = topics.save({ ideas: [{ title: 'Our original topic', angle: 'Real product workflow' }], source_ids: [s.id] }, ctx)
  const topicId = saved.topic_ids[0]
  lib.link({ source_id: s.id, target_type: 'topic', target_id: topicId }, ctx)
  assert.equal(tables.content_references.length, 1)
  assert.equal(topics.context({ source_ids: [s.id] }, ctx).sources[0].creator.nickname, c.nickname)
  const writing = await content.context({ topic_id: topicId, type: 'post' }, ctx)
  assert.ok(writing.evidence_id)
  assert.equal(writing.research.sources[0].summary, source.summary)
  lib.saveSource({ id: s.id, summary: 'Updated summary' }, ctx)
  const article = content.save({ type: 'post', topic_id: topicId, evidence_id: writing.evidence_id, title: 'Our article', body: 'A real original explanation of our product workflow.' }, ctx)
  const refs = lib.references({ target_type: 'article', target_id: article.article_id }, ctx)
  assert.equal(refs.sources[0].summary, source.summary)
  assert.equal(refs.sources[0].creator.nickname, creator.nickname)
  assert.equal(content.save({ type: 'post', topic_id: topicId, evidence_id: writing.evidence_id, title: 'Retry', body: 'A real original explanation of our product workflow.' }, ctx).article_id, article.article_id)
  assert.equal(lib.list({}, ctx).sources[0].uses.length, 2)
  const rewrite = content.rewriteContext({ article_id: article.article_id, type: 'post' }, ctx)
  const rewritten = content.save({ type: 'post', source_id: article.article_id, evidence_id: rewrite.evidence_id, title: 'Rewritten original', body: 'A different original explanation of the same verified product workflow.' }, ctx)
  assert.equal(lib.references({ target_type: 'article', target_id: rewritten.article_id }, ctx).sources[0].summary, source.summary)
  const revision = content.revisionContext({ article_id: article.article_id }, ctx)
  assert.equal(revision.research.sources[0].summary, source.summary)
  lib.archive({ kind: 'source', id: s.id }, ctx)
  assert.equal(lib.references({ target_type: 'article', target_id: article.article_id }, ctx).sources[0].summary, source.summary)
})
test('invalid source references are rejected before topics are created', () => {
  const { ctx, tables } = fixture()
  assert.throws(() => topics.save({ ideas: [{ title: 'Topic' }], source_ids: ['missing'] }, ctx))
  assert.equal(tables.topics, undefined)
})
test('legacy import validates before writes, maps author IDs, preserves media and retries safely', () => {
  const { ctx, tables } = fixture()
  const input = { origin: 'https://old.example/admin', creators: [{ id: 'old-1', body: { creatorId: 'business-1', nickname: 'Old creator', platform: 'xiaohongshu', profileUrl: creator.profile_url, followersCount: 0 } }], inspirations: [{ id: 'old-source', body: { title: 'Old inspiration', sourceUrl: source.url, creatorId: 'business-1', summary: source.summary, images: [{ id: 'image', url: 'https://cdn.example/image.jpg', note: 'Source media' }], usedInTaskIds: ['old-task'], status: 'used' } }] }
  assert.throws(() => lib.importLegacy({ ...input, inspirations: [...input.inspirations, { id: 'invalid', body: { title: '' } }] }, ctx))
  assert.equal(tables.reference_creators, undefined)
  const preview = lib.importLegacy({ ...input, preview: true }, ctx)
  assert.equal(preview.sources, 1)
  assert.equal(tables.reference_creators, undefined)
  const first = lib.importLegacy(input, ctx)
  assert.equal(first.creators, 1)
  assert.equal(first.sources, 1)
  assert.equal(tables.research_sources[0].creator_id, tables.reference_creators[0].id)
  assert.equal(tables.reference_creators[0].followers_count, null)
  assert.equal(JSON.parse(tables.research_sources[0].images)[0].note, 'Source media')
  assert.equal(JSON.parse(tables.research_sources[0].legacy_snapshot).usedInTaskIds[0], 'old-task')
  assert.equal(lib.list({}, ctx).sources[0].uses.length, 0)
  lib.saveSource({ id: tables.research_sources[0].id, summary: 'Our reviewed summary' }, ctx)
  const second = lib.importLegacy(input, ctx)
  assert.equal(second.creators + second.sources, 0)
  assert.equal(second.skipped, 2)
  assert.equal(tables.research_sources[0].summary, 'Our reviewed summary')
})
