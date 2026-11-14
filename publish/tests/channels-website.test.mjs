// 任何网址都能加成网站渠道：不是 creght 的加成只读的 website，同域名不重复加；之后认出是 creght 站点时原地升级，id 不变
// node --test publish/tests/channels-website.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-website-'))
fs.cpSync(path.join(root, 'core/local'), path.join(temp, 'local'), { recursive: true })
fs.cpSync(path.join(root, 'core/features/websites'), temp, { recursive: true })
await build({ stdin: { contents: "export * as channels from './local/channels'", resolveDir: temp }, outfile: path.join(temp, 'test.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'social-stub', setup(b) {
    b.onResolve({ filter: /plugins\/social\// }, (a) => ({ path: a.path, namespace: 'social-stub' }))
    b.onLoad({ filter: /.*/, namespace: 'social-stub' }, () => ({ loader: 'ts', contents: 'export async function summary() { return [] }' }))
  } }] })
const { channels } = await import(pathToFileURL(path.join(temp, 'test.mjs')))
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }))

// 首页：pages[网址] 是页面 HTML；没有的当 404
let pages = {}
globalThis.fetch = async (url) => {
  const html = pages[String(url).replace(/\/$/, '')]
  return { ok: html != null, status: html != null ? 200 : 404, text: async () => html ?? '' }
}

function fixture() {
  const tables = { channels: [] }
  let n = 0
  const match = (r, where = {}) => Object.entries(where).every(([k, v]) => r[k] === v)
  const ctx = {
    locale: 'zh', workspace: {}, mcp: { servers: () => [] }, log() {}, progress() {},
    db: {
      query: (t, o = {}) => ({ list: (tables[t] ??= []).filter((r) => match(r, o.where)).slice(0, o.limit ?? 1000) }),
      get: (t, id) => (tables[t] ?? []).find((r) => r.id === id) ?? null,
      insert: (t, d) => { const r = { id: `${t}-${++n}`, ...d }; (tables[t] ??= []).push(r); return r },
      update: (t, id, d) => { Object.assign(tables[t].find((r) => r.id === id), d); return { ok: true } },
    },
  }
  return { ctx, tables }
}

test('不是 creght 的网址加成只读网站，名字用域名，地址只留域名；同域名再加返回同一条', async () => {
  pages = { 'https://acme.com/about': '<title>Acme Furniture | Factory</title>' }
  const { ctx, tables } = fixture()
  const ch = await channels.fromURL({ url: 'https://acme.com/about' }, ctx)
  assert.equal(ch.type, 'website')
  assert.equal(ch.name, 'acme.com')
  assert.equal(ch.preview_url, 'https://acme.com')
  assert.equal(ch.live_url, 'https://acme.com')
  const again = await channels.fromURL({ url: 'https://www.acme.com/' }, ctx)
  assert.equal(again.id, ch.id)
  assert.equal(tables.channels.length, 1)
})

test('首页读不到也照样加', async () => {
  pages = {}
  const { ctx } = fixture()
  const ch = await channels.fromURL({ url: 'https://down.example.org' }, ctx)
  assert.deepEqual([ch.type, ch.name], ['website', 'down.example.org'])
})

test('之后认出是 creght 站点：同域名的网站原地升级，id 和已有字段留着', async () => {
  pages = { 'https://acme.com': '<title>Acme</title>' }
  const { ctx, tables } = fixture()
  const ch = await channels.fromURL({ url: 'https://acme.com' }, ctx)
  tables.channels[0].gsc_property = 'sc-domain:acme.com'
  pages = { 'https://acme.com': '<title>Acme</title><script>window.__DATA__ = {"projectId":"p1","siteId":"s1","provider":{"url":"https://creght.com"}};</script>' }
  const up2 = await channels.fromURL({ url: 'https://acme.com' }, ctx)
  assert.equal(up2.id, ch.id)
  assert.equal(up2.type, 'creght_site')
  assert.deepEqual([up2.project_id, up2.site_id], ['p1', 's1'])
  assert.equal(tables.channels.length, 1)
  assert.equal(tables.channels[0].gsc_property, 'sc-domain:acme.com')
})

test('Annulo 项目本身的网址不加', async () => {
  pages = { 'https://ops.example.com': '<script>window.__DATA__ = {"projectId":"me","siteId":"s"};</script>' }
  const { ctx, tables } = fixture()
  ctx.workspace = { shuttle_projects: ['me'] }
  assert.equal(await channels.fromURL({ url: 'https://ops.example.com' }, ctx), null)
  assert.equal(tables.channels.length, 0)
})
