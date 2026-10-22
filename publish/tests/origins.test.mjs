// 选题的出处（docs/content-origins.md）：AI 搜索问题 → 选题，标题重复时并进已有选题，没写问题的报错
// node --test publish/tests/origins.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'origins-'))
fs.cpSync(path.join(root, 'product'), temp, { recursive: true })
fs.cpSync(path.join(root, 'core/local'), path.join(temp, 'local'), { recursive: true })
fs.cpSync(path.join(root, 'core/lib'), path.join(temp, 'lib'), { recursive: true })
fs.cpSync(path.join(root, 'core/features/websites'), temp, { recursive: true })
await build({ stdin: { contents: "export * as topics from './local/topics'; export * from './lib/origins';", resolveDir: temp },
  bundle: true, platform: 'node', format: 'esm', outfile: path.join(temp, 'test.mjs'), logLevel: 'silent',
  plugins: [{ name: 'social-fixture', setup(b) {
    b.onResolve({ filter: /plugins\/social\// }, (a) => ({ path: a.path, namespace: 'social-fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'social-fixture' }, () => ({ loader: 'ts', contents: "export const FIELDS={}; export const CONTENT_TYPES=['article','post','video']; export const contentType=c=>c?.type || 'article'; export const parseList=v=>Array.isArray(v)?v:JSON.parse(v || '[]'); export const lengthOn=c=>String(c.body || '').length; export const platformsFor=()=>[]; export const htmlImages=()=>[]; export const supports=()=>false; export const fromContent=c=>c; export async function summary(){return []}" }))
  } }] })
const { topics, originsOf, topicsFrom } = await import(pathToFileURL(path.join(temp, 'test.mjs')))

function fakeCtx(tables) {
  let n = 0
  const rows = (t) => (tables[t] ??= [])
  const match = (r, where = {}) => Object.entries(where).every(([k, v]) => r[k] === v)
  return {
    locale: 'zh', chat_id: 'chat-1', progress() {}, log() {},
    db: {
      query: (t, o = {}) => ({ list: rows(t).filter((r) => match(r, o.where)), next_cursor: '' }),
      get: (t, id) => rows(t).find((r) => r.id === id) ?? null,
      insert: (t, d) => { const r = { id: `${t}-${++n}`, ...d }; rows(t).push(r); return r },
      update: (t, id, d) => { Object.assign(rows(t).find((r) => r.id === id), d); return { ok: true } },
    },
  }
}
const geoTables = () => ({
  geo_questions: [
    { id: 'q1', channel_id: 'c1', question: 'best sofa factory in china', intent: 'commercial', status: 'active' },
    { id: 'q2', channel_id: 'c1', question: 'Pofung reviews', intent: 'brand', status: 'active' },
    { id: 'q3', channel_id: 'c1', question: 'hotel furniture supplier', intent: 'commercial', status: 'active' },
  ],
  geo_results: [
    { question_id: 'q1', engine: 'chatgpt', cited: false, created_at: '2026-10-01' },
    { question_id: 'q1', engine: 'doubao', cited: false, created_at: '2026-10-01' },
    { question_id: 'q2', engine: 'chatgpt', cited: false, created_at: '2026-10-01' },
    { question_id: 'q3', engine: 'chatgpt', cited: false, created_at: '2026-09-01' },
    { question_id: 'q3', engine: 'chatgpt', cited: true, created_at: '2026-10-01' },
  ].map((r) => ({ channel_id: 'c1', ...r })),
  topics: [],
})

test('context gives the uncited recommendation questions, same rule as the AI search page', () => {
  const ctx = fakeCtx(geoTables())
  const r = topics.context({ channel_id: 'c1' }, ctx)
  assert.deepEqual(r.geo_questions.map((q) => q.id), ['q1']) // q2 是品牌问题，q3 最新一次引用了
})

test('geo topics must name their questions, and record question, label and chat', () => {
  const tables = geoTables()
  const ctx = fakeCtx(tables)
  assert.throws(() => topics.save({ source: 'geo', ideas: [{ title: 'How to pick a sofa factory' }] }, ctx), /question_ids/)
  assert.throws(() => topics.save({ source: 'geo', ideas: [{ title: 'x', question_ids: ['nope'] }] }, ctx), /nope/)
  const r = topics.save({ source: 'geo', workspace: 'website', ideas: [{ title: 'How to pick a sofa factory', question_ids: ['q1'] }] }, ctx)
  const t = tables.topics[0]
  assert.deepEqual(r.saved, ['How to pick a sofa factory'])
  assert.deepEqual(originsOf(t), [{ type: 'geo_question', id: 'q1', label: 'best sofa factory in china', channel_id: 'c1' }])
  assert.equal(t.chat_id, 'chat-1')
  assert.deepEqual(topicsFrom(tables.topics, 'geo_question', 'q1').map((x) => x.id), [t.id])
  // 再出选题时，写成过的问题带上选题标题
  assert.deepEqual(topics.context({ channel_id: 'c1' }, ctx).geo_questions[0].topic_titles, ['How to pick a sofa factory'])
})

test('a duplicate title links the new question to the existing topic instead of being dropped', () => {
  const tables = geoTables()
  const ctx = fakeCtx(tables)
  topics.save({ source: 'geo', workspace: 'website', ideas: [{ title: 'Sofa factory guide', question_ids: ['q1'] }] }, ctx)
  const r = topics.save({ source: 'geo', workspace: 'website', ideas: [{ title: 'sofa factory guide', question_ids: ['q3'] }] }, ctx)
  assert.deepEqual(r.linked, ['sofa factory guide'])
  assert.equal(tables.topics.length, 1)
  assert.deepEqual(originsOf(tables.topics[0]).map((o) => o.id), ['q1', 'q3'])
})

test('old rows: module fields are read as origins without migrating', () => {
  assert.deepEqual(originsOf({ campaign_id: 'c', search_query: 'sofa', source: 'search' }).map((o) => o.type), ['campaign', 'search_query'])
  assert.deepEqual(originsOf({ origins: 'not json' }), [])
})
