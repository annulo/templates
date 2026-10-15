export type ContentWorkspace = 'website' | 'social'
export type ContentStage = 'planned' | 'creating' | 'draft' | 'ready' | 'scheduled' | 'published' | 'verify' | 'blocked' | 'archived'
export const editableContentStages = ['planned', 'creating', 'draft', 'ready', 'scheduled', 'published', 'verify', 'blocked', 'archived'] as const
export type EditableContentStage = typeof editableContentStages[number]
export type ContentData = {
  articles: any[]; topics: any[]; plans: any[]; posts: any[]; publications: any[];
  channels: any[]; roles?: any[]; accounts?: any[];
  /** 每篇社媒帖子（social_posts 的 id）近 7 天涨了多少，content-workspace.context 从 social_post_daily 算 */
  post_gains?: Record<string, Partial<PostMetrics>>; [key: string]: any
}
export const metricKeys = ['views', 'likes', 'comments', 'collects', 'shares'] as const
export type PostMetrics = Record<typeof metricKeys[number], number>
export type ContentEntry = {
  key: string; title: string; article?: any; topic?: any; plan?: any;
  /** 没有出处的社媒帖子（多是在平台上直接发、采集时发现的）：自己一行，关联到内容或存为内容后并进那一行 */
  post?: any;
  /** 没有出处、但平台上的 id 和这条内容确认过的发布链接对得上的帖子：数据算进这条内容 */
  linkedPosts?: any[];
  workspaces: ContentWorkspace[]; stage: ContentStage; updatedAt: string;
  publicationUrls: string[];
  /** User-confirmed links (publication_links); editable, unlike publication records and receipts. */
  linkedUrls: string[];
}
const parse = (value: any) => {
  if (typeof value !== 'string') return value || {}
  try { return JSON.parse(value) } catch { return {} }
}
export const platformWorkspace = (platform?: string): ContentWorkspace | undefined =>
  ['website', 'creght_site', 'wordpress'].includes(platform || '') ? 'website'
    : ['social', 'xiaohongshu', 'douyin', 'x', 'linkedin', 'facebook', 'instagram', 'youtube', 'bilibili', 'zhihu', 'wechat_mp'].includes(platform || '') ? 'social' : undefined

/** Only absolute HTTP(S) URLs may become clickable publication links. */
export function publishedUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4000 || !/^https?:\/\//i.test(value.trim())) return ''
  try {
    const url = new URL(value.trim())
    // The local function runtime's URL shim does not expose username/password.
    if (/^https?:\/\/[^/?#]*@/i.test(url.href)) return ''
    return url.hostname && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

/** Keep confirmed links with every original record, even after a topic gains a plan or draft. */
export function entryPublicationUrls(entry: Pick<ContentEntry, 'article' | 'topic' | 'plan'>, data: ContentData, workspace?: ContentWorkspace): string[] {
  const urls = new Set<string>()
  const add = (value: unknown) => { const url = publishedUrl(value); if (url) urls.add(url) }
  for (const scope of workspace ? [workspace] : ['website', 'social'] as const) {
    for (const row of [entry.plan, entry.article, entry.topic]) {
      const links = parse(row?.publication_links)?.[scope]
      if (Array.isArray(links)) links.forEach(add)
    }
    if (entry.plan && platformWorkspace(entry.plan.platform) === scope) add(parse(entry.plan.receipt)?.url)
    const records = scope === 'website' ? data.publications : data.posts
    for (const record of records)
      if (entry.article && record.article_id === entry.article.id && record.status === 'published') add(scope === 'website' ? record.url : record.post_url)
  }
  return [...urls]
}

/** Links the user confirmed by hand for one workspace, across the plan, draft and topic of an entry. */
export function entryLinkedUrls(entry: Pick<ContentEntry, 'article' | 'topic' | 'plan'>, workspace: ContentWorkspace): string[] {
  const urls = new Set<string>()
  for (const row of [entry.plan, entry.article, entry.topic]) {
    const links = parse(row?.publication_links)?.[workspace]
    if (Array.isArray(links)) links.forEach(v => { const url = publishedUrl(v); if (url) urls.add(url) })
  }
  return [...urls]
}

/** Existing review rows store target_kind/target_id rather than a platform field. */
export function reviewWorkspace(review: any, data: { plans: any[] }): ContentWorkspace | undefined {
  if (review.target_kind === 'publication') return 'website'
  if (review.target_kind === 'post') return 'social'
  const plan = data.plans.find(p => p.id === review.target_id)
  return platformWorkspace(review.platform) || (plan?.workspace === 'website' || plan?.workspace === 'social' ? plan.workspace : platformWorkspace(plan?.platform))
}

export function legacyContentWorkspace(params: Record<string, string>, entries: ContentEntry[]): ContentWorkspace {
  const selected = entries.find(e => (params.article && e.article?.id === params.article) || (params.topic && e.topic?.id === params.topic) || (params.plan && e.plan?.id === params.plan))
  return selected?.workspaces[0] || (params.workspace === 'website' ? 'website' : 'social')
}

export function entryAccountIds(entry: ContentEntry, data: ContentData, workspace: ContentWorkspace, publishedOnly = false): string[] {
  const ids = new Set<string>()
  const add = (id?: string) => { if (id) ids.add(id) }
  if (entry.post) add(entry.post.channel_id)
  if (workspace === 'social') entry.linkedPosts?.forEach(p => add(p.channel_id))
  if (!publishedOnly) {
    [entry.article?.target_account_id, entry.article?.channel_id, entry.topic?.target_account_id, entry.plan?.target_account_id, entry.plan?.target_account?.id].forEach(add)
  }
  if (entry.plan && platformWorkspace(entry.plan.platform) === workspace) add(parse(entry.plan.receipt).account_id)
  const records = workspace === 'website' ? data.publications : data.posts
  for (const record of records) if (entry.article && record.article_id === entry.article.id && (!publishedOnly || record.status === 'published')) add(record.channel_id)
  return [...ids]
}

/** Only persisted destination/relationship evidence determines ownership. Format and title do not. */
export function recordWorkspaces(record: any, data: ContentData, visited = new Set<any>()): ContentWorkspace[] {
  if (!record) return []
  if (visited.has(record)) return []
  visited.add(record)
  const result = new Set<ContentWorkspace>()
  const add = (platform?: string) => { const scope = platformWorkspace(platform); if (scope) result.add(scope) }
  if (record.workspace === 'website' || record.workspace === 'social') result.add(record.workspace)
  else {
    add(record.target_platform || record.platform)
    const target = data.channels.find(c => c.id === record.target_account_id)
    if (target) add(target.type)
    if (!result.size && record.channel_id) add(data.channels.find(c => c.id === record.channel_id)?.type)
    if (['search', 'geo'].includes(record.source)) result.add('website')
    if (!result.size) {
      const channels = parse(record.brief).channels
      const terms = Array.isArray(channels) ? channels : String(channels || '').toLowerCase().split(/[,，、/|\s]+/)
      terms.forEach((p: string) => add(p.toLowerCase()))
    }
  }
  for (const scope of ['website', 'social'] as const) {
    const links = parse(record.publication_links)?.[scope]
    if (Array.isArray(links) && links.some(publishedUrl)) result.add(scope)
  }
  // Actual publications remain visible in both workspaces when one original was reused.
  for (const p of data.publications) if (p.article_id === record.id) result.add('website')
  for (const p of data.posts) if (p.article_id === record.id) result.add('social')
  const related = [
    data.topics.find(t => t.id === record.topic_id),
    data.plans.find(p => p.id === record.marketing_plan_id),
    data.articles.find(a => a.id === record.article_id),
  ]
  for (const linked of related) for (const scope of recordWorkspaces(linked, data, visited)) result.add(scope)
  return [...result]
}

/** Manual progress belongs to the primary record and the current destination. */
export function manualEntryStage(entry: Pick<ContentEntry, 'article' | 'topic' | 'plan'>, workspace?: ContentWorkspace): EditableContentStage | undefined {
  const row = entry.plan || entry.article || entry.topic
  const scope = workspace || (row?.workspace === 'website' || row?.workspace === 'social' ? row.workspace : platformWorkspace(row?.target_platform || row?.platform))
  const stage = scope && parse(row?.workflow_stages)[scope]
  return editableContentStages.includes(stage) ? stage : undefined
}

export function entryStage(entry: Pick<ContentEntry, 'article' | 'topic' | 'plan'>, data: ContentData, workspace?: ContentWorkspace): ContentStage {
  const { article, topic, plan } = entry
  const manual = manualEntryStage(entry, workspace)
  if (manual) return manual
  const pubs = article ? data.publications.filter(p => p.article_id === article.id && workspace !== 'social') : []
  const posts = article ? data.posts.filter(p => p.article_id === article.id && workspace !== 'website') : []
  const receipt = plan?.receipt && parse(plan.receipt)
  if (pubs.some(p => p.status === 'published') || posts.some(p => p.status === 'published') || entryPublicationUrls(entry, data, workspace).length) return 'published'
  if (pubs.some(p => p.scheduled_at) || posts.some(p => p.status === 'scheduled')) return 'scheduled'
  if (plan?.stage === 'blocked' || pubs.some(p => p.status === 'failed') || posts.some(p => p.status === 'failed')) return 'blocked'
  if (plan?.stage === 'reported_published' || (plan?.stage === 'published' && !receipt?.url)) return 'verify'
  if (article?.status === 'published' && ![...data.publications, ...data.posts].some(p => p.article_id === article.id && p.status === 'published')) return 'verify'
  if (article) return 'draft'
  if (topic?.status === 'dropped') return 'archived'
  if (plan?.stage === 'review' || topic?.status === 'done') return 'verify'
  if (plan?.stage === 'ready') return 'ready'
  if (plan?.stage === 'creating' || topic?.status === 'writing') return 'creating'
  return 'planned'
}

/** Join by original IDs, never by title. Additional drafts/copies retain their own rows. */
export function contentEntries(data: ContentData, workspace?: ContentWorkspace): ContentEntry[] {
  const usedArticles = new Set<string>(), usedTopics = new Set<string>()
  const entries: ContentEntry[] = []
  const push = (key: string, plan?: any, topic?: any, article?: any) => {
    if (topic) usedTopics.add(topic.id)
    if (article) usedArticles.add(article.id)
    const scopes = new Set<ContentWorkspace>()
    for (const item of [plan, topic, article]) for (const scope of recordWorkspaces(item, data)) scopes.add(scope)
    const entry = { key, plan, topic, article, workspaces: [...scopes], title: article?.title || topic?.title || plan?.title || '', updatedAt: article?.updated_at || article?.created_at || plan?.updated_at || topic?.created_at || plan?.created_at || '' } as ContentEntry
    entry.stage = entryStage(entry, data, workspace)
    entry.publicationUrls = entryPublicationUrls(entry, data, workspace)
    entry.linkedUrls = workspace ? entryLinkedUrls(entry, workspace) : []
    entries.push(entry)
  }
  for (const plan of data.plans) {
    const topic = data.topics.find(t => t.id === plan.topic_id) || data.topics.find(t => t.marketing_plan_id === plan.id)
    const article = data.articles.find(a => a.id === plan.article_id || a.id === plan.article?.id)
      || data.articles.find(a => !a.source_id && !usedArticles.has(a.id) && (a.marketing_plan_id === plan.id || (topic && (a.id === topic.article_id || a.topic_id === topic.id))))
    push('plan:' + plan.id, plan, topic, article)
  }
  for (const topic of data.topics) if (!usedTopics.has(topic.id)) {
    const article = data.articles.find(a => !usedArticles.has(a.id) && (a.id === topic.article_id || (!a.source_id && a.topic_id === topic.id)))
    push('topic:' + topic.id, undefined, topic, article)
  }
  for (const article of data.articles) if (!usedArticles.has(article.id)) push('article:' + article.id, undefined, data.topics.find(t => t.id === article.topic_id), article)
  // 用户确认过的发布链接（手动关联的、核对过的回执）指向的帖子，按平台上的 id 对：数据算进这条内容，不再单独成行
  const matched = new Set<string>()
  if (workspace !== 'website') for (const entry of entries) {
    const urls = [...entryLinkedUrls(entry, 'social'), ...(entry.plan && platformWorkspace(entry.plan.platform) === 'social' ? [publishedUrl(parse(entry.plan.receipt)?.url)] : [])].filter(Boolean)
    if (!urls.length) continue
    const segments = new Set(urls.flatMap(u => { try { return new URL(u).pathname.split('/').filter(Boolean) } catch { return [] } }))
    const posts = data.posts.filter(p => !p.article_id && p.post_id && segments.has(String(p.post_id)))
    if (posts.length) { entry.linkedPosts = posts; posts.forEach(p => matched.add(p.id)) }
  }
  if (workspace !== 'website') for (const post of data.posts) if (!post.article_id && !matched.has(post.id)) {
    const url = publishedUrl(post.post_url)
    entries.push({ key: 'post:' + post.id, post, workspaces: ['social'], stage: postStage(post.status),
      title: post.title || String(post.body || '').split('\n')[0].slice(0, 80),
      updatedAt: post.published_at || post.updated_at || post.created_at || '',
      publicationUrls: url && post.status === 'published' ? [url] : [], linkedUrls: [] })
  }
  return entries.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
}

const postStage = (status?: string): ContentStage =>
  status === 'published' ? 'published' : status === 'scheduled' || status === 'publishing' ? 'scheduled'
    : status === 'failed' ? 'blocked' : status === 'removed' ? 'archived' : status === 'approved' ? 'ready' : 'draft'

/** 一条内容发出去的社媒帖子；没发出去的不算数据 */
export function entryPosts(entry: ContentEntry, data: ContentData): any[] {
  if (entry.post) return entry.post.status === 'published' ? [entry.post] : []
  const own = entry.article ? data.posts.filter(p => p.article_id === entry.article.id) : []
  return [...own, ...(entry.linkedPosts || [])].filter(p => p.status === 'published')
}

/** 一条内容在各账号的累计数据，加近 7 天涨了多少（gain 为 null：还没有每天的记录，算不出来）；没发出去的是 null */
export function entryMetrics(entry: ContentEntry, data: ContentData): (PostMetrics & { gain: PostMetrics | null; posts: number }) | null {
  const posts = entryPosts(entry, data)
  if (!posts.length) return null
  const sum = (rows: any[]) => Object.fromEntries(metricKeys.map(k => [k, rows.reduce((s, r) => s + (Number(r?.[k]) || 0), 0)])) as PostMetrics
  const gains = posts.map(p => data.post_gains?.[p.id]).filter(Boolean)
  return { ...sum(posts), gain: gains.length ? sum(gains) : null, posts: posts.length }
}
