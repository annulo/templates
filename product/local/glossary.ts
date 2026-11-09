// 术语表（本机函数）：翻译时固定的说法，翻文章、做多语言落地页都照它。设计见 docs/multilingual.md。
//
//   glossary.list()                               全部词条
//   glossary.save({ terms: [{ term, translations?, keep?, note? }] })
//                                                 加或改几条：同一个词（不分大小写）合并，translations 按语言覆盖、没写的语言保留。
//                                                 助手翻译时遇到新的专有词就调它补进来；页面上改一条也用它
//   glossary.remove({ id })                       删一条

import { L } from './_i18n'
import { normLocale } from './_locales'

const now = () => new Date().toISOString()
const text = (v: unknown) => String(v ?? '').trim()
const parse = (v: unknown): Record<string, string> => {
  try {
    const o = typeof v === 'string' ? JSON.parse(v || '{}') : v
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, string>) : {}
  } catch {
    return {}
  }
}
const all = (ctx: any) => ctx.db.query('glossary', { limit: 1000 }).list as any[]

export function list(_: unknown, ctx: any) {
  return all(ctx)
    .map((g) => ({ id: g.id, term: g.term, translations: parse(g.translations), keep: !!g.keep, note: g.note ?? '', updated_at: g.updated_at || g.created_at || '' }))
    .sort((x, y) => x.term.localeCompare(y.term))
}

type Term = { term: string; translations?: Record<string, string>; keep?: boolean; note?: string }

export function save(input: { terms: Term[] | string } | Term, ctx: any) {
  let terms: Term[] = []
  if ('term' in (input ?? {})) terms = [input as Term]
  else {
    const raw = (input as { terms: Term[] | string })?.terms
    try {
      terms = typeof raw === 'string' ? JSON.parse(raw) : raw ?? []
    } catch {
      terms = []
    }
  }
  if (!Array.isArray(terms) || !terms.length) throw new Error(L(ctx, 'terms 要是一组词条：[{ "term": "sintered stone", "translations": { "zh": "岩板" } }]', 'terms must be a list: [{ "term": "sintered stone", "translations": { "zh": "岩板" } }]'))
  const rows = all(ctx)
  const out: { id: string; term: string; created: boolean }[] = []
  for (const t of terms) {
    const term = text(t?.term)
    if (!term) continue
    const tr: Record<string, string> = {}
    for (const [k, v] of Object.entries(parse(t.translations))) if (normLocale(k) && text(v)) tr[normLocale(k)] = text(v)
    const prev = rows.find((r) => text(r.term).toLowerCase() === term.toLowerCase())
    const patch: Record<string, unknown> = { term, translations: JSON.stringify({ ...parse(prev?.translations), ...tr }), updated_at: now() }
    if (t.keep !== undefined) patch.keep = !!t.keep
    if (t.note !== undefined) patch.note = text(t.note)
    if (prev) {
      ctx.db.update('glossary', prev.id, patch)
      out.push({ id: prev.id, term, created: false })
    } else {
      const row = ctx.db.insert('glossary', { keep: false, note: '', ...patch, created_at: now() })
      rows.push(row)
      out.push({ id: row.id, term, created: true })
    }
  }
  return { saved: out }
}

export function remove(input: { id: string }, ctx: any) {
  const g = ctx.db.get('glossary', input?.id)
  if (!g) return { deleted: false }
  ctx.db.delete('glossary', g.id)
  return { deleted: true }
}
