import { context as marketingContext } from './marketing'
import { L } from './_i18n'
import { contentEntries, editableContentStages, publishedUrl, type ContentData, type EditableContentStage, type ContentWorkspace } from '../lib/contentWorkspace'
export const cloud = ['context']

export function context(_input: {}, ctx: any) {
  const marketing = marketingContext({}, ctx)
  const read = (table: string) => ctx.db.query(table, { limit: 10000 }).list
  let posts = [], publications = []
  try { posts = read('social_posts') } catch {}
  try { publications = read('publications') } catch {}
  return { ...marketing, articles: read('articles'), topics: read('topics'), posts, publications,
    channels: [...read('channels'), ...marketing.accounts] }
}

/** Ownership is an explicit, reversible metadata edit; no content or publication is moved or copied. */
export function assign(input: { key: string; workspace: ContentWorkspace }, ctx: any) {
  if (!['website', 'social'].includes(input.workspace)) throw new Error('Invalid content workspace')
  // Goja wraps a database row again on each access; normalize it before following cyclic links.
  const entry = contentEntries(JSON.parse(JSON.stringify(context({}, ctx)))).find(e => e.key === input.key)
  if (!entry) throw new Error('Content no longer exists')
  if (entry.workspaces.some(w => w !== input.workspace)) throw new Error('This content already has a destination. Keep its existing publication history and create a linked version for another workspace.')
  for (const [table, row] of [['marketing_plans', entry.plan], ['topics', entry.topic], ['articles', entry.article]] as const)
    if (row && row.workspace !== input.workspace) ctx.db.update(table, row.id, { workspace: input.workspace })
  return { workspace: input.workspace, key: entry.key }
}

/** Save progress and explicitly supplied links together, preserving transport receipts and content. */
export function setStage(input: { key: string; workspace: ContentWorkspace; stage: EditableContentStage | ''; published_url?: string }, ctx: any) {
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
  const table = entry.plan ? 'marketing_plans' : entry.article ? 'articles' : 'topics'
  const row = ctx.db.get(table, (entry.plan || entry.article || entry.topic).id)
  const patch: Record<string, string> = {}
  if (input.published_url !== undefined && input.published_url !== '') {
    const url = publishedUrl(input.published_url)
    if (!url) throw new Error(L(ctx, '请填写有效的 HTTP / HTTPS 发布链接，链接中不能包含登录凭据。', 'Enter a valid HTTP or HTTPS publication URL without credentials.'))
    if (input.workspace !== 'social' || input.stage !== 'published') throw new Error('Only published social content can link a publication URL')
    if (!entry.publicationUrls.includes(url)) {
      let links: any = {}
      try { links = JSON.parse(row.publication_links || '{}') } catch {}
      if (!links || typeof links !== 'object' || Array.isArray(links)) links = {}
      const social = Array.isArray(links.social) ? links.social.filter((v: unknown) => typeof v === 'string') : []
      if (social.length >= 20) throw new Error(L(ctx, '最多关联 20 个发布链接。', 'Link at most 20 publication URLs.'))
      patch.publication_links = JSON.stringify({ ...links, social: [...social, url] })
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
  return { key: entry.key, workspace: input.workspace, stage: input.stage }
}
