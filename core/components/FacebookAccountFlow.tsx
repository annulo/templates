import SocialAuthorizationFlow from './SocialAuthorizationFlow'
import SocialConnectionButton from './SocialConnectionButton'
import type { AuthorizationChannel } from '../lib/socialAuthorization'
import type { Channel } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { apiMetricState } from '../lib/apiMetrics'
import { Notice } from './ui'

export default function FacebookAccountFlow({ channel, onAdded }: { channel?: AuthorizationChannel; onAdded: () => void }) {
  return <SocialAuthorizationFlow provider="facebook" channel={channel} onAdded={onAdded} />
}
export function FacebookConnectionButton({ channel, onDone }: { channel: AuthorizationChannel; onDone: () => void }) {
  return <SocialConnectionButton provider="facebook" channel={channel} onDone={onDone} />
}

export function ApiMetricsNotice({ channel }: { channel: Channel }) {
  const state = apiMetricState(channel)
  if (channel.type !== 'facebook' || channel.auth_mode !== 'api' || !state) return null
  return <Notice>
    <p>{state.warnings.length ? tr('facebook_connect.metrics_limited', { metrics: state.warnings.map((w) => w.name).join('、') }) : tr('facebook_connect.metrics_available')}</p>
    <p className="mt-1 text-xs">{tr('facebook_connect.metrics_unsupported')}</p>
  </Notice>
}
