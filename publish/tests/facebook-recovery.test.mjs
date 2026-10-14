// npx --yes --package=esbuild -c 'node --test publish/tests/facebook-recovery.test.mjs'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temp = mkdtempSync(join(tmpdir(), 'facebook-recovery-test-'))
const build = (entry, output, extra = []) => execFileSync('esbuild', [entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${join(temp, output)}`, ...extra], { stdio: 'pipe' })
build(join(root, 'core/lib/facebookPublishRecovery.ts'), 'recovery.mjs')
const { facebookPublishRecovery: recovery } = await import(pathToFileURL(join(temp, 'recovery.mjs')))
copyFileSync(join(root, 'core/lib/publishQueue.ts'), join(temp, 'publishQueue.ts'))
writeFileSync(join(temp, 'react.ts'), 'export const useState = () => [0, () => {}]; export const useEffect = () => {}')
writeFileSync(join(temp, 'shuttle.ts'), 'export const dbList = async () => []; export const dbPatch = async () => {}; export const runLocal = (...args) => globalThis.__facebookQueueTest.run(...args)')
writeFileSync(join(temp, 'runs.ts'), 'export const showRun = async () => {}; export const stopRun = async () => {}')
writeFileSync(join(temp, 'i18n.ts'), 'export const tr = (key) => key')
build(join(temp, 'publishQueue.ts'), 'queue.mjs', [`--alias:react=${join(temp, 'react.ts')}`])
const queue = await import(pathToFileURL(join(temp, 'queue.mjs')))
after(() => { delete globalThis.__facebookQueueTest; rmSync(temp, { recursive: true, force: true }) })

const channel = { type: 'facebook', auth_mode: 'api', page_id: '200' }
const attemptedAt = '2026-10-10T00:00:00.000Z'
const post = { id: 'p1', status: 'failed', body: 'Edited caption', images: '[]', facebook_api_state: JSON.stringify({ content: JSON.stringify(['100', 'Original caption', ['https://example.com/a.png']]), photo_ids: ['123'], uploaded_at: attemptedAt, attempted_at: attemptedAt }) }

test('recovery shows the original attempted content and Page after a draft or target changes', () => {
  assert.deepEqual(recovery(post, channel), { attemptedAt, text: 'Original caption', imageCount: 1, pageUrl: 'https://www.facebook.com/100' })
  assert.equal(recovery({ ...post, status: 'approved' }, channel).text, 'Original caption')
})
test('only unresolved Facebook API attempts get recovery controls', () => {
  for (const status of ['published', 'draft', 'removed', 'publishing']) assert.equal(recovery({ ...post, status }, channel), null)
  assert.equal(recovery(post, { ...channel, auth_mode: 'browser' }), null)
  assert.equal(recovery(post, { ...channel, type: 'linkedin' }), null)
  const state = JSON.parse(post.facebook_api_state); delete state.attempted_at
  assert.equal(recovery({ ...post, facebook_api_state: JSON.stringify(state) }, channel), null)
})
test('malformed state cannot create an unsafe Page link', () => {
  for (const content of [['javascript:alert(1)', '', []], ['100', '', [{}]], ['100', ''], [100, '', []]]) {
    assert.equal(recovery({ ...post, facebook_api_state: JSON.stringify({ attempted_at: attemptedAt, content: JSON.stringify(content) }) }, channel), null)
  }
  assert.equal(recovery({ ...post, facebook_api_state: '{broken' }, channel), null)
})
test('queued checks and confirmed retries retain their flags, ordinary publishing has none and duplicates are skipped', async () => {
  const calls = []; let release
  globalThis.__facebookQueueTest = { run: (fn, input) => { calls.push({ fn, input }); return calls.length === 1 ? new Promise((r) => { release = r }) : Promise.resolve() } }
  const job = (post_id, extra = {}) => ({ post_id, article_id: 'article', article_title: 'Article', channel_id: 'channel', channel_name: 'Page', ...extra })
  queue.enqueue([job('check', { check_only: true }), job('check', { confirm_unpublished: true }), job('retry', { confirm_unpublished: true }), job('normal')])
  assert.deepEqual(calls, [{ fn: 'social/social.publish', input: { post_id: 'check', check_only: true } }])
  release()
  for (let i = 0; i < 8 && queue.usePublishQueue().some((j) => ['queued', 'running'].includes(j.state)); i++) await new Promise((r) => setImmediate(r))
  assert.deepEqual(calls, [
    { fn: 'social/social.publish', input: { post_id: 'check', check_only: true } },
    { fn: 'social/social.publish', input: { post_id: 'retry', confirm_unpublished: true } },
    { fn: 'social/social.publish', input: { post_id: 'normal' } },
  ])
  assert.ok(queue.usePublishQueue().every((j) => j.state === 'ok'))
})
