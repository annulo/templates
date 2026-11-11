// business 模块的 content.ts：在内存假数据库上跑写文章上下文、存文章、改文章、改写（外贸、产品运营的产物各一遍）
// ESBUILD_MODULE=/path/to/esbuild node publish/tests/business/content.test.mjs（外贸在同级 shuttle-template，没有就只跑产品运营）
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { build } = require(process.env.ESBUILD_MODULE || 'esbuild')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'business-content-'))
execFileSync('python3', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'build.py'), out], { stdio: 'inherit' })
for (const name of fs.readdirSync(out)) await runFor(name)

async function runFor(name) {
const dir = path.join(out, name)
const optional = name === 'product' ? "export * as campaigns from './local/campaigns';" : ''
await build({ stdin: { contents: `export * as content from './local/content'; ${optional}`, resolveDir: dir, loader: 'ts' }, outfile: `${dir}/bundle.mjs`, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' })
// 动态 require（有就用的模块）：产品运营有 campaigns，外贸没有。要在加载之前设好：打包出来的 __require 加载时就记下当时的 require
let mod
globalThis.require = (p) => { if (p === './campaigns.ts' && mod?.campaigns) return mod.campaigns; throw new Error('no ' + p) }
mod = await import(`${dir}/bundle.mjs?${Date.now()}`)

let n = 0
const tables = {}
const tbl = (t) => (tables[t] ??= [])
const match = (r, w) => !w || Object.entries(w).every(([k, v]) => r[k] === v)
const ctx = {
  locale: 'zh', chat_id: 'chat1',
  progress() {},
  db: {
    query(t, q = {}) { if (!(t in tables) && ['use_cases', 'channel_strategies', 'campaigns'].includes(t) && name === 'trade') throw new Error('table not found'); return { list: tbl(t).filter((r) => match(r, q.where)).slice(0, q.limit ?? 1000).map((r) => ({ ...r })), next_cursor: '' } },
    get(t, id) { const r = tbl(t).find((r) => r.id === id); return r ? { ...r } : null },
    insert(t, row) { const r = { id: `${t}_${++n}`, ...row }; tbl(t).push(r); return { ...r } },
    update(t, id, patch) { const r = tbl(t).find((r) => r.id === id); Object.assign(r, patch); return { ...r } },
    delete(t, id) { tables[t] = tbl(t).filter((r) => r.id !== id) },
  },
}
// 数据：一个产品、一个选题（产品运营的带运营主题），一条灵感来源引用
const prod = ctx.db.insert('products', { name: 'Alpha Widget', model: 'AW-1', summary: 's', features: 'f', status: 'active' })
const topic = ctx.db.insert('topics', { title: 'How to pick an Alpha Widget', keywords: 'alpha widget', status: 'idea', workspace: 'website', brief: JSON.stringify({ product_ids: [prod.id] }),
  ...(name === 'product' ? { campaign_id: 'camp1', opportunity_id: 'opp1', target_platform: 'website', plan_key: 'k1' } : {}) })
if (name === 'product') { ctx.db.insert('campaigns', { id: 'camp1', title: 'C' }); tables.campaigns[0].id = 'camp1' }
ctx.db.insert('content_references', { kind: 'source', target_type: 'topic', target_id: topic.id, source_id: 'src1', snapshot: JSON.stringify({ source_id: 'src1', title: 'Insp' }) })

const body = '<h2>Why</h2><p>' + 'Alpha Widget AW-1 helps teams pick the right part for each job. '.repeat(12) + '</p><h2>How</h2><p>' + 'Measure, compare and test before ordering in bulk. '.repeat(12) + '</p>'
const c = await mod.content.context({ type: 'article', topic_id: topic.id }, ctx)
assert.ok(c.evidence_id, 'context 留了写作依据')
assert.equal(c.research.sources.length, 1, '依据里带灵感来源')
assert.equal(c.research.products[0].name, 'Alpha Widget')
assert.ok(!('certs' in c.research.products[0]), '空字段不进快照')
if (name === 'product') assert.equal(c.campaign?.title, 'C', '产品运营带运营主题'); else assert.ok(!('campaign' in c), '外贸没有运营主题字段')
const saved = mod.content.save({ type: 'article', topic_id: topic.id, evidence_id: c.evidence_id, title: 'Pick an Alpha Widget', summary: 'x', body }, ctx)
assert.ok(saved.checks, '长文存完返回 checks')
const art = ctx.db.get('articles', saved.article_id)
assert.equal(art.workspace, 'website'); assert.equal(art.topic_id, topic.id)
if (name === 'product') { assert.equal(art.campaign_id, 'camp1'); assert.equal(art.plan_key, 'k1'); assert.equal(art.target_platform, 'website') }
else assert.ok(!('campaign_id' in art) && !('plan_key' in art), '外贸文章不带空的运营主题字段')
assert.equal(ctx.db.get('topics', topic.id).status, 'done')
const rv = mod.content.revisionContext({ article_id: saved.article_id }, ctx)
assert.equal(rv.research.sources.length, 1, '改文章保留灵感来源')
const up = mod.content.update({ article_id: saved.article_id, evidence_id: rv.evidence_id, title: 'Pick the right Alpha Widget' }, ctx)
assert.deepEqual(up.changed, ['title'])
const rw = mod.content.rewriteContext({ article_id: saved.article_id, type: 'post' }, ctx)
assert.ok(rw.evidence_id, '改写也留依据'); assert.equal(rw.source.video_cover, '')
const post = mod.content.save({ type: 'post', source_id: saved.article_id, evidence_id: rw.evidence_id, title: 'Alpha tips', body: 'Short post body about picking widgets.', workspace: 'social', target_account_id: 'acc1' }, ctx)
const p2 = ctx.db.get('articles', post.article_id)
assert.equal(p2.workspace, 'social'); assert.equal(p2.target_account_id, 'acc1'); assert.equal(p2.source_id, saved.article_id)
const ss = mod.content.socialSource({ id: post.article_id }, ctx)
assert.ok('video_cover' in ss)
console.log(name, 'ok')
}
