import type { Channel, SocialPost } from './shuttle'

export type FacebookComment = { id?: string; message: string; created_time: string }
export type FacebookCommentPage = { comments: FacebookComment[]; next_cursor: string }

export function canViewFacebookComments(post: SocialPost, channel?: Channel): boolean {
  return channel?.type === 'facebook' && channel.auth_mode === 'api' && channel.fb_kind === 'page' && post.channel_id === channel.id && post.status === 'published' && !!post.post_id
}

/** Meta pages may overlap while new comments arrive. Update known IDs without
 * duplicating them; comments without an ID must not be collapsed by their text. */
export function mergeFacebookComments(previous: FacebookComment[], next: FacebookComment[]): FacebookComment[] {
  const out: FacebookComment[] = []
  const positions = new Map<string, number>()
  for (const comment of [...previous, ...next]) {
    const at = comment.id ? positions.get(comment.id) : undefined
    if (at !== undefined) out[at] = comment
    else {
      if (comment.id) positions.set(comment.id, out.length)
      out.push(comment)
    }
  }
  return out
}
