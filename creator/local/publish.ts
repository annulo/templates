import { L } from './_i18n'
import { platformsFor, postFrom, typeOf } from './_types'
import { check } from '../plugins/social/local/social'

// 把一篇文章发到社媒账号（本机函数）。
//
//   publish.prepare({ article_id, channel_ids, scheduled_at? })
//       按文章给每个账号备好一条帖子（社媒插件的 social_posts，article_id 指回文章），过一遍平台规格检查：
//       通过的是 approved（给了 scheduled_at 就是 scheduled，到点由插件的定时任务发），没通过的不留记录、把问题带回去。
//       返回 { ready: [{ channel_id, post_id }], problems: [{ channel_id, problems }] }。
//       页面接着对 ready 的逐条调 social/social.publish（排期的不用）。
//       有网站的模板（外贸）：网站（channels 表里的 creght 站点、WordPress）只收长文、不能排期，要先配好发布脚本（publish_status = ready）；
//       ready 里网站那条带 publisher，页面调 <publisher>.publish({ article_id })，发布记录在 publications（local/_publish.ts）。
//
// 文章本身就是要发的内容，不再有「各账号的版本」：帖子是发布记录，文章改了不影响已经发出去的。
// 同一个账号还有这篇没发出去的记录（失败、排期、老的待审版本）就改它，不另起一条。

type Ready = { channel_id: string; post_id?: string; publisher?: string }

const SITE_TYPES = ['creght_site', 'wordpress']
/** 网站渠道（channels 表）；没有网站的模板（自媒体）没有这张表，读不到就当不是网站 */
function siteOf(ctx: any, id: string) {
  try { return ctx.db.get('channels', id) } catch { return null }
}
/** 以前网站版本能单独改标题、正文…：发布脚本有就用它的（publishTo 里「空则继承文章」）。现在文章就是要发的内容，发之前清掉 */
const OVERRIDES = { title: '', summary: '', body: '', video: '', keywords: '' }

export function prepare(input: { article_id: string; channel_ids: string[]; scheduled_at?: string }, ctx: any) {
  const a = ctx.db.get('articles', input?.article_id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.article_id)
  const ids = [...new Set(input?.channel_ids ?? [])]
  if (!ids.length) throw new Error(L(ctx, '要选至少一个账号', 'Pick at least one account'))
  const at = String(input?.scheduled_at ?? '').trim()
  if (at && !(Date.parse(at) > Date.now() - 60_000)) throw new Error(L(ctx, '排期时间要选将来的时间', 'Pick a time in the future'))
  const t = typeOf(a)
  const ok = platformsFor(t)
  const ready: Ready[] = []
  const problems: { channel_id: string; problems: string[] }[] = []
  for (const id of ids) {
    const site = siteOf(ctx, id)
    if (site && SITE_TYPES.includes(site.type)) {
      if (t !== 'article') { problems.push({ channel_id: id, problems: [L(ctx, '网站只发长文，先改写成长文', 'Websites take long-form articles only; rewrite it first')] }); continue }
      if (at) { problems.push({ channel_id: id, problems: [L(ctx, '网站不能排期，选「立即发布」', "Websites can't be scheduled; publish now instead")] }); continue }
      if (site.publish_status !== 'ready' || !site.publisher) { problems.push({ channel_id: id, problems: [L(ctx, '这个网站还没配好发布方式', "This website's publishing isn't set up yet")] }); continue }
      const pub = ctx.db.query('publications', { where: { article_id: a.id, channel_id: id }, limit: 1 }).list[0]
      if (pub && Object.keys(OVERRIDES).some((k) => pub[k])) ctx.db.update('publications', pub.id, { ...OVERRIDES, updated_at: new Date().toISOString() })
      ready.push({ channel_id: id, publisher: site.publisher })
      continue
    }
    const ch = ctx.db.get('social_accounts', id)
    if (!ch) { problems.push({ channel_id: id, problems: [L(ctx, '没有这个账号', 'No such account')] }); continue }
    if (!ok.includes(ch.type)) { problems.push({ channel_id: id, problems: [L(ctx, '这个平台不支持这种类型的文章，先改写成它支持的类型', "This platform doesn't take this type; rewrite it into a type it supports first")] }); continue }
    const now = new Date().toISOString()
    const row = { ...postFrom(a, ch.type), status: at ? 'scheduled' : 'approved', scheduled_at: at, error: null, review_note: null, updated_at: now }
    const old = ctx.db.query('social_posts', { where: { article_id: a.id, channel_id: id }, limit: 50 }).list.find((p: any) => !['published', 'publishing', 'removed'].includes(p.status))
    const postId = old ? (ctx.db.update('social_posts', old.id, row), old.id) : ctx.db.insert('social_posts', { ...row, channel_id: id, article_id: a.id, source: 'shuttle', created_at: now }).id
    let found: string[] = []
    try {
      found = check({ post_id: postId }, ctx)?.problems ?? []
    } catch (e: any) {
      found = [e?.message ?? String(e)]
    }
    if (found.length) {
      // 没通过：新建的删掉；改的是老记录就退回草稿，问题写在上面
      if (old) ctx.db.update('social_posts', postId, { status: 'draft', scheduled_at: '', error: found.join('；') })
      else ctx.db.delete('social_posts', postId)
      problems.push({ channel_id: id, problems: found })
      continue
    }
    ready.push({ channel_id: id, post_id: postId })
  }
  return { ready, problems, scheduled: !!at }
}
