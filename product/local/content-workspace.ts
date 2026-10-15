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
