import { L } from './_i18n'

// 内容文件夹（本机函数，Annulo 在用户电脑上执行，不经过模型；设计见 docs/content-model.md）：
// 每条内容一个文件夹，在项目工作目录（ctx.fs.root，本机是 ~/Annulo/<项目名>）的「内容/」下，文章表 folder 字段记它相对工作目录的路径。
// 稿子、脚本、文案、视频、参考都是里面的文件，可以分目录；页面列出、编辑它们，助手在对话里直接读写这个目录。
// 页面预览图片、视频用 /_annulo/work-files/<root 下的路径>（components/Folder.tsx），不经过这里。
//
//   folder.create({ article_id })                → { dir, path }  没有就建（带一个空的 稿子.md），有就返回；在对话里跑的会记下这段对话（「继续对话」回到它）
//   folder.list({ article_id })                  → { dir, path, entries: [{ path, dir, size, mtime }] }  entries 相对这条内容的文件夹
//   folder.read({ article_id, path })            → { text }
//   folder.write({ article_id, path, text })
//   folder.mkdir / remove / rename({ article_id, path, to? })
//   folder.importLocal({ article_id, url, to })  把本机文件（local:<name>，上传的、资料库里的）复制进文件夹
//   folder.open({ article_id, path?, reveal? })  用系统程序打开 / 在访达里显示
//   folder.retitle({ article_id, title })        改这条内容的名字；文件夹是按老名字建的就跟着改
//   folder.prepare({ article_id, video?, copy? }) → { title }  发布时挑的视频和文案填进文章的发布字段（发布框和社媒插件读这些字段）

const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|csv|srt|vtt|html?|css|tsx?|jsx?|py|sh)$/i

const safeName = (s: string) => s.replace(/[\/\\:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 60)

function need(ctx: any) {
  if (!ctx.fs) throw new Error(L(ctx, '这个功能要新版 Annulo：到 设置 → 关于 更新', 'This needs a newer Annulo: update it in Settings → About'))
}

function article(ctx: any, id: string) {
  const a = id ? ctx.db.get('articles', id) : null
  if (!a) throw new Error(L(ctx, `找不到这条内容：${id}`, `Content not found: ${id}`))
  return a
}

/** 相对内容文件夹的路径：不能是绝对路径、不能带 .. */
function rel(ctx: any, p?: string) {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  if (s.startsWith('/') || s.split('/').some((x) => x === '..')) throw new Error(L(ctx, `路径不对：${p}`, `Invalid path: ${p}`))
  return s
}

/** 这条内容的文件夹（相对工作目录）；create 时没有就起一个名字（内容的标题，重名的加 id 后四位） */
function folderOf(ctx: any, a: any, create: boolean) {
  let dir = String(a.folder ?? '')
  if (dir || !create) return dir
  const parent = L(ctx, '内容', 'Content')
  let name = safeName(a.title || '') || a.id
  if (ctx.fs.stat(`${parent}/${name}`)) name = `${name} ${a.id.slice(-4)}`
  dir = `${parent}/${name}`
  ctx.db.update('articles', a.id, { folder: dir })
  return dir
}

function dirOf(ctx: any, id: string) {
  need(ctx)
  const dir = folderOf(ctx, article(ctx, id), false)
  if (!dir) throw new Error(L(ctx, '这条内容还没有文件夹', "This content doesn't have a folder yet"))
  return dir
}
const join = (dir: string, p: string) => (p ? `${dir}/${p}` : dir)

/** 在对话里（annulo run）建、写文件夹的：记下是哪段对话，页面上「继续对话」回到它 */
function rememberChat(ctx: any, id: string) {
  if (ctx.chat_id) ctx.db.update('articles', id, { chat_id: ctx.chat_id })
}

export function create(input: { article_id: string }, ctx: any) {
  need(ctx)
  const a = article(ctx, input.article_id)
  const dir = folderOf(ctx, a, true)
  ctx.fs.mkdir(dir)
  // 稿子：最外层的 稿子.md（英文界面 brief.md），老项目搬过来的、用户改了名的都不再建
  if (!ctx.fs.list(dir).length) ctx.fs.write(`${dir}/${L(ctx, '稿子.md', 'brief.md')}`, '')
  rememberChat(ctx, a.id)
  return { dir: `${ctx.fs.root}/${dir}`, path: dir }
}

export function list(input: { article_id: string }, ctx: any) {
  need(ctx)
  const dir = folderOf(ctx, article(ctx, input.article_id), false)
  if (!dir || !ctx.fs.stat(dir)) return { dir: '', path: dir, entries: [] }
  return { dir: `${ctx.fs.root}/${dir}`, path: dir, entries: ctx.fs.list(dir) }
}

export function read(input: { article_id: string; path: string }, ctx: any) {
  const p = rel(ctx, input.path)
  if (!TEXT_EXT.test(p)) throw new Error(L(ctx, '只能直接打开文本文件', 'Only text files can be opened here'))
  return { text: ctx.fs.read(join(dirOf(ctx, input.article_id), p)) }
}

export function write(input: { article_id: string; path: string; text: string }, ctx: any) {
  const p = rel(ctx, input.path)
  if (!p) throw new Error(L(ctx, '要给文件名', 'Give a file name'))
  ctx.fs.write(join(dirOf(ctx, input.article_id), p), String(input.text ?? ''))
  rememberChat(ctx, input.article_id)
  return { path: p }
}

export function mkdir(input: { article_id: string; path: string }, ctx: any) {
  const p = rel(ctx, input.path)
  if (!p) throw new Error(L(ctx, '要给文件夹名', 'Give a folder name'))
  ctx.fs.mkdir(join(dirOf(ctx, input.article_id), p))
  return { path: p }
}

/** 删除：挪进废纸篓，不真删 */
export function remove(input: { article_id: string; path: string }, ctx: any) {
  const p = rel(ctx, input.path)
  if (!p) throw new Error(L(ctx, '不能删整个文件夹', "Can't delete the whole folder"))
  ctx.fs.trash(join(dirOf(ctx, input.article_id), p))
  return { ok: true }
}

export function rename(input: { article_id: string; path: string; to: string }, ctx: any) {
  const p = rel(ctx, input.path), to = rel(ctx, input.to)
  if (!p || !to) throw new Error(L(ctx, '要给名字', 'Give a name'))
  const dir = dirOf(ctx, input.article_id)
  if (p !== to) ctx.fs.move(join(dir, p), join(dir, to))
  return { path: to }
}

export function importLocal(input: { article_id: string; url: string; to: string }, ctx: any) {
  const to = rel(ctx, input.to)
  if (!String(input.url ?? '').startsWith('local:') || !to) throw new Error(L(ctx, '不是本机文件', 'Not a local file'))
  const dir = dirOf(ctx, input.article_id)
  if (!ctx.fs.stat(join(dir, to))) ctx.fs.copy(input.url, join(dir, to))
  return { path: to }
}

export function open(input: { article_id: string; path?: string; reveal?: boolean }, ctx: any) {
  const dir = input.path ? dirOf(ctx, input.article_id) : create({ article_id: input.article_id }, ctx).path
  ctx.fs.open(join(dir, rel(ctx, input.path)), { reveal: !!input.reveal })
  return { ok: true }
}

/** 改名字：文件夹是按老名字建的（「内容/<老名字>」，可能带 id 后四位）就跟着改，新名字被占了就不动文件夹 */
export function retitle(input: { article_id: string; title: string }, ctx: any) {
  const a = article(ctx, input.article_id)
  const title = String(input.title ?? '').trim()
  if (!title) throw new Error(L(ctx, '名字不能是空的', "The name can't be empty"))
  const patch: any = { title, updated_at: new Date().toISOString() }
  const dir = String(a.folder ?? '')
  const old = safeName(a.title || '')
  const base = dir.slice(dir.lastIndexOf('/') + 1)
  if (ctx.fs && dir && old && (base === old || base === `${old} ${a.id.slice(-4)}`) && safeName(title)) {
    const to = `${dir.slice(0, dir.lastIndexOf('/') + 1)}${safeName(title)}`
    if (to !== dir && !ctx.fs.stat(to) && ctx.fs.stat(dir)) {
      ctx.fs.move(dir, to)
      patch.folder = to
    }
  }
  ctx.db.update('articles', a.id, patch)
  return { folder: patch.folder ?? dir }
}

/** 文案 md：开头可以有 --- 包住的 title / tags，或者第一行 # 标题，剩下的是正文 */
function parseCopy(text: string) {
  let title = '', tags: string[] = [], body = text
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (m) {
    body = text.slice(m[0].length)
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (!kv) continue
      if (kv[1] === 'title') title = kv[2].trim()
      if (kv[1] === 'tags') tags = kv[2].replace(/^\[|\]$/g, '').split(/[,，\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean)
    }
  } else {
    const h = text.match(/^#\s+(.+)\r?\n/)
    if (h) { title = h[1].trim(); body = text.slice(h[0].length) }
  }
  return { title, tags, body: body.trim() }
}

/**
 * 发布时挑：把挑的视频和文案填进这条内容的发布字段（发布框、社媒插件现在读文章字段）；发出去的是什么记在发布记录里。
 * 视频存成本机文件（local:<name>）。文案的 title 要临时填进 title（发布框读它），返回原来的名字，发布框关了页面改回去。
 */
export function prepare(input: { article_id: string; video?: string; copy?: string }, ctx: any) {
  if (!input.video && !input.copy) throw new Error(L(ctx, '至少挑一个视频或一份文案', 'Pick at least a video or a copy file'))
  const a = article(ctx, input.article_id)
  const dir = dirOf(ctx, a.id)
  const patch: any = { updated_at: new Date().toISOString() }
  if (input.video) patch.video = ctx.fs.toLocal(join(dir, rel(ctx, input.video)))
  if (input.copy) {
    const c = parseCopy(ctx.fs.read(join(dir, rel(ctx, input.copy))))
    if (c.title) patch.title = c.title
    patch.body = c.body
    patch.tags = JSON.stringify(c.tags)
  }
  ctx.db.update('articles', a.id, patch)
  return { title: a.title }
}
