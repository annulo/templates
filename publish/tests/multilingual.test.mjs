// 网站多语言（core/features/websites/docs/multilingual.md）：读站点语言、存译文、publishTo 把译文写进 CMS 的 body._i18n
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multilingual-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))
fs.cpSync(path.join(root, 'core/local'), path.join(dir, 'local'), { recursive: true })
fs.cpSync(path.join(root, 'core/features/websites/local'), path.join(dir, 'local'), { recursive: true })
await build({
  stdin: { contents: "export * as pub from './local/_publish';export * as loc from './local/_locales';export * as languages from './local/languages';export * as translations from './local/translations';export * as glossary from './local/glossary';", resolveDir: dir },
  bundle: true, platform: 'node', format: 'esm', outfile: path.join(dir, 'test.mjs'), logLevel: 'silent',
})
const { pub, loc, languages, translations, glossary } = await import(pathToFileURL(path.join(dir, 'test.mjs')))

const HOME = (i18n) => `<html><script>window.TalizenConfig = { baseUrl: window.location.origin + '/api/', ${i18n ? `i18n: ${JSON.stringify(i18n)}, ` : ''}messages: {"blog":{"related":"x"}} };</script></html>`

/** 假的项目：几张表、creght 的 MCP（CMS 内容存在 cms 里）、ctx.html 只认 img[src] */
function fixture({ getTool = true } = {}) {
  const tables = { articles: [], topics: [], channels: [], publications: [], article_translations: [], glossary: [], site_changes: [], keywords: [] }
  const cms = []
  const calls = []
  let seq = 0
  const db = {
    get: (t, id) => (tables[t] || []).find((r) => r.id === id) ?? null,
    query: (t, q = {}) => ({ list: (tables[t] || []).filter((r) => Object.entries(q.where || {}).every(([k, v]) => r[k] === v)) }),
    insert: (t, v) => { const row = { ...v, id: `${t}-${++seq}` }; (tables[t] ||= []).push(row); return row },
    update: (t, id, v) => Object.assign(tables[t].find((r) => r.id === id), v),
    delete: (t, id) => { tables[t] = tables[t].filter((r) => r.id !== id) },
  }
  const mcp = async (_server, tool, args) => {
    calls.push({ tool, args })
    if (tool === 'cms_content_create') { const row = { id: `c${cms.length + 1}`, slug: args.slug, body: structuredClone(args.body) }; cms.push(row); return { id: row.id } }
    if (tool === 'cms_content_update') { const row = cms.find((r) => r.id === args.id); Object.assign(row.body, structuredClone(args.body)); return { updated: true } }
    if (tool === 'cms_content_get') { if (!getTool) throw new Error(`MCP creght 没有工具 ${tool}`); return structuredClone(cms.find((r) => r.id === args.id)) ?? null }
    if (tool === 'cms_content_list') return { list: structuredClone(cms.slice(args.offset || 0, (args.offset || 0) + args.limit)), has_more: false }
    if (tool === 'site_status') return { live_url: 'https://shop.test' }
    throw new Error('unexpected tool ' + tool)
  }
  mcp.servers = () => [{ name: 'creght', status: 'connected' }]
  const html = (s) => ({ find: () => [...String(s).matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => ({ attrs: { src: m[1] } })), text: () => String(s).replace(/<[^>]+>/g, ''), markdown: () => String(s) })
  const ctx = { locale: 'en', db, mcp, html, log: () => {}, chat_id: 'chat-1', workspace: {} }
  const site = db.insert('channels', { type: 'creght_site', name: 'Shop', project_id: 'p1', site_id: 's1', preview_url: 'https://p.test', locales: JSON.stringify(['en', 'zh', 'ar']), default_locale: 'en', locales_read_at: '2026-11-09' })
  const a = db.insert('articles', { title: 'Sofa guide', summary: 'How to pick', body: '<p>Pick a sofa</p><img src="https://img.test/a.png">', keywords: 'sofa, guide', status: 'draft' })
  return { ctx, tables, cms, calls, site, a }
}

/** 照 pofung 的发布脚本写：分类、作者、日期不跟着语言变 */
const script = (ctx, site, { noBody = false } = {}) => (input) => pub.publishTo(ctx, input, site.id, async ({ a, prev, dry }) => {
  const slug = prev?.slug || pub.slugOf(a)
  const body = { title: a.title, excerpt: a.summary, content: a.body, cover: a.cover, category: 'buying-guides', tags: (a.keywords || '').split(/,\s*/), publishDate: '2026-11-09' }
  const url = `https://shop.test/blog/${slug}`
  if (dry) return noBody ? { collection: 'blogs', slug, url, fields: body } : { collection: 'blogs', slug, body, url }
  const cms_id = prev?.cms_id ? (await pub.creght.update(ctx, 'p1', 'blogs', prev.cms_id, slug, body), prev.cms_id) : await pub.creght.create(ctx, 'p1', 'blogs', slug, body)
  return { cms_id, collection: 'blogs', slug, url }
})

test('reads the languages a creght site turned on from its page', () => {
  assert.deepEqual(loc.parseSiteI18n(HOME({ locale: 'zh', locales: ['en', 'zh', 'ar', 'pt'], defaultLocale: 'en', routingDefaultLocale: 'en' })), { locales: ['en', 'zh', 'ar', 'pt'], default_locale: 'en' })
  assert.deepEqual(loc.parseSiteI18n(HOME(null)), { locales: [], default_locale: '' })
  assert.equal(loc.parseSiteI18n('<html>not creght</html>'), null)
  assert.equal(loc.localeURL('https://shop.test/blog/x', 'zh', 'en'), 'https://shop.test/zh/blog/x')
  assert.equal(loc.localeURL('https://shop.test/', 'ar', 'en'), 'https://shop.test/ar')
  assert.equal(loc.localeURL('https://shop.test/blog/x', 'en', 'en'), 'https://shop.test/blog/x')
  assert.equal(loc.matchLocale(['en', 'zh', 'pt'], 'zh-CN'), 'zh')
  assert.equal(loc.siteLocales({ type: 'wordpress', locales: '["en","zh"]' }), null)
  assert.equal(loc.siteLocales({ type: 'creght_site', locales: '["en"]' }), null)
})

test('languages.read stores the locales; the article page lists each language state', async () => {
  const { ctx, tables, site, a } = fixture()
  const orig = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => HOME({ locale: 'en', locales: ['en', 'zh', 'ar', 'pt'], defaultLocale: 'en' }) })
  try {
    const r = await languages.read({ channel_id: site.id }, ctx)
    assert.deepEqual(r.locales, ['en', 'zh', 'ar', 'pt'])
  } finally {
    globalThis.fetch = orig
  }
  assert.equal(tables.channels[0].locales, '["en","zh","ar","pt"]')
  await translations.save({ article_id: a.id, locale: 'zh', title: '沙发指南', body: '<p>选沙发</p><img src="https://img.test/a.png">' }, ctx)
  const s = await languages.article({ article_id: a.id }, ctx)
  assert.deepEqual(s.states.map((x) => [x.locale, x.state]), [['en', 'source'], ['zh', 'draft'], ['ar', 'none'], ['pt', 'none']])
  ctx.db.update('articles', a.id, { body: '<p>Pick a sofa, updated</p><img src="https://img.test/a.png">' })
  const after = await languages.article({ article_id: a.id }, ctx)
  assert.equal(after.states[1].state, 'stale')
  const c = await translations.context({ article_id: a.id }, ctx)
  assert.deepEqual(c.targets, ['zh', 'ar', 'pt'])
  assert.equal(c.existing[0].stale, true)
})

test('translations keep the original images and the source language is not translated', async () => {
  const { ctx, a } = fixture()
  await assert.rejects(translations.save({ article_id: a.id, locale: 'zh', title: '沙发指南', body: '<p>选沙发</p>' }, ctx), /img\.test\/a\.png/)
  await assert.rejects(translations.save({ article_id: a.id, locale: 'en', title: 'x', body: 'y' }, ctx), /own language|原文的语言/)
  await assert.rejects(translations.save({ article_id: a.id, locale: 'de', title: 'x', body: 'y' }, ctx), /de/)
})

test('publishTo writes the default language to the main fields and the others into body._i18n', async () => {
  const { ctx, tables, cms, calls, site, a } = fixture({ getTool: false })
  await translations.save({ article_id: a.id, locale: 'zh', title: '沙发指南', summary: '怎么选', body: '<p>选沙发</p><img src="https://img.test/a.png">', keywords: '沙发, 指南' }, ctx)
  await translations.save({ article_id: a.id, locale: 'ar', title: 'دليل الأريكة', body: '<p>اختر</p><img src="https://img.test/a.png">' }, ctx)
  const publish = script(ctx, site)
  const dry = await publish({ article_id: a.id, dry: true })
  assert.deepEqual(Object.keys(dry.i18n), ['zh', 'ar'])
  assert.equal(calls.filter((c) => c.tool.startsWith('cms_content_c') || c.tool === 'cms_content_update').length, 0, 'a dry run writes nothing')

  const r = await publish({ article_id: a.id })
  assert.equal(cms[0].body.title, 'Sofa guide')
  assert.deepEqual(cms[0].body._i18n.zh, { title: '沙发指南', excerpt: '怎么选', content: '<p>选沙发</p><img src="https://img.test/a.png">', tags: ['沙发', '指南'] })
  // 译文空着的字段照用原文、不进 _i18n（阿语没写摘要、关键词）；分类、日期、封面不跟语言变
  assert.deepEqual(Object.keys(cms[0].body._i18n.ar), ['title', 'content'])
  assert.equal('category' in cms[0].body._i18n.zh, false)
  assert.equal('cover' in cms[0].body._i18n.zh, false)
  assert.deepEqual(r.locales, { en: 'https://shop.test/blog/sofa-guide', zh: 'https://shop.test/zh/blog/sofa-guide', ar: 'https://shop.test/ar/blog/sofa-guide' })
  const p = tables.publications[0]
  assert.equal(p.status, 'published')
  assert.equal(p.warning, '')
  assert.deepEqual(JSON.parse(p.locales), ['en', 'zh', 'ar'])
  assert.deepEqual(JSON.parse(tables.site_changes[0].pages), Object.values(r.locales))
})

test('republishing keeps languages someone translated in the creght editor', async () => {
  const { ctx, cms, site, a } = fixture()
  await translations.save({ article_id: a.id, locale: 'zh', title: '沙发指南', body: '<p>选沙发</p><img src="https://img.test/a.png">' }, ctx)
  const publish = script(ctx, site)
  await publish({ article_id: a.id })
  cms[0].body._i18n.pt = { title: 'Guia do sofá' }
  const t = ctx.db.query('article_translations').list[0]
  translations.update({ id: t.id, title: '沙发选购指南' }, ctx)
  await publish({ article_id: a.id })
  assert.equal(cms[0].body._i18n.pt.title, 'Guia do sofá')
  assert.equal(cms[0].body._i18n.zh.title, '沙发选购指南')
})

test('a site that publishes only reviewed translations skips drafts', async () => {
  const { ctx, cms, site, a } = fixture()
  languages.setReview({ channel_id: site.id, review: true }, ctx)
  const { id } = await translations.save({ article_id: a.id, locale: 'zh', title: '沙发指南', body: '<p>选沙发</p><img src="https://img.test/a.png">' }, ctx)
  await translations.save({ article_id: a.id, locale: 'ar', title: 'دليل', body: '<p>اختر</p><img src="https://img.test/a.png">' }, ctx)
  translations.update({ id, confirm: true }, ctx)
  await script(ctx, site)({ article_id: a.id })
  assert.deepEqual(Object.keys(cms[0].body._i18n), ['zh'])
})

test('an article written in another language needs a default-language translation first', async () => {
  const { ctx, cms, site, a } = fixture()
  languages.setLang({ article_id: a.id, lang: 'zh' }, ctx)
  ctx.db.update('articles', a.id, { title: '沙发指南', body: '<p>选沙发</p>' })
  await assert.rejects(script(ctx, site)({ article_id: a.id }), /en/)
  await translations.save({ article_id: a.id, locale: 'en', title: 'Sofa guide', body: '<p>Pick a sofa</p>' }, ctx)
  await script(ctx, site)({ article_id: a.id })
  assert.equal(cms[0].body.title, 'Sofa guide')
  assert.equal(cms[0].body._i18n.zh.title, '沙发指南')
})

test('an older publish script still publishes the default language and asks for an update', async () => {
  const { ctx, cms, tables, site, a } = fixture()
  await translations.save({ article_id: a.id, locale: 'zh', title: '沙发指南', body: '<p>选沙发</p><img src="https://img.test/a.png">' }, ctx)
  await script(ctx, site, { noBody: true })({ article_id: a.id })
  assert.equal(cms[0].body.title, 'Sofa guide')
  assert.equal(cms[0].body._i18n, undefined)
  assert.match(tables.publications[0].warning, /publish script/)
  assert.deepEqual(JSON.parse(tables.publications[0].locales), ['en'])
})

test('single-language sites publish exactly as before', async () => {
  const { ctx, cms, tables, site, a } = fixture()
  ctx.db.update('channels', site.id, { locales: '["en"]' })
  await translations.save({ article_id: a.id, locale: 'zh', title: 'x', body: '<img src="https://img.test/a.png">' }, ctx).catch(() => {})
  await script(ctx, site)({ article_id: a.id })
  assert.equal(cms[0].body._i18n, undefined)
  assert.equal(tables.publications[0].locales, undefined)
})

test('glossary merges terms case-insensitively and keeps other languages', () => {
  const { ctx } = fixture()
  glossary.save({ terms: [{ term: 'Sintered stone', translations: { zh: '岩板' } }] }, ctx)
  glossary.save({ term: 'sintered stone', translations: { ar: 'الحجر الملبد' }, note: 'first mention' }, ctx)
  glossary.save({ terms: JSON.stringify([{ term: 'Pofung', keep: true }]) }, ctx)
  const l = glossary.list({}, ctx)
  assert.equal(l.length, 2)
  assert.deepEqual(l.find((g) => g.term === 'sintered stone').translations, { zh: '岩板', ar: 'الحجر الملبد' })
  assert.equal(l.find((g) => g.term === 'Pofung').keep, true)
})

test('a real publish that is missing the default language is recorded as failed, so a schedule does not retry', async () => {
  const { ctx, tables, site, a } = fixture()
  languages.setLang({ article_id: a.id, lang: 'zh' }, ctx)
  ctx.db.insert('publications', { article_id: a.id, channel_id: site.id, status: 'scheduled', scheduled_at: '2026-11-09T00:00:00Z' })
  await assert.rejects(script(ctx, site)({ article_id: a.id }), /en/)
  const p = tables.publications[0]
  assert.equal(p.status, 'failed')
  assert.equal(p.scheduled_at, '')
  assert.match(p.error, /en/)
})

test('an older script with no translations to send does not nag', async () => {
  const { ctx, tables, cms, site, a } = fixture()
  await script(ctx, site, { noBody: true })({ article_id: a.id })
  assert.equal(cms[0].body.title, 'Sofa guide')
  assert.equal(tables.publications[0].warning, '')
})
