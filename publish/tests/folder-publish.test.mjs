import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-publish-'));
fs.cpSync(path.join(root, 'creator'), temp, { recursive: true });
fs.cpSync(path.join(root, 'core/local'), path.join(temp, 'local'), { recursive: true });
await build({ entryPoints: [path.join(temp, 'local/folder.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(temp, 'test.mjs'), logLevel: 'silent',
  // 社媒插件换成桩：只看 folder.publish 把什么存进帖子
  plugins: [{ name: 'social-fixture', setup(b) {
    b.onResolve({ filter: /plugins\/social\// }, a => ({ path: a.path, namespace: 'social-fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'social-fixture' }, () => ({ loader: 'ts', contents: "export const FIELDS={douyin:{video:'optional',videoCover:true}}; export const CONTENT_TYPES=['article','post','video']; export const contentType=c=>c?.type||'article'; export const parseList=v=>Array.isArray(v)?v:JSON.parse(v||'[]'); export const lengthOn=()=>0; export const platformsFor=()=>['douyin']; export const htmlImages=()=>[]; export const supports=()=>true; export const fromContent=c=>({...c}); export function check(){return {problems:[]}}; export async function summary(){return []}" }));
  } }] });
const folder = await import(pathToFileURL(path.join(temp, 'test.mjs')));

function fixture(article = {}) {
  const tables = { articles: [{ id: 'a', title: 'T', folder: '内容/T', ...article }], social_accounts: [{ id: 'dy', type: 'douyin' }], social_posts: [] };
  const ctx = { locale: 'en', log() {}, db: {
    get: (t, id) => tables[t].find(r => r.id === id),
    insert: (t, v) => { const row = { ...v, id: 'p' + tables[t].length }; tables[t].push(row); return row },
    update: (t, id, patch) => Object.assign(tables[t].find(r => r.id === id), patch),
    delete: (t, id) => { tables[t] = tables[t].filter(r => r.id !== id) },
  }, fs: { stat: () => ({}), toLocal: p => 'local:' + Buffer.from(p).toString('hex').slice(0, 32) + '.png' } };
  return { ctx, tables };
}
const base = { article_id: 'a', kind: 'video', title: 'T', body: 'B', video: 'local:0123456789abcdef0123456789abcdef.mp4', channel_ids: ['dy'] };

test('the cover picked in the publish dialog goes onto the post; folder images become local files', () => {
  const { ctx, tables } = fixture({ video_cover: 'https://lib.test/old.png' });
  folder.publish({ ...base, video_cover: '封面.png' }, ctx);
  assert.match(tables.social_posts[0].video_cover, /^local:[0-9a-f]{32}\.png$/);
  folder.publish({ ...base, video_cover: 'https://lib.test/new.png' }, ctx);
  assert.equal(tables.social_posts[1].video_cover, 'https://lib.test/new.png');
});
test('an empty cover means the platform default; leaving it out keeps the cover set on the content', () => {
  const { ctx, tables } = fixture({ video_cover: 'https://lib.test/old.png' });
  folder.publish({ ...base, video_cover: '' }, ctx);
  assert.equal(tables.social_posts[0].video_cover, '');
  folder.publish(base, ctx);
  assert.equal(tables.social_posts[1].video_cover, 'https://lib.test/old.png');
  folder.publish({ ...base, kind: 'post', images: ['https://lib.test/i.png'], video_cover: '封面.png' }, ctx);
  assert.equal(tables.social_posts[2].video_cover, '');
});
test('a cover path outside the content folder is rejected', () => {
  const { ctx } = fixture();
  assert.throws(() => folder.publish({ ...base, video_cover: '../x.png' }, ctx), /Invalid path/);
});
