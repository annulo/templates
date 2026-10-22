import { L } from './_i18n'
import { fromContent, supports } from './_types'
import { FIELDS } from '../plugins/social/local/_fields'
import { check } from '../plugins/social/local/social'

// 内容文件夹（本机函数，Annulo 在用户电脑上执行，不经过模型；设计见 docs/content-model.md）：
// 每条内容一个文件夹，在项目工作目录（ctx.fs.root，本机是 ~/Annulo/<项目名>）的「内容/」下，文章表 folder 字段记它相对工作目录的路径。
// 新版 Annulo（59 起）上它是一个产物文件夹（ctx.folders）：带 id（folder_id），挪了、改了名也找得到；团队服务器上，
// 用户电脑上的 Claude Code 按文件夹拉下来做、做完推回去（annulo folder pull / push）。文件夹里的 .annuloignore 列不同步的中间产物
// （草稿视频、草稿音频、渲染缓存放 草稿/），建文件夹时写一份默认的。老 Annulo 没有 ctx.folders，只用路径，照旧能用。
// 稿子、脚本、文案、视频、参考都是里面的文件，可以分目录；页面列出、编辑它们，助手在对话里直接读写这个目录。
// 页面预览图片、视频用 /_annulo/work-files/<root 下的路径>（components/Folder.tsx），不经过这里。
//
//   folder.create({ article_id })                → { dir, path }  没有就建（带一个空的 稿子.md），有就返回；在对话里跑的会记下这段对话（「继续对话」回到它）
//   folder.list({ article_id })                  → { dir, path, entries: [{ path, dir, size, mtime }], can_open, missing? }  entries 相对这条内容的文件夹；
//                                                  missing：表里记着文件夹、磁盘上没有（被挪走、删了，工作目录换了），页面让用户选，不自动重建
//   folder.openRoot()                            用系统程序打开工作目录（文件夹不见了时去找）
//   folder.read({ article_id, path })            → { text }
//   folder.write({ article_id, path, text })
//   folder.mkdir / remove / rename({ article_id, path, to? })
//   folder.importLocal({ article_id, url, to })  把本机文件（local:<name>，上传的、资料库里的）复制进文件夹
//   folder.open({ article_id, path?, reveal? })  用系统程序打开 / 在访达里显示
//   folder.retitle({ article_id, title })        改这条内容的名字；文件夹是按老名字建的就跟着改
//   folder.publish({ article_id, kind, title, body, tags, images, video, channel_ids, scheduled_at? })
//                                                → { ready, problems }  发布时挑好的内容发到几个账号（每次新建帖子，见下面）

// 只读角色（服务端部署）能看文件夹、读文件，不能改
export const readonly = ['list', 'read']

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

// 默认的 .annuloignore：做视频、配音时的中间产物不同步到服务器、不给同事（只留在做的人电脑上）
const IGNORE = `# 这个文件夹里不同步的文件（写法照 .gitignore）：做的过程中的中间产物，只留在做的人电脑上
# 草稿视频、草稿音频、试渲染的片段放进 草稿/；成片、定稿的文案放在外面
草稿/
drafts/
cache/
*.tmp
`

/** 新版 Annulo：把这条内容的文件夹登记成产物文件夹（有 id），第一次写一份默认的 .annuloignore；老版本什么都不做 */
function asArtifact(ctx: any, a: any, dir: string) {
  if (!ctx.folders || !dir) return
  const f = ctx.folders.create(dir, { name: a.title || '' })
  if (f?.id && f.id !== a.folder_id) {
    ctx.db.update('articles', a.id, { folder_id: f.id })
    a.folder_id = f.id
  }
  if (!ctx.fs.stat(`${dir}/.annuloignore`)) ctx.fs.write(`${dir}/.annuloignore`, IGNORE)
}

/** 这条内容的文件夹（相对工作目录）；create 时没有就起一个名字（内容的标题，重名的加 id 后四位） */
function folderOf(ctx: any, a: any, create: boolean) {
  let dir = String(a.folder ?? '')
  // 产物文件夹按 id 找：被人挪了、改了名（在别的电脑上、页面外面）也跟得上
  if (a.folder_id && ctx.folders) {
    const f = ctx.folders.get(a.folder_id)
    if (f && f.path !== dir) {
      ctx.db.update('articles', a.id, { folder: f.path })
      a.folder = dir = f.path
    }
  }
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
  asArtifact(ctx, a, dir)
  rememberChat(ctx, a.id)
  // folder_id：用户电脑上的助手用它把文件夹拉下来（dir 是服务器上的位置，那台电脑上没有；工作目录在对象存储里时是 s3://…）
  return { dir: `${ctx.fs.root}/${dir}`, path: dir, folder_id: a.folder_id || '', local: ctx.fs.kind !== 's3' }
}

export function list(input: { article_id: string }, ctx: any) {
  need(ctx)
  const dir = folderOf(ctx, article(ctx, input.article_id), false)
  // can_open：本机版能用系统程序打开、在访达里显示；服务端部署不能，页面在新标签页打开预览地址
  const can_open = !!ctx.fs.canOpen
  if (!dir || !ctx.fs.stat(dir)) return { dir: '', path: dir, entries: [], can_open, missing: !!dir, root: ctx.fs.root }
  return { dir: `${ctx.fs.root}/${dir}`, path: dir, entries: ctx.fs.list(dir), can_open }
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

export function openRoot(_input: unknown, ctx: any) {
  need(ctx)
  ctx.fs.open('', { reveal: false })
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
      if (a.folder_id && ctx.folders) ctx.folders.move(a.folder_id, to) // 产物文件夹：id 不变，索引跟着改
      else ctx.fs.move(dir, to)
      patch.folder = to
    }
  }
  ctx.db.update('articles', a.id, patch)
  return { folder: patch.folder ?? dir }
}

const isRef = (u: string) => /^(https?:\/\/|\/_(annulo|shuttle)\/uploaded\/|local:)/.test(u)

/**
 * 发布时挑好的内容发到几个账号：每个账号新建一条帖子（社媒插件的 social_posts，存的就是挑好的内容，排期到点照它发），
 * 过一遍平台检查；通过的是 approved（给了 scheduled_at 就是 scheduled，到点由插件的定时任务发），没通过的不留记录、把问题带回去。
 * 同一条内容在同一个账号可以发好几次。返回 { ready: [{ channel_id, post_id }], problems: [{ channel_id, problems }] }，页面接着把 ready 的放进发布队列。
 *
 *   kind     发成什么：post 图文（纯文字 + 配图）/ video 视频（简介 + 视频）/ article 长文（HTML 正文，图在正文里）
 *   images   配图：文件夹里的路径（相对这条内容的文件夹）或资料库的地址；video 同样。长文正文里 <img> 的相对路径也换成本机文件
 *   video_cover  视频封面（小红书、抖音、B站用），同样是文件夹里的路径或资料库地址；空字符串是用平台默认的那一帧，不传用内容上设的
 *   video_covers 按账号给的封面（账号 id → 封面，写法同 video_cover）：平台要的比例不一样时各用各的，给了的账号不看 video_cover
 */
export function publish(input: { article_id: string; kind: 'post' | 'video' | 'article'; title?: string; body?: string; tags?: string[]; images?: string[]; video?: string; video_cover?: string; video_covers?: Record<string, string>; cover_text?: string; category?: string; channel_ids: string[]; scheduled_at?: string }, ctx: any) {
  const a = article(ctx, input.article_id)
  const dir = dirOf(ctx, a.id)
  const kind = input.kind
  if (!['post', 'video', 'article'].includes(kind)) throw new Error(L(ctx, '要选发成图文、视频还是长文', 'Choose image post, video or article'))
  const ids = [...new Set(input.channel_ids ?? [])]
  if (!ids.length) throw new Error(L(ctx, '要选至少一个账号', 'Pick at least one account'))
  const at = String(input.scheduled_at ?? '').trim()
  if (at && !(Date.parse(at) > Date.now() - 60_000)) throw new Error(L(ctx, '排期时间要选将来的时间', 'Pick a time in the future'))
  // 文件夹里的文件存成本机文件（local:<name>，同一个文件没改过是同一个名字），资料库的地址原样用
  const ref = (u: string) => (isRef(u) ? u : ctx.fs.toLocal(join(dir, rel(ctx, u))))
  let body = String(input.body ?? '')
  if (kind === 'article') body = body.replace(/(<(?:img|video|source)\b[^>]*?\ssrc=")([^"]+)(")/gi, (_m, x, src, y) => x + ref(decodeURI(src)) + y)
  const content = {
    type: kind, title: String(input.title ?? '').trim() || a.title, body, tags: JSON.stringify(input.tags ?? []),
    images: JSON.stringify(kind === 'post' ? (input.images ?? []).map(ref) : []),
    video: kind === 'video' && input.video ? ref(input.video) : '',
    // 视频封面（小红书、抖音用）：发布时挑的，没传用内容上设的
    video_cover: kind !== 'video' ? '' : input.video_cover === undefined ? String(a.video_cover ?? '') : input.video_cover ? ref(String(input.video_cover)) : '',
    cover_text: String(input.cover_text ?? ''), category: String(input.category ?? ''),
  }
  const ready: { channel_id: string; post_id: string }[] = []
  const problems: { channel_id: string; problems: string[] }[] = []
  const now = new Date().toISOString()
  for (const id of ids) {
    const ch = ctx.db.get('social_accounts', id)
    if (!ch) { problems.push({ channel_id: id, problems: [L(ctx, '没有这个账号', 'No such account')] }); continue }
    if (!supports(FIELDS[ch.type], kind)) { problems.push({ channel_id: id, problems: [L(ctx, '这个平台不发这种内容', "This platform doesn't take this kind of post")] }); continue }
    // 每个账号可以有自己的封面（video_covers：账号 id → 封面）：平台要的比例不一样（小红书、抖音 3:4，B站 4:3），发布弹窗按比例分组挑
    const own = kind === 'video' ? input.video_covers?.[id] : undefined
    const mine = own === undefined ? content : { ...content, video_cover: own ? ref(String(own)) : '' }
    const postId = ctx.db.insert('social_posts', { ...fromContent(mine, ch.type), channel_id: id, article_id: a.id, source: 'shuttle', status: at ? 'scheduled' : 'approved', scheduled_at: at, created_at: now, updated_at: now }).id
    let found: string[] = []
    try { found = check({ post_id: postId }, ctx)?.problems ?? [] } catch (e: any) { found = [e?.message ?? String(e)] }
    if (found.length) { ctx.db.delete('social_posts', postId); problems.push({ channel_id: id, problems: found }); continue }
    ready.push({ channel_id: id, post_id: postId })
  }
  return { ready, problems, scheduled: !!at }
}
