import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'backlinks-test-'))
fs.cpSync(path.join(root, 'core/local'), path.join(temp, 'local'), { recursive: true })
fs.cpSync(path.join(root, 'core/features/plan'), temp, { recursive: true })
// backlinks.context 用 business 模块 _ai 的 profile / projectBrief（它还依赖网站模块和模板的行业文件），这里给一份最小的替身
fs.writeFileSync(path.join(temp, 'local/_ai.ts'), "export const profile = (ctx) => ctx.db.query('profile').list[0] ?? { name: '' }\nexport const projectBrief = (p) => `公司：${p.name}\\n主营：${p.business ?? ''}`\n")
await build({ stdin: { contents: "export * as backlinks from './local/backlinks'", resolveDir: temp }, outfile: path.join(temp, 'test.mjs'), bundle: true, platform: 'node', format: 'esm' })
const { backlinks } = await import(pathToFileURL(path.join(temp, 'test.mjs')))
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }))

function fixture(seed = {}) {
  const tables = structuredClone(seed), counts = {}
  const ctx = { locale: 'zh', db: {
    query(table) { return { list: (tables[table] || []).map((r) => ({ ...r })) } },
    get(table, id) { const r = tables[table]?.find((r) => r.id === id); return r ? { ...r } : null },
    insert(table, data) { const row = { ...data, id: `${table}-${counts[table] = (counts[table] || 0) + 1}` }; (tables[table] ||= []).push(row); return { ...row } },
    update(table, id, patch) { Object.assign(tables[table].find((r) => r.id === id), patch); return { ok: true } },
    delete(table, id) { tables[table] = tables[table].filter((r) => r.id !== id) },
  } }
  return { tables, ctx }
}
const site = { id: 'c1', type: 'creght_site', live_url: 'https://www.pofung.com' }

test('社媒帖子里有本站链接的自动登记，只登记一次', () => {
  const { ctx, tables } = fixture({
    channels: [site], social_accounts: [{ id: 's1', platform: 'instagram' }],
    social_posts: [
      { id: 'p1', channel_id: 's1', status: 'published', post_url: 'https://instagram.com/p/1', body: 'New sofa https://pofung.com/sofa.' },
      { id: 'p2', channel_id: 's1', status: 'published', post_url: 'https://instagram.com/p/2', body: 'see www.pofung.com' },
      { id: 'p3', channel_id: 's1', status: 'published', post_url: 'https://instagram.com/p/3', body: 'no link' },
      { id: 'p4', channel_id: 's1', status: 'draft', body: 'https://pofung.com' },
    ],
  })
  assert.equal(backlinks.sync({}, ctx).added, 2)
  assert.equal(backlinks.sync({}, ctx).added, 0)
  const b = tables.backlinks.find((x) => x.post_id === 'p1')
  assert.equal(b.target_url, 'https://pofung.com/sofa')
  assert.equal(b.nofollow, true)
  assert.equal(b.platform, 'instagram')
})

test('手动登记去重；询盘按来源网址算到外链上', () => {
  const { ctx } = fixture({ channels: [site], leads: [{ id: 'l1', referrer: 'https://www.houzz.com/pro/pofung' }, { id: 'l2', utm: '{"source":"alibaba"}' }, { id: 'l3', referrer: 'https://google.com' }] })
  assert.throws(() => backlinks.add({ source_url: 'houzz.com' }, ctx), /完整网址/)
  backlinks.add({ source_url: 'https://www.houzz.com/pro/pofung/', kind: 'directory' }, ctx)
  assert.equal(backlinks.add({ source_url: 'https://www.houzz.com/pro/pofung' }, ctx).duplicate, true)
  backlinks.add({ source_url: 'https://pofung.en.alibaba.com', kind: 'b2b', platform: 'alibaba' }, ctx)
  const l = backlinks.list({}, ctx)
  assert.equal(l.list.length, 2)
  assert.equal(l.list.find((x) => x.kind === 'directory').leads, 1)
  assert.equal(l.list.find((x) => x.kind === 'b2b').leads, 1)
})

test('检查：找到链接是在线，找不到是丢了，社媒读不到不改原来的结论', async () => {
  const { ctx, tables } = fixture({ channels: [site], backlinks: [
    { id: 'b1', source_url: 'https://dir.com/a', status: 'live' },
    { id: 'b2', source_url: 'https://dir.com/b', status: 'live' },
    { id: 'b3', source_url: 'https://www.instagram.com/p/1', status: 'live' },
    { id: 'b4', source_url: 'https://dir.com/gone', status: 'live' },
  ] })
  globalThis.fetch = async (u) => u.endsWith('/gone') ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => u.endsWith('/a') ? '<a rel="nofollow ugc" href="https://pofung.com/x">Pofung</a>' : '<p>nothing</p>' }
  const r = await backlinks.check({}, ctx)
  const st = Object.fromEntries(tables.backlinks.map((b) => [b.id, b.status]))
  assert.deepEqual(st, { b1: 'live', b2: 'lost', b3: 'live', b4: 'lost' })
  assert.equal(tables.backlinks[0].nofollow, true)
  assert.equal(r.checked, 4)
})

test('AI 找的机会：存成打算做、同一网站跳过；已申请记时间，14 天没上线提醒跟进', () => {
  const { ctx, tables } = fixture({ channels: [site], profile: [{ id: 'p', name: 'Pofung', business: '家具', markets: '欧洲' }], backlinks: [{ id: 'b0', source_url: 'https://www.houzz.com/pro/x', status: 'live' }] })
  ctx.chat_id = 'chat-1'
  const c = backlinks.context({}, ctx)
  assert.match(c.project, /主营：家具/)
  assert.deepEqual(c.own_sites, ['pofung.com'])
  assert.equal(c.existing[0].domain, 'houzz.com')
  const r = backlinks.saveSuggestions({ items: [
    { source_url: 'https://www.europages.co.uk/', kind: 'directory', how_to: '注册免费公司页', effort: 'easy', paid: false },
    { source_url: 'https://houzz.com/', kind: 'directory' },
    { source_url: 'https://www.pofung.com/blog', kind: 'other' },
    { source_url: 'https://europages.co.uk/another', kind: 'directory' },
    { source_url: 'https://www.archiproducts.com/', kind: 'nonsense' },
  ] }, ctx)
  assert.equal(r.added, 2)
  assert.equal(r.skipped.length, 3)
  const ep = tables.backlinks.find((b) => b.platform === 'europages.co.uk')
  assert.equal(ep.status, 'planned')
  assert.equal(ep.ai, true)
  assert.equal(ep.chat_id, 'chat-1')
  assert.equal(tables.backlinks.find((b) => b.platform === 'archiproducts.com').kind, 'other')
  assert.throws(() => backlinks.saveSuggestions({ items: [{ source_url: 'https://a.com', effort: 'trivial' }] }, ctx), /effort/)

  backlinks.update({ id: ep.id, status: 'applied' }, ctx)
  assert.ok(ep.applied_at)
  ep.applied_at = new Date(Date.now() - 15 * 86400000).toISOString()
  const row = backlinks.list({}, ctx).list.find((b) => b.id === ep.id)
  assert.equal(row.days_applied, 15)
  assert.equal(row.follow_up, true)
  backlinks.update({ id: ep.id, status: 'live', source_url: 'https://www.europages.co.uk/en/company/pofung' }, ctx)
  assert.ok(ep.live_at)
  assert.equal(ep.source_url, 'https://www.europages.co.uk/en/company/pofung')
})

test('检查：已申请的读到链接自动标在线，读不到保持已申请', async () => {
  const { ctx, tables } = fixture({ channels: [site], backlinks: [
    { id: 'a1', source_url: 'https://dir.com/ok', status: 'applied', applied_at: '2026-11-01T00:00:00Z' },
    { id: 'a2', source_url: 'https://dir.com/wait', status: 'applied', applied_at: '2026-11-01T00:00:00Z' },
    { id: 'p1', source_url: 'https://dir.com/plan', status: 'planned' },
  ] })
  globalThis.fetch = async (u) => ({ ok: true, status: 200, text: async () => u.endsWith('/ok') ? '<a href="https://pofung.com/">Pofung</a>' : '<p>nothing</p>' })
  await backlinks.check({}, ctx)
  const st = Object.fromEntries(tables.backlinks.map((b) => [b.id, b.status]))
  assert.deepEqual(st, { a1: 'live', a2: 'applied', p1: 'planned' })
  assert.ok(tables.backlinks[0].live_at)
  assert.equal(tables.backlinks[2].checked_at, undefined)
})
