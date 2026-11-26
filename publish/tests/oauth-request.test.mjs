import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const { transformSync } = require(process.env.ESBUILD_MODULE || 'esbuild')
const requests = []
// Match the client's connect contract at the HTTP boundary, without contacting a provider.
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const parsed = JSON.parse(body)
  requests.push({ path: req.url, method: req.method, headers: req.headers, body, parsed })
  res.setHeader('x-shuttle', '1')
  res.setHeader('content-type', 'application/json')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    res.writeHead(400).end(JSON.stringify({ error: "The request body isn't valid JSON" }))
  } else if (parsed.return_to === '/rejected') {
    res.writeHead(400).end(JSON.stringify({ error: 'connection unavailable' }))
  } else {
    res.end(JSON.stringify({ auth_url: 'https://auth.example.test/authorize' }))
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
const origin = `http://127.0.0.1:${server.address().port}`

function load(path) {
  const source = transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module,
    fetch: (url, init) => fetch(new URL(url, origin), init),
    require: id => {
      if (id === './remote') return { shuttleMissing: () => false, markShuttle: () => {}, ShuttleUnavailable: class extends Error {} }
      if (id === './i18n') return { tr: key => key }
      if (id === './sites' || id === 'talizen/assets') return {}
      throw Error(`Unexpected dependency: ${id}`)
    },
  })
  return module.exports
}

for (const [name, path] of [
  ['business (product and trade)', '../../core/features/business/lib/shuttle.ts'],
  ['creator', '../../creator/lib/shuttle.ts'],
]) {
  const { startOAuthConnection } = load(path)
  test(`${name}: all three providers send a JSON object with the project return path`, async () => {
    const returnTo = '/en/?view=channels&oauth_intent=test-intent'
    for (const provider of ['instagram', 'threads', 'facebook']) {
      const result = await startOAuthConnection(provider, returnTo)
      assert.equal(result.auth_url, 'https://auth.example.test/authorize')
      const sent = requests.at(-1)
      assert.equal(sent.path, `/_shuttle/api/settings/connections/${provider}/connect`)
      assert.equal(sent.method, 'POST')
      assert.equal(sent.headers['content-type'], 'application/json')
      assert.equal(sent.headers['x-shuttle'], '1')
      assert.deepEqual(sent.parsed, { return_to: returnTo })
    }
  })
  test(`${name}: settings authorization without a return path still sends an object`, async () => {
    await startOAuthConnection('instagram')
    assert.deepEqual(requests.at(-1).parsed, {})
  })
  test(`${name}: a rejected connection remains an error`, async () => {
    await assert.rejects(startOAuthConnection('threads', '/rejected'), /connection unavailable/)
  })
}
