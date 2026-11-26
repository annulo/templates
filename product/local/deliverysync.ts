export const remote = ['sync']
// Retry saved report uploads, without calling Google or repeating AI questions.
import { flushReports } from './_delivery_reports'
export async function sync(input: { channel_id?: string }, ctx: any) {
  const channels = ctx.db.query('channels', { where: { type: 'creght_site' }, limit: 500 }).list
  const results = []
  for (const ch of channels) if (!input?.channel_id || ch.id === input.channel_id)
    results.push({ channel_id: ch.id, ...await flushReports(ctx, ch) })
  return { results }
}
export function status(input: { channel_id: string }, ctx: any) {
  return ctx.db.query('delivery_sync', { where: { channel_id: input?.channel_id }, limit: 30 }).list
    .map(({ payload, ...row }: any) => row)
}
