import { useState } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import { runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { Button } from './ui'

/** creght 站点渠道的「去编辑」：现取一次性登录链接（channels.adminLink，60 秒、一次有效）马上打开，打开就是登录状态。
 *  浏览器拦了弹窗时（取链接要一两秒，有的浏览器不再算用户点击）给一个链接让用户自己点 */
export default function EditSiteButton({ channelId, target = 'editor' }: { channelId: string; target?: string }) {
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState('')
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true)
    setErr('')
    setBlocked('')
    try {
      const { url } = await runLocal<{ url: string }>('channels.adminLink', { id: channelId, target })
      // 带 noopener 时 window.open 总是返回 null，判断不了有没有被拦；桌面 App 交给系统浏览器打开，也返回 null
      const w = window.open(url, '_blank')
      if (w) w.opener = null
      else if (!/Electron\//.test(navigator.userAgent)) setBlocked(url)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={go} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <ArrowUpRight />}
        {tr('site_admin.edit')}
      </Button>
      {blocked && (
        <a href={blocked} target="_blank" rel="noreferrer" onClick={() => setBlocked('')} className="text-xs font-medium text-primary-text hover:underline">
          {tr('site_admin.open_blocked')}
        </a>
      )}
      {err && <span className="max-w-64 text-xs text-destructive [overflow-wrap:anywhere]">{err}</span>}
    </span>
  )
}
