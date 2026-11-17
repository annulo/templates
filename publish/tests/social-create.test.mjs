// 新建社媒内容（core/features/business/docs/social-create.md）：页面存设置、存方案时按平台限制查文案、切回旧版
// node --test publish/tests/social-create.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-create-'))
fs.cpSync(path.join(root, 'product'), temp, { recursive: true })
fs.cpSync(path.join(root, 'core/local'), path.join(temp, 'local'), { recursive: true })
fs.cpSync(path.join(root, 'core/lib'), path.join(temp, 'lib'), { recursive: true })
for (const f of JSON.parse(fs.readFileSync(path.join(root, 'publish/targets.json'), 'utf8')).product.features) fs.cpSync(path.join(root, 'core/features', f), temp, { recursive: true })
// 社媒插件换成假的：小红书标题 20 字、正文 1000、话题 10；save 记下收到的参数
await build({ stdin: { contents: "export * as sc from './local/social-create'", resolveDir: temp },
  bundle: true, platform: 'node', format: 'esm', outfile: path.join(temp, 'test.mjs'), logLevel: 'silent',
  plugins: [{ name: 'social-fixture', setup(b) {
    b.onResolve({ filter: /plugins\/social\// }, (a) => ({ path: a.path, namespace: 'social-fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'social-fixture' }, () => ({ loader: 'ts', contents: `
      const xhs = { title: 'publish', titleMax: 20, body: 'text', bodyMax: 1000, len: (b) => [...b].length, tags: 10, images: 18, video: 'optional', cover: true, category: false, coverRatio: [3, 4] }
      export const FIELDS = { xiaohongshu: xhs }
      export const fieldsFor = (p) => FIELDS[p]
      export const saved = []
      export const PLATFORMS = { xiaohongshu: { save: (input) => { saved.push(input); return { post_id: 'post-1', problems: [] } } } }
      export const CONTENT_TYPES=['article','post','video']; export const contentType=c=>c?.type || 'article'; export const parseList=v=>Array.isArray(v)?v:JSON.parse(v || '[]'); export const lengthOn=c=>String(c.body || '').length; export const platformsFor=()=>[]; export const htmlImages=()=>[]; export const supports=()=>false; export const fromContent=c=>c; export async function summary(){return []} export const userIdOf=()=>''; export async function creatorNotes(){return []}` }))
  } }] })
const { sc } = await import(pathToFileURL(path.join(temp, 'test.mjs')))

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
const accounts = () => ({ social_accounts: [{ id: 'xhs1', type: 'xiaohongshu', name: '小红书号', profile: 'AI 工具' }] })
const social = { request: '录 30 秒视频发小红书', source: { kind: 'url', url: 'https://example.com' }, platforms: [{ channel_id: 'xhs1', type: 'xiaohongshu', why: 'said' }], format: { type: 'video', duration: 30, aspect: '4:3' } }
const shots = [{ start: 0, end: 4, screen: 1, y_from: 0, y_to: 100, caption: '开场' }, { start: 4, end: 30, card: { title: 'Annulo' } }]

test('页面存设置：没有选题先建一个，归到自媒体；再存不丢函数写的网站和方案', () => {
  const tables = accounts(), ctx = fakeCtx(tables)
  const { topic_id } = sc.save({ social }, ctx)
  const topic = tables.topics[0]
  assert.equal(topic.id, topic_id)
  assert.equal(topic.workspace, 'social')
  assert.equal(topic.content_type, 'video')
  assert.equal(topic.target_platform, 'xiaohongshu')
  const brief = JSON.parse(topic.brief)
  brief.social.site = { url: 'https://example.com', screens: [{ n: 1, y: 0, file: 'a.jpg' }] }
  topic.brief = JSON.stringify(brief)
  sc.save({ topic_id, social: { ...social, request: '改了要求', site: null } }, ctx)
  const after = JSON.parse(tables.topics[0].brief).social
  assert.equal(after.request, '改了要求')
  assert.equal(after.site.url, 'https://example.com')
})

test('存方案：按平台限制查文案，问题返回给助手；每存一次是新的一版，能切回', () => {
  const tables = accounts(), ctx = fakeCtx(tables)
  const { topic_id } = sc.save({ social }, ctx)
  const long = sc.savePlan({ topic_id, plan: { title: '方案', shots, copies: [{ channel_id: 'xhs1', title: '这是一个特别特别特别特别特别长的小红书标题啊', body: '正文', tags: ['a'] }] } }, ctx)
  assert.equal(long.version, 1)
  assert.match(long.problems.join(), /标题 2\d 字，最多 20/)
  const ok = sc.savePlan({ topic_id, plan: { title: '方案', shots, copies: [{ channel_id: 'xhs1', title: '一句话做出运营后台', body: '正文', tags: ['#AI工具'] }] } }, ctx)
  assert.equal(ok.version, 2)
  assert.deepEqual(ok.problems, [])
  let s = JSON.parse(tables.topics[0].brief).social
  assert.equal(s.plan.version, 2)
  assert.equal(s.plan.chat_id, 'chat-1')
  assert.deepEqual(s.plan.copies[0].tags, ['AI工具'])
  sc.pickPlan({ topic_id, version: 1 }, ctx)
  s = JSON.parse(tables.topics[0].brief).social
  assert.equal(s.plan.version, 1)
  assert.equal(s.plans.length, 2)
})

test('方案缺账号文案、视频没分镜都报出来', () => {
  const tables = accounts(), ctx = fakeCtx(tables)
  const { topic_id } = sc.save({ social }, ctx)
  assert.throws(() => sc.savePlan({ topic_id, plan: { title: 'x', copies: [] } }, ctx), /分镜/)
  const r = sc.savePlan({ topic_id, plan: { title: 'x', shots, copies: [] } }, ctx)
  assert.match(r.problems.join(), /小红书号：缺这个账号的文案/)
})
