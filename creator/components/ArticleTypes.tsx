import { FileText, Images, Video, type LucideIcon } from 'lucide-react'
import { cx } from './ui'
import { CHANNEL_TYPES } from '../lib/channels'
import { CHANNELS } from '../lib/edition'
import { tr } from '../lib/i18n'
import type { ChannelType } from '../lib/shuttle'
import { ARTICLE_TYPES, platformsFor, type ArticleType } from '../local/_types'

export { ARTICLE_TYPES, type ArticleType }
export { typeOf } from '../local/_types'

/** 类型的图标、名字、说明（名字和说明按当前语言取） */
export const TYPE_META: Record<ArticleType, { icon: LucideIcon; label: string; desc: string }> = {
  article: { icon: FileText, get label() { return tr('article.t_article') }, get desc() { return tr('article.t_article_desc') } },
  post: { icon: Images, get label() { return tr('article.t_post') }, get desc() { return tr('article.t_post_desc') } },
  video: { icon: Video, get label() { return tr('article.t_video') }, get desc() { return tr('article.t_video_desc') } },
}

/** 这个模板启用的平台里，支持这种类型的（按社媒插件的字段表算，local/_types.ts） */
export const typePlatforms = (t: ArticleType) => platformsFor(t, CHANNELS) as ChannelType[]

/** 平台小图标一排，悬停看名字 */
export function PlatformIcons({ types, size = 13, className }: { types: ChannelType[]; size?: number; className?: string }) {
  return <span className={cx('inline-flex flex-wrap items-center gap-1.5 text-muted-foreground', className)}>{types.map((p) => { const Icon = CHANNEL_TYPES[p]?.icon; return Icon ? <span key={p} title={CHANNEL_TYPES[p].label}><Icon size={size} /></span> : null })}</span>
}

/** 文章类型标签（列表、详情里） */
export function TypeBadge({ type, className }: { type: ArticleType; className?: string }) {
  const m = TYPE_META[type]
  return <span className={cx('inline-flex h-5 shrink-0 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-muted-foreground', className)}><m.icon className="size-3" />{m.label}</span>
}

/** 选类型：三张卡片，每张写清楚有哪些字段、能发到哪些平台 */
export function TypePicker({ value, onChange, exclude }: { value: ArticleType; onChange: (t: ArticleType) => void; exclude?: ArticleType }) {
  return <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
    {ARTICLE_TYPES.map((t) => {
      const m = TYPE_META[t]
      const on = value === t
      return <button key={t} type="button" role="radio" aria-checked={on} onClick={() => onChange(t)}
        className={cx('flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors', on ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30' : 'border-border hover:bg-accent/50')}>
        <span className="flex items-center gap-1.5 text-sm font-medium"><m.icon className="size-4" />{m.label}{exclude === t && <span className="text-[11px] font-normal text-muted-foreground">{tr('article.same_type')}</span>}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{m.desc}</span>
        <PlatformIcons types={typePlatforms(t)} className="mt-auto pt-1" />
      </button>
    })}
  </div>
}
