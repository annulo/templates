import SocialAuthorizationFlow from './SocialAuthorizationFlow'
import SocialConnectionButton from './SocialConnectionButton'
import type { AuthorizationChannel } from '../lib/socialAuthorization'

export const instagramApi = (ch?: AuthorizationChannel) => ch?.type === 'instagram' && ch.auth_mode === 'api'
export default function InstagramAccountFlow({ channel, onAdded }: { channel?: AuthorizationChannel; onAdded: () => void; onChanged?: () => void }) {
  return <SocialAuthorizationFlow provider="instagram" channel={channel} onAdded={onAdded} />
}
export function InstagramConnectionButton({ channel, onDone }: { channel: AuthorizationChannel; onDone: () => void }) {
  return <SocialConnectionButton provider="instagram" channel={channel} onDone={onDone} />
}
