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
  return { locale: 'en', article, channel, rows, writes, db: {
    get(t, id) { return t === 'articles' ? article : t === 'social_accounts' ? channel : rows.get(id) },
    query(t) { return { list: t === 'social_posts' ? [...rows.values()] : [] } },
    insert(t, data) { const r = { ...data, id: 'new' }; rows.set(r.id, r); writes.push(r); return r },
    update(t, id, data) { const r = { ...rows.get(id), ...data }; rows.set(id, r); writes.push(r) },
    delete(t, id) { rows.delete(id) },
  } }
}
const input = { article_id: 'a', channel_ids: ['c'] }

test('Threads prepare carries both videos in order and clears old carousel on image-only edits', () => {
  const ctx = context()
  ctx.channel.type = 'threads'
  ctx.article.type = 'video'
  ctx.article.video = 'https://example.org/one.mp4'
  const items = [{ kind: 'video', url: ctx.article.video }, { kind: 'image', url: 'https://example.org/test.jpg' }, { kind: 'video', url: 'https://example.org/two.mp4' }]
  ctx.article.media = JSON.stringify(items)
  let r = prepare(input, ctx)
  assert.deepEqual(r.problems, [])
  assert.deepEqual(JSON.parse(ctx.rows.get('new').media), items)
  ctx.article.type = 'post'; ctx.article.media = '[]'; ctx.article.video = ''
  r = prepare(input, ctx)
  assert.deepEqual(r.problems, [])
  assert.equal(ctx.rows.get('new').media, '')
  assert.equal(ctx.rows.get('new').video, '')
})

test('Threads prepare rejects twenty-one items; Instagram still rejects two videos', () => {
  for (const [platform, count, expected] of [['threads', 21, /up to 20/], ['instagram', 2, /Only one video/]]) {
    const ctx = context(); ctx.channel.type = platform; ctx.article.type = 'video'
    ctx.article.media = JSON.stringify(Array.from({ length: count }, (_, i) => ({ kind: 'video', url: `https://example.org/${i}.mp4` })))
    const r = prepare(input, ctx)
    assert.equal(r.ready.length, 0)
    assert.match(r.problems[0].problems.join(), expected)
    assert.equal(ctx.writes.length, 0)
  }
})
