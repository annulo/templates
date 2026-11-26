import { useState } from 'react'
import type { OAuthProvider } from '../lib/oauthReturn'
import { finishOAuthReturn } from '../lib/oauthReturn'
import type { AuthorizationChannel } from '../lib/socialAuthorization'
import { tr } from '../lib/i18n'
import { Badge, Button } from './ui'
import SocialAuthorizationDialog from './SocialAuthorizationDialog'

export default function SocialConnectionButton({ provider, channel, onDone }: { provider: OAuthProvider; channel: AuthorizationChannel; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const official = provider === 'instagram' ? channel.api_credential === 'instagram_managed' : provider === 'threads' ? channel.api_credential === 'threads_oauth' : channel.auth_mode === 'api' && channel.api_credential === 'oauth'
  const close = () => { finishOAuthReturn(); setOpen(false); onDone() }
  return <>
    <Badge>{tr(official ? 'instagram_managed.label' : 'account_authorization.legacy')}</Badge>
    <Button size="sm" variant={channel.login_status === 'expired' ? 'default' : 'ghost'} onClick={() => setOpen(true)}>{tr('social_authorization.manage')}</Button>
    {open && <SocialAuthorizationDialog provider={provider} channel={channel} onClose={close} onAdded={close} />}
  </>
}
