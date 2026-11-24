import { useState } from 'react'
import { Check, GripVertical } from 'lucide-react'
import { ChannelAvatar } from './ArticlePublish'
import { typePlatforms } from './ArticleTypes'
import { Button, Dialog, cx } from './ui'
import { CHANNEL_TYPES } from '../lib/channels'
import { isSite, type Article, type Channel } from '../lib/shuttle'
import { tr } from '../lib/i18n'

// 自媒体内容的「发到哪些账号」：文章的 targets（账号 id，第一个是主账号）和 variants（账号单独改过的文字），设计见 docs/social-workspace.md。

const s = (key: string, vars?: Record<string, unknown>) => tr('social_ws.' + key, vars)

/** 一条内容的图片、视频（按顺序，可以多个、混放）；cover 是视频的封面图 */
export type MediaItem = { kind: 'image' | 'video'; url: string; cover?: string }
/** 一个账号单独设置的文字，和它自己的图片、视频（没有 media 就是和主文案共用） */
export type Variant = { body: string; tags: string; media?: MediaItem[] }

/** 编辑器的列表换成文章表原来的字段（插件和发布只认这几个）：图片、第一个视频和它的封面 */
export function legacyOf(list: MediaItem[]) {
  const items = Array.isArray(list) ? list : []
  const v = items.find((i) => i.kind === 'video')
  return { images: items.filter((i) => i.kind === 'image').map((i) => i.url), video: v?.url || '', video_cover: v?.cover || '' }
}

/** 一篇文章的图片、视频列表：存了 media 并且和 images、video 对得上就用它，否则（别处改过）按 images、video 重建 */
export function itemsOf(a: Partial<Article>): MediaItem[] {
  const images = (() => { try { const l = JSON.parse(String(a.images || '[]')); return Array.isArray(l) ? l.map(String) : [] } catch { return [] } })()
  const legacy: MediaItem[] = [...(a.video ? [{ kind: 'video' as const, url: String(a.video), ...(a.video_cover ? { cover: String(a.video_cover) } : {}) }] : []), ...images.map((url) => ({ kind: 'image' as const, url }))]
  try {
    const l = JSON.parse(String((a as any).media || '[]'))
    if (Array.isArray(l) && l.length) {
      const items = l.filter((i) => i && (i.kind === 'image' || i.kind === 'video') && i.url) as MediaItem[]
      const d = legacyOf(items)
      if (d.video === (a.video || '') && (JSON.stringify(d.images) === JSON.stringify(images) || (!!a.video && a.type === 'video'))) return items
    }
  } catch {}
  return legacy
}

/** 这条内容要发的账号：targets，没有的话老数据的 target_account_id */
export function targetsOf(a: Partial<Article>): string[] {
  try {
    const l = JSON.parse(String(a.targets || '[]'))
    if (Array.isArray(l) && l.length) return l.map(String)
  } catch {}
  return a.target_account_id ? [a.target_account_id] : []
}

/** 账号单独改过的文字（没有这个账号的 key 就是跟随主文案） */
export function variantsOf(a: Partial<Article>): Record<string, Variant> {
  try {
    const v = JSON.parse(String(a.variants || '{}'))
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    // 媒体：数组是现在的格式；早先存过 { images, video, video_cover } 的对象，转成列表；其他的当没有
    for (const k of Object.keys(v)) {
      const m = v[k]?.media
      if (m === undefined || Array.isArray(m)) continue
      if (m && typeof m === 'object') {
        const imgs: string[] = Array.isArray(m.images) ? m.images.map(String) : []
        v[k].media = [...(m.video ? [{ kind: 'video', url: String(m.video), ...(m.video_cover ? { cover: String(m.video_cover) } : {}) }] : []), ...imgs.map((url) => ({ kind: 'image', url }))]
      } else delete v[k].media
    }
    return v
  } catch {
    return {}
  }
}

/** 能选来发内容的账号：社媒账号（不含网站） */
export const socialAccounts = (channels: Channel[]) => channels.filter((c) => !isSite(c) && !!CHANNEL_TYPES[c.type])

/** 这个账号现在不能选的原因；空的是能选（平台一种形式都不收、登录过期） */
export function accountBlocked(ch: Channel): string {
  if (!typePlatforms('post').includes(ch.type) && !typePlatforms('video').includes(ch.type)) return s('acc_unsupported')
  if (ch.login_status === 'expired') return s('acc_expired')
  return ''
}

/**
 * 账号勾选列表：勾选的顺序就是页签顺序，第一个是主账号（文案写在它那页，别的默认跟着它）。
 * 已选的非主账号有「设为主」。不能选的灰掉写原因（已经选了的还能取消）
 */
export function AccountList({ accounts, picked, onChange, onMain, compact = false }: { accounts: Channel[]; picked: string[]; onChange: (ids: string[]) => void; onMain?: (id: string) => void; compact?: boolean }) {
  const [dragId, setDragId] = useState('')
  // 拖动排序：只能在已选的里面换位置，换到第一个就是换主账号
  const dropOn = (id: string) => { if (dragId && dragId !== id && picked.includes(dragId) && picked.includes(id)) { const n = picked.filter((x) => x !== dragId); n.splice(n.indexOf(id) + (picked.indexOf(dragId) < picked.indexOf(id) ? 1 : 0), 0, dragId); onChange(n) } setDragId('') }
  const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  if (!accounts.length) return <p className="py-3 text-sm text-muted-foreground">{s('acc_none')}</p>
  // 已选的按顺序排前面
  const rows = [...picked.map((id) => accounts.find((c) => c.id === id)).filter(Boolean) as Channel[], ...accounts.filter((c) => !picked.includes(c.id))]
  return <div className="grid gap-1.5">
    {rows.map((ch) => {
      const on = picked.includes(ch.id), why = accountBlocked(ch), isMain = on && picked[0] === ch.id
      return <div key={ch.id} draggable={on && picked.length > 1} onDragStart={() => setDragId(ch.id)} onDragOver={(e) => { if (dragId && on) e.preventDefault() }} onDrop={(e) => { e.preventDefault(); dropOn(ch.id) }} onDragEnd={() => setDragId('')}
        className={cx('flex items-center gap-2.5 rounded-lg border px-3', dragId === ch.id && 'opacity-40', compact ? 'py-1.5' : 'py-2', on ? 'border-primary/50 bg-primary/5' : 'border-border', why && !on && 'opacity-60')}>
        {picked.length > 1 && <GripVertical className={cx('-ml-1.5 size-4 shrink-0', on ? 'cursor-grab text-muted-foreground' : 'invisible')} aria-hidden />}
        <button type="button" role="checkbox" aria-checked={on} aria-label={ch.name} disabled={!!why && !on} onClick={() => toggle(ch.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left disabled:cursor-default">
          <span className={cx('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>{on && <Check className="size-3" />}</span>
          <ChannelAvatar ch={ch} />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{ch.name}</span>{why ? <span className="block text-xs text-muted-foreground">{why}</span> : <span className="block text-xs text-muted-foreground">{CHANNEL_TYPES[ch.type]?.label}</span>}</span>
        </button>
        {isMain ? <span className="shrink-0 rounded bg-primary/10 px-1.5 text-[10px] leading-4 font-bold text-primary-text">{s('main')}</span>
          : on && onMain ? <button type="button" onClick={() => onMain(ch.id)} className="shrink-0 cursor-pointer text-xs text-primary-text hover:underline">{s('set_main')}</button>
          : on ? <span className="shrink-0 text-xs text-muted-foreground">{s('follow')}</span> : null}
      </div>
    })}
  </div>
}

/** 新建「自己写」：先选发到哪些账号（可以不选，之后在编辑页加） */
export function NewDraftDialog({ open, accounts, picked, setPicked, busy, onCancel, onCreate }: { open: boolean; accounts: Channel[]; picked: string[]; setPicked: (ids: string[]) => void; busy: boolean; onCancel: () => void; onCreate: () => void }) {
  return <Dialog open={open} onClose={() => !busy && onCancel()} title={s('new_which')} width={460} footer={<>
    <span className="mr-auto text-xs text-muted-foreground">{s('new_count', { n: picked.length })}</span>
    <Button variant="ghost" disabled={busy} onClick={onCancel}>{tr('common.cancel')}</Button>
    <Button disabled={busy} onClick={onCreate}>{s('new_start')}</Button>
  </>}>
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">{s('new_which_hint')}</p>
      <AccountList accounts={accounts} picked={picked} onChange={setPicked} onMain={(id) => setPicked([id, ...picked.filter((x) => x !== id)])} />
    </div>
  </Dialog>
}
