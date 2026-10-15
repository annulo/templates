// 做视频（本机函数，Annulo 在用户电脑上执行，不经过模型）。视频本身由助手按任务 tasks/make-video.md 做，
// 用什么工具、工程放哪由助手定；这里只管表：开一个版本、记下当时的文档和做它的对话（ctx.chat_id），做好了记下成片、换成当前版、放进资料库。
// 要改就回到做它的那段对话接着说（页面上「继续对话」），每改一次是一个新版本；那段对话找不到时按 tasks/revise-video.md 在新对话里改。
//
//   video.start({ doc_id, note })                       照一篇文档做一条新视频：建一篇视频文章（source_id 指回文档）和它的第 1 版
//   video.start({ article_id, version_id?, note })      给视频文章做一个新版本：在 version_id 那一版上改（不给就在当前版上改；还没有版本就照文档重新做）
//        → { video_article_id, version_id, n, doc, doc_changed, base, history, note, platforms, project, … } 做视频要的上下文
//   video.finish({ version_id, file, duration?, width?, height?, notes?, title?, body?, tags?, category? })
//        file 是 annulo upload --local 给的 local:<name>；这一版标成做好了、换成文章的当前视频、放进资料库
//   video.finish({ version_id, error })                 没做成：记下原因

import { L } from './_i18n'
import { profile, projectBrief } from './_ai'
import { htmlText, parseList, platformsFor, typeOf } from './_types'
import { FIELDS } from '../plugins/social/local/_fields'

const now = () => new Date().toISOString()
const LOCAL_FILE = /^local:[0-9a-f]{32}(\.[a-z0-9]{1,6})?$/

function article(ctx: any, id: string) {
  const a = id ? ctx.db.get('articles', id) : null
  if (!a) throw new Error(L(ctx, `没有这篇文章：${id}`, `No such article: ${id}`))
  return a
}

/** 文档的内容（纯文字）：长文去掉 HTML，笔记、视频就是正文 */
function docOf(a: any) {
  const body = String(a.body ?? '')
  const text = typeOf(a) === 'article' ? htmlText(body) : body
  return { id: a.id, title: a.title ?? '', type: typeOf(a), summary: a.summary ?? '', text: text.slice(0, 60000) }
}
const snapshotOf = (d: ReturnType<typeof docOf>) => `${d.title}\n\n${d.summary ? d.summary + '\n\n' : ''}${d.text}`.trim()

function versionsOf(ctx: any, articleId: string): any[] {
  return ctx.db.query('video_versions', { where: { article_id: articleId }, limit: 500 }).list
    .sort((a: any, b: any) => (Number(a.n) || 0) - (Number(b.n) || 0))
}

/** 用户有账号的、能发视频的平台（没有账号就是所有能发视频的）：标题、简介、话题的上限，竖屏还是横屏由任务按平台定 */
function platformsOf(ctx: any) {
  let mine: string[] = []
  try { mine = [...new Set<string>(ctx.db.query('social_accounts', { limit: 200 }).list.map((c: any) => c.type))] } catch {}
  const all = platformsFor('video')
  const list = mine.filter((p) => all.includes(p)).length ? all.filter((p) => mine.includes(p)) : all
  // 只发视频的平台（抖音、YouTube、B 站）排前面：任务按排在前面的定横竖屏
  return list.sort((x, y) => Number(FIELDS[y].video === 'only') - Number(FIELDS[x].video === 'only')).map((p) => {
    const f = FIELDS[p]
    return { platform: p, video: f.video, title_max: f.title === 'publish' ? f.titleMax : 0, body_max: f.bodyMax, tags_max: f.tags, ...(f.category ? { category: true } : {}) }
  })
}

export function start(input: { doc_id?: string; article_id?: string; version_id?: string; note?: string }, ctx: any) {
  const note = String(input?.note ?? '').trim()
  let video: any
  let doc: any = null
  let base: any = null
  if (input?.doc_id) {
    // 照文档做一条新视频：先建视频文章，做好之前页面上就能看到「制作中」
    doc = article(ctx, input.doc_id)
    const t = now()
    video = ctx.db.insert('articles', { type: 'video', title: doc.title || L(ctx, '新视频', 'New video'), body: '', source_id: doc.id, ...(doc.topic_id ? { topic_id: doc.topic_id } : {}), status: 'draft', unread: true, created_at: t, updated_at: t })
  } else {
    video = article(ctx, input?.article_id ?? '')
    if (typeOf(video) !== 'video') throw new Error(L(ctx, '这篇不是视频：要照它做视频，传 doc_id', 'This article is not a video: pass doc_id to make a video from it'))
    doc = video.source_id ? ctx.db.get('articles', video.source_id) : null
    const list = versionsOf(ctx, video.id)
    if (input?.version_id) {
      base = list.find((v) => v.id === input.version_id)
      if (!base) throw new Error(L(ctx, `这篇视频没有这个版本：${input.version_id}`, `This video has no such version: ${input.version_id}`))
    } else {
      const done = list.filter((v) => v.status === 'done' && v.file)
      base = done.find((v) => v.file === video.video) ?? done[done.length - 1] ?? null
    }
  }
  // 同一段对话里重复开同一个版本（调用重试、脚本跑了两遍）：复用那个还在做的，不多出一版
  const chatId = String(ctx.chat_id ?? '')
  const dup = !input?.doc_id && chatId ? versionsOf(ctx, video.id).find((v) => v.status === 'making' && v.chat_id === chatId && (v.parent_id ?? '') === (base?.id ?? '') && (v.prompt ?? '') === note) : null
  const d = doc ? docOf(doc) : null
  // 没有文档（自己新建的视频文章）：照文章的标题和简介做
  const snapshot = d ? snapshotOf(d) : `${video.title ?? ''}\n\n${video.body ?? ''}`.trim()
  const all = versionsOf(ctx, video.id)
  const n = dup ? Number(dup.n) : all.reduce((m, v) => Math.max(m, Number(v.n) || 0), 0) + 1
  const v = dup ?? ctx.db.insert('video_versions', { article_id: video.id, n, parent_id: base?.id ?? '', prompt: note, doc_id: doc?.id ?? '', doc_snapshot: snapshot, chat_id: chatId, status: 'making', created_at: now() })
  // 从第 1 版到 base 这一串改过来的要求，助手看得出这条视频是怎么一步步改成现在这样的
  const chain: any[] = []
  for (let p = base; p; p = all.find((x) => x.id === p.parent_id)) chain.unshift({ n: p.n, prompt: p.prompt ?? '', notes: p.notes ?? '' })
  return {
    video_article_id: video.id,
    version_id: v.id,
    n,
    link: `/?view=content&article=${video.id}`,
    note,
    doc: d,
    doc_changed: !!base && String(base.doc_snapshot ?? '') !== snapshot,
    base: base ? { id: base.id, n: base.n, prompt: base.prompt ?? '', notes: base.notes ?? '', file: base.file, duration: base.duration, width: base.width, height: base.height, doc_snapshot: base.doc_snapshot ?? '' } : null,
    history: chain,
    video: { title: video.title ?? '', body: video.body ?? '', tags: parseList(video.tags), category: video.category ?? '' },
    platforms: platformsOf(ctx),
    project: projectBrief(profile(ctx)),
  }
}

type FinishInput = { version_id: string; file?: string; error?: string; duration?: number; width?: number; height?: number; notes?: string; title?: string; body?: string; tags?: string[]; category?: string }

export function finish(input: FinishInput, ctx: any) {
  const v = input?.version_id ? ctx.db.get('video_versions', input.version_id) : null
  if (!v) throw new Error(L(ctx, `没有这个版本：${input?.version_id}`, `No such version: ${input?.version_id}`))
  const a = article(ctx, v.article_id)
  if (input.error) {
    ctx.db.update('video_versions', v.id, { status: 'failed', error: String(input.error).slice(0, 2000), finished_at: now() })
    return { article_id: a.id, version_id: v.id, n: v.n, status: 'failed' }
  }
  const file = String(input.file ?? '').trim()
  if (!LOCAL_FILE.test(file)) throw new Error(L(ctx, 'file 要是 annulo upload --local <视频文件> 打印的 local:<name>（先把做好的视频存进来）', 'file must be the local:<name> printed by annulo upload --local <video file> (save the finished video first)'))
  const num = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : undefined)
  ctx.db.update('video_versions', v.id, { status: 'done', error: '', file, duration: num(input.duration), width: num(input.width), height: num(input.height), notes: String(input.notes ?? '').trim(), finished_at: now() })

  const patch: Record<string, any> = { video: file, unread: true, updated_at: now() }
  if (input.title?.trim()) patch.title = input.title.trim()
  if (input.body !== undefined) {
    const body = String(input.body).trim()
    if (/<(p|h\d|ul|ol|li|div|br|img)[\s/>]/i.test(body)) throw new Error(L(ctx, '视频简介（body）是纯文字，不要 HTML', 'The video description (body) is plain text, not HTML'))
    patch.body = body
  }
  if (input.tags !== undefined) patch.tags = JSON.stringify([...new Set(parseList(input.tags).map((x) => x.replace(/^#/, '').trim()).filter(Boolean))])
  if (input.category !== undefined) patch.category = String(input.category).trim()
  ctx.db.update('articles', a.id, patch)
  // 成片放进资料库：别的文章、帖子也能用；表里引用着，Annulo 不会因为放久了清掉它
  ctx.db.insert('assets', { kind: 'video', url: file, name: `${patch.title ?? a.title} · ${L(ctx, `第 ${v.n} 版`, `v${v.n}`)}`, source: 'agent', created_at: now() })
  return { article_id: a.id, version_id: v.id, n: v.n, status: 'done', link: `/?view=content&article=${a.id}` }
}
