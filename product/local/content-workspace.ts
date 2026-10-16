import { context as marketingContext } from './marketing'
import { L } from './_i18n'
import { contentEntries, editableContentStages, entryPosts, postsMetrics, metricKeys, publishedUrl, type ContentData, type EditableContentStage, type ContentWorkspace, type PostMetrics } from '../lib/contentWorkspace'
export const cloud = ['context']

export function context(_input: {}, ctx: any) {
  const marketing = marketingContext({}, ctx)
  const read = (table: string) => ctx.db.query(table, { limit: 10000 }).list
  let posts = [], publications = []
  try { posts = read('social_posts') } catch {}
  try { publications = read('publications') } catch {}
  let post_gains = {}
  try { post_gains = postGains(posts, 7, ctx) } catch {}
  return { ...marketing, articles: read('articles'), topics: read('topics'), posts, publications, post_gains,
    channels: [...read('channels'), ...marketing.accounts] }
}

/** 本机时区的日期 YYYY-MM-DD（和社媒插件采集时记的日期一致） */
function localDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 每篇帖子近 days 天涨了多少，口径和社媒插件的 social/stats 一样：最新一天 − 期初前最后一天；期初前没记录、又是这段时间发的从 0 算，否则算不出来、不返回 */
function postGains(posts: any[], days: number, ctx: any): Record<string, PostMetrics> {
  const start = localDay(new Date(Date.now() - (days - 1) * 86400_000))
  const metrics = metricKeys.map(k => ({ op: 'last', field: k, order_by: 'date', as: k }))
  const byPost = (list: any[]) => Object.fromEntries(list.map(r => [r.post_id, r]))
  const last = byPost(ctx.db.aggregate('social_post_daily', { group_by: ['post_id'], metrics, limit: 10000 }).list)
  const base = byPost(ctx.db.aggregate('social_post_daily', { filter: [{ field: 'date', op: 'lt', value: start }], group_by: ['post_id'], metrics, limit: 10000 }).list)
  const gains: Record<string, PostMetrics> = {}
  for (const p of posts) {
    const now = last[p.id], before = base[p.id]
    if (!now || (!before && !(Date.parse(p.published_at || '') >= Date.parse(start + 'T00:00:00')))) continue
    gains[p.id] = Object.fromEntries(metricKeys.map(k => [k, (Number(now[k]) || 0) - (Number(before?.[k]) || 0)])) as PostMetrics
  }
  return gains
}

/** 内容详情的「效果」：这几篇帖子每天的累计数据（social_post_daily，按日期从早到晚） */
export function performance(input: { post_ids: string[] }, ctx: any) {
  const ids = [...new Set((Array.isArray(input?.post_ids) ? input.post_ids : []).filter((id: unknown) => typeof id === 'string' && id))].slice(0, 50)
  const days: Record<string, any[]> = {}
  for (const id of ids) {
    let list: any[] = []
    try { list = ctx.db.query('social_post_daily', { where: { post_id: id }, order_by: 'date asc', limit: 1000 }).list } catch {}
    days[id] = list.map(r => ({ date: r.date, ...Object.fromEntries(metricKeys.map(k => [k, Number(r[k]) || 0])) }))
  }
  return { days }
}

/**
 * 自媒体内容的表现排行，出选题时参考（topics.context 的 performance）：只看近 days 天（默认 180）发的，
 * 每个平台分开排（各平台的浏览量不在一个量级）：top 浏览最多，rising 近 7 天涨得最快，low 发出去一周以上、浏览最少。
 * 一条内容发到同一平台的几个账号，数字是这几个账号加起来的；发到几个平台的，每个平台各算一次。
 */
export function ranking(input: { limit?: number; days?: number }, ctx: any) {
  const limit = Math.min(Math.max(Number(input?.limit) || 3, 1), 20)
  const days = Math.min(Math.max(Number(input?.days) || 180, 7), 3650), since = Date.now() - days * 86400_000
  const data: ContentData = JSON.parse(JSON.stringify(context({}, ctx)))
  const account = (id: string) => data.channels.find(c => c.id === id)
  const rows = contentEntries(data, 'social').flatMap(entry => {
    const all = entryPosts(entry, data), platformOf = (p: any) => account(p.channel_id)?.type || ''
    return [...new Set(all.map(platformOf))].flatMap(platform => {
      const posts = all.filter(p => platformOf(p) === platform), m = postsMetrics(posts, data)
      const published = posts.map(p => p.published_at).filter(Boolean).sort()[0] || ''
      if (!m || !(Date.parse(published) >= since)) return []
      const interactions = m.likes + m.comments + m.collects + m.shares
      return [{
        platform,
        title: entry.title,
        angle: entry.topic?.angle || entry.plan?.notes || '',
        // 平台上直接发的没有选题，给一段正文看它讲了什么
        excerpt: entry.post ? String(entry.post.body || '').slice(0, 200) : '',
        type: entry.article?.type || (entry.post?.video ? 'video' : 'post'),
        accounts: [...new Set(posts.map(p => account(p.channel_id)?.name || p.channel_id))],
        published_at: published,
        views: m.views, likes: m.likes, comments: m.comments, collects: m.collects, shares: m.shares,
        engagement_rate: m.views ? Math.round(interactions / m.views * 1000) / 10 : null,
        views_7d: m.gain ? m.gain.views : null,
      }]
    })
  })
  const weekAgo = Date.now() - 7 * 86400_000
  const platforms: Record<string, any> = {}
  for (const platform of [...new Set(rows.map(r => r.platform))]) {
    const mine = rows.filter(r => r.platform === platform), byViews = [...mine].sort((a, b) => b.views - a.views)
    const top = byViews.slice(0, limit)
    const rising = mine.filter(r => r.views_7d && r.views_7d > 0 && !top.includes(r)).sort((a, b) => b.views_7d! - a.views_7d!).slice(0, limit)
    const low = byViews.filter(r => !top.includes(r) && !rising.includes(r) && Date.parse(r.published_at) < weekAgo).slice(-limit).reverse()
    platforms[platform || 'unknown'] = { published: mine.length, top, rising, low }
  }
  return {
    published: rows.length, days, platforms,
    note: L(ctx, `近 ${days} 天发的内容。数字是各账号帖子最近一次采集的累计值；engagement_rate 是（点赞+评论+收藏+分享）/ 浏览，单位 %；platforms 按平台分开排（各平台的浏览量不在一个量级，不要跨平台比）；views_7d 是近 7 天浏览涨了多少，null 是还没有每天的记录。`,
      `Content published in the last ${days} days. Numbers are the latest collected totals across accounts; engagement_rate is (likes + comments + collects + shares) / views in %; platforms are ranked separately (view counts differ greatly across platforms, so don't compare them); views_7d is view growth over 7 days, null when daily records are missing.`),
  }
}

/** 没有出处的社媒帖子（多是在平台上直接发的）并进内容：给了 article_id 就关联到那条内容，没给就用帖子存一条内容。只写帖子的 article_id，不改帖子本身和它的数据 */
export function adoptPost(input: { post_id: string; article_id?: string }, ctx: any) {
  const post = ctx.db.get('social_posts', input?.post_id)
  if (!post) throw new Error(L(ctx, '没有这条帖子', 'No such post'))
  if (post.article_id) throw new Error(L(ctx, '这条帖子已经属于一条内容', 'This post already belongs to a content item'))
  let id = input.article_id
  if (id) {
    if (!ctx.db.get('articles', id)) throw new Error(L(ctx, '没有这条内容', 'No such content'))
  } else {
    const account = ctx.db.get('social_accounts', post.channel_id)
    const now = new Date().toISOString(), body = String(post.body || '')
    id = ctx.db.insert('articles', {
      title: String(post.title || body.split('\n')[0] || L(ctx, '未命名内容', 'Untitled')).slice(0, 120),
      type: post.video ? 'video' : 'post', body, summary: '', tags: post.tags || '[]', images: post.images || '[]', cover_text: post.cover_text || '',
      ...(post.video ? { video: post.video } : {}),
      status: post.status === 'published' ? 'published' : 'draft', workspace: 'social',
      target_platform: account?.type || '', target_account_id: post.channel_id || '',
      published_at: post.published_at || '', created_at: post.published_at || post.created_at || now, updated_at: now,
    }).id
  }
  ctx.db.update('social_posts', post.id, { article_id: id })
  return { article_id: id, post_id: post.id }
}

/** Ownership is an explicit, reversible metadata edit; no content or publication is moved or copied. */
export function assign(input: { key: string; workspace: ContentWorkspace }, ctx: any) {
  if (!['website', 'social'].includes(input.workspace)) throw new Error('Invalid content workspace')
  // Goja wraps a database row again on each access; normalize it before following cyclic links.
  const entry = contentEntries(JSON.parse(JSON.stringify(context({}, ctx)))).find(e => e.key === input.key)
  if (!entry) throw new Error('Content no longer exists')
  if (entry.post) throw new Error('A platform post is linked with content-workspace.adoptPost')
  if (entry.workspaces.some(w => w !== input.workspace)) throw new Error('This content already has a destination. Keep its existing publication history and create a linked version for another workspace.')
  for (const [table, row] of [['marketing_plans', entry.plan], ['topics', entry.topic], ['articles', entry.article]] as const)
    if (row && row.workspace !== input.workspace) ctx.db.update(table, row.id, { workspace: input.workspace })
  return { workspace: input.workspace, key: entry.key }
}

/** Save progress and the user-confirmed links together, preserving transport receipts and content.
 * `links` replaces this workspace's confirmed links (so they can be edited or removed); `published_url` is the older append-only form. */
export function setStage(input: { key: string; workspace: ContentWorkspace; stage: EditableContentStage | ''; links?: string[]; published_url?: string }, ctx: any) {
  if (!['website', 'social'].includes(input.workspace)) throw new Error('Invalid content workspace')
  if (input.stage !== '' && !editableContentStages.includes(input.stage)) throw new Error('Invalid content stage')
  // Editing one task does not need SEO, assets, reviews or every historical social post.
  const read = (table: string, where?: Record<string, string>) => JSON.parse(JSON.stringify(ctx.db.query(table, { limit: 10000, ...(where ? { where } : {}) }).list))
  const data: ContentData = { plans: read('marketing_plans'), articles: read('articles'), topics: read('topics'),
    channels: [...read('channels'), ...read('social_accounts')], posts: [], publications: [] }
  let entry = contentEntries(data, input.workspace).find(e => e.key === input.key)
  if (entry?.article) {
    try { data.posts = read('social_posts', { article_id: entry.article.id }) } catch {}
    try { data.publications = read('publications', { article_id: entry.article.id }) } catch {}
    entry = contentEntries(data, input.workspace).find(e => e.key === input.key)
  }
  if (!entry) throw new Error('Content no longer exists')
  if (entry.workspaces.length && !entry.workspaces.includes(input.workspace)) throw new Error('Content belongs to another workspace')
  const primary = entry.plan || entry.article || entry.topic
  const table = entry.plan ? 'marketing_plans' : entry.article ? 'articles' : 'topics'
  const row = ctx.db.get(table, primary.id)
  const patch: Record<string, string> = {}
  const parseLinks = (value: any) => {
    let links: any = {}
    try { links = JSON.parse(value || '{}') } catch {}
    return links && typeof links === 'object' && !Array.isArray(links) ? links : {}
  }
  const valid = (value: unknown) => {
    const url = publishedUrl(value)
    if (!url) throw new Error(L(ctx, '请填写有效的 HTTP / HTTPS 发布链接，链接中不能包含登录凭据。', 'Enter a valid HTTP or HTTPS publication URL without credentials.'))
    return url
  }
  const tooMany = () => new Error(L(ctx, '最多关联 20 个发布链接。', 'Link at most 20 publication URLs.'))
  let linked = entry.linkedUrls
  if (Array.isArray(input.links)) {
    linked = [...new Set(input.links.filter(v => typeof v === 'string' && v.trim()).map(v => valid(v.trim())))]
    if (linked.length > 20) throw tooMany()
    if (linked.join('\n') !== entry.linkedUrls.join('\n')) {
      const links = parseLinks(row.publication_links)
      if (linked.length) links[input.workspace] = linked
      else delete links[input.workspace]
      patch.publication_links = Object.keys(links).length ? JSON.stringify(links) : ''
      // Links kept on the topic or draft before a plan existed belong to this entry too: move them to the primary record.
      for (const [other, rec] of [['marketing_plans', entry.plan], ['articles', entry.article], ['topics', entry.topic]] as const) {
        if (!rec || (other === table && rec.id === primary.id)) continue
        const own = parseLinks(rec.publication_links)
        if (!(input.workspace in own)) continue
        delete own[input.workspace]
        ctx.db.update(other, rec.id, { publication_links: Object.keys(own).length ? JSON.stringify(own) : '' })
      }
    }
  } else if (input.published_url !== undefined && input.published_url !== '') {
    const url = valid(input.published_url)
    if (input.workspace !== 'social' || input.stage !== 'published') throw new Error('Only published social content can link a publication URL')
    if (!entry.publicationUrls.includes(url)) {
      const links = parseLinks(row.publication_links)
      const own = Array.isArray(links[input.workspace]) ? links[input.workspace].filter((v: unknown) => typeof v === 'string') : []
      if (own.length >= 20) throw tooMany()
      patch.publication_links = JSON.stringify({ ...links, [input.workspace]: [...own, url] })
      linked = [...linked, url]
    }
  }
  let saved: Record<string, string> = {}
  try { saved = JSON.parse(row.workflow_stages || '{}') } catch {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {}
  if ((saved[input.workspace] || '') !== input.stage) {
    if (input.stage) saved[input.workspace] = input.stage
    else delete saved[input.workspace]
    patch.workflow_stages = Object.keys(saved).length ? JSON.stringify(saved) : ''
  }
  if (Object.keys(patch).length) ctx.db.update(table, row.id, patch)
  return { key: entry.key, workspace: input.workspace, stage: input.stage, links: linked }
}
