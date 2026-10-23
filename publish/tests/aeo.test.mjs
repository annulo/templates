// node --test publish/tests/aeo.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const source = fs.readFileSync(new URL('../../core/local/_aeo.ts', import.meta.url), 'utf8')
const { scoreArticle, aeoOptions, gradeOf } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)

const good = `
<p>A bathroom vanity factory in Foshan can usually ship 300 units of the VT-2040 cabinet within 25 days, with a MOQ of 50 sets per model and CE and ISO 9001 certificates available for EU buyers who import through FOB Shenzhen.</p>
<h2>What sizes does the VT-2040 come in?</h2>
<p>The VT-2040 vanity comes in 600 mm, 800 mm and 1000 mm widths, each 460 mm deep and 850 mm tall, so it fits most European bathrooms without custom cutting, and every size uses the same 18 mm plywood carcass with a quartz top.</p>
<ul><li>600 mm: single basin, 32 kg</li><li>800 mm: single basin, 38 kg</li><li>1000 mm: double basin, 46 kg</li></ul>
<h2>How long is the lead time?</h2>
<p>Production of the VT-2040 takes 20 to 25 days after the deposit for orders up to 300 units, and a 40 ft container holds about 120 units, so one container order usually leaves the factory within 4 weeks including inspection.</p>
<h2>Which certifications are available?</h2>
<table><tr><td>CE</td><td>EN 14749</td></tr><tr><td>ISO 9001</td><td>Factory</td></tr><tr><td>FSC</td><td>Plywood</td></tr></table>
<p>See the <a href="https://www.iso.org/iso-9001-quality-management.html">ISO 9001 standard</a> and our <a href="/products/vt-2040">VT-2040 page</a> for the full specification sheet with 12 drawings.</p>
`

test('a structured, specific article scores high', () => {
  const r = scoreArticle({ title: 'VT-2040 Bathroom Vanity: Sizes, Lead Time and Certifications', summary: 'Sizes, MOQ, lead time and CE / ISO certificates of the VT-2040 vanity from our Foshan factory.', body: good }, { terms: ['VT-2040'], hosts: ['example.com'] })
  assert.equal(r.lang, 'en')
  assert.ok(r.score >= 75, `score ${r.score}`)
  const ok = Object.fromEntries(r.checks.map((c) => [c.key, c.ok]))
  assert.equal(ok.questions, true)
  assert.equal(ok.lists, true)
  assert.equal(ok.external, true)
  assert.equal(ok.internal, true)
  assert.deepEqual(r.blocks.map((b) => b.kind), ['p', 'p', 'list', 'p', 'table', 'p'])
})

test('vague paragraphs are named as the weakest', () => {
  const body = `<p>We are a leading manufacturer of high quality furniture.</p><h2>About us</h2><p>This is why customers love us. However, we always provide excellent service and a wide range of products for every customer around the world, and our professional team is ready to help you with anything you need at any time of the day.</p>`
  const r = scoreArticle({ title: 'About', body })
  assert.ok(r.score < 40, `score ${r.score}`)
  assert.equal(r.grade, gradeOf(r.score))
  assert.ok(r.weakest.length >= 1)
  assert.ok(r.weakest[0].miss.includes('specific'))
  assert.ok(r.blocks.find((b) => b.text.startsWith('This')).miss.includes('standalone'))
})

test('Chinese articles count characters and Chinese pointers', () => {
  const body = `<p>佛山浴室柜工厂一般 25 天能出 300 套 VT-2040，每款起订量 50 套，可以提供 CE 和 ISO 9001 证书，适合从深圳 FOB 出口到欧洲的采购商，第一次合作也可以先下一个混柜小单试销。</p><h2>交期多久？</h2><p>此外，我们是行业领先的一站式供应商。</p>`
  const r = scoreArticle({ title: 'VT-2040 浴室柜的尺寸、交期和认证', body })
  assert.equal(r.lang, 'zh')
  assert.equal(r.checks.find((c) => c.key === 'lead').ok, true)
  const last = r.blocks.at(-1)
  assert.ok(last.miss.includes('standalone'))
  assert.ok(last.miss.includes('specific'))
})

test('nested blocks are not counted twice; empty body is null', () => {
  const r = scoreArticle({ body: '<div><blockquote><p>Inside a quote with 20 mm and 30 kg figures that should only appear once in the result list.</p></blockquote><ul><li><p>a</p></li><li>b</li><li>c</li></ul></div>' })
  assert.deepEqual(r.blocks.map((b) => b.kind), ['p', 'list'])
  assert.equal(scoreArticle({ body: '<p> </p>' }), null)
})

test('options come from profile and products', () => {
  const o = aeoOptions({ name: 'Pofung', brand_terms: '["Pofung Home", "PF"]', website_url: 'https://www.pofung.com/' }, [{ name: 'Oak Vanity', model: 'VT-2040' }])
  assert.deepEqual(o.terms, ['Pofung', 'Pofung Home', 'PF', 'Oak Vanity', 'VT-2040'])
  assert.deepEqual(o.hosts, ['pofung.com'])
  const r = scoreArticle({ body: '<p>Link <a href="https://pofung.com/a">own</a> and <a href="https://shop.pofung.com/b">own too</a> and <a href="https://iso.org">iso</a> in a sentence long enough.</p>' }, o)
  assert.equal(r.checks.find((c) => c.key === 'internal').value, 2)
  assert.equal(r.checks.find((c) => c.key === 'external').value, 1)
})

test('a sentence ending with a colon belongs to the list after it', () => {
  const r = scoreArticle({ body: '<h2>What does it include?</h2><p>The collection covers these categories:</p><ul><li>Beds 1800 mm</li><li>Nightstands</li><li>Vanities</li></ul>' })
  assert.deepEqual(r.blocks.map((b) => b.kind), ['list'])
  assert.match(r.blocks[0].text, /^The collection covers these categories: Beds/)
})
