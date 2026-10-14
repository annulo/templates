export type ContentWorkspace = 'website' | 'social'
export type ContentStage = 'planned' | 'creating' | 'draft' | 'ready' | 'scheduled' | 'published' | 'verify' | 'blocked' | 'archived'
export const editableContentStages = ['planned', 'creating', 'draft', 'ready', 'scheduled', 'published', 'verify', 'blocked', 'archived'] as const
export type EditableContentStage = typeof editableContentStages[number]
export type ContentData = {
  articles: any[]; topics: any[]; plans: any[]; posts: any[]; publications: any[];
  channels: any[]; roles?: any[]; accounts?: any[]; [key: string]: any
}
export type ContentEntry = {
  key: string; title: string; article?: any; topic?: any; plan?: any;
  workspaces: ContentWorkspace[]; stage: ContentStage; updatedAt: string;
}
const parse = (value: any) => {
  if (typeof value !== 'string') return value || {}
  try { return JSON.parse(value) } catch { return {} }
}
export const platformWorkspace = (platform?: string): ContentWorkspace | undefined =>
  ['website', 'creght_site', 'wordpress'].includes(platform || '') ? 'website'
    : ['social', 'xiaohongshu', 'douyin', 'x', 'linkedin', 'facebook', 'instagram', 'youtube', 'bilibili', 'zhihu', 'wechat_mp'].includes(platform || '') ? 'social' : undefined

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
  if (pubs.some(p => p.status === 'published') || posts.some(p => p.status === 'published') || (receipt?.url && (!workspace || platformWorkspace(plan.platform) === workspace))) return 'published'
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
  return entries.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
}
