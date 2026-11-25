import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temp = mkdtempSync(join(tmpdir(), 'oauth-disconnect-'))
copyFileSync(join(root, 'core/lib/managedConnections.ts'), join(temp, 'managedConnections.ts'))
writeFileSync(join(temp, 'remote.ts'), 'export const shuttleMissing = () => false; export const markShuttle = () => {}; export class ShuttleUnavailable extends Error {}')
writeFileSync(join(temp, 'i18n.ts'), 'export const tr = key => key')
execFileSync(process.env.ESBUILD_MODULE ? process.env.ESBUILD_MODULE + '/bin/esbuild' : 'esbuild', [join(temp, 'managedConnections.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${join(temp, 'connections.mjs')}`], { stdio: 'pipe' })
const { disconnectOAuthConnection } = await import(pathToFileURL(join(temp, 'connections.mjs')))
const originalFetch = globalThis.fetch
after(() => { globalThis.fetch = originalFetch; rmSync(temp, { recursive: true, force: true }) })

test('an empty account never reaches the endpoint that disconnects every account', () => {
  globalThis.fetch = () => assert.fail('must not send DELETE without an account')
  assert.throws(() => disconnectOAuthConnection('facebook', ''), /select_account/)
})

test('disconnect targets only the selected account through the current project origin', async () => {
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    return new Response('{"list":[]}', { headers: { 'x-shuttle': '1' } })
  }
  for (const provider of ['facebook', 'threads', 'instagram']) await disconnectOAuthConnection(provider, 'account/&other=1')
  for (const [index, provider] of ['facebook', 'threads', 'instagram'].entries()) {
    assert.equal(calls[index][0], `/_shuttle/api/settings/connections/${provider}?account=account%2F%26other%3D1`)
    assert.equal(calls[index][1].method, 'DELETE')
    assert.equal(calls[index][1].headers['X-Shuttle'], '1')
  }
})

test('a rejected disconnect remains an error', async () => {
  globalThis.fetch = async () => new Response('{"error":"credential service unavailable"}', { status: 503, headers: { 'x-shuttle': '1' } })
  await assert.rejects(disconnectOAuthConnection('instagram', 'connection-1'), /credential service unavailable/)
})
