import { useState } from 'react'
import { disconnectOAuthConnection } from '../lib/managedConnections'
import { numLocale, tr } from '../lib/i18n'
import type { OAuthConnection } from '../lib/shuttle'
import { Button, Notice } from './ui'

/** 项目账号页管理同一份可信连接；页面只有状态和标识，不接触凭据。 */
export default function OAuthAccountControls({ provider, account, onDisconnected }: {
  provider: string
  account?: OAuthConnection['accounts'][number]
  onDisconnected: () => void | Promise<void>
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!account) return null
  const expiry = account.expires_at && Number.isFinite(Date.parse(account.expires_at))
    ? new Date(account.expires_at).toLocaleDateString(numLocale()) : ''
  const disconnect = async () => {
    setBusy(true); setError('')
    try {
      await disconnectOAuthConnection(provider, account.account)
      setConfirm(false)
      await onDisconnected()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
    {account.needs_reconnect ? <Notice>{tr('account_authorization.expired')}</Notice>
      : account.renew_error ? <Notice>{tr(expiry ? 'account_authorization.renew_failed_date' : 'account_authorization.renew_failed', { date: expiry })}</Notice>
      : expiry ? <p>{tr('account_authorization.expires', { date: expiry })}</p> : null}
    {!!account.missing_scopes?.length && <Notice>{tr('account_authorization.missing')}</Notice>}
    {confirm ? <div className="space-y-2">
      <p>{tr('account_authorization.disconnect_hint')}</p>
      <div className="flex gap-2">
        <Button needsShuttle size="sm" variant="destructive" disabled={busy} onClick={disconnect}>{tr('account_authorization.confirm_disconnect')}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>{tr('common.cancel')}</Button>
      </div>
    </div> : <Button needsShuttle size="sm" variant="ghost" onClick={() => setConfirm(true)}>{tr('account_authorization.disconnect')}</Button>}
    {error && <Notice tone="error">{error}</Notice>}
  </div>
}
