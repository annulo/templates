import { useEffect, useState } from 'react'
import { Check, KeyRound, Loader } from 'lucide-react'
import { Button, Field, Notice, inputCls } from './ui'
import { secretsSet, setSecret, wpVerify, type Channel } from '../lib/shuttle'
import { tr } from '../lib/i18n'

/** WordPress 渠道的应用密码：看存了没有、验证、换一个新的（写进本机密钥，只写不读） */
export default function WpCredential({ channel, disabled }: { channel: Channel; disabled?: boolean }) {
  const name = channel.wp_secret ?? ''
  const [has, setHas] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setHas(null)
    setMsg(null)
    setOpen(false)
    if (name) secretsSet([name]).then((s) => setHas(!!s[name])).catch(() => setHas(null))
  }, [channel.id])

  const run = async (save: boolean) => {
    setBusy(true)
    setMsg(null)
    try {
      if (save) {
        await setSecret(name, password.trim())
        setHas(true)
      }
      const r = await wpVerify(channel.id)
      setMsg({ ok: true, text: r.user ? tr('ui.wp_ok_user', { user: r.user }) : tr('ui.wp_ok') })
      setPassword('')
      setOpen(false)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
      setOpen(true)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!name) return <Notice tone="error">{tr('ui.wp_no_secret')}</Notice>
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <KeyRound className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          {has === null ? tr('ui.wp_pw') : has ? tr('ui.wp_pw_saved') : tr('ui.wp_pw_missing')}
          {channel.wp_user ? <span className="text-muted-foreground"> · {tr('ui.wp_user', { user: channel.wp_user })}</span> : null}
        </span>
        {has && (
          <Button variant="ghost" size="sm" onClick={() => run(false)} disabled={busy || disabled}>
            {busy && !open ? <Loader className="animate-spin" /> : <Check />}
            {tr('ui.wp_check')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} disabled={disabled}>
          {has ? tr('ui.wp_update') : tr('ui.wp_fill')}
        </Button>
      </div>
      {msg && <div className={msg.ok ? 'text-xs text-emerald-600 dark:text-emerald-400' : 'rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive'}>{msg.text}</div>}
      {open && (
        <div className="space-y-3">
          <Field label={tr('ui.wp_new_pw')} hint={tr('ui.wp_pw_hint')}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" className={inputCls} />
          </Field>
          <Button size="sm" onClick={() => run(true)} disabled={busy || !password.trim()}>
            {busy && <Loader className="animate-spin" />}{tr('ui.wp_save_verify')}
          </Button>
        </div>
      )}
    </div>
  )
}
