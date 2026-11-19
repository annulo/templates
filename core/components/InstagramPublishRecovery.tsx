import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Channel, SocialPost } from '../lib/shuttle'
import { instagramPublishRecovery } from '../lib/instagramPublishRecovery'
import { tr } from '../lib/i18n'
import { Button, Notice } from './ui'

export default function InstagramPublishRecovery({ post, channel, onAction, disabled }: { post: SocialPost; channel?: Channel; disabled?: boolean; onAction: (input: { post_id: string; check_only: true }) => unknown | Promise<unknown> }) {
  const r = instagramPublishRecovery(post, channel)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!r) return null
  return <Notice>
    <p>{tr('instagram_connect.recovery')}</p>
    <p className="mt-2 whitespace-pre-wrap text-xs">{r.caption}</p>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <Button size="sm" fn="social/social.publish" disabled={busy || disabled} onClick={async () => { setBusy(true); setError(''); try { await onAction({ post_id: post.id, check_only: true }) } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}><RefreshCw />{tr('instagram_connect.check_result')}</Button>
      <a href={r.profileUrl} target="_blank" rel="noopener noreferrer" className="text-primary-text underline">{tr('social.open_profile')}</a>
    </div>
    {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
  </Notice>
}
