import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
const require = createRequire(import.meta.url)
const { transformSync } = require(process.env.ESBUILD_MODULE || 'esbuild')
const source = transformSync(readFileSync(new URL('../../core/lib/oauthReturn.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code

function harness() {
  const data = new Map(), calls = [], queues = new Map()
  const location = { href: 'http://project-a.localhost:7799/en/?view=channels' }
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
  const module = { exports: {} }
  const context = { module, URL, crypto: webcrypto, Date, location, localStorage: storage,
    history: { state: null, replaceState: (_, __, path) => { location.href = new URL(path, location.href).href } },
    navigator: { locks: { request: async (key, run) => {
      const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(run)
      queues.set(key, next); return next
    } } }, require: () => ({ startOAuthConnection: async (provider, returnTo) => { calls.push({ provider, returnTo }); return { auth_url: 'https://auth.example.test' } } }) }
  vm.runInNewContext(source, context)
  const returned = (call, account = 'new-account', status = 'connected') => {
    const to = new URL(call.returnTo, location.href)
    to.searchParams.set('connection_provider', call.provider)
    to.searchParams.set('connection_status', status)
    to.searchParams.set('connection_account', account)
    location.href = to.href
  }
  return { ...module.exports, calls, returned, location, data }
}

test('return restores the actual authorized identity, target record and media host', async () => {
  const h = harness()
  await h.startProjectOAuth('instagram', { channelId: 'record-a', mediaHost: 'site-a' })
  h.returned(h.calls[0], 'new-grant')
  const result = h.readOAuthReturn('instagram')
  assert.equal(result.account, 'new-grant')
  assert.equal(result.channelId, 'record-a')
  assert.equal(result.mediaHost, 'site-a')
  assert.equal(new URL(h.location.href).pathname, '/en/')
  assert.equal(h.readOAuthReturn('threads'), undefined)
})

test('parallel return handlers and reload execute a binding at most once', async () => {
  const h = harness()
  await h.startProjectOAuth('threads'); h.returned(h.calls[0])
  let count = 0
  await Promise.all(Array.from({ length: 3 }, () => h.continueOAuthReturn('threads', async () => { count++; await Promise.resolve() })))
  await h.continueOAuthReturn('threads', async () => { count++ })
  assert.equal(count, 1)
  h.finishOAuthReturn()
  assert.equal(h.readOAuthReturn(), undefined)
  assert.equal(new URL(h.location.href).search, '?view=channels')
})

test('cancelled, expired, forged or different-provider callbacks never bind', async () => {
  const h = harness()
  await h.startProjectOAuth('facebook'); h.returned(h.calls[0], '', 'failed')
  let count = 0
  await h.continueOAuthReturn('facebook', async () => { count++ })
  const to = new URL(h.location.href); to.searchParams.set('oauth_intent', 'forged'); h.location.href = to.href
  assert.equal(h.readOAuthReturn(), undefined)
  h.returned(h.calls[0])
  const [key, value] = [...h.data][0]; h.data.set(key, JSON.stringify({ ...JSON.parse(value), at: Date.now() - 16 * 60_000 }))
  await h.continueOAuthReturn('facebook', async () => { count++ })
  assert.equal(count, 0)
})

test('a failed bind is not retried on refresh; separate transactions retain their own identity', async () => {
  const h = harness()
  await h.startProjectOAuth('instagram'); await h.startProjectOAuth('threads')
  h.returned(h.calls[0], 'grant-a')
  let count = 0
  await assert.rejects(h.continueOAuthReturn('instagram', async () => { count++; throw Error('upstream unavailable') }), /upstream/)
  await h.continueOAuthReturn('instagram', async () => { count++ })
  assert.equal(count, 1)
  h.returned(h.calls[1], 'threads-b')
  assert.equal(h.readOAuthReturn('threads').account, 'threads-b')
})

test('closing the initiating add flow cancels binding even if OAuth later succeeds', async () => {
  const h = harness()
  await h.startProjectOAuth('instagram')
  h.finishOAuthReturn()
  h.returned(h.calls[0])
  await h.continueOAuthReturn('instagram', async () => assert.fail('closed add flow must not bind'))
  assert.equal(h.readOAuthReturn(), undefined)
})
