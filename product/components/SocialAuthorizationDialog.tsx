import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { OAuthProvider } from '../lib/oauthReturn'
import { finishOAuthReturn } from '../lib/oauthReturn'
import type { AuthorizationChannel } from '../lib/socialAuthorization'
import { tr } from '../lib/i18n'
import SocialAuthorizationFlow from './SocialAuthorizationFlow'
import { Button } from './ui'

export default function SocialAuthorizationDialog({ provider, channel, onAdded, onClose, onBack = onClose }: {
  provider: OAuthProvider; channel?: AuthorizationChannel; onAdded: () => void; onClose: () => void;
  onBack?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const close = () => { finishOAuthReturn(); onClose() }
  return <dialog ref={ref} onClose={close} onClick={e => { if (e.target === ref.current) ref.current?.close() }} className="m-auto w-[min(92vw,560px)] rounded-2xl border border-border bg-popover p-0 text-left text-popover-foreground shadow-xl backdrop:bg-black/50 min-[800px]:translate-x-[110px]">
    <div className="flex max-h-[85dvh] flex-col">
      <header className="flex shrink-0 items-start gap-4 px-6 pb-2 pt-5">
        <div className="flex-1"><h2 className="text-lg font-semibold">{tr(channel ? 'social_authorization.manage_title' : 'social_authorization.title')}</h2><p className="mt-1 text-xs text-muted-foreground">{tr('social_authorization.project_only')}</p></div>
        <Button variant="ghost" size="icon-sm" aria-label={tr('common.close')} onClick={() => ref.current?.close()} className="-mr-2 -mt-1"><X /></Button>
      </header>
      <SocialAuthorizationFlow key={provider} provider={provider} channel={channel} onAdded={onAdded} onBack={() => { finishOAuthReturn(); onBack() }} />
    </div>
  </dialog>
}
