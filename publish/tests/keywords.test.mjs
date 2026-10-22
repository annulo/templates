// node --test publish/tests/keywords.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const load = async (file, prelude = '') => {
  const src = fs.readFileSync(new URL(`../../core/features/websites/local/${file}`, import.meta.url), 'utf8').replace(/^import .*$/gm, '')
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(prelude + src)).toString('base64')}`)
}
const kw = await load('_keywords.ts')

test('suggest responses from Google and Bing parse the same', () => {
  assert.deepEqual(kw.parseSuggest('["led",["led grow light","led strip"]]'), ['led grow light', 'led strip'])
  assert.deepEqual(kw.parseSuggest('<html>blocked</html>'), [])
  assert.match(kw.suggestUrl('bing', 'a b', 'en', 'us'), /market=en-US/)
  assert.match(kw.suggestUrl('google', 'a b', 'en', 'gb'), /gl=gb.*q=a%20b/)
})

test('seed terms split on commas and dedupe case-insensitively', () => {
  assert.deepEqual(kw.splitTerms('LED Grow Light, led grow light，greenhouse light', 'x\nhydroponic kit'), ['LED Grow Light', 'greenhouse light', 'hydroponic kit'])
})

test('usable keeps single words and CJK, drops numbers and punctuation', () => {
  assert.ok(kw.usable('Nebula'))
  assert.ok(kw.usable('储能电池'))
  assert.ok(!kw.usable('123 456'))
  assert.ok(!kw.usable('!!!'))
})

test('buckets follow GSC position and impressions only', () => {
  assert.equal(kw.bucketOf({}), 'unchecked')
  assert.equal(kw.bucketOf({ gsc_impressions: 50, gsc_position: 2.4 }), 'ranking')
  assert.equal(kw.bucketOf({ gsc_impressions: 50, gsc_position: 12 }), 'quick_win')
  assert.equal(kw.bucketOf({ gsc_impressions: 5, gsc_position: 12 }), 'unchecked')
  assert.equal(kw.bucketOf({ gsc_impressions: 500, gsc_position: 45 }), 'unchecked')
  assert.ok(kw.scoreOf({ gsc_impressions: 100, gsc_position: 8 }, 'quick_win') > kw.scoreOf({ gsc_impressions: 100, gsc_position: 25 }, 'quick_win'))
})

test('GSC rows merge per keyword with the page that has most impressions', () => {
  const m = kw.gscByKeyword(
    [{ keys: ['LED  grow light'], clicks: 3, impressions: 120, position: 14.26 }],
    [{ keys: ['led grow light', 'https://a.com/x'], clicks: 1, impressions: 30, position: 20 }, { keys: ['led grow light', 'https://a.com/y'], clicks: 2, impressions: 90, position: 12 }],
  )
  assert.deepEqual(m.get('led grow light'), { impressions: 120, clicks: 3, position: 14.3, page: 'https://a.com/y', pageImp: 90 })
})

test('sources merge without duplicates', () => {
  assert.equal(kw.mergeSources('suggest', 'gsc,suggest'), 'suggest,gsc')
  assert.equal(kw.mergeSources(undefined, 'agent'), 'agent')
})

// keywords.ts 跑在一个内存里的假 ctx.db 上
function fakeCtx(tables, extra = {}) {
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
      delete: (t, id) => { tables[t] = rows(t).filter((r) => r.id !== id) },
    },
    ...extra,
  }
}
const prelude = `const L = (ctx, zh, en) => ctx.locale === 'en' ? en : zh; const profile = ctx => (ctx.db.query('profile').list[0] ?? { name: '' });
const DAY = 86400000; const ymd = ms => new Date(ms).toISOString().slice(0, 10); const brandTerms = () => ['acme']; const isNoise = (q, b) => b.some(x => q.toLowerCase().includes(x)); const notConnected = () => false;
const query = async () => []; `
const kwPure = fs.readFileSync(new URL('../../core/features/websites/local/_keywords.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '')
const fn = await load('keywords.ts', prelude + kwPure)

test('expand falls back to Bing, drops brand words, and stores raw rows', async () => {
  const tables = { channels: [{ id: 'c1', name: 'Site', type: 'creght_site' }], profile: [{ name: 'Acme', keywords: 'grow light' }], products: [{ name: 'LED panel', moq: '100' }] }
  const urls = []
  const ctx = fakeCtx(tables, {
    sleep: () => new Promise(() => {}),
    fetchAll: async (list) => list.map((u) => {
      urls.push(u)
      if (u.includes('google')) return { ok: false, error: 'timeout' }
      const q = decodeURIComponent(new URL(u).searchParams.get('query'))
      return { ok: true, status: 200, text: async () => JSON.stringify([q, [`${q} china`, 'acme grow light']]) }
    }),
  })
  const r = await fn.expand({ channel_id: 'c1' }, ctx)
  assert.equal(r.engine, 'bing')
  assert.deepEqual(r.seeds, ['grow light', 'LED panel'])
  assert.ok(urls.some((u) => u.includes('manufacturer'))) // 产品有起订量：用外贸修饰词
  assert.ok(tables.keywords.every((k) => k.status === 'raw' && !k.keyword.includes('acme')))
  assert.ok(tables.keywords.some((k) => k.keyword === 'grow light manufacturer china' && k.suggest_engine === 'bing'))
  const again = await fn.expand({ channel_id: 'c1' }, ctx)
  assert.equal(again.added, 0)
})

test('save reviews raw rows, records the chat, and toTopic groups by cluster', () => {
  const tables = { channels: [{ id: 'c1', name: 'Site', type: 'creght_site' }], topics: [], keywords: [
    { id: 'k1', channel_id: 'c1', keyword: 'grow light manufacturer', status: 'raw' },
    { id: 'k2', channel_id: 'c1', keyword: 'grow light factory', status: 'raw', gsc_impressions: 40, gsc_position: 18 },
    { id: 'k3', channel_id: 'c1', keyword: 'grow light jobs', status: 'raw' },
  ] }
  const ctx = fakeCtx(tables)
  const r = fn.save({ channel_id: 'c1', items: [
    { id: 'k1', keep: true, intent: 'buy', cluster: 'Grow light suppliers' },
    { id: 'k2', keep: true, intent: 'buy', cluster: 'Grow light suppliers' },
    { id: 'k3', keep: false, note: 'jobs' },
    { keyword: 'oem grow light', keep: true, intent: 'buy', cluster: 'Grow light suppliers' },
  ] }, ctx)
  assert.deepEqual([r.kept, r.dismissed, r.added, r.raw_left], [3, 1, 1, 0])
  assert.equal(tables.keywords.find((k) => k.id === 'k1').chat_id, 'chat-1')
  const l = fn.list({ channel_id: 'c1' }, ctx)
  assert.equal(l.chat_id, 'chat-1')
  const t = fn.toTopic({ ids: ['k1', 'k2'] }, ctx)
  assert.deepEqual(t.created, ['grow light factory']) // 标题用曝光最多的词
  assert.equal(tables.topics[0].source, 'keyword')
  assert.ok(['k1', 'k2'].every((id) => tables.keywords.find((k) => k.id === id).status === 'targeting'))
})

test('without GSC, Google results decide open / mixed / hard', () => {
  const at = '2026-10-22T00:00:00Z'
  assert.equal(kw.bucketOf({ serp_at: at, serp_position: 2 }), 'ranking')
  assert.equal(kw.bucketOf({ serp_at: at, serp_position: 7 }), 'quick_win')
  assert.equal(kw.bucketOf({ serp_at: at, serp_weak: 3, serp_strong: 5 }), 'open')
  assert.equal(kw.bucketOf({ serp_at: at, serp_weak: 1, serp_strong: 4 }), 'hard')
  assert.equal(kw.bucketOf({ serp_at: at, serp_weak: 2, serp_strong: 1 }), 'mixed')
  // GSC 有排名时以 GSC 为准
  assert.equal(kw.bucketOf({ gsc_impressions: 40, gsc_position: 15, serp_at: at, serp_weak: 0, serp_strong: 9 }), 'quick_win')
})

test('Google results become facts: our position, weak and strong counts, competitors marked', () => {
  const r = (p, domain, kind) => ({ position: p, url: `https://${domain}/x`, domain, kind, title: 't' })
  const ours = kw.ownDomains('sc-domain:acme.com', 'https://p2.preview.creght.cn/', 'https://www.acme.com/a')
  assert.deepEqual(ours, ['acme.com', 'p2.preview.creght.cn'])
  const f = kw.serpFacts([r(1, 'alibaba.com', 'b2b'), r(2, 'reddit.com', 'forum'), r(3, 'amazon.com', 'marketplace'), r(4, 'rival.com', 'site'), r(5, 'shop.acme.com', 'site')], ours, ['rival.com'])
  assert.deepEqual([f.serp_position, f.serp_weak, f.serp_strong], [5, 2, 1])
  assert.deepEqual(JSON.parse(f.serp_results).map((x) => x.kind), ['b2b', 'forum', 'marketplace', 'competitor', 'ours'])
})

test('rank history keeps one entry per day and source, oldest first', () => {
  let h = kw.pushRank('', { d: '2026-10-01', p: 18, s: 'gsc' })
  h = kw.pushRank(h, { d: '2026-10-08', p: 12, s: 'gsc' })
  h = kw.pushRank(h, { d: '2026-10-08', p: 11, s: 'gsc' })
  assert.deepEqual(JSON.parse(h).map((x) => x.p), [18, 11])
})
