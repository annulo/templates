import { context as marketingContext } from './marketing'
import { contentEntries, type ContentWorkspace } from '../lib/contentWorkspace'
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
  const entry = contentEntries(context({}, ctx)).find(e => e.key === input.key)
  if (!entry) throw new Error('Content no longer exists')
  if (entry.workspaces.some(w => w !== input.workspace)) throw new Error('This content already has a destination. Keep its existing publication history and create a linked version for another workspace.')
  for (const [table, row] of [['marketing_plans', entry.plan], ['topics', entry.topic], ['articles', entry.article]] as const)
    if (row && row.workspace !== input.workspace) ctx.db.update(table, row.id, { workspace: input.workspace })
  return { workspace: input.workspace, key: entry.key }
}
