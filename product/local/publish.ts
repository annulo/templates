import { L } from './_i18n'
import { articleFixes, fromContent, platformsFor, typeOf } from './_types'
import { check } from '../plugins/social/local/social'
import { fieldsFor } from '../plugins/social/local/_fields'

// 把一篇文章发到社媒账号（本机函数）。
//
//   publish.prepare({ article_id, channel_ids, scheduled_at? })
//       按文章给每个账号备好一条帖子（社媒插件的 social_posts，article_id 指回文章），过一遍平台规格检查：
//       通过的是 approved（给了 scheduled_at 就是 scheduled，到点由插件的定时任务发），没通过的不留记录、把问题带回去。
//       返回 { ready: [{ channel_id, post_id }], problems: [{ channel_id, problems }] }。
//       页面接着对 ready 的逐条调 social/social.publish（排期的不用）。
//       有网站的模板（外贸）：网站（channels 表里的 creght 站点、WordPress）只收长文，要先配好发布脚本（publish_status = ready）；
//       ready 里网站那条带 publisher，页面调 <publisher>.publish({ article_id })，发布记录在 publications（local/_publish.ts）。
//       网站排期：发布记录记上 scheduled_at（没发过的状态是 scheduled，发过的还是 published、到点更新），到点由定时任务 publishing.publishScheduled 发。
//
// 文章本身就是要发的内容，不再有「各账号的版本」：帖子是发布记录，文章改了不影响已经发出去的。
// 同一个账号还有这篇没发出去的记录（失败、排期、老的待审版本）就改它，不另起一条。

/** 只有部分模板有的模块（拼出来的路径：没有这个文件的模板打包时不报错） */
function optional(name: string): any {
  try { return require('./' + name + '.ts') } catch { return null }
}
declare const require: (path: string) => any

/** 这个账号单独改过文字（articles.variants）的话叠在文章上；图片、视频所有账号共用 */
function withVariant(a: any, channelId: string) {
  let v: any
  try { v = JSON.parse(String(a.variants || '{}'))?.[channelId] } catch { v = null }
  if (!v || typeof v !== 'object') return a
  const m: any[] | null = Array.isArray(v.media) ? v.media : null
  const imgs = m ? m.filter((i) => i?.kind === 'image' && i.url).map((i) => String(i.url)) : []
  const vid = m ? m.find((i) => i?.kind === 'video' && i.url) : null
  return { ...a, ...(typeof v.body === 'string' ? { body: v.body } : {}), ...(typeof v.title === 'string' ? { title: v.title } : {}),
    ...(typeof v.tags === 'string' ? { tags: JSON.stringify(v.tags.split(/[\s,，#]+/).filter(Boolean)) } : {}),
    // 这个账号单独设置了图片、视频：有视频就是视频，否则是图文
    ...(m ? { media: JSON.stringify(m), type: vid ? 'video' : 'post', video: vid ? String(vid.url) : '', video_cover: vid?.cover ? String(vid.cover) : '', images: JSON.stringify(imgs) } : {}) }
}

/** 编辑器里图片、视频能放多个、混放；能混放的平台（_fields.ts 的 media，X、Threads）只看总数，别的一条只发一个视频、图和视频不能同发：不满足的报出来，不要悄悄丢掉 */
function mediaProblems(ctx: any, a: any, platform: string): string[] {
  let l: any[] = []
  try { l = JSON.parse(String(a.media || '[]')) } catch {}
  if (!Array.isArray(l)) return []
  const vids = l.filter((i) => i?.kind === 'video').length, imgs = l.filter((i) => i?.kind === 'image').length
  const max = fieldsFor(platform, vids ? 'video' : 'post')?.media
  if (max) return vids + imgs > max ? [L(ctx, `图片和视频共 ${vids + imgs} 个，这个平台一条最多 ${max} 个，删掉多的`, `${vids + imgs} images and videos; this platform takes up to ${max} per post. Remove the extras`)] : []
  return [...(vids > 1 ? [L(ctx, `一条只能发 1 个视频，现在有 ${vids} 个，删掉多的`, `Only one video per post; this has ${vids}. Remove the extras`)] : []),
    ...(vids && imgs ? [L(ctx, '图片和视频不能放在同一条里发，删掉其中一种', "Images and a video can't go in the same post; remove one kind")] : [])]
}

type Ready = { channel_id: string; post_id?: string; publisher?: string }

const SITE_TYPES = ['creght_site', 'wordpress']
/** 网站渠道（channels 表）；没有网站的模板（自媒体）没有这张表，读不到就当不是网站 */
function siteOf(ctx: any, id: string) {
  try { return ctx.db.get('channels', id) } catch { return null }
}
/** 以前网站版本能单独改标题、正文…：发布脚本有就用它的（publishTo 里「空则继承文章」）。现在文章就是要发的内容，发之前清掉 */
const OVERRIDES = { title: '', summary: '', body: '', video: '', keywords: '' }

export function prepare(input: { article_id: string; channel_ids: string[]; scheduled_at?: string; plan_item_id?: string }, ctx: any) {
  let a = ctx.db.get('articles', input?.article_id)
  if (!a) throw new Error(L(ctx, '没有这篇文章：', 'No such article: ') + input?.article_id)
  // 老文章补成插件认的格式再发（帖子按补好的生成）
  const fix = articleFixes(a)
  if (fix) { ctx.db.update('articles', a.id, fix); a = { ...a, ...fix } }
  const ids = [...new Set(input?.channel_ids ?? [])]
  if (!ids.length) throw new Error(L(ctx, '要选至少一个账号', 'Pick at least one account'))
  const at = String(input?.scheduled_at ?? '').trim()
  if (at && !(Date.parse(at) > Date.now() - 60_000)) throw new Error(L(ctx, '排期时间要选将来的时间', 'Pick a time in the future'))
  const t = typeOf(a)
  const ok = platformsFor(t)
  // 增长计划：这批帖子算哪个计划项的（调用方没给就按这周还没做完的社媒计划项）；帖子里的本站链接带上来源参数，询盘才能对上
  const planItem = String(input?.plan_item_id ?? '').trim() || optional('plan')?.socialItem?.({}, ctx)?.id || ''
  const ready: Ready[] = []
  const problems: { channel_id: string; problems: string[] }[] = []
  for (const id of ids) {
    const site = siteOf(ctx, id)
    if (site && SITE_TYPES.includes(site.type)) {
      if (t !== 'article') { problems.push({ channel_id: id, problems: [L(ctx, '网站只发长文，先改写成长文', 'Websites take long-form articles only; rewrite it first')] }); continue }
      if (site.publish_status !== 'ready' || !site.publisher) { problems.push({ channel_id: id, problems: [L(ctx, '这个网站还没配好发布方式', "This website's publishing isn't set up yet")] }); continue }
      const pub = ctx.db.query('publications', { where: { article_id: a.id, channel_id: id }, limit: 1 }).list[0]
      if (pub?.status === 'publishing') { problems.push({ channel_id: id, problems: [L(ctx, '这个网站正在发这篇，等它发完', 'This article is being published to this site; wait for it to finish')] }); continue }
      const now = new Date().toISOString()
      if (at) {
        // 发过的保持 published（到点是更新），没发过的记成 scheduled
        const row = { ...OVERRIDES, status: pub?.status === 'published' ? 'published' : 'scheduled', scheduled_at: at, error: '', updated_at: now }
        if (pub) ctx.db.update('publications', pub.id, row)
        else ctx.db.insert('publications', { ...row, article_id: a.id, channel_id: id })
      } else if (pub && (Object.keys(OVERRIDES).some((k) => pub[k]) || pub.scheduled_at)) ctx.db.update('publications', pub.id, { ...OVERRIDES, scheduled_at: '', updated_at: now })
      ready.push({ channel_id: id, publisher: site.publisher })
      continue
    }
    const ch = ctx.db.get('social_accounts', id)
    if (!ch) { problems.push({ channel_id: id, problems: [L(ctx, '没有这个账号', 'No such account')] }); continue }
    const src = withVariant(a, id)
    const mediaIssues = mediaProblems(ctx, src, ch.type)
    if (mediaIssues.length) { problems.push({ channel_id: id, problems: mediaIssues }); continue }
    if (!platformsFor(typeOf(src)).includes(ch.type)) { problems.push({ channel_id: id, problems: [L(ctx, '这个平台不支持这种类型的文章，先改写成它支持的类型', "This platform doesn't take this type; rewrite it into a type it supports first")] }); continue }
    const now = new Date().toISOString()
    const post: any = fromContent(src, ch.type)
    const tagged = optional('backlinks')?.tagLinks?.({ body: post.body, platform: ch.type, plan_item_id: planItem }, ctx)
    if (tagged?.tagged) post.body = tagged.body
    const row = { ...post, status: at ? 'scheduled' : 'approved', scheduled_at: at, error: null, review_note: null, updated_at: now }
    const prior = ctx.db.query('social_posts', { where: { article_id: a.id, channel_id: id }, limit: 50 }).list
    if (ch.type === 'instagram' && ch.auth_mode === 'api' && prior.some((p: any) => p.status === 'publishing')) { problems.push({ channel_id: id, problems: [L(ctx, '这篇内容正在发布，请等待完成或核对已有记录。', 'This content is publishing; wait or reconcile its existing record.')] }); continue }
    const old = prior.find((p: any) => !['published', 'publishing', 'removed'].includes(p.status))
    let instagramAttempt = false
    if (old?.instagram_api_state) { try { instagramAttempt = ['submitted', 'published'].includes(JSON.parse(old.instagram_api_state).stage) } catch { instagramAttempt = true } }
    if (instagramAttempt) { problems.push({ channel_id: id, problems: [L(ctx, '已有 Instagram 发布记录待核对，请到发布记录中核对结果。', 'An Instagram attempt needs reconciliation; check its publication record.')] }); continue }
    // 计划项只在第一次记（同一条帖子再改、重发不换归属）
    const attach = planItem && !old?.plan_item_id ? { plan_item_id: planItem } : {}
    const postId = old ? (ctx.db.update('social_posts', old.id, { ...row, ...attach }), old.id) : ctx.db.insert('social_posts', { ...row, ...attach, channel_id: id, article_id: a.id, source: 'shuttle', created_at: now }).id
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
