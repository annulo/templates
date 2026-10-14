import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const temp = mkdtempSync(join(tmpdir(), 'facebook-comment-ui-test-'))
execFileSync('esbuild', ['core/lib/facebookComments.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${join(temp, 'comments.mjs')}`], { stdio: 'pipe' })
const { canViewFacebookComments: enabled, mergeFacebookComments: merge } = await import(pathToFileURL(join(temp, 'comments.mjs')))
after(() => rmSync(temp, { recursive: true, force: true }))

test('comment reading is limited to published posts on the matching API Page', () => {
  const channel = { id: 'a', type: 'facebook', auth_mode: 'api', fb_kind: 'page' }
  const post = { id: 'p', channel_id: 'a', status: 'published', post_id: '100_1' }
  assert.equal(enabled(post, channel), true)
  for (const other of [undefined, { ...channel, id: 'b' }, { ...channel, type: 'linkedin' }, { ...channel, auth_mode: 'browser' }, { ...channel, fb_kind: 'profile' }]) assert.equal(enabled(post, other), false)
  for (const status of ['draft', 'failed', 'removed', 'publishing']) assert.equal(enabled({ ...post, status }, channel), false)
  assert.equal(enabled({ ...post, post_id: '' }, channel), false)
})

test('overlapping pages update comments by ID without losing separate comments with identical text or missing IDs', () => {
  const comment = { message: 'Thanks', created_time: '2026-10-10T00:00:00Z' }
  const previous = [{ ...comment, id: '1' }, { ...comment, id: '2' }, comment]
  const next = [{ ...comment, id: '2', message: 'Edited' }, { ...comment, id: '3' }, comment]
  assert.deepEqual(merge(previous, next), [previous[0], next[0], previous[2], next[1], next[2]])
  assert.equal(previous[1].message, 'Thanks')
  assert.deepEqual(merge([], next), next)
})
