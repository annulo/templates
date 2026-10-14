import type { Channel, SocialPost } from './shuttle'

export type FacebookRecoveryInput = { post_id: string; check_only?: true; confirm_unpublished?: true }

/** Read the attempted version, which can differ from the edited draft. */
export function facebookPublishRecovery(post: SocialPost, channel?: Channel) {
  if (channel?.type !== 'facebook' || channel.auth_mode !== 'api' || !['failed', 'approved', 'scheduled'].includes(post.status)) return null
  try {
    const state = JSON.parse(post.facebook_api_state || 'null')
    if (!state || !Number.isFinite(Date.parse(state.attempted_at))) return null
    const content = JSON.parse(state.content)
    if (!Array.isArray(content) || content.length !== 3 || typeof content[0] !== 'string' || !/^\d+$/.test(content[0]) || typeof content[1] !== 'string' || !Array.isArray(content[2]) || !content[2].every((url: unknown) => typeof url === 'string')) return null
    return { attemptedAt: String(state.attempted_at), text: content[1], imageCount: content[2].length, pageUrl: `https://www.facebook.com/${content[0]}` }
  } catch { return null }
}
