import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const { transformSync } = require(process.env.ESBUILD_MODULE || 'esbuild')
const compile = path => transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code
const source = compile('../../core/lib/socialAuthorizationReturn.ts')
const model = { exports: {} }; vm.runInNewContext(compile('../../core/lib/socialAuthorization.ts'), { module: model })

function harness() {
  const state = { channels: [], connections: ['instagram', 'threads', 'facebook'].map(key => ({ key, available: true, accounts: [{ account: 'new' }] })),
    grants: [{ id: 'new', login_method: 'unified_login', status: 'active', assets: ['one', 'two'].map(id => ({ id, name: id, kind: 'instagram_account', status: 'active' })) }],
    pages: [{ id: 'page-one' }, { id: 'page-two' }], fail: false, active: true }
  const writes = [], reads = [], records = new Map()
  const module = { exports: {} }
  vm.runInNewContext(source, { module, require: id => {
    if (id === './socialAuthorization') return model.exports
    if (id === './i18n') return { tr: key => key }
    if (id === './managedConnections') return { managedConnections: async () => state.grants }
    if (id === './shuttle') return {
      listOAuthConnections: async () => state.connections,
      listChannels: async () => ({ list: state.channels }),
      runLocal: async (fn, input) => {
        input = JSON.parse(JSON.stringify(input))
        if (fn === 'social/social.login' && input.type === 'facebook') {
          reads.push(input)
          return { choose: { type: 'facebook', profile: 'api', uid: input.account, pages: state.pages } }
        }
        writes.push({ fn, input })
        if (state.fail) throw Error('upstream unavailable')
        if (input.type === 'threads') {
          const existing = state.channels.find(c => c.oauth_account === input.account)
          if (existing) assert.equal(input.channel_id, existing.id)
          else state.channels.push({ id: 'threads-row', type: 'threads', api_credential: 'threads_oauth', oauth_account: input.account })
        }
        const ids = input.page_ids || [input.asset_id || input.account]
        for (const id of ids) records.set(id, 'row-' + id)
        return { ids: ids.map(id => records.get(id)) }
      },
    }
    throw Error(id)
  } })
  const bind = (provider, extra = {}) => module.exports.bindReturnedAuthorization({ provider, account: 'new', status: 'connected', nonce: 'intent', ...extra }, () => state.active)
  return { state, bind, writes, reads, records }
}

test('Instagram adds every active asset from the exact returned grant, without platform or account confirmation', async () => {
  const h = harness()
  h.state.grants.unshift({ ...h.state.grants[0], id: 'old' })
  await h.bind('instagram', { mediaHost: 'chosen-host' })
  assert.deepEqual(h.writes.map(c => c.input.asset_id), ['one', 'two'])
  assert.ok(h.writes.every(c => c.input.connection_id === 'new' && c.input.media_host === 'chosen-host'))
  await h.bind('instagram')
  assert.equal(h.records.size, 2)
})
test('Facebook adds the authorized Pages together and never adds a personal profile', async () => {
  const h = harness(); await h.bind('facebook')
  assert.equal(h.writes.length, 1)
  assert.deepEqual(h.writes[0].input.page_ids, ['page-one', 'page-two'])
  assert.equal(h.writes[0].input.profile_selected, false)
  assert.equal(h.writes[0].input.choose.uid, 'new')
})
test('Threads reuses its existing official row when retrying', async () => {
  const h = harness(); await h.bind('threads'); await h.bind('threads')
  assert.equal(h.writes[0].input.account, 'new')
  assert.equal(h.writes[1].input.channel_id, 'threads-row')
  assert.equal(h.state.channels.length, 1)
})
test('missing, expired or cancelled returned grants never fall back to another authorization', async () => {
  for (const change of [
    h => { h.state.connections[0].accounts = [{ account: 'old' }] },
    h => { h.state.connections[0].accounts[0].needs_reconnect = true },
    h => { h.state.active = false },
  ]) {
    const h = harness(); change(h)
    await assert.rejects(h.bind('instagram'))
    assert.equal(h.writes.length, 0)
  }
  const h = harness(); await assert.rejects(h.bind('facebook', { status: 'failed' }))
  assert.equal(h.writes.length, 0)
})
test('reconnecting a target only updates that target; a missing target cannot create new accounts', async () => {
  const h = harness()
  h.state.channels = [{ id: 'target', type: 'facebook', fb_kind: 'page', page_id: 'page-two' }]
  await h.bind('facebook', { channelId: 'target' })
  assert.deepEqual(h.writes[0].input.page_ids, ['page-two'])
  await assert.rejects(h.bind('threads', { channelId: 'missing' }), /target_missing/)
  assert.equal(h.writes.length, 1)
})
test('an empty resource list or failed binding stays failed and can be explicitly retried', async () => {
  const h = harness(); h.state.pages = []
  await assert.rejects(h.bind('facebook'), /empty_facebook/)
  assert.equal(h.writes.length, 0)
  h.state.fail = true
  await assert.rejects(h.bind('threads'), /upstream unavailable/)
  h.state.fail = false
  await h.bind('threads')
  assert.equal(h.records.size, 1)
})
