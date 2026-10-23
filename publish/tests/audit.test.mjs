// node --test publish/tests/audit.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const source = fs.readFileSync(new URL('../../core/features/websites/local/audit.ts', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
const js = stripTypeScriptTypes(`const isEn = ctx => ctx.locale === 'en'; const L = (ctx, zh, en) => isEn(ctx) ? en : zh;\n${source}`)
const { inspect } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const response = (status, body, type = 'text/plain', extra = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => type }, text: async () => body, ...extra })
async function audit(files, retryFiles) {
  const calls = []
  let batch = 0
  const ctx = { progress() {}, fetchAll: async urls => {
    calls.push(...urls)
    if (urls.every(u => /\/(robots|llms)\.txt$/.test(u))) {
      return urls.map(u => (batch++ < 2 ? files : retryFiles ?? files)[u.endsWith('/robots.txt') ? 0 : 1])
    }
    return urls.map(() => response(200, 'not html', 'text/plain'))
  } }
  const old = global.fetch
  global.fetch = async () => response(200, '<urlset></urlset>', 'application/xml')
  try { return { result: await inspect({ url: 'https://example.com/en/products?src=test', max: 1 }, ctx), calls } }
  finally { global.fetch = old }
}
const robots = response(200, 'User-agent: *\nAllow: /')
const llms = response(200, '# Example\n\nSite description')
const fileIssues = result => result.found.filter(f => ['robots', 'llms_txt'].includes(f.check))
test('nested URL checks files at the origin; valid text works even with incorrect HTML MIME', async () => {
  const { result, calls } = await audit([response(200, 'User-agent: *\nAllow: /', 'text/html'), llms])
  assert.deepEqual(calls.slice(0, 2), ['https://example.com/robots.txt', 'https://example.com/llms.txt'])
  assert.deepEqual(fileIssues(result), [])
  assert.equal(calls.at(-1), 'https://example.com/en/products')
})
test('404 and 410 establish missing files', async () => {
  const { result } = await audit([response(404, 'not found'), response(410, 'gone')])
  assert.deepEqual(fileIssues(result).map(f => f.title), ['没有 robots.txt', '没有 llms.txt'])
})
test('network failure and 503 are unknown, never missing', async () => {
  const { result } = await audit([{ ok: false, error: 'timeout' }, response(503, 'unavailable')])
  assert.deepEqual(fileIssues(result).map(f => f.title), ['无法确认 robots.txt', '无法确认 llms.txt'])
})
test('retry recovers transient failure', async () => {
  const { result } = await audit([{ ok: false, error: 'timeout' }, response(503, '')], [robots, llms])
  assert.deepEqual(fileIssues(result), [])
})
test('HTML fallback/challenge and truncated responses do not establish missing files', async () => {
  const { result } = await audit([response(200, '<!doctype html><html><body>Not found</body></html>'), response(200, '# Example', 'text/plain', { truncated: true })])
  assert.ok(fileIssues(result).every(f => f.title.startsWith('无法确认')))
  assert.equal(fileIssues(result).length, 2)
})
const crawlers = result => result.found.find(f => f.check === 'ai_crawlers')
test('robots.txt that blocks AI search crawlers is a high issue', async () => {
  const { result } = await audit([response(200, 'User-agent: *\nDisallow: /admin\n\nUser-agent: OAI-SearchBot\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /\nAllow: /blog/'), llms])
  const f = crawlers(result)
  assert.equal(f.severity, 'high')
  assert.match(f.detail, /OAI-SearchBot（ChatGPT 搜索）：整站禁止/)
  assert.match(f.detail, /GPTBot（OpenAI 训练）：整站禁止/)
  assert.match(f.detail, /PerplexityBot（Perplexity）：只放行了部分路径/)
  assert.doesNotMatch(f.detail, /ClaudeBot/)
})
test('blocking only training crawlers is low; path-only disallows and missing robots are fine', async () => {
  assert.equal(crawlers((await audit([response(200, 'User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /'), llms])).result).severity, 'low')
  assert.equal(crawlers((await audit([response(200, 'User-agent: *\nDisallow: /cart\nDisallow: /admin/'), llms])).result), undefined)
  assert.equal(crawlers((await audit([response(404, 'not found'), llms])).result), undefined)
  assert.equal(crawlers((await audit([response(200, 'User-agent: *\nDisallow: /\nAllow: /'), llms])).result), undefined)
})
test('preview hosts are not checked for AI crawlers', async () => {
  const calls = []
  const ctx = { progress() {}, fetchAll: async urls => urls.map(u => u.endsWith('/robots.txt') ? response(200, 'User-agent: *\nDisallow: /') : u.endsWith('/llms.txt') ? llms : response(200, 'not html')) }
  const old = global.fetch
  global.fetch = async () => response(200, '<urlset></urlset>', 'application/xml')
  try { assert.equal(crawlers(await inspect({ url: 'https://abc.preview.creght.cn/', max: 1 }, ctx)), undefined) }
  finally { global.fetch = old }
})
