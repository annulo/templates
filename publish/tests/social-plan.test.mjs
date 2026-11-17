import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 社媒发布记录和增长计划的结合：指标、按计划项归属判断做完、询盘归因、本站链接带来源参数
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-plan-test-'))
fs.mkdirSync(path.join(temp, 'local'))
for (const f of ['plan.ts', '_social.ts', 'backlinks.ts']) fs.copyFileSync(path.join(root, 'core/features/plan/local', f), path.join(temp, 'local', f))
fs.copyFileSync(path.join(root, 'core/local/_i18n.ts'), path.join(temp, 'local/_i18n.ts'))
fs.writeFileSync(path.join(temp, 'local/_ai.ts'), 'export const profile = () => ({}); export const projectBrief = () => ({})')
await build({ stdin: { contents: "export * as plan from './local/plan'; export * as backlinks from './local/backlinks'; export * as social from './local/_social'", resolveDir: temp }, outfile: path.join(temp, 'test.mjs'), bundle: true, platform: 'node', format: 'esm' })
globalThis.require = (p) => { if (/\/leads\.ts$/.test(p)) return {}; throw new Error('not found ' + p) }
const { plan, backlinks, social } = await import(pathToFileURL(path.join(temp, 'test.mjs')))
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }))

function fixture(seed = {}) {
  const tables = structuredClone(seed)
  const ctx = { locale: 'zh', db: {
    query(table, opt = {}) { return { list: (tables[table] || []).slice(0, opt.limit || 1000).map((r) => ({ ...r })) } },
    get(table, id) { const r = tables[table]?.find((r) => r.id === id); return r ? { ...r } : null },
    insert(table, data) { const row = { ...data, id: `${table}-${(tables[table] || []).length + 1}` }; (tables[table] ||= []).push(row); return { ...row } },
    update(table, id, patch) { Object.assign(tables[table].find((r) => r.id === id), patch); return { ok: true } },
    delete(table, id) { tables[table] = tables[table].filter((r) => r.id !== id) },
  } }
  return { tables, ctx }
}
const dayStr = (n) => { const d = new Date(Date.now() - n * 86400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const iso = (n) => new Date(Date.now() - n * 86400_000).toISOString()

test('没有社媒账号：不出社媒的先行和结果指标', () => {
  const { ctx } = fixture({})
  const m = plan.compute(ctx)
  assert.equal('social_views_28d' in m, false)
  assert.equal('social_leads_28d' in m, false)
})

test('社媒指标：新增 = 期末累计 − 期初前一天累计；窗口里才发的从 0 算；存量不算增量', () => {
  const { ctx } = fixture({
    social_accounts: [{ id: 'a1', type: 'x' }],
    social_posts: [
      { id: 'p-old', channel_id: 'a1', status: 'published', published_at: iso(60) }, // 窗口前就发了
      { id: 'p-new', channel_id: 'a1', status: 'published', published_at: iso(5) }, // 窗口里发的
    ],
    social_post_daily: [
      { post_id: 'p-old', date: dayStr(40), views: 1000, likes: 10, comments: 0, collects: 0, shares: 0 },
      { post_id: 'p-old', date: dayStr(1), views: 1300, likes: 15, comments: 1, collects: 0, shares: 0 },
      { post_id: 'p-new', date: dayStr(1), views: 200, likes: 8, comments: 2, collects: 3, shares: 1 },
    ],
    leads: [
      { id: 'l1', submitted_at: iso(3), utm: JSON.stringify({ source: 'x', campaign: 'item-1' }) },
      { id: 'l2', submitted_at: iso(3), referrer: 'https://www.linkedin.com/feed' },
      { id: 'l3', submitted_at: iso(3), referrer: 'https://google.com' },
      { id: 'l4', submitted_at: iso(50), utm: JSON.stringify({ source: 'x' }) }, // 太早
    ],
  })
  const m = plan.compute(ctx)
  assert.equal(m.social_views_28d, 300 + 200) // p-old 1300−1000（窗口前最后一行）、p-new 从 0
  assert.equal(m.social_engagement_28d, 6 + 14)
  assert.equal(m.social_leads_28d, 2)
  assert.equal(m.social_active_channels, 1)
})

test('采集没记过数：阅读、互动是 null，不当 0', () => {
  const { ctx } = fixture({ social_accounts: [{ id: 'a1', type: 'x' }], social_posts: [{ id: 'p1', channel_id: 'a1', status: 'published', published_at: iso(2) }] })
  const m = plan.compute(ctx)
  assert.equal(m.social_views_28d, null)
  assert.equal(m.social_leads_28d, 0)
})

test('询盘归因：utm_source 的别名、来源域名；campaign 带计划项 id', () => {
  assert.deepEqual(social.leadSocial({ utm: '{"source":"twitter","campaign":"c1"}' }), { platform: 'x', campaign: 'c1' })
  assert.equal(social.leadSocial({ referrer: 'https://l.instagram.com/?u=1' }).platform, 'instagram')
  assert.equal(social.leadSocial({ referrer: 'https://www.google.com/' }).platform, '')
})

test('计划项做没做完：挂在它名下的帖子够数才算，没挂的退回按这周发了几条', () => {
  const from = iso(2)
  const item = { id: 'i1', title: '发 2 条社媒', action: { kind: 'go', view: 'social-content' } }
  const mk = (posts) => fixture({ social_posts: posts }).ctx
  assert.equal(plan.actionDone(mk([{ id: 'a', status: 'published', published_at: iso(1), plan_item_id: 'i1' }]), item, from), null)
  assert.ok(plan.actionDone(mk([1, 2].map((n) => ({ id: 'p' + n, status: 'published', published_at: iso(0), plan_item_id: 'i1' }))), item, from))
  assert.ok(plan.actionDone(mk([1, 2].map((n) => ({ id: 'p' + n, status: 'published', published_at: iso(0) }))), item, from)) // 没归属：这周发了 2 条
  assert.equal(plan.actionDone(mk([{ id: 'x', status: 'published', published_at: iso(9) }]), { ...item, title: '发社媒' }, from), null) // 没归属、也是上周的
})

test('发布时归属：进行中的计划里最早没做完的社媒计划项', () => {
  const { ctx } = fixture({
    growth_plans: [{ id: 'g1', status: 'active', start_date: dayStr(10) }],
    plan_items: [
      { id: 'late', plan_id: 'g1', week: 9, title: '后面的', action: JSON.stringify({ kind: 'go', view: 'social-content' }) },
      { id: 'w2', plan_id: 'g1', week: 2, title: '社媒', action: JSON.stringify({ kind: 'go', view: 'social-content' }) },
      { id: 'w1', plan_id: 'g1', week: 1, title: '已做完', status: 'done', action: JSON.stringify({ kind: 'go', view: 'calendar' }) },
      { id: 'kw', plan_id: 'g1', week: 1, title: '挖词', action: JSON.stringify({ kind: 'go', view: 'search' }) },
    ],
  })
  assert.equal(plan.socialItem({}, ctx).id, 'w2')
  assert.equal(plan.socialItem({}, fixture({}).ctx), null)
})

test('检查点摘要：按平台、按计划项、带来的询盘', () => {
  const { ctx } = fixture({
    social_accounts: [{ id: 'a1', type: 'x' }, { id: 'a2', type: 'linkedin' }],
    social_posts: [
      { id: 'p1', channel_id: 'a1', status: 'published', published_at: iso(5), plan_item_id: 'i1', title: 'A', body: 'x https://a.com' },
      { id: 'p2', channel_id: 'a2', status: 'published', published_at: iso(4), title: 'B', body: 'no link' },
    ],
    social_post_daily: [
      { post_id: 'p1', date: dayStr(1), views: 100, likes: 5, comments: 0, collects: 0, shares: 0 },
      { post_id: 'p2', date: dayStr(1), views: 40, likes: 1, comments: 0, collects: 0, shares: 0 },
    ],
    leads: [{ id: 'l1', submitted_at: iso(2), utm: '{"source":"x","campaign":"i1"}' }],
    plan_items: [{ id: 'i1', title: '发社媒' }],
  })
  const d = plan.social({ since: iso(10) }, ctx)
  assert.equal(d.published, 2)
  assert.equal(d.by_platform[0].platform, 'x')
  assert.equal(d.by_platform[0].leads, 1)
  assert.equal(d.by_plan_item[0].leads, 1)
  assert.equal(d.unattributed_posts, 1)
})

test('本站链接带来源参数：只动本站的、已经带的不动、句尾标点保留', () => {
  const { ctx } = fixture({ channels: [{ id: 'c1', type: 'website', url: 'https://www.acme.com' }] })
  const r = backlinks.tagLinks({ body: 'Read https://acme.com/blog/a. Also https://other.com/x and https://acme.com/b?utm_source=mail', platform: 'linkedin', plan_item_id: 'i9' }, ctx)
  assert.equal(r.tagged, 1)
  assert.ok(r.body.includes('https://acme.com/blog/a?utm_source=linkedin&utm_medium=social&utm_campaign=i9.'))
  assert.ok(r.body.includes('https://other.com/x '))
  assert.ok(r.body.endsWith('https://acme.com/b?utm_source=mail'))
})
