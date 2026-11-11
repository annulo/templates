import { L } from './_i18n'

// 只读的几个在手机上（不在 Annulo 里）打开后台时也能用：annulo push 打包成站点 Func，只用 ctx.db
export const cloud = ['list', 'get', 'search', 'addText', 'update', 'remove']

// 要电脑的（读网页用 ctx.html）：手机上点了转给电脑上开着的 Annulo 跑
export const remote = ['addUrl']

// 企业资料（知识库）：产品手册、FAQ、证书、报价口径、案例……写文章、回询盘、做背调时先查这里，引用时说明依据哪份资料。
// 存在 core 的 research_sources 表（一份资料一行，content 是读出来的正文）。
//
// 资料怎么进来：
// - 网址：addUrl 读网页，转成 Markdown 存正文；
// - 文件：页面在浏览器里读出文字（txt / md / csv 直接读，PDF 用 pdf.js，Word 用 mammoth），连同原文件（本机文件 local:<name>）交给 addText；
// - 粘贴的文字：addText。
//
//   knowledge.list({})                              资料列表（不带正文，带字数、摘要）
//   knowledge.get({ id })                           一份资料的全部内容
//   knowledge.addText({ title, content, kind?, file_name?, url? })   存一份资料（文件、粘贴）
//   knowledge.addUrl({ url, title? })               读网页存成一份资料
//   knowledge.update({ id, title?, summary?, tags?, notes?, archived? })   改标题、摘要（任务 tasks/summarize-knowledge.md 写）、标签、备注，归档 / 恢复
//   knowledge.remove({ id })                        删掉
//   knowledge.search({ q, limit? })                 按关键词找相关段落：[{ source_id, title, snippet, score }]，写文章、回询盘前先查
//
//   命令行：annulo run knowledge.search --input '{"q":"MOQ lead time"}'

const TABLE = 'research_sources'
/** 一份资料最多存这么多字（表的一行放不下太大的正文） */
const MAX_CHARS = 150_000
const CHUNK = 700

type Source = {
  id: string
  kind?: string
  title?: string
  url?: string
  file_name?: string
  content?: string
  status?: string
  error?: string
  version?: number
  summary?: string
  tags?: string
  notes?: string
  library_status?: string
  collected_at?: string
  created_at?: string
  updated_at?: string
}

const nowISO = () => new Date().toISOString()
const parseArr = (v?: string): string[] => {
  try {
    const a = JSON.parse(v || '[]')
    return Array.isArray(a) ? a.map(String) : []
  } catch {
    return []
  }
}

/** 正文整理一下：去掉多余空行和行尾空白，截到上限 */
function clean(text: string): { content: string; truncated: boolean } {
  const t = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { content: t.slice(0, MAX_CHARS), truncated: t.length > MAX_CHARS }
}

function brief(s: Source) {
  return {
    id: s.id, kind: s.kind ?? 'text', title: s.title ?? '', url: s.url ?? '', file_name: s.file_name ?? '', status: s.status ?? 'ready', error: s.error ?? '',
    chars: (s.content ?? '').length, summary: s.summary ?? '', tags: parseArr(s.tags), notes: s.notes ?? '', archived: s.library_status === 'archived',
    collected_at: s.collected_at ?? '', created_at: s.created_at ?? '', updated_at: s.updated_at ?? '',
  }
}

function must(ctx: any, id: string): Source {
  const s = id ? ctx.db.get(TABLE, id) : null
  if (!s) throw new Error(L(ctx, '没有这份资料：', 'No such document: ') + id)
  return s
}

export function list(_: unknown, ctx: any) {
  const rows: Source[] = ctx.db.query(TABLE, { limit: 1000 }).list
  return rows.map(brief).sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at))
}

export function get(input: { id: string }, ctx: any) {
  const s = must(ctx, input?.id)
  return { ...brief(s), content: s.content ?? '' }
}

export function addText(input: { title: string; content: string; kind?: string; file_name?: string; url?: string }, ctx: any) {
  const { content, truncated } = clean(input?.content)
  if (!content) throw new Error(L(ctx, '没有读到文字。扫描件、图片做的 PDF 读不出字，可以把文字复制出来粘贴进来。', 'No text found. Scanned or image-only PDFs have no text; copy the text and paste it instead.'))
  const title = String(input.title ?? '').trim() || content.split('\n')[0].slice(0, 80)
  const kind = ['file', 'text', 'article', 'product'].includes(String(input.kind)) ? String(input.kind) : 'text'
  const t = nowISO()
  const row = ctx.db.insert(TABLE, {
    kind, title: title.slice(0, 200), url: String(input.url ?? ''), file_name: String(input.file_name ?? ''), content, status: 'ready', error: '', version: 1,
    library_status: 'ready', tags: '[]', collected_at: t, created_at: t, updated_at: t,
  })
  return { ...brief(row), truncated }
}

export async function addUrl(input: { url: string; title?: string }, ctx: any) {
  const url = String(input?.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error(L(ctx, '网址要以 http:// 或 https:// 开头', 'The address must start with http:// or https://'))
  const r = await fetch(url).catch(() => null)
  if (!r?.ok) throw new Error(L(ctx, `打不开这个网址（${r?.status ?? '网络错误'}）`, `Couldn't open this address (${r?.status ?? 'network error'})`))
  const type = r.headers.get('content-type') ?? ''
  const body = await r.text()
  let title = String(input.title ?? '').trim()
  let text = body
  if (/html/i.test(type) || /^\s*</.test(body)) {
    const doc = ctx.html(body)
    title ||= doc.find('title')[0]?.text?.trim() ?? ''
    // 去掉导航、页头页脚、脚本这些每页都有的部分，只留正文
    const main = ctx.html(body.replace(/<(nav|footer|header|script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ''))
    text = main.markdown() || main.text()
  }
  return addText({ title: title || url, content: text, kind: 'article', url }, ctx)
}

export function update(input: { id: string; title?: string; summary?: string; tags?: string[]; notes?: string; archived?: boolean }, ctx: any) {
  const s = must(ctx, input?.id)
  const patch: Record<string, unknown> = { updated_at: nowISO() }
  if (input.title !== undefined) patch.title = String(input.title).trim().slice(0, 200) || s.title
  if (input.summary !== undefined) patch.summary = String(input.summary).trim().slice(0, 4000)
  if (input.tags !== undefined) patch.tags = JSON.stringify((Array.isArray(input.tags) ? input.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 20))
  if (input.notes !== undefined) patch.notes = String(input.notes).slice(0, 4000)
  if (input.archived !== undefined) patch.library_status = input.archived ? 'archived' : 'ready'
  return brief(ctx.db.update(TABLE, s.id, patch))
}

export function remove(input: { id: string }, ctx: any) {
  const s = must(ctx, input?.id)
  ctx.db.delete(TABLE, s.id)
  return { deleted: s.id, url: s.url ?? '' }
}

/** 正文切成几百字一段：按空行分段，太短的并起来，太长的硬切 */
export function chunks(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim()
    if (!p) continue
    if (cur && cur.length + p.length > CHUNK) {
      out.push(cur)
      cur = ''
    }
    if (p.length > CHUNK * 1.5) {
      for (let i = 0; i < p.length; i += CHUNK) out.push(p.slice(i, i + CHUNK))
      continue
    }
    cur = cur ? cur + '\n\n' + p : p
  }
  if (cur) out.push(cur)
  return out
}

/** 查询拆成词：英文、数字按词，中日韩按相邻两个字 */
export function terms(q: string): string[] {
  const t = String(q ?? '').toLowerCase()
  const words = t.match(/[a-z0-9][a-z0-9.\-]*[a-z0-9]|[a-z0-9]/g) ?? []
  const cjk = (t.match(/[぀-ヿ㐀-鿿가-힯]+/g) ?? []).flatMap((s) => (s.length === 1 ? [s] : Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2))))
  return [...new Set([...words.filter((w) => w.length > 1 || /\d/.test(w)), ...cjk])]
}

function count(hay: string, needle: string) {
  let n = 0
  for (let i = hay.indexOf(needle); i >= 0 && n < 10; i = hay.indexOf(needle, i + needle.length)) n++
  return n
}

export function search(input: { q: string; limit?: number; include_archived?: boolean }, ctx: any) {
  const ts = terms(input?.q)
  if (!ts.length) throw new Error(L(ctx, '要查什么？给几个关键词', 'What to look for? Give a few keywords'))
  const limit = Math.min(Math.max(Math.floor(input?.limit ?? 8), 1), 30)
  const rows: Source[] = ctx.db.query(TABLE, { limit: 1000 }).list.filter((s: Source) => (input?.include_archived || s.library_status !== 'archived') && s.content)
  const hits: { source_id: string; title: string; kind: string; url: string; snippet: string; score: number }[] = []
  for (const s of rows) {
    const title = (s.title ?? '').toLowerCase()
    const bonus = ts.filter((t) => title.includes(t)).length
    for (const c of chunks(s.content ?? '')) {
      const low = c.toLowerCase()
      // 命中的词越多越靠前（每个词算一次，再按出现次数加一点），标题里有的再加分
      const matched = ts.filter((t) => low.includes(t))
      if (!matched.length) continue
      const score = matched.length * 10 + matched.reduce((n, t) => n + count(low, t), 0) + bonus * 3
      hits.push({ source_id: s.id, title: s.title ?? '', kind: s.kind ?? '', url: s.url?.startsWith('local:') ? '' : (s.url ?? ''), snippet: c, score })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  // 同一份资料最多取 3 段，留位置给别的资料
  const per = new Map<string, number>()
  const out = hits.filter((h) => {
    const n = per.get(h.source_id) ?? 0
    per.set(h.source_id, n + 1)
    return n < 3
  })
  return { terms: ts, total: rows.length, hits: out.slice(0, limit) }
}
