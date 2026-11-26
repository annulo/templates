import SocialAuthorizationFlow from './SocialAuthorizationFlow'
import SocialConnectionButton from './SocialConnectionButton'
import type { AuthorizationChannel } from '../lib/socialAuthorization'

export default function ThreadsAccountFlow({ channel, onAdded }: { channel?: AuthorizationChannel; onAdded: () => void }) {
  return <SocialAuthorizationFlow provider="threads" channel={channel} onAdded={onAdded} />
}
export function ThreadsConnectionButton({ channel, onDone }: { channel: AuthorizationChannel; onDone: () => void }) {
  return <SocialConnectionButton provider="threads" channel={channel} onDone={onDone} />
}
