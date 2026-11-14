// 分析网站（core/features/plan/local/diagnosis.ts）：开一次、不重复开、每一步记状态和结论，收尾时没走到的记跳过，计划没出来算失败
// node --test publish/tests/diagnosis.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnosis-test-'))
fs.mkdirSync(path.join(temp, 'local'))
fs.cpSync(path.join(root, 'core/local/_i18n.ts'), path.join(temp, 'local/_i18n.ts'))
fs.cpSync(path.join(root, 'core/features/plan/local/diagnosis.ts'), path.join(temp, 'local/diagnosis.ts'))
// 网站检查、AI 搜索检测换成假的：结果由测试控制
fs.writeFileSync(path.join(temp, 'local/audit.ts'), 'export async function run(i, ctx) { return globalThis.fake.audit(i, ctx) }')
fs.writeFileSync(path.join(temp, 'local/geo.ts'), 'export function autoEngine() { return globalThis.fake.engine } export function brandQuestions() { return { added: ["q"] } } export async function check(i, ctx) { return globalThis.fake.geo(i, ctx) }')
await build({ stdin: { contents: "export * as diagnosis from './local/diagnosis'", resolveDir: temp }, outfile: path.join(temp, 'test.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { diagnosis } = await import(pathToFileURL(path.join(temp, 'test.mjs')))
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }))
// 有竞品模块的模板（外贸）多一步
let hasCompetitors = false
globalThis.require = (p) => { if (hasCompetitors && /\/competitors\.ts$/.test(p)) return {}; throw new Error('not found ' + p) }

function fixture(seed = {}) {
  const tables = { channels: [{ id: 'c1', type: 'website' }, { id: 'c2', type: 'creght_site' }], onboarding: [{ key: 'trade', channel_id: 'c2' }], ...seed }
  let n = 0
  const ctx = {
    locale: 'zh', progress() {}, log() {},
    db: {
      query: (t) => ({ list: (tables[t] ??= []).map((r) => ({ ...r })) }),
      get: (t, id) => { const r = (tables[t] ?? []).find((r) => r.id === id); return r ? { ...r } : null },
      insert: (t, d) => { const r = { id: `${t}-${++n}`, ...d }; (tables[t] ??= []).push(r); return { ...r } },
      update: (t, id, d) => { Object.assign(tables[t].find((r) => r.id === id), d); return { ok: true } },
    },
  }
  return { ctx, tables }
}

test('开一次：网站用向导里选的；在跑的不重复开；产品运营没有竞品这一步，外贸有', () => {
  const { ctx, tables } = fixture()
  const r = diagnosis.start({}, ctx)
  assert.equal(r.channel_id, 'c2')
  assert.deepEqual(r.steps.map((s) => s.key), ['audit', 'keywords', 'geo', 'plan'])
  assert.equal(diagnosis.start({}, ctx).id, r.id)
  assert.equal(tables.site_diagnosis.length, 1)
  hasCompetitors = true
  tables.site_diagnosis[0].status = 'done'
  assert.deepEqual(diagnosis.start({}, ctx).steps.map((s) => s.key), ['audit', 'keywords', 'geo', 'competitors', 'plan'])
  hasCompetitors = false
})

test('网站检查、AI 搜索自己记结论；失败了记原因不抛出；开不了检测记跳过', async () => {
  const { ctx } = fixture()
  const { id } = diagnosis.start({}, ctx)
  globalThis.fake = { audit: async (i) => (assert.equal(i.max, 100), { pages: 80, score: 72, issues: { high: 2, medium: 5 }, top: ['缺标题'] }), engine: { ready: true, engine: 'openai' }, geo: async () => ({}) }
  const a = await diagnosis.audit({ id }, ctx)
  assert.ok(a.ok)
  let s = diagnosis.get({}, ctx).run.steps.find((x) => x.key === 'audit')
  assert.equal(s.status, 'done')
  assert.match(s.summary, /80 页，72 分；严重问题 2 个/)

  globalThis.fake.audit = async () => { throw new Error('网站打不开') }
  assert.equal((await diagnosis.audit({ id }, ctx)).ok, false)
  s = diagnosis.get({}, ctx).run.steps.find((x) => x.key === 'audit')
  assert.deepEqual([s.status, s.error], ['failed', '网站打不开'])

  globalThis.fake.engine = { ready: false, reason: '没有能联网搜索的模型' }
  assert.equal(diagnosis.geoPrep({ id }, ctx).ready, false)
  s = diagnosis.get({}, ctx).run.steps.find((x) => x.key === 'geo')
  assert.deepEqual([s.status, s.summary], ['skipped', '没有能联网搜索的模型'])
})

test('任务报进度、记下对话；收尾：没走到的记跳过，计划出来了才算 done', () => {
  const { ctx } = fixture()
  const { id } = diagnosis.start({}, ctx)
  ctx.chat_id = 'chat-9'
  diagnosis.step({ id, step: 'keywords', status: 'running' }, ctx)
  assert.equal(diagnosis.get({}, ctx).run.chat_id, 'chat-9')
  diagnosis.step({ id, step: 'keywords', status: 'done', summary: '留下 40 个词' }, ctx)
  assert.throws(() => diagnosis.step({ id, step: 'nope', status: 'done' }, ctx), /没有这一步/)
  assert.throws(() => diagnosis.step({ id, step: 'plan', status: 'ok' }, ctx), /status/)
  let r = diagnosis.finish({ id }, ctx)
  assert.equal(r.status, 'failed')
  assert.equal(r.steps.find((s) => s.key === 'audit').status, 'skipped')

  const again = diagnosis.start({}, ctx)
  diagnosis.step({ id: again.id, step: 'plan', status: 'done', summary: '按正常档开始' }, ctx)
  r = diagnosis.finish({ id: again.id }, ctx)
  assert.equal(r.status, 'done')
  diagnosis.seen({ id: again.id }, ctx)
  assert.equal(diagnosis.get({}, ctx).run.seen, true)
})
