import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const { transformSync } = require(process.env.ESBUILD_MODULE || 'esbuild')
const source = transformSync(readFileSync(new URL('../../core/lib/socialAuthorization.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code
const module = { exports: {} }; vm.runInNewContext(source, { module })
const { selectAuthorization, authorizationReady, instagramResources, authorizationTarget, defaultResources, resourceKey } = module.exports
const old = { account: 'old' }, current = { account: 'new' }

test('OAuth return and explicit selection never fall back to an unrelated saved authorization', () => {
  assert.equal(selectAuthorization([old, current], 'new', true), 'new')
  assert.equal(selectAuthorization([old], 'new', true), '')
  assert.equal(selectAuthorization([old, current], '', false), 'old')
  assert.equal(selectAuthorization([{ ...old, needs_reconnect: true }, current], '', false), 'new')
})
test('expired and incomplete grants cannot be presented as ready', () => {
  assert.equal(authorizationReady(undefined), false)
  assert.equal(authorizationReady({ ...current, needs_reconnect: true }), false)
  assert.equal(authorizationReady({ ...current, missing_scopes: ['publish'] }), false)
  assert.equal(authorizationReady({ ...current, missing_scopes: [] }), true)
})
test('Instagram resources belong to the selected active grant and the target account', () => {
  const connection = { id: 'new', login_method: 'unified_login', status: 'active', assets: [
    { id: 'one', name: 'one', kind: 'instagram_account', status: 'active' },
    { id: 'two', name: 'two', kind: 'instagram_account', status: 'revoked' },
    { id: 'page', name: 'page', kind: 'page', status: 'active' },
  ] }
  assert.equal(instagramResources([{ ...connection, id: 'old' }, connection], 'new').length, 1)
  assert.equal(instagramResources([connection], 'old').length, 0)
  assert.equal(instagramResources([{ ...connection, needs_reconnect: true }], 'new').length, 0)
  assert.equal(instagramResources([connection], 'new', { instagram_user_id: 'different' }).length, 0)
  assert.equal(instagramResources([connection], 'new', { instagram_user_id: 'one' })[0].account, 'new')
})
test('legacy Instagram sources and Facebook personal profiles are not overwritten', () => {
  const ch = { id: 'existing', type: 'instagram', api_credential: 'instagram_user_token' }
  assert.equal(authorizationTarget('instagram', ch), undefined)
  assert.equal(authorizationTarget('instagram', { ...ch, api_credential: 'instagram_managed' }).id, 'existing')
  assert.equal(authorizationTarget('facebook', { id: 'profile', fb_kind: 'profile' }), undefined)
  assert.equal(authorizationTarget('threads', { id: 'threads', api_credential: 'threads_user_token' }).id, 'threads')
})
test('single assets are preselected; multiple assets require a choice and stale grant selections are dropped', () => {
  const one = { key: resourceKey('new', 'one'), id: 'one' }, two = { key: resourceKey('new', 'two'), id: 'two' }
  assert.equal(defaultResources([one], [], undefined)[0], one.key)
  assert.equal(defaultResources([one, two], [], undefined).length, 0)
  assert.equal(defaultResources([one, two], [two.key], undefined)[0], two.key)
  assert.equal(defaultResources([one, two], [resourceKey('old', 'one')], undefined).length, 0)
  assert.equal(defaultResources([one, two], [], { page_id: 'two' })[0], two.key)
})
