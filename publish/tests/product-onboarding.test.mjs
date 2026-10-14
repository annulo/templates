import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const { build } = require(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'product-onboarding-test-'))
fs.cpSync(path.join(root, 'product'), temp, { recursive: true })
fs.cpSync(path.join(root, 'core/local'), path.join(temp, 'local'), { recursive: true })
fs.cpSync(path.join(root, 'core/features/websites'), temp, { recursive: true })
await build({ stdin: { contents: "export * as start from './local/productstart'; export * as today from './local/today';", resolveDir: temp }, outfile: path.join(temp, 'test.mjs'), bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'social-stub', setup(b) { b.onResolve({ filter: /plugins\/social\// }, (a) => ({ path: a.path, namespace: 'social-stub' })); b.onLoad({ filter: /.*/, namespace: 'social-stub' }, () => ({ contents: 'export const FIELDS = {}; export async function summary() { return [] }', loader: 'ts' })) } }] })
const { start, today } = await import(pathToFileURL(path.join(temp, 'test.mjs')))
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }))
global.fetch = async () => new Response('<title>Selected site</title>')
function fixture() {
  const tables = {}
  const ctx = { locale: 'zh', workspace: { api_host: 'https://creght.cn', shuttle_projects: ['ops'] }, progress() {},
    mcp: async (_server, tool) => tool === 'list_sites' ? { sites: [{ project_id: 'product', site_id: 'one', site_name: 'Product site', project_name: 'Product' }] } : { live_url: 'https://selected.example/' },
    fetchAll: async () => [], html: () => ({ text: () => 'Facts from the selected website', find: (selector) => selector === 'title' ? [{ text: 'Selected product' }] : [] }),
    db: { query(table, options = {}) { let rows = tables[table] || []; if (options.where) rows = rows.filter((row) => Object.entries(options.where).every(([k, v]) => row[k] === v)); return { list: rows.slice(0, options.limit || 1000).map((row) => ({ ...row })) } }, get(table, id) { return tables[table]?.find((row) => row.id === id) || null }, insert(table, data) { const rows = tables[table] ||= []; const row = { ...data, id: `${table}-${rows.length + 1}` }; rows.push(row); return { ...row } }, update(table, id, patch) { const row = tables[table].find((row) => row.id === id); Object.assign(row, patch); return { ...row } } } }
  ctx.mcp.servers = () => [{ name: 'creght', status: 'connected' }]
  return { ctx, tables }
}
const facts = (revision) => ({ revision, profile: { name: 'Selected product', business: 'Solve a real problem', customer_types: 'Website users' }, products: [{ name: 'Website feature', features: 'Verified feature', source_url: 'https://selected.example/features' }], use_cases: [{ title: 'Supported task', product_name: 'Website feature', problem: 'A real user problem' }] })
test('a new product project starts with website selection, then review', () => {
  const { ctx } = fixture(), list = today.list({}, ctx)
  assert.equal(list.total, 7)
  assert.deepEqual(list.wizard.steps.map((s) => s.key), ['site', 'company-details'])
  assert.equal(list.wizard.current, 'site')
  assert.equal(today.closeWizard({}, ctx).wizard.closed, true)
  assert.equal(today.openWizard({}, ctx).wizard.closed, false)
})
test('selected Creght site is the only site read even when the profile contains another URL', async () => {
  const { ctx } = fixture()
  ctx.db.insert('profile', { name: 'Old product', website_url: 'https://old.example/' })
  const selected = await start.selectSite({ project_id: 'product', site_id: 'one' }, ctx)
  const original = global.fetch, seen = []
  global.fetch = async (address) => { seen.push(address); return new Response('<title>Selected product</title>') }
  try {
    const result = await start.context({ revision: selected.revision }, ctx)
    assert.equal(result.url, 'https://selected.example/')
    assert.deepEqual(seen, ['https://selected.example/'])
    assert.equal(today.list({}, ctx).wizard.current, 'company-details')
  } finally { global.fetch = original }
})
test('extraction stages all three sections, confirmation writes them and repeated runs reuse records', async () => {
  const { ctx, tables } = fixture()
  ctx.db.insert('profile', { name: 'Old product', business: 'Old business', customer_types: 'Old users' })
  const selected = await start.selectURL({ url: 'https://selected.example/' }, ctx)
  const draft = await start.saveDraft(facts(selected.revision), ctx)
  assert.equal(tables.profile[0].name, 'Old product')
  assert.equal(tables.products, undefined)
  assert.equal(tables.use_cases, undefined)
  assert.equal(draft.company_status, 'needs_review')
  const saved = start.saveDetails({ revision: selected.revision, ...draft.draft }, ctx)
  assert.equal(saved.profile.name, 'Selected product')
  assert.equal(saved.profile.website_url, 'https://selected.example/')
  assert.equal(saved.products.length, 1)
  assert.equal(saved.use_cases[0].product_id, saved.products[0].id)
  assert.ok(saved.products[0].verified_at)
  assert.equal(today.list({}, ctx).wizard.current, null)
  const selectedAgain = await start.selectURL({ url: 'https://selected.example/', refresh: true }, ctx)
  const next = await start.saveDraft(facts(selectedAgain.revision), ctx)
  start.saveDetails({ revision: selectedAgain.revision, ...next.draft }, ctx)
  assert.equal(tables.products.length, 1)
  assert.equal(tables.use_cases.length, 1)
})
test('switching sites rejects previous extraction and confirmation without changing saved facts', async () => {
  const { ctx, tables } = fixture()
  const first = await start.selectURL({ url: 'https://selected.example/' }, ctx)
  const draft = await start.saveDraft(facts(first.revision), ctx)
  await start.selectURL({ url: 'https://another.example/' }, ctx)
  const snapshot = JSON.stringify(tables)
  await assert.rejects(start.saveDraft(facts(first.revision), ctx), /资料已修改/)
  assert.throws(() => start.saveDetails({ ...draft.draft, revision: first.revision }, ctx), /资料已修改/)
  assert.equal(JSON.stringify(tables), snapshot)
})
test('invalid links and product associations are rejected before writing any profile or product', async () => {
  const { ctx, tables } = fixture(), selected = await start.selectURL({ url: 'https://selected.example/' }, ctx)
  const draft = await start.saveDraft(facts(selected.revision), ctx)
  const snapshot = JSON.stringify(tables)
  assert.throws(() => start.saveDetails({ ...draft.draft, revision: selected.revision, use_cases: [{ title: 'Wrong', product_name: 'Missing' }] }, ctx), /关联产品/)
  assert.throws(() => start.saveDetails({ ...draft.draft, revision: selected.revision, products: [{ name: 'Website feature', source_url: 'javascript:bad' }] }, ctx), /HTTP/)
  assert.equal(JSON.stringify(tables), snapshot)
})
test('an unreadable selected website fails instead of producing a completed empty profile', async () => {
  const { ctx } = fixture(), selected = await start.selectURL({ url: 'https://selected.example/' }, ctx)
  const original = global.fetch
  global.fetch = async () => new Response('Unavailable', { status: 503 })
  try { await assert.rejects(start.context({ revision: selected.revision }, ctx), /读不到/); }
  finally { global.fetch = original }
  start.failed({ revision: selected.revision, stage: 'company', error: 'Website unavailable' }, ctx)
  assert.equal(start.get({}, ctx).company_status, 'failed')
  assert.equal(today.list({}, ctx).wizard.steps[1].done, false)
})
