import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { type ChannelType } from '../lib/shuttle'
import { CHANNEL_TYPES } from '../lib/channels'
import { CHANNELS } from '../lib/edition'
import { SOCIAL } from '../lib/social'
import RunButton from './RunButton'
import ChooseAccounts, { type Choose } from './ChooseAccounts'
import { Button, cx } from './ui'
import { tr } from '../lib/i18n'

/** 添加账号：先选平台，再弹浏览器登录（登录态只留在这台电脑上）。用原生 <dialog>，Esc 关闭、焦点自动圈住。 */
export default function AddChannelDialog({ onClose, onAdded, allowedTypes = CHANNELS }: { onClose: () => void; onAdded: (key: string) => void; initialUrl?: string; allowedTypes?: ChannelType[] }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [type, setType] = useState<ChannelType | null>(null)
  const [choose, setChoose] = useState<Choose | null>(null) // 登录后待勾选的账号（ChooseAccounts）
  useEffect(() => {
    ref.current?.showModal()
  }, [])
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
            {([['social', allowedTypes]] as const).map(([group, types]) =>
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
        ) : null}
      </div>
    </dialog>
  )
}
