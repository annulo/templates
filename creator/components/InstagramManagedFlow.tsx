import SocialAuthorizationFlow from './SocialAuthorizationFlow'
import type { AuthorizationChannel } from '../lib/socialAuthorization'

/** Compatibility export for project pages that imported the managed-only form. */
export default function InstagramManagedFlow({ channel, onAdded }: { channel?: { id: string; instagram_user_id?: string; instagram_connection_id?: string; instagram_media_host?: string }; onAdded: () => void }) {
  const target = channel ? { type: 'instagram', name: '', api_credential: 'instagram_managed', ...channel } as AuthorizationChannel : undefined
  return <SocialAuthorizationFlow provider="instagram" channel={target} onAdded={onAdded} />
}
