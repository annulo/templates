import { finishOAuthReturn } from '../lib/oauthReturn'
import InstagramManagedFlow from './InstagramManagedFlow'
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { type Channel as BaseChannel } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { Badge, Button, Dialog, Notice } from './ui'
import RunButton from './RunButton'

type Channel = Omit<BaseChannel, 'api_credential'> & { api_credential?: string; instagram_connection_id?: string; instagram_user_id?: string; instagram_media_host?: string; instagram_auth_error?: string; api_host?: string }

export const instagramApi = (ch?: Channel) => ch?.type === 'instagram' && ch.auth_mode === 'api'

/** New and renewed connections use official authorization; legacy records and history are retained. */
export default function InstagramAccountFlow({ channel, onAdded }: { channel?: Channel; onAdded: () => void; onChanged?: () => void }) {
  const legacy = !!channel && channel.api_credential !== 'instagram_managed'
  return <div className="space-y-4 text-sm">
    {legacy && <Notice>{tr('instagram_managed.legacy_connection')}</Notice>}
    <InstagramManagedFlow channel={legacy ? undefined : channel} onAdded={onAdded} />
  </div>
}

export function InstagramConnectionButton({ channel, onDone }: { channel: Channel; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState(false)
  return <>
    <Badge>{tr(channel.api_credential === 'instagram_managed' ? 'instagram_managed.label' : 'account_authorization.legacy')}</Badge>
    {instagramApi(channel) && <RunButton inline fn="social/instagram.checkLogin" input={{ channel_id: channel.id }} icon={RefreshCw} variant="ghost" onStart={() => setChecked(false)} onError={setError} onDone={r => { setChecked(!!(r as any)?.ok); onDone() }}>{tr('instagram_connect.check')}</RunButton>}
    <Button size="sm" variant={channel.login_status === 'expired' ? 'default' : 'ghost'} onClick={() => setOpen(true)}>{tr('instagram_connect.manage')}</Button>
    {error && <span className="basis-full text-xs text-destructive">{error}</span>}
    {checked && !error && <span className="basis-full text-xs text-muted-foreground">{tr('instagram_connect.checked')}</span>}
    <Dialog open={open} onClose={() => { finishOAuthReturn(); setOpen(false) }} title={tr('instagram_connect.title')} footer={<Button variant="ghost" onClick={() => { finishOAuthReturn(); setOpen(false) }}>{tr('common.close')}</Button>}>
      {open && <InstagramAccountFlow channel={channel} onAdded={() => { finishOAuthReturn(); setOpen(false); setError(''); onDone() }} onChanged={onDone} />}
    </Dialog>
  </>
}
