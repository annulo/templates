import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const temp = mkdtempSync(join(tmpdir(), 'instagram-prepare-'))
mkdirSync(join(temp, 'local')); mkdirSync(join(temp, 'plugins'))
for (const name of ['publish', '_types', '_i18n']) copyFileSync(`core/local/${name}.ts`, join(temp, 'local', name + '.ts'))
symlinkSync(resolve('../annulo-plugins-public/social'), join(temp, 'plugins/social'), 'dir')
execFileSync('esbuild', [join(temp, 'local/publish.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${join(temp, 'publish.mjs')}`], { stdio: 'pipe' })
const { prepare } = await import(pathToFileURL(join(temp, 'publish.mjs')))
after(() => rmSync(temp, { recursive: true, force: true }))

function context(post) {
  const article = { id: 'a', type: 'post', title: 'Test', body: 'Edited caption', images: '["https://example.org/test.jpg"]', tags: '[]' }
  const channel = { id: 'c', type: 'instagram', auth_mode: 'api' }
  const rows = new Map(post ? [['p', { id: 'p', article_id: 'a', channel_id: 'c', body: 'Original caption', ...post }]] : [])
  const writes = []
  return { locale: 'en', rows, writes, db: {
    get(t, id) { return t === 'articles' ? article : t === 'social_accounts' ? channel : rows.get(id) },
    query(t) { return { list: t === 'social_posts' ? [...rows.values()] : [] } },
    insert(t, data) { const r = { ...data, id: 'new' }; rows.set(r.id, r); writes.push(r); return r },
    update(t, id, data) { const r = { ...rows.get(id), ...data }; rows.set(id, r); writes.push(r) },
    delete(t, id) { rows.delete(id) },
  } }
}
const input = { article_id: 'a', channel_ids: ['c'] }

test('content edits cannot overwrite a submitted, published or malformed unresolved receipt', () => {
  for (const state of ['{"stage":"submitted"}', '{"stage":"published"}', '{broken']) {
    const ctx = context({ status: 'failed', instagram_api_state: state })
    const r = prepare(input, ctx)
    assert.equal(r.ready.length, 0); assert.equal(r.problems.length, 1)
    assert.equal(ctx.writes.length, 0); assert.equal(ctx.rows.get('p').body, 'Original caption')
  }
})
test('publishing and scheduled API attempts stop before preparing another record', () => {
  for (const [post, params] of [[{ status: 'publishing' }, input], [undefined, { ...input, scheduled_at: new Date(Date.now() + 3600000).toISOString() }]]) {
    const ctx = context(post), r = prepare(params, ctx)
    assert.equal(r.ready.length, 0); assert.equal(r.problems.length, 1); assert.equal(ctx.writes.length, 0)
  }
})
test('an unpublished prepared container keeps the same post record when its content is edited', () => {
  const ctx = context({ status: 'approved', instagram_api_state: '{"stage":"prepared"}' })
  const r = prepare(input, ctx)
  assert.deepEqual(r.problems, []); assert.equal(r.ready[0].post_id, 'p')
  assert.equal(ctx.rows.size, 1); assert.equal(ctx.rows.get('p').body, 'Edited caption')
})
