import { useEffect, useState } from 'react'
import { ArrowUpRight, RefreshCw, Send } from 'lucide-react'
import { facebookPublishRecovery, type FacebookRecoveryInput } from '../lib/facebookPublishRecovery'
import { tr } from '../lib/i18n'
import type { Channel, SocialPost } from '../lib/shuttle'
import { Button, Dialog, Notice, fmtTime } from './ui'

export default function FacebookPublishRecovery({ post, channel, onAction, disabled = false }: {
  post: SocialPost; channel?: Channel; disabled?: boolean
  onAction: (input: FacebookRecoveryInput) => void | Promise<unknown>
}) {
  const recovery = facebookPublishRecovery(post, channel)
  const [confirming, setConfirming] = useState(false)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setChecked(false); setConfirming(false); setError('') }, [post.id, post.facebook_api_state])
  if (!recovery) return null
  const act = async (input: FacebookRecoveryInput) => {
    if (busy || disabled) return false
    setBusy(true); setError('')
    try { await onAction(input); setConfirming(false) }
    catch (e) { setError((e as Error).message); return false }
    finally { setBusy(false); setChecked(false) }
  }
  const pageLink = <a href={recovery.pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary-text hover:underline">{tr('facebook_retry.open_page')}<ArrowUpRight className="size-4" /></a>
  return <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3">
    <p className="text-sm font-medium">{tr('facebook_retry.uncertain')}</p>
    <p className="text-xs leading-relaxed text-muted-foreground">{tr('facebook_retry.hint')}</p>
    <p className="text-xs text-muted-foreground">{tr('facebook_retry.attempt', { when: fmtTime(recovery.attemptedAt), n: recovery.imageCount })}</p>
    <div className="flex flex-wrap items-center gap-3">
      {pageLink}
      <Button size="sm" variant="outline" fn="social/social.publish" disabled={busy || disabled} onClick={() => act({ post_id: post.id, check_only: true })}><RefreshCw />{tr('facebook_retry.check')}</Button>
      <Button size="sm" variant="outline" fn="social/social.publish" feedback={false} disabled={busy || disabled} onClick={() => { setChecked(false); setError(''); setConfirming(true) }}>{tr('facebook_retry.retry')}</Button>
    </div>
    {error && !confirming && <Notice tone="error">{error}</Notice>}
    <Dialog open={confirming} onClose={() => { if (!busy) setConfirming(false) }} title={tr('facebook_retry.confirm_title')} footer={<>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>{tr('common.cancel')}</Button>
      <Button size="sm" fn="social/social.publish" disabled={!checked || busy || disabled} onClick={() => act({ post_id: post.id, confirm_unpublished: true })}><Send />{tr('facebook_retry.confirm_retry')}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">{tr('facebook_retry.confirm_hint', { name: channel?.name || 'Facebook' })}</p>
        {pageLink}
        <p className="text-xs text-muted-foreground">{tr('facebook_retry.previous_content')}</p>
        <div className="max-h-48 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{recovery.text || tr('facebook_retry.no_text')}</div>
        <p className="text-xs text-muted-foreground">{tr('facebook_retry.attempt', { when: fmtTime(recovery.attemptedAt), n: recovery.imageCount })}</p>
        <label className="flex cursor-pointer items-start gap-2 text-sm leading-relaxed"><input type="checkbox" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" />{tr('facebook_retry.checked')}</label>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  </div>
}
