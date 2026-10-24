// AI 引用分（本机函数，不经过模型）：写文章、改文章的任务存完长文后跑它，看哪几项没过、哪几段最弱，改一轮再交给用户。
// 规则在 _aeo.ts（页面上文章的「AI 引用分」用的是同一份），设计见仓库根目录 docs/ai-citation-score.md。
//
//   aeo.article({ article_id })
//     → { score, grade, failed: [{ item, rule, value }], weakest: [{ n, heading, text, missing: [{ item, rule }] }], note }
//     不是长文、正文是空的：{ score: null, note }

import { isEn, L } from './_i18n'
import { typeOf } from './_types'
import { aeoCheckText, aeoDimText, aeoOptions, scoreArticle } from './_aeo'

// 只读表，手机上打开后台也能算
export const cloud = ['article']

export function article(input: { article_id: string }, ctx: any) {
  const a = input?.article_id ? ctx.db.get('articles', input.article_id) : null
  if (!a) throw new Error(L(ctx, `没有 id 为 ${input?.article_id} 的文章`, `No article with id ${input?.article_id}`))
  if (typeOf(a) !== 'article') return { score: null, note: L(ctx, '只给长文算 AI 引用分', 'Only long-form articles get an AI citation score') }
  // 公司资料、产品目录：有就用（没有这两张表的模板当空的）
  let profile: any = null
  let products: any[] = []
  try { profile = ctx.db.query('profile', { limit: 1 }).list[0] ?? null } catch {}
  try { products = ctx.db.query('products', { limit: 200 }).list } catch {}
  const r = scoreArticle(a, aeoOptions(profile, products))
  if (!r) return { score: null, note: L(ctx, '正文是空的', 'The body is empty') }
  const en = isEn(ctx)
  return {
    score: r.score,
    grade: r.grade,
    failed: r.checks.filter((c) => !c.ok).map((c) => { const [item, rule] = aeoCheckText(c.key, en); return { item, rule, value: c.value } }),
    weakest: r.weakest.map((b) => ({
      n: b.n,
      heading: b.heading,
      text: b.text.length > 160 ? b.text.slice(0, 160) + '…' : b.text,
      missing: b.miss.map((m) => { const [item, rule] = aeoDimText(m, en); return { item, rule } }),
    })),
    note: L(ctx,
      'n 是正文里第几段（只数段落、列表、表格，不数标题）。分数是规则数出来的：只改没过的项，不为凑分编数据、加无关的链接。',
      'n counts paragraphs, lists and tables in the body (not headings). The score is rule-based: fix only what failed, never invent data or add unrelated links to raise it.'),
  }
}
