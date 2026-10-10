import { useState } from 'react'
import { Check, Loader } from 'lucide-react'
import { runLocal, shuttleImage } from '../lib/shuttle'
import { Button, cx } from './ui'
import { tr } from '../lib/i18n'

/** 登录后平台返回的待选账号（社媒插件 login 返回的 choose，比如 Facebook 的个人号和他管理的主页） */
export type Choose = {
  type: string
  profile: string
  uid: string
  /** 弹窗上的说明（插件按界面语言写），没有用 Facebook 的默认说明 */
  desc?: string
  /** 登录的人自己（个人号）；YouTube 这类只有频道、没有个人号的不给 */
  me?: { name: string; handle?: string; avatar?: string; added?: boolean; label?: string }
  /** 他管理的主页 / 频道 / 公司主页；label 是第二行的说明（「公共主页」「公司主页」「频道 · @handle」），没有用「公共主页」 */
  pages: { id: string; name: string; handle?: string; avatar?: string; added?: boolean; label?: string }[]
}

/**
 * 登录后勾选要添加哪些（Facebook 的个人号和主页、YouTube 的频道、LinkedIn 的个人号和公司主页）：每个一行，只建勾上的（social.addChosen）。默认都不勾：
 * 一个人管几个主页、不同项目各用一个时，在每个项目里只勾自己的那个。这个项目里已经有的标「已添加」，勾上是更新它。
 */
export default function ChooseAccounts({ choose, onAdded, initialPageIds = [] }: { choose: Choose; onAdded: () => void; initialPageIds?: string[] }) {
  const [me, setMe] = useState(false)
  const [pages, setPages] = useState<string[]>(() => initialPageIds.filter((id) => choose.pages.some((p) => p.id === id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const add = async () => {
    setBusy(true)
    setError('')
    try {
      await runLocal('social/social.addChosen', { choose, profile_selected: me, page_ids: pages })
      onAdded()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  const rows = [
    ...(choose.me ? [{ key: '__me', name: choose.me.name, sub: choose.me.label || tr('choose_accounts.personal'), avatar: choose.me.avatar, added: choose.me.added, on: me, toggle: () => setMe((v) => !v) }] : []),
    ...choose.pages.map((p) => ({ key: p.id, name: p.name, sub: p.label || tr('choose_accounts.page'), avatar: p.avatar, added: p.added, on: pages.includes(p.id), toggle: () => setPages((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id])) })),
  ]
  return (
    <div className="space-y-3 p-4 text-sm">
      <p className="text-muted-foreground">{choose.desc || tr('choose_accounts.desc')}</p>
      {!rows.length && <p className="text-muted-foreground">{tr('choose_accounts.empty')}</p>}
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key}>
            <button type="button" role="checkbox" aria-checked={r.on} onClick={r.toggle} className={cx('flex w-full cursor-pointer items-center gap-3 rounded-xl border-[1.5px] px-2.5 py-2 text-left transition-colors hover:bg-accent', r.on ? 'border-primary' : 'border-transparent')}>
              {r.avatar ? <img src={shuttleImage(r.avatar)} alt="" className="size-8 shrink-0 rounded-full object-cover" /> : <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{r.name.slice(0, 1).toUpperCase()}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{r.name}</span>
                <span className="block truncate text-[11px] font-medium text-muted-foreground">{r.sub}{r.added ? ` · ${tr('choose_accounts.added')}` : ''}</span>
              </span>
              <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-md border', r.on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>{r.on && <Check className="size-3.5" />}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      <Button onClick={add} disabled={busy || (!me && pages.length === 0)}>
        {busy && <Loader className="animate-spin" />}
        {tr('choose_accounts.add', { n: (me ? 1 : 0) + pages.length })}
      </Button>
    </div>
  )
}
