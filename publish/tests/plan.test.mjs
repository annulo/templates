import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-test-'))
fs.cpSync(path.join(root, 'core/local'), path.join(temp, 'local'), { recursive: true })
fs.cpSync(path.join(root, 'core/features/plan'), temp, { recursive: true })
await build({ stdin: { contents: "export * as plan from './local/plan'", resolveDir: temp }, outfile: path.join(temp, 'test.mjs'), bundle: true, platform: 'node', format: 'esm' })
// 本机函数的运行时有 require：外贸开了询盘、竞品模块
globalThis.require = (p) => { if (/\/(leads|competitors)\.ts$/.test(p)) return {}; throw new Error('not found ' + p) }
const { plan } = await import(pathToFileURL(path.join(temp, 'test.mjs')))
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }))

function fixture(seed = {}) {
  const tables = structuredClone(seed), counts = {}
  const ctx = { locale: 'zh', db: {
    query(table, opt = {}) { return { list: (tables[table] || []).slice(0, opt.limit || 1000).map((r) => ({ ...r })) } },
    get(table, id) { const r = tables[table]?.find((r) => r.id === id); return r ? { ...r } : null },
    insert(table, data) { const row = { ...data, id: `${table}-${counts[table] = (counts[table] || 0) + 1}` }; (tables[table] ||= []).push(row); return { ...row } },
    update(table, id, patch) { Object.assign(tables[table].find((r) => r.id === id), patch); return { ok: true } },
    delete(table, id) { tables[table] = tables[table].filter((r) => r.id !== id) },
  } }
  return { tables, ctx }
}
const day = (n) => { const d = new Date(Date.now() - n * 86400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const targets = (k) => ({ pages_published: 8 * k, impressions_28d: 1000 * k, clicks_28d: 20 * k, leads_28d: 2 * k })
const draft = (over = {}) => ({
  stage: { phase: 1, reason: '新站' }, summary: '先布局关键词', recommended: 'normal',
  phases: [1, 2, 3].map((phase) => ({ phase, title: 't' + phase, focus: 'f', goals: ['g'] })),
  options: [['conservative', 1], ['normal', 2], ['aggressive', 3]].map(([level, k]) => ({ level, note: '', targets: targets(k) })),
  items: [
    { week: 1, area: 'keywords', title: '挖词', action: { kind: 'go', view: 'search', params: { tab: 'keywords' } } },
    { week: 2, area: 'content', title: '发 2 篇', action: { kind: 'go', view: 'website-content' }, check: { metric: 'pages_published', gte: 2, delta: true } },
    { week: 1, area: 'competitors', title: '推荐竞品', action: { kind: 'task', task: 'competitor-suggest', input: {} } },
  ],
  ...over,
})

test('新站：没连谷歌时先行指标是 null，建议从第 1 阶段开始', () => {
  const { ctx } = fixture({ channels: [{ id: 'c1', type: 'creght_site' }] })
  const m = plan.compute(ctx)
  assert.equal(m.impressions_28d, null)
  assert.equal(m.pages_published, 0)
  assert.equal(m.leads_28d, 0)
  assert.equal(plan.judgeStage(ctx, m).phase, 1)
})

test('老项目：谷歌数据满 4 周、发了一批文章，建议从第 2 / 3 阶段开始', () => {
  const daily = Array.from({ length: 40 }, (_, i) => ({ channel_id: 'c1', date: day(i + 3), impressions: 50, clicks: i < 28 ? 2 : 0 }))
  const pubs = Array.from({ length: 10 }, (_, i) => ({ article_id: 'a' + i, status: 'published', published_at: '2026-08-01T00:00:00Z' }))
  const { ctx } = fixture({ channels: [{ id: 'c1', type: 'creght_site', gsc_property: 'sc-domain:x.com' }], search_daily: daily, publications: pubs })
  const m = plan.compute(ctx)
  assert.equal(m.impressions_28d, 50 * 28)
  assert.equal(plan.judgeStage(ctx, m).phase, 2)
  const more = fixture({ channels: [{ id: 'c1', type: 'creght_site', gsc_property: 'x' }], search_daily: daily, publications: [...pubs, ...pubs.map((p) => ({ ...p, article_id: p.article_id + 'b' }))] })
  assert.equal(plan.judgeStage(more.ctx).phase, 3)
})

test('起草 → 选目标 → 发文章后计划项自动做完；页面和任务只能用 catalog 里的', () => {
  const { ctx, tables } = fixture({ channels: [{ id: 'c1', type: 'creght_site' }] })
  assert.throws(() => plan.saveDraft(draft({ items: [{ week: 1, title: 'x', action: { kind: 'go', view: 'nope' } }] }), ctx), /nope/)
  assert.throws(() => plan.saveDraft(draft({ options: draft().options.slice(0, 2) }), ctx), /三档/)
  plan.saveDraft(draft(), ctx)
  plan.saveDraft(draft({ summary: '第二版' }), ctx) // 再起草替换草稿
  assert.equal(tables.growth_plans.length, 1)
  assert.equal(tables.plan_items.length, 3)
  let g = plan.get({}, ctx)
  assert.equal(g.plan.status, 'draft')
  assert.equal(g.plan.summary, '第二版')

  g = plan.activate({ level: 'aggressive' }, ctx)
  assert.equal(g.plan.status, 'active')
  assert.equal(g.plan.targets.pages_published, 24)
  assert.equal(g.position.day, 1)
  assert.equal(g.position.phase, 1)
  assert.equal(plan.thisWeek({}, ctx).items.length, 2) // 第 1 周的两件

  tables.publications = [{ article_id: 'a1', status: 'published' }, { article_id: 'a2', status: 'published' }]
  g = plan.get({}, ctx)
  const item = g.items.find((i) => i.title === '发 2 篇')
  assert.equal(item.status, 'done')
  assert.equal(item.auto, true)
  const p = g.progress.find((x) => x.metric === 'pages_published')
  assert.deepEqual([p.baseline, p.current, p.target, p.pct], [0, 2, 24, 8])
})

test('从第 2 阶段开始：第 1 天往前推 30 天，Day 30 检查点不用做', () => {
  const { ctx, tables } = fixture({})
  plan.saveDraft(draft({ stage: { phase: 2, reason: '已有数据' }, items: [{ week: 5, title: '补内容', action: { kind: 'go', view: 'search' } }] }), ctx)
  const g = plan.activate({ level: 'normal' }, ctx)
  assert.equal(g.position.day, 31)
  assert.equal(g.position.phase, 2)
  assert.equal(g.checkpoint_due, null)
  // 过了 30 天：该做 Day 60
  tables.growth_plans[0].start_date = day(60)
  assert.equal(plan.get({}, ctx).checkpoint_due, 60)
})

test('检查点：存结论、换掉下一阶段没做的计划项；Day 90 后计划结束', () => {
  const { ctx, tables } = fixture({})
  plan.saveDraft(draft(), ctx)
  plan.activate({ level: 'normal' }, ctx)
  tables.growth_plans[0].start_date = day(30)
  assert.equal(plan.get({}, ctx).checkpoint_due, 30)
  const c = plan.checkpointContext({}, ctx)
  assert.equal(c.day, 30)
  assert.equal(c.next_phase, 2)
  assert.throws(() => plan.saveCheckpoint({ day: 30, summary: 's' }, ctx), /下一阶段/)
  plan.saveCheckpoint({ day: 30, summary: '展示起来了', wins: ['w'], items: [{ week: 5, title: '快赢词补内容', action: { kind: 'go', view: 'search', params: { tab: 'keywords' } } }], targets: { clicks_28d: 50 } }, ctx)
  let g = plan.get({}, ctx)
  assert.equal(g.checkpoint_due, null)
  assert.equal(g.plan.checkpoints[0].summary, '展示起来了')
  assert.equal(g.plan.targets.clicks_28d, 50)
  assert.equal(g.items.filter((i) => i.week === 5).length, 1)
  tables.growth_plans[0].start_date = day(95)
  assert.equal(plan.get({}, ctx).checkpoint_due, 60)
  plan.saveCheckpoint({ day: 60, summary: 's', items: [{ week: 9, title: '落地页', action: { kind: 'go', view: 'landing' } }] }, ctx)
  plan.saveCheckpoint({ day: 90, summary: '复盘' }, ctx)
  g = plan.get({}, ctx)
  assert.equal(g.plan.status, 'done')
  assert.equal(g.checkpoint_due, null)
  assert.equal(plan.thisWeek({}, ctx).items.length, 0)
})

test('关键词地图：按主题走到哪一步，询盘按落地页算', () => {
  const { ctx } = fixture({
    keywords: [
      { id: 'k1', cluster: 'sofa', keyword: 'sofa manufacturer', status: 'targeting', target_page: 'https://x.com/sofa', gsc_position: 18, gsc_impressions: 300, gsc_clicks: 4 },
      { id: 'k2', cluster: 'sofa', keyword: 'sofa factory', status: 'idea' },
      { id: 'k3', cluster: 'table', keyword: 'table supplier', status: 'targeting', topic_id: 't1' },
      { id: 'k4', cluster: 'chair', keyword: 'chair oem', status: 'targeting', topic_id: 't2' },
      { id: 'k5', cluster: 'bed', keyword: 'bed', status: 'idea' },
      { id: 'k6', cluster: 'gone', keyword: 'x', status: 'dismissed' },
    ],
    articles: [{ id: 'a1', topic_id: 't2' }],
    leads: [{ id: 'l1', landing_page: 'https://www.x.com/sofa/', submitted_at: '2026-11-01' }, { id: 'l2', landing_page: 'https://x.com/other' }],
  })
  const m = plan.keywordMap({}, ctx)
  const by = Object.fromEntries(m.rows.map((r) => [r.cluster, r]))
  assert.deepEqual(Object.keys(by).sort(), ['bed', 'chair', 'sofa', 'table'])
  assert.equal(by.sofa.stage, 'top30')
  assert.equal(by.sofa.leads, 1)
  assert.equal(by.sofa.impressions, 300)
  assert.equal(by.table.stage, 'topic')
  assert.equal(by.chair.stage, 'draft')
  assert.equal(by.chair.next.action.params.article, 'a1')
  assert.equal(by.bed.stage, 'none')
  assert.deepEqual(by.bed.untopiced, ['k5']) // 没页面的主题能直接转选题
  assert.deepEqual(by.table.untopiced, [])
  assert.equal(m.rows[0].cluster, 'sofa') // 走得最远的在前
  assert.equal(plan.compute(ctx).clusters_live, 1)
})

test('自动判断做完：按去的页面看这周的数据，存下依据；撤销后不再自动标；没做完的挪到本周', () => {
  const { ctx, tables } = fixture({ channels: [{ id: 'c1', type: 'creght_site' }], site_issues: [{ id: 'i1', status: 'open', severity: 'high' }] })
  plan.saveDraft(draft({ items: [
    { week: 1, title: '挖词并筛选', action: { kind: 'go', view: 'search', params: { tab: 'keywords' } } },
    { week: 1, title: '修严重问题', action: { kind: 'go', view: 'audit' } },
    { week: 1, title: '发 2 篇文章', action: { kind: 'go', view: 'website-content' } },
    { week: 1, title: '看一遍公司资料', action: { kind: 'go', view: 'company' } },
    { week: 1, title: '写竞对总览', action: { kind: 'task', task: 'competitor-overview', input: {} } },
  ] }), ctx)
  plan.activate({ level: 'normal' }, ctx)
  let g = plan.get({}, ctx)
  assert.equal(g.items.filter((i) => i.status).length, 0)

  const now = new Date().toISOString()
  tables.keywords = [{ id: 'k1', keyword: 'sofa', status: 'idea', reviewed_at: now }]
  tables.site_issues[0].status = 'fixed'; tables.site_issues[0].updated_at = now
  tables.publications = [{ article_id: 'a1', status: 'published', published_at: now }]
  g = plan.get({}, ctx)
  const by = Object.fromEntries(g.items.map((i) => [i.title, i]))
  assert.equal(by['挖词并筛选'].status, 'done')
  assert.equal(by['挖词并筛选'].done_by, 'auto')
  assert.match(by['挖词并筛选'].done_note, /筛了 1 个词/)
  assert.equal(by['修严重问题'].status, 'done')
  assert.equal(by['发 2 篇文章'].status, '') // 要 2 篇，只发了 1 篇
  assert.equal(by['看一遍公司资料'].status, '') // 判断不了，手动标
  // 存进表了：数据再变也不退回去
  tables.keywords = []
  assert.equal(plan.get({}, ctx).items.find((i) => i.title === '挖词并筛选').status, 'done')
  // 撤销自动判断：不再自动标
  plan.mark({ id: by['挖词并筛选'].id, status: '' }, ctx)
  tables.keywords = [{ id: 'k2', keyword: 'x', reviewed_at: now }]
  assert.equal(plan.get({}, ctx).items.find((i) => i.title === '挖词并筛选').status, '')
  // 助手标的
  plan.mark({ id: by['写竞对总览'].id, status: 'done', by: 'ai', note: '写了 6 家的竞对总览' }, ctx)
  const ai = plan.get({}, ctx).items.find((i) => i.title === '写竞对总览')
  assert.deepEqual([ai.status, ai.done_by, ai.done_note], ['done', 'ai', '写了 6 家的竞对总览'])
  // 到了第 2 周：第 1 周没做完的挪进来
  tables.growth_plans[0].start_date = day(8)
  const w = plan.thisWeek({}, ctx)
  assert.equal(w.week, 2)
  assert.ok(w.items.some((i) => i.title === '看一遍公司资料' && i.carried))
})
