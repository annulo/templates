import type { Channel, SocialPost } from './shuttle'

export function instagramPublishRecovery(post: SocialPost & { instagram_api_state?: string }, channel?: Channel) {
  if (channel?.type !== 'instagram' || !post.instagram_api_state || post.status === 'published') return null
  try {
    const s = JSON.parse(post.instagram_api_state)
    if (s?.version !== 1 || !['submitted', 'published'].includes(s.stage) || typeof s.container_id !== 'string' || !/^\d+$/.test(s.container_id)) return null
    return { caption: String(s.caption || ''), profileUrl: `https://www.instagram.com/${encodeURIComponent(channel.handle || '')}/` }
  } catch { return null }
}
