// 从外部文档（Notion）导入文章、之后再同步（本机函数，Annulo 在用户电脑上执行，不经过模型）。
// 正文在 Notion 里写，这里只做各平台的微调和发布。读文档是 docs 插件的事（plugins/docs），这里只管存进 articles：
// 来源记在文章的 source_doc（JSON：provider、url、title、edited_at 文档最后编辑时间、synced_at 同步时间、hash 同步时正文的指纹）。
//
//   docsync.create({ url, type })              读文档，新建一篇草稿（长文存 HTML 正文；图文笔记、视频存纯文字，图文的图做配图）
//   docsync.pull({ article_id, force? })       从文档更新正文和标题；这边改过正文（和上次同步的不一样）且没给 force，不覆盖，返回 { conflict: true }
//   docsync.status({ article_id })             文档在上次同步之后改过没有：{ updated, changed_here, edited_at }
import { meta, read } from '../plugins/docs/local/docs'
import { L } from './_i18n'
import { typeOf, type ArticleType } from './_types'

type SourceDoc = { provider: string; url: string; title?: string; edited_at?: string; synced_at?: string; hash?: string }

const now = () => new Date().toISOString()

/** 正文的指纹：判断同步之后这边有没有改过（不用于安全，只比较） */
function hash(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + ':' + s.length
}

function sourceOf(a: any): SourceDoc | null {
  try {
    const v = JSON.parse(a?.source_doc || 'null')
    return v && v.url ? v : null
  } catch {
    return null
  }
}

/** 文档内容按文章类型落到字段上；指纹按存进去的正文算 */
function fields(doc: any, type: ArticleType) {
  const body = type === 'article' ? doc.html : doc.text
  const out: Record<string, any> = { body }
  if (type === 'post') out.images = JSON.stringify(doc.images ?? [])
  return { out, hash: hash(body) }
}

function article(id: string, ctx: any) {
  const a = id ? ctx.db.get('articles', id) : null
  if (!a) throw new Error(L(ctx, `找不到这篇文章：${id}`, `Article not found: ${id}`))
  return a
}

export async function create(input: { url: string; type?: ArticleType }, ctx: any) {
  const type: ArticleType = input?.type === 'post' || input?.type === 'video' ? input.type : 'article'
  const doc = await read({ url: input?.url }, ctx)
  const { out, hash: h } = fields(doc, type)
  const t = now()
  const src: SourceDoc = { provider: doc.provider, url: doc.url, title: doc.title, edited_at: doc.edited_at, synced_at: t, hash: h }
  const row = ctx.db.insert('articles', { type, title: doc.title || L(ctx, '未命名', 'Untitled'), summary: '', tags: '[]', status: 'draft', created_at: t, updated_at: t, ...out, source_doc: JSON.stringify(src) })
  return { article_id: row.id, warnings: doc.warnings ?? [] }
}

export async function pull(input: { article_id: string; force?: boolean }, ctx: any) {
  const a = article(input?.article_id, ctx)
  const src = sourceOf(a)
  if (!src) throw new Error(L(ctx, '这篇不是从文档导入的', "This article wasn't imported from a document"))
  const type = typeOf(a)
  const changedHere = !!src.hash && hash(String(a.body ?? '')) !== src.hash
  if (changedHere && !input.force) return { conflict: true }
  const doc = await read({ url: src.url }, ctx)
  const { out, hash: h } = fields(doc, type)
  const t = now()
  ctx.db.update('articles', a.id, { ...out, title: doc.title || a.title, updated_at: t, source_doc: JSON.stringify({ ...src, provider: doc.provider, url: doc.url, title: doc.title, edited_at: doc.edited_at, synced_at: t, hash: h }) })
  return { conflict: false, warnings: doc.warnings ?? [] }
}

export async function status(input: { article_id: string }, ctx: any) {
  const a = article(input?.article_id, ctx)
  const src = sourceOf(a)
  if (!src) return { updated: false, changed_here: false }
  const m = await meta({ url: src.url }, ctx)
  return {
    updated: !!m.edited_at && !!src.edited_at && m.edited_at > src.edited_at,
    changed_here: !!src.hash && hash(String(a.body ?? '')) !== src.hash,
    edited_at: m.edited_at,
  }
}
