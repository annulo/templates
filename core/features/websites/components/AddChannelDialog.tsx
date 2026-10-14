import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader, Search, X } from 'lucide-react'
import { addSiteChannel, addWordPressChannel, listCreghtSites, openShuttleSettings, setSecret, wpPrepare, type ChannelType, type CreghtSite } from '../lib/shuttle'
import { CHANNEL_TYPES } from '../lib/channels'
import { CHANNELS } from '../lib/edition'
import { SOCIAL } from '../lib/social'
import RunButton from './RunButton'
import ChooseAccounts, { type Choose } from './ChooseAccounts'
import FacebookAccountFlow from './FacebookAccountFlow'
import { Button, Field, cx, inputCls } from './ui'
import { tr } from '../lib/i18n'

/** 选类型时分两组：网站、社媒 */
const SITE_TYPES: ChannelType[] = ['creght_site', 'wordpress']

/** 添加渠道：先选类型，Creght 网站再从 creght 账号下的站点里挑一个，WordPress 填地址和应用密码，小红书、X、B 站、抖音这些社媒弹浏览器登录。用原生 <dialog>，Esc 关闭、焦点自动圈住。 */
export default function AddChannelDialog({ onClose, onAdded, initialUrl = '', allowedTypes = CHANNELS }: { onClose: () => void; onAdded: (key: string) => void; initialUrl?: string; allowedTypes?: ChannelType[] }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [type, setType] = useState<ChannelType | null>(null)
  const [choose, setChoose] = useState<Choose | null>(null) // 登录后待勾选的账号（ChooseAccounts）
  const [sites, setSites] = useState<CreghtSite[] | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('') // 读站点列表失败：不再转圈，给重试和去设置的入口
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    ref.current?.showModal()
  }, [])
  useEffect(() => {
    if (type !== 'creght_site' || sites) return
    setLoadError('')
    listCreghtSites().then(setSites).catch((e) => setLoadError(e.message))
  }, [type, sites, attempt])

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    return (sites ?? []).filter((s) => !k || s.site_name.toLowerCase().includes(k) || s.project_name.toLowerCase().includes(k))
  }, [sites, q])

  const add = async (s: CreghtSite) => {
    setBusy(s.site_id)
    setError('')
    try {
      await addSiteChannel(s.project_id, s.site_id)
      onAdded(`${s.project_id}/${s.site_id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy('')
      return false
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className={cx('m-auto rounded-xl border border-border bg-popover p-0 text-left text-popover-foreground shadow-xl backdrop:bg-black/50', type ? 'w-[min(92vw,480px)]' : 'w-[min(92vw,720px)]')}
    >
      <div className="flex max-h-[min(80vh,640px)] flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {type && (
            <Button variant="ghost" size="icon-sm" onClick={() => (setType(null), setChoose(null))} aria-label={tr('add_channel.back')} className="-ml-2 text-muted-foreground">
              <ArrowLeft />
            </Button>
          )}
          <h2 className="flex-1 text-sm font-semibold">{type ? tr('add_channel.title_type', { type: CHANNEL_TYPES[type].label }) : tr('add_channel.title')}</h2>
          <Button variant="ghost" size="icon-sm" onClick={() => ref.current?.close()} aria-label={tr('common.close')} className="-mr-2 text-muted-foreground">
            <X />
          </Button>
        </div>

        {!type ? (
          <div className="min-h-0 space-y-4 overflow-y-auto p-4">
            {([['sites', allowedTypes.filter((t) => SITE_TYPES.includes(t))], ['social', allowedTypes.filter((t) => !SITE_TYPES.includes(t))]] as const).map(([group, types]) =>
              types.length > 0 && (
                <section key={group}>
                  <h3 className="mb-1.5 px-2 text-xs font-medium text-muted-foreground">{tr('add_channel.group_' + group)}</h3>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {types.map((t) => {
                      const m = CHANNEL_TYPES[t]
                      return (
                        <button
                          key={t}
                          disabled={!m.ready}
                          onClick={() => setType(t)}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] border-transparent p-2 text-left transition-all enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {/* logo 自带品牌色，底色用中性的；还不能添加的整行已经变淡 */}
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground">
                            <m.icon size={14} strokeWidth={2.5} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-bold">{m.label}</span>
                            <span className="block text-[11px] font-medium text-muted-foreground">{m.ready ? m.hint : tr('add_channel.not_ready')}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ),
            )}
          </div>
        ) : type === 'wordpress' ? (
          <WordPressForm initialUrl={initialUrl} onAdded={() => onAdded('wordpress')} />
        ) : type === 'xiaohongshu' ? (
          // 和「社媒」页的添加账号一样：弹出浏览器登录，登录态只留在这台电脑上。
          // 对话框里只有这一个按钮，不用 inline：进度（「已经打开浏览器窗口，请在窗口里登录…」）完整写在按钮下面
          <div className="space-y-3 p-4 text-sm">
            <p className="text-muted-foreground">{tr('add_channel.xhs_desc')}</p>
            <RunButton watch fn="social/social.login" input={{ type: 'xiaohongshu' }} onDone={() => onAdded('xiaohongshu')}>
              {tr('add_channel.xhs_login')}
            </RunButton>
          </div>
        ) : type === 'linkedin' ? (
          <div className="space-y-3 p-4 text-sm">
            <p className="text-muted-foreground">{tr('add_channel.linkedin_desc')}</p>
            <RunButton watch fn="social/social.login" input={{ type: 'linkedin' }} onDone={() => onAdded('linkedin')}>
              {tr('add_channel.linkedin_login')}
            </RunButton>
          </div>
        ) : type === 'x' ? (
          <div className="space-y-3 p-4 text-sm">
            <p className="text-muted-foreground">{tr('add_channel.x_desc')}</p>
            <RunButton watch fn="social/social.login" input={{ type: 'x' }} onDone={() => onAdded('x')}>
              {tr('add_channel.x_login')}
            </RunButton>
          </div>
        ) : type === 'facebook' ? (
          <div className="min-h-0 overflow-y-auto p-4"><FacebookAccountFlow onAdded={() => onAdded('facebook')} /></div>
        ) : SOCIAL[type] ? (
          // 其余社媒平台（B 站、抖音…）：同样弹浏览器登录。登录都走 social.login（记下是在这台电脑登录的）
          <div className="space-y-3 p-4 text-sm">
            <p className="text-muted-foreground">{tr('add_channel.social_desc', { hint: SOCIAL[type]!.loginHint })}</p>
            {choose ? (
              <ChooseAccounts choose={choose} onAdded={() => onAdded(type)} />
            ) : (
              // 登录后可能要先勾选（Facebook 管理着主页时返回 choose：个人号、每个主页让用户挑），没有就是已经添加好了
              <RunButton watch fn="social/social.login" input={{ type }} onDone={(r) => { const c = (r as { choose?: Choose } | null)?.choose; if (c) setChoose(c); else onAdded(type) }}>
                {tr('add_channel.social_login', { name: SOCIAL[type]!.label })}
              </RunButton>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <label className="relative mb-3 block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tr('add_channel.search_ph')}
                aria-label={tr('add_channel.search_label')}
                className="flex h-9 w-full rounded-md border border-input bg-input-background py-1 pr-3 pl-9 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
            {error && <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              {loadError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm">
                  <p className="text-destructive">{loadError}</p>
                  <div className="mt-2.5 flex gap-2">
                    {/MCP/.test(loadError) && <Button size="sm" variant="outline" onClick={() => openShuttleSettings('mcp')}>{tr('add_channel.open_mcp')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>{tr('common.retry')}</Button>
                  </div>
                </div>
              ) : sites === null ? (
                <div className="flex justify-center py-10">
                  <Loader className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">{tr('add_channel.no_match')}</div>
              ) : (
                <ul className="space-y-1">
                  {filtered.map((s) => (
                    <li key={s.site_id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold">{s.site_name}</div>
                        {s.project_name !== s.site_name && <div className="truncate text-[11px] font-medium text-muted-foreground">{s.project_name}</div>}
                      </div>
                      {s.added ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Check className="size-3.5" /> {tr('add_channel.added')}
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => add(s)}>
                          {busy === s.site_id && <Loader className="animate-spin" />}{tr('common.add')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </dialog>
  )
}

/** 应用密码在哪里建：添加渠道和更新密码共用 */

/**
 * WordPress：填站点地址、用户名、应用密码 → 密码写进本机密钥（PUT local/secrets，表里只记密钥名）→ 验证并添加。
 */
function WordPressForm({ onAdded, initialUrl }: { onAdded: () => void; initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const add = async () => {
    setBusy(true)
    setError('')
    try {
      const p = await wpPrepare(url)
      if (p.added) throw new Error(tr('add_channel.wp_added', { url: p.url }))
      if (password.trim()) await setSecret(p.secret, password.trim())
      else if (!p.has_secret) throw new Error(tr('add_channel.wp_need_pw'))
      await addWordPressChannel(p.url, username)
      onAdded()
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 p-4 text-sm">
      <Field label={tr('add_channel.wp_url')}>
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" className={inputCls} />
      </Field>
      <Field label={tr('add_channel.wp_user')} hint={tr('add_channel.wp_user_hint')}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoComplete="off" className={inputCls} />
      </Field>
      <Field label={tr('ui.wp_pw')} hint={tr('ui.wp_pw_hint')}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" autoComplete="new-password" className={inputCls} />
      </Field>
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      <Button onClick={add} disabled={busy || !url.trim() || !username.trim()}>
        {busy && <Loader className="animate-spin" />}{tr('add_channel.wp_verify_add')}
      </Button>
    </div>
  )
}
