import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Clock, Film, ImagePlus, Layers, Repeat2, Users, Library, Link2, Loader2, PanelRight, Pencil, Plus, Search as SearchIcon, Send, Sparkles, X } from 'lucide-react'
import { typeOf } from '../../local/_types'
import { draftOf, patchOf, sameDraft, type ArticleDraft } from '../ArticleEditor'
import { typePlatforms } from '../ArticleTypes'
import { PublishDialog } from '../ArticlePublish'
import { RowMore, removeArticle } from './Content'
import AssetPicker from '../AssetPicker'
import Lightbox from '../Lightbox'
import Select from '../Select'
import { useTask } from '../Task'
import { Badge, Button, Dialog, Notice, cx, inputCls, toast } from '../ui'
import { AccountList, NewDraftDialog, accountBlocked, socialAccounts, targetsOf, variantsOf, legacyOf, itemsOf, type MediaItem, type Variant } from '../SocialAccounts'
import { lengthOn } from '../../local/_types'
import { PostStatusBar, PostedView, SentContent } from '../SocialPosted'
import { StageBadge } from '../ContentStatus'
import { CHANNEL_TYPES } from '../../lib/channels'
import { fileSrc } from '../../lib/files'
import { uploadAssets } from '../../lib/assets'
import { usePasteFiles } from '../../lib/usePasteFiles'
import { entryAccountIds, entryMetrics, type ContentData, type ContentEntry, type ContentStage } from '../../lib/contentWorkspace'
import { dbCreate, dbList, dbPatch, isSite, runLocal, uploadLocalFile, videoSrc, type Article, type Asset, type Channel } from '../../lib/shuttle'
import { fieldsFor } from '../../plugins/social/local/_fields'
import { numLocale, tr } from '../../lib/i18n'
import type { Ctx } from './types'

// 自媒体内容：左边列表（草稿 / 排期 / 已发布），右边点哪条就在原地编辑，设计见 docs/social-workspace.md。
// 草稿直接在右边写：文字、粘贴或拖进来的图片和视频（有视频就是视频，只有图就是图文），自动保存；发布、排期用原来的发布弹窗。
// 排期、已发布的右边仍是原来的文章页（发布记录、数据、复盘），由 ContentWorkspace 通过 detail 传进来。

const s = (key: string, vars?: Record<string, unknown>) => tr('social_ws.' + key, vars)

type Tab = 'drafts' | 'queue' | 'posted' | 'archived'
const TAB_STAGES: Record<Tab, ContentStage[]> = {
  drafts: ['planned', 'creating', 'draft', 'ready', 'verify', 'blocked'],
  queue: ['scheduled'],
  posted: ['published'],
  archived: ['archived'],
}
const TABS: Tab[] = ['drafts', 'queue', 'posted']

/** 列表上这条的标题：没写标题的取正文第一句 */
const titleOf = (e: ContentEntry) => e.title || firstLine(e.article?.body || e.post?.body || '') || s('empty_draft')
const firstLine = (t: string) => String(t || '').replace(/<[^>]+>/g, '').split('\n').find((x) => x.trim())?.trim().slice(0, 80) || ''

/** 这条在列表里排的时间：排期的取最早的排期时间，已发布的取最近发出的时间，其他取更新时间 */
function keyTime(e: ContentEntry, tab: Tab, posts: any[]): number {
  const mine = e.article ? posts.filter((p) => p.article_id === e.article.id) : e.post ? [e.post] : []
  const at = tab === 'queue' ? mine.filter((p) => p.status === 'scheduled').map((p) => String(p.scheduled_at)).sort()[0]
    : tab === 'posted' ? mine.filter((p) => p.status === 'published').map((p) => String(p.published_at)).sort().reverse()[0] : ''
  return Date.parse(at || '') || Date.parse(e.updatedAt) || 0
}
const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
const clock = (ms: number) => new Date(ms).toLocaleTimeString(numLocale(), { hour: '2-digit', minute: '2-digit' })
function dayLabel(ms: number) {
  const diff = Math.round((new Date(new Date(ms).toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400_000)
  return diff === 0 ? s('day_today') : diff === 1 ? s('day_tomorrow') : diff === -1 ? s('day_yesterday') : new Date(ms).toLocaleDateString(numLocale(), { month: 'long', day: 'numeric' })
}

function ago(iso?: string) {
  const t = Date.parse(iso || '')
  if (!t) return ''
  const d = new Date(t)
  const days = Math.floor((Date.now() - t) / 86400_000)
  if (days <= 0) return d.toLocaleTimeString(numLocale(), { hour: '2-digit', minute: '2-digit' })
  if (days < 7) return s('days_ago', { n: days })
  return d.toLocaleDateString(numLocale(), { month: 'numeric', day: 'numeric' })
}

/**
 * 这条内容要发的账号：存了 targets 就用它；老草稿没有的，按已有的发布记录、目标账号、目标平台推断（推不出来是空的）
 */
function guessTargets(a: Article, posts: any[], channels: Channel[]): string[] {
  const own = targetsOf(a)
  if (own.length) return own
  const fromPosts = [...new Set(posts.filter((p) => p.article_id === a.id).map((p) => String(p.channel_id)))].filter((id) => channels.some((c) => c.id === id))
  if (fromPosts.length) return fromPosts
  const platform = (a as Article & { target_platform?: string }).target_platform
  return platform ? channels.filter((c) => c.type === platform && !isSite(c)).slice(0, 1).map((c) => c.id) : []
}

type Props = {
  ctx: Ctx
  data: ContentData
  entries: ContentEntry[]
  params: Record<string, string>
  setParam: (k: string, v: string) => void
  reload: () => void
  /** 排期、已发布（或不是图文、视频的）这条在右边怎么显示：原来的文章页 */
  detail: (a: Article) => ReactNode
  /** 没有成品的行（只有选题、计划）点了去哪 */
  openEntry: (e: ContentEntry) => void
  /** 左下角的小入口（出选题、导入营销资料） */
  tools?: ReactNode
  /** 还没记归属的行（没带 workspace 建的选题）上「选发到哪」：打开确认归属 */
  onAssign?: (e: ContentEntry) => void
}

export default function SocialWorkspace({ ctx, data, entries, params, setParam, reload, detail, openEntry, tools, onAssign }: Props) {
  const [tab, setTab] = useState<Tab>('drafts')
  // 「已发布」按来源筛：全部 / 从 Annulo 发的 / 平台上直接发的（采集时发现的，没有出处）
  const [src, setSrc] = useState<'' | 'annulo' | 'platform'>('')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)
  const accounts = ctx.channels.filter((c) => !isSite(c))
  const account = params.account || ''
  const selected = params.article ? data.articles.find((a) => a.id === params.article) : undefined
  const selectedEntry = selected ? entries.find((e) => e.article?.id === selected.id) : undefined
  // 平台上直接发的帖子（不属于任何内容）：右边是只读的 PlatformPostView
  const postEntry = !selected && params.post ? entries.find((e) => e.post?.id === params.post) : undefined

  // 选中的那条在哪个页签就跳到哪个页签（刚发布完、从别处链接进来）
  useEffect(() => {
    const e = selectedEntry || postEntry
    if (!e) return
    if (tabHas(tab, e)) return
    const t = (Object.keys(TAB_STAGES) as Tab[]).find((k) => tabHas(k, e))
    if (t && t !== tab) setTab(t)
  }, [selected?.id, selectedEntry?.stage, postEntry?.key])

  const q = query.trim().toLowerCase()
  // 一条内容发到几个账号时可能只发了一部分：已发布的账号、排期中的、还没发的（没有发布记录，或只是草稿、失败）
  const infoOf = (e: ContentEntry) => {
    if (!e.article) return { sent: [] as string[], sched: [] as string[], unsent: [] as string[] }
    const mine = data.posts.filter((p) => p.article_id === e.article.id)
    const ids = guessTargets(e.article, mine, ctx.channels)
    const sent = ids.filter((id) => mine.some((p) => p.channel_id === id && p.status === 'published'))
    const sched = ids.filter((id) => !sent.includes(id) && mine.some((p) => p.channel_id === id && p.status === 'scheduled'))
    return { sent, sched, unsent: ids.filter((id) => !sent.includes(id) && !sched.includes(id)) }
  }
  // 部分账号发出去的内容在「已发布」里，同时还在「草稿」（有没发的账号）或「排期」（有排期中的账号）里，直到都处理完
  const tabHas = (t: Tab, e: ContentEntry) => TAB_STAGES[t].includes(e.stage) || (e.stage === 'published' && ((t === 'drafts' && infoOf(e).unsent.length > 0) || (t === 'queue' && infoOf(e).sched.length > 0)))
  const inTab = (t: Tab) => entries.filter((e) => tabHas(t, e))
  const rows = inTab(tab).filter((e) => (!account || entryAccountIds(e, data, 'social').includes(account))
    && (tab !== 'posted' || !src || (src === 'platform') === !!e.post)
    && (!q || [e.title, e.topic?.angle, e.article?.body, e.post?.body].join(' ').toLowerCase().includes(q)))
  const tabs: Tab[] = inTab('archived').length ? [...TABS, 'archived'] : TABS
  // 排期和已发布按时间分组：排期从近到远，已发布从新到旧
  const times = new Map(rows.map((e) => [e.key, keyTime(e, tab, data.posts)] as const))
  if (tab === 'queue') rows.sort((x, y) => times.get(x.key)! - times.get(y.key)!)
  else if (tab === 'posted') rows.sort((x, y) => times.get(y.key)! - times.get(x.key)!)
  const grouped = tab === 'queue' || tab === 'posted'
  let lastDay = ''

  // 新建空白草稿（不经过 AI）：左边的「＋ 新建内容」直接用上次用的账号（筛选了账号就用它）；菜单里点哪个账号就用哪个；
  // 「选择多个账号…」弹窗勾选，选的第一个是主账号
  const [creating, setCreating] = useState(false), [newPicked, setNewPicked] = useState<string[]>([]), [newBusy, setNewBusy] = useState(false)
  const usable = socialAccounts(ctx.channels).filter((c) => !accountBlocked(c))
  const lastIds = () => {
    const recent = data.articles.filter((x) => x.workspace === 'social').sort((x, y) => (Date.parse(y.created_at || '') || 0) - (Date.parse(x.created_at || '') || 0)).map(targetsOf).find((l) => l.some((id) => usable.some((c) => c.id === id))) || []
    const ids = recent.filter((id) => usable.some((c) => c.id === id))
    return ids.length ? ids : usable.slice(0, 1).map((c) => c.id)
  }
  const quickIds = account && usable.some((c) => c.id === account) ? [account] : lastIds()
  const createWith = async (ids: string[]) => {
    setMenu(false)
    setNewBusy(true)
    try {
      const now = new Date().toISOString()
      const first = ctx.channels.find((c) => c.id === ids[0])
      const a = await dbCreate('articles', { title: '', type: 'post', body: '', summary: '', tags: '[]', status: 'draft', workspace: 'social', channel_id: '',
        targets: JSON.stringify(ids), variants: '{}', target_account_id: first?.id || '', target_platform: first?.type || '', created_at: now, updated_at: now } as any)
      setCreating(false)
      reload()
      setTab('drafts')
      setParam('article', a.id)
    } catch (e) { toast((e as Error).message, 'error') } finally { setNewBusy(false) }
  }
  const quickNew = () => { if (!usable.length) { setMenu(false); return toast(s('acc_none'), 'error') } void createWith(quickIds) }
  const openMulti = () => { setMenu(false); setNewPicked(quickIds); setCreating(true) }
  // 复用已发布的内容：选一条已发出去的，复制成新草稿（文字、媒体、账号都带上，不带发布记录和数据）
  const [reuse, setReuse] = useState(false), [reuseQ, setReuseQ] = useState(''), [reusing, setReusing] = useState('')
  const reuseList = inTab('posted').filter((e) => e.article && (!reuseQ.trim() || [e.title, e.article.body].join(' ').toLowerCase().includes(reuseQ.trim().toLowerCase()))).slice(0, 50)
  const copyOpen = async (id: string) => {
    setReusing(id)
    try {
      const r = await runLocal<{ article_id: string }>('convert.copy', { article_id: id })
      setReuse(false); reload(); setTab('drafts'); setParam('article', r.article_id); toast(s('copied'))
    } catch (e) { toast((e as Error).message, 'error') } finally { setReusing('') }
  }

  const open = (e: ContentEntry) => {
    if (e.post) { setParam('article', ''); setParam('post', e.post.id) }
    else if (e.article) { setParam('post', ''); setParam('article', e.article.id) }
    else openEntry(e)
  }
  // 右边显示什么：草稿、排期、失败的是编辑器；已发布的是只读的 PostedView；长文、点了「完整详情」的仍是原来的文章页
  const [full, setFull] = useState('')
  const selectedPosts = selected ? data.posts.filter((p) => p.article_id === selected.id) : []
  const selectedTargets = selected ? guessTargets(selected, selectedPosts, ctx.channels) : []
  const hasUnsent = selectedTargets.some((id) => !selectedPosts.some((p) => p.channel_id === id && p.status === 'published'))
  const simple = !!selected && !!selectedEntry && typeOf(selected) !== 'article' && full !== selected.id
  const mode: 'edit' | 'posted' | 'full' | '' = !selected ? '' : simple && (TAB_STAGES.drafts.includes(selectedEntry!.stage) || selectedEntry!.stage === 'scheduled' || (selectedEntry!.stage === 'published' && hasUnsent)) ? 'edit' : simple && selectedEntry!.stage === 'published' ? 'posted' : 'full'

  return <div className="-mx-4 -my-4 flex h-[calc(100vh-4.5rem)] min-h-[560px] md:-mx-6">
    {/* 左：列表 */}
    <aside className={cx('flex w-80 shrink-0 flex-col border-r border-border bg-muted/20 max-md:w-full max-md:border-r-0', (selected || postEntry) && 'max-md:hidden')}>
      <div className="space-y-2 px-3 pt-3">
        <div role="tablist" className="flex gap-0.5 rounded-lg border border-border bg-background p-0.5 text-xs">
          {tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cx('flex-1 cursor-pointer rounded-md px-2 py-1.5 transition-colors', tab === t ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {s('tab_' + t)}<span className="ml-1 tabular-nums opacity-60">{inTab(t).length || ''}</span></button>)}
        </div>
        <div className="flex items-center gap-1.5">
          <label className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input type="search" aria-label={s('search')} placeholder={s('search')} value={query} onChange={(e) => setQuery(e.target.value)} className={cx(inputCls, 'h-8 rounded-lg pl-8 text-xs')} />
          </label>
          {accounts.length > 1 && <Select variant="inline" className="max-w-32" ariaLabel={s('account')} value={account} onChange={(v) => setParam('account', v)}
            options={[{ value: '', label: s('all_accounts'), icon: <Users className="size-3.5" /> }, ...accounts.map((c) => { const Icon = CHANNEL_TYPES[c.type]?.icon; return { value: c.id, label: c.name, sub: CHANNEL_TYPES[c.type]?.label, icon: Icon ? <Icon size={14} /> : undefined } })]} />}
        </div>
        {tab === 'posted' && entries.some((e) => e.post) && <div role="radiogroup" aria-label={s('src')} className="flex gap-3 text-xs text-muted-foreground">
          {(['', 'annulo', 'platform'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={src === k} onClick={() => setSrc(k)}
            className={cx('cursor-pointer hover:text-foreground', src === k && 'font-semibold text-foreground')}>{s('src_' + (k || 'all'))}</button>)}
        </div>}
      </div>
      <div className="relative mt-3 flex items-stretch border-y border-border bg-background">
        <button type="button" onClick={quickNew} disabled={newBusy} title={quickIds.map((id) => ctx.channels.find((c) => c.id === id)?.name).filter(Boolean).join('、')} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-60">
          {newBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{s('new')}
          <span className="min-w-0 truncate text-xs opacity-70">{quickIds.map((id) => CHANNEL_TYPES[ctx.channels.find((c) => c.id === id)?.type as keyof typeof CHANNEL_TYPES]?.label).filter(Boolean).join(' · ')}</span>
        </button>
        <button type="button" aria-haspopup="menu" aria-expanded={menu} aria-label={s('new_menu')} onClick={() => setMenu((v) => !v)} className="flex w-11 cursor-pointer items-center justify-center border-l border-border text-muted-foreground hover:text-foreground"><ChevronDown className={cx('size-4 transition-transform', menu && 'rotate-180')} /></button>
        {menu && <>
          <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
          <div role="menu" className="absolute top-full left-3 z-30 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-border bg-background p-1.5 shadow-lg">
            <p className="px-2.5 pt-1.5 pb-1 text-xs text-muted-foreground">{s('menu_new')}</p>
            {!usable.length && <p className="px-2.5 py-2 text-xs text-muted-foreground">{s('acc_none')}</p>}
            {usable.map((c) => { const Icon = CHANNEL_TYPES[c.type]?.icon; return <button key={c.id} type="button" role="menuitem" onClick={() => void createWith([c.id])} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent">
              {Icon && <Icon size={18} />}<span className="min-w-0 flex-1 truncate">{c.name}</span><span className="shrink-0 text-xs text-muted-foreground">{CHANNEL_TYPES[c.type]?.label}</span></button> })}
            {usable.length > 1 && <button type="button" role="menuitem" onClick={openMulti} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"><Layers className="size-[18px] text-muted-foreground" />{s('menu_multi')}</button>}
            <div role="separator" className="my-1.5 border-t border-border" />
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setReuseQ(''); setReuse(true) }} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"><Repeat2 className="size-[18px] text-muted-foreground" />{s('menu_reuse')}</button>
            <div role="separator" className="my-1.5 border-t border-border" />
            <p className="px-2.5 pt-1 pb-1 text-xs text-muted-foreground">{s('menu_settings')}</p>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); ctx.go('channels') }} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"><Plus className="size-[18px] text-muted-foreground" />{s('menu_manage')}</button>
          </div>
        </>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!rows.length && <p className="px-4 py-8 text-center text-xs text-muted-foreground">{s('empty_' + tab)}</p>}
        {rows.map((e) => {
          const ids = [...new Set([...entryAccountIds(e, data, 'social', tab === 'posted'), ...(e.article && tab !== 'posted' ? guessTargets(e.article, data.posts, ctx.channels) : [])])]
          const accs = ids.map((id) => ctx.channels.find((c) => c.id === id)).filter(Boolean) as Channel[]
          const m = tab === 'posted' ? entryMetrics(e, data) : null
          const on = (!!e.article && e.article.id === params.article) || (!!e.post && !selected && e.post.id === params.post)
          const article = e.article
          const ms = times.get(e.key) || 0
          const inf = e.stage === 'published' ? infoOf(e) : null
          const nm = (l: string[]) => l.map((id) => ctx.channels.find((c) => c.id === id)?.name).filter(Boolean).join('、')
          const partial = inf && (tab === 'posted' ? (inf.unsent.length || inf.sched.length ? s('partial_posted', { names: nm([...inf.unsent, ...inf.sched]) }) : '') : tab === 'drafts' ? s('partial_drafts', { sent: nm(inf.sent), unsent: nm(inf.unsent) }) : s('partial_queue', { sent: nm(inf.sent) }))
          const header = grouped && dayKey(ms) !== lastDay ? <p className="border-b border-border bg-muted/50 px-4 py-1.5 text-[11px] font-semibold text-muted-foreground">{dayLabel(ms)}</p> : null
          if (grouped) lastDay = dayKey(ms)
          return <Fragment key={e.key}>{header}<div role="button" tabIndex={0} onClick={() => open(e)} onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(e) } }}
            className={cx('group relative block w-full cursor-pointer border-b border-border px-4 py-3 text-left transition-colors outline-none focus-visible:bg-muted/40', on ? 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]' : 'bg-background hover:bg-muted/40')}>
            <div className="flex items-start gap-2">
              <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug">{titleOf(e)}</span>
              {article && <span className={cx('shrink-0 transition-opacity', !on && 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100')}><RowMore
                onCopy={async () => { const r = await runLocal<{ article_id: string }>('convert.copy', { article_id: article.id }); reload(); setTab('drafts'); setParam('article', r.article_id); toast(s('copied')) }}
                onDelete={async () => { await removeArticle(article, data.posts, data.publications); if (params.article === article.id) setParam('article', ''); reload() }} /></span>}
            </div>
            {!!accs.length && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {accs.slice(0, 2).map((c) => { const Icon = CHANNEL_TYPES[c.type]?.icon; return <span key={c.id} className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={c.name}>{Icon && <Icon size={14} />}<span className="truncate">{c.name}</span></span> })}
              {accs.length > 2 && <span title={accs.slice(2).map((c) => c.name).join('、')}>+{accs.length - 2}</span>}
            </div>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {e.article?.unread && <span className="rounded-md bg-primary/10 px-1.5 text-[10px] leading-4 font-semibold text-primary-text">{tr('article.new_badge')}</span>}
              {e.post && <span className="rounded-md bg-muted px-1.5 text-[10px] leading-4 font-medium">{s('from_platform')}</span>}
              {!e.workspaces.length && onAssign && <button type="button" onClick={(ev) => { ev.stopPropagation(); onAssign(e) }} className="cursor-pointer rounded-md border border-amber-300 bg-amber-50 px-1.5 text-[10px] leading-4 font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{s('assign_where')}</button>}
              {tab !== 'posted' && e.stage !== 'published' && <StageBadge stage={e.stage} />}
              {partial && <span className="rounded-md bg-amber-100 px-1.5 text-[10px] leading-4 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">{partial}</span>}
              <span>{grouped ? (tab === 'posted' ? s('published_clock', { time: clock(ms) }) : clock(ms)) : ago(e.updatedAt)}</span>
              {m && <span className="tabular-nums">· {m.views.toLocaleString(numLocale())} {s('views')}</span>}
            </div>
          </div></Fragment>
        })}
      </div>
      {tools && <div className="flex flex-wrap items-center gap-2 border-t border-border bg-background px-3 py-2">{tools}</div>}
    </aside>

    {/* 右：编辑 / 详情 */}
    <section className={cx('min-w-0 flex-1 overflow-y-auto bg-background', !selected && !postEntry && 'max-md:hidden')}>
      {(selected || postEntry) && <button type="button" onClick={() => { setParam('article', ''); setParam('post', '') }} className="flex cursor-pointer items-center gap-1.5 px-4 pt-3 text-xs text-muted-foreground md:hidden"><ArrowLeft className="size-3.5" />{s('back')}</button>}
      {postEntry && <PlatformPostView key={postEntry.key} ctx={ctx} post={postEntry.post} data={data} reload={reload}
        onDraft={(id) => { reload(); setTab('drafts'); setParam('post', ''); setParam('article', id) }} onAdopt={() => setParam('adopt', postEntry.post.id)} />}
      {!selected && !postEntry && <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <Send className="size-8 opacity-40" />
        <p>{s('pick_hint')}</p>
        <Button variant="outline" onClick={quickNew}><Pencil />{s('new_blank')}</Button>
      </div>}
      {selected && mode === 'edit' && <SocialEditor key={selected.id} fallback={quickIds} ctx={ctx} a={selected} posts={selectedPosts} pubs={data.publications.filter((p) => p.article_id === selected.id)}
        onChanged={reload} onDeleted={() => { setParam('article', ''); reload() }} data={data} onFull={() => setFull(selected.id)} />}
      {selected && mode === 'posted' && <PostedView key={selected.id} ctx={ctx} a={selected} posts={selectedPosts} data={data} order={targetsOf(selected)} onChanged={reload}
        onCopy={async () => { const r = await runLocal<{ article_id: string }>('convert.copy', { article_id: selected.id }); reload(); setTab('drafts'); setParam('article', r.article_id); toast(s('copied')) }}
        menu={<RowMore items={[{ label: s('full_detail'), icon: <Layers className="size-4" />, onSelect: () => setFull(selected.id) }]} />} />}
      {selected && mode === 'full' && <div className="px-6 py-5">
        {full === selected.id && <button type="button" onClick={() => setFull('')} className="mb-3 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />{s('back_new')}</button>}
        {detail(selected)}</div>}
    </section>
    <NewDraftDialog open={creating} accounts={socialAccounts(ctx.channels)} picked={newPicked} setPicked={setNewPicked} busy={newBusy} onCancel={() => setCreating(false)} onCreate={() => void createWith(newPicked)} />
    <Dialog open={reuse} onClose={() => setReuse(false)} title={s('reuse_title')} width={520} footer={<Button variant="ghost" onClick={() => setReuse(false)}>{tr('common.cancel')}</Button>}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{s('reuse_hint')}</p>
        <input autoFocus type="search" value={reuseQ} onChange={(e) => setReuseQ(e.target.value)} placeholder={s('search')} className={cx(inputCls, 'h-9')} />
        <div className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {!reuseList.length && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{s('reuse_empty')}</p>}
          {reuseList.map((e) => { const accs = entryAccountIds(e, data, 'social', true).map((id) => ctx.channels.find((c) => c.id === id)).filter(Boolean) as Channel[]; return <button key={e.key} type="button" disabled={!!reusing} onClick={() => void copyOpen(e.article.id)} className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-accent disabled:cursor-default disabled:opacity-60">
            <span className="min-w-0 flex-1"><span className="line-clamp-2 text-sm">{titleOf(e)}</span><span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{accs.slice(0, 3).map((c) => { const Icon = CHANNEL_TYPES[c.type]?.icon; return Icon ? <Icon key={c.id} size={13} /> : null })}<span>{ago(e.updatedAt)}</span></span></span>
            {reusing === e.article.id && <Loader2 className="size-4 animate-spin" />}</button> })}
        </div>
      </div>
    </Dialog>
  </div>
}

// ---- 平台上直接发的帖子（只读） ----

/**
 * 采集时发现的、不属于任何内容的帖子：照已发布的样子只读显示（数据、正文、媒体），不用先「并入」。
 * 能直接再用：「复用」复制成一条新草稿；「让 AI 照这条再写一条」复制后交给 revise-article 重写。「并入内容」在「更多」里（确实是同一条内容的另一版时用）
 */
function PlatformPostView({ ctx, post, data, reload, onDraft, onAdopt }: { ctx: Ctx; post: any; data: ContentData; reload: () => void; onDraft: (articleId: string) => void; onAdopt: () => void }) {
  const ch = ctx.channels.find((c) => c.id === post.channel_id)
  const Icon = ch && CHANNEL_TYPES[ch.type]?.icon
  const reviser = useTask('revise-article', reload)
  const [busy, setBusy] = useState<'' | 'copy' | 'ai'>('')
  const reuse = async (ai: boolean) => {
    setBusy(ai ? 'ai' : 'copy')
    try {
      const r = await runLocal<{ article_id: string }>('content-workspace.reusePost', { post_id: post.id })
      if (ai) await reviser.run({ article_id: r.article_id, note: s('ai_again_note') })
      else toast(s('copied'))
      onDraft(r.article_id)
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy('') }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
      <span className="flex min-w-0 items-center gap-1.5 rounded-xl bg-muted px-2.5 py-1.5 text-xs font-semibold">{Icon && <Icon size={14} />}<span className="max-w-40 truncate">{ch?.name || tr('content.removed_channel')}</span></span>
      <Badge tone="default">{s('from_platform')}</Badge>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" fn="content-workspace.reusePost" disabled={!!busy} onClick={() => void reuse(false)}>{busy === 'copy' ? <Loader2 className="animate-spin" /> : <Repeat2 />}{s('reuse_post')}</Button>
        <Button size="sm" fn="content-workspace.reusePost" disabled={!!busy || !reviser.task} onClick={() => void reuse(true)}>{busy === 'ai' ? <Loader2 className="animate-spin" /> : <Sparkles />}{s('ai_again')}</Button>
        <RowMore items={[{ label: s('adopt'), icon: <Link2 className="size-4" />, onSelect: onAdopt }]} />
      </div>
    </div>
    <SentContent ctx={ctx} post={post} data={data} onChanged={reload} hint={false} />
  </div>
}

// ---- 右边的编辑器 ----

const MAX_ITEMS = 20

function SocialEditor({ ctx, a, posts, pubs, data, fallback, onChanged, onDeleted, onFull }: { onFull: () => void; fallback: string[]; ctx: Ctx; a: Article; posts: any[]; pubs: any[]; data: ContentData; onChanged: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState<ArticleDraft>(() => draftOf(a))
  const saved = useRef<ArticleDraft>(draft)
  // 图片、视频（按顺序，可以多个、混放）；draft 里的 images、video、video_cover 是从它算出来的（插件和发布只认那几个）
  const [items, setItems] = useState<MediaItem[]>(() => itemsOf(a))
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [err, setErr] = useState('')
  // 正在上传的占位：粘贴、拖进来的文件一进来就先占一格（图片先显示本机预览），传完换成真的
  const [pending, setPending] = useState<{ id: string; kind: 'image' | 'video'; name: string; pct?: number; src?: string }[]>([])
  const upload = pending.length > 0
  const [picking, setPicking] = useState(false)
  const [coverFor, setCoverFor] = useState<number | null>(null)
  const [zoom, setZoom] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const reviser = useTask('revise-article', onChanged)
  const revising = (reviser.task?.running ?? []).some((r) => r.input?.article_id === a.id)

  // 已发布的账号（页签只读，显示当时发出去的那一版）、没发的账号（照常编辑、发布）
  const sentPosts = posts.filter((p) => p.status === 'published')
  const sentIds = new Set(sentPosts.map((p) => String(p.channel_id)))
  const sentPostOf = (id: string) => sentPosts.filter((p) => p.channel_id === id).sort((x, y) => String(y.published_at || '').localeCompare(String(x.published_at || '')))[0]
  const mark = (id: string) => (sentIds.has(id) ? 'sent' : posts.some((p) => p.channel_id === id && p.status === 'scheduled') ? 'sched' : posts.some((p) => p.channel_id === id && p.status === 'failed') ? 'failed' : '')
  // 有视频就是视频，否则是图文：一条内容只能是其中一种（文章表的 type）
  const type = draft.video ? 'video' : 'post'
  const set = <K extends keyof ArticleDraft>(k: K, v: ArticleDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  // 发到哪些账号（第一个是主账号，文案存在文章自己的 title、body、tags 里）和各账号单独改过的文字（variants，没有 key 就是跟随主文案）
  // 老草稿没有记录要发的账号：按发布记录、目标平台推断，再不行用上次新建用的账号；补上后自动存进文章
  const [targets, setTargets] = useState<string[]>(() => { const g = guessTargets(a, posts, ctx.channels); return g.length ? g : fallback })
  const [variants, setVariants] = useState<Record<string, Variant>>(() => variantsOf(a))
  const [active, setActive] = useState(() => (guessTargets(a, posts, ctx.channels)[0] || fallback[0] || ''))
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ text: string; run: () => void } | null>(null)
  const metaSaved = useRef(JSON.stringify([targetsOf(a), variants, items]))
  const accounts = socialAccounts(ctx.channels)
  const tabAccounts = targets.map((id) => accounts.find((c) => c.id === id)).filter(Boolean) as Channel[]
  const cur = tabAccounts.find((c) => c.id === active) || tabAccounts[0]
  const curId = cur?.id || ''
  const isMain = !curId || curId === tabAccounts[0]?.id
  const variant = !isMain ? variants[curId] : undefined
  const following = !isMain && !variant
  const body = variant ? variant.body : draft.body
  const tagsText = variant ? variant.tags : draft.tags
  // 图片、视频：默认所有账号共用；非主账号可以「图片和视频也单独设置」（variant.media）
  const media: MediaItem[] = variant?.media ?? items
  const mediaTarget = variant?.media ? curId : ''
  const curType = media.some((i) => i.kind === 'video') ? 'video' : 'post'
  const updateMedia = (target: string, fn: (m: MediaItem[]) => MediaItem[]) => (target
    ? setVariants((m) => (m[target] ? { ...m, [target]: { ...m[target], media: fn(m[target].media ?? items) } } : m))
    : setItems(fn))
  useEffect(() => {
    const l = legacyOf(items)
    setDraft((d) => (d.video === l.video && d.video_cover === l.video_cover && JSON.stringify(d.images) === JSON.stringify(l.images) ? d : { ...d, ...l }))
  }, [items])
  const setBody = (v: string) => (variant ? setVariants((m) => ({ ...m, [curId]: { ...m[curId], body: v } })) : set('body', v))
  const setTagsText = (v: string) => (variant ? setVariants((m) => ({ ...m, [curId]: { ...m[curId], tags: v } })) : set('tags', v))

  // 打开了就不再是新的
  useEffect(() => { if (a.unread) void dbPatch('articles', a.id, { unread: false }).then(onChanged).catch(() => {}) }, [a.id])
  // 表里这篇在别处变了（AI 改完）：这边没动过就换成新的
  useEffect(() => {
    const now = draftOf(a)
    if (sameDraft(now, saved.current)) return
    if (sameDraft(draft, saved.current)) { saved.current = now; setDraft(now); setItems(itemsOf(a)) }
  }, [a.updated_at])

  // 自动保存：停手 0.8 秒存一次。没写标题的取正文第一句，发布和列表都要有标题
  const save = useCallback(async (d: ArticleDraft) => {
    setState('saving')
    try {
      const t = d.video ? 'video' : 'post'
      const title = d.title.trim() || firstLine(d.body)
      await dbPatch('articles', a.id, { ...patchOf({ ...d, title }, t), type: t, updated_at: new Date().toISOString() } as Partial<Article>)
      saved.current = d
      setState('saved'); setErr('')
      onChanged()
      void syncSchedule()
    } catch (e) { setState('error'); setErr((e as Error).message) }
  }, [a.id])
  useEffect(() => {
    if (sameDraft(draft, saved.current)) return
    setState('saving')
    const t = setTimeout(() => void save(draft), 800)
    return () => clearTimeout(t)
  }, [draft])
  // 排期中的内容改了：到点要按最新的发，改完重新备好排期的帖子（publish.prepare 同一个时间再排一次）；有问题的会退回草稿，报出来
  const postsRef = useRef(posts)
  postsRef.current = posts
  const syncSchedule = async () => {
    const sched = postsRef.current.filter((p) => p.status === 'scheduled')
    if (!sched.length) return
    const byAt = new Map<string, string[]>()
    for (const p of sched) byAt.set(String(p.scheduled_at), [...(byAt.get(String(p.scheduled_at)) ?? []), String(p.channel_id)])
    try {
      for (const [at, ids] of byAt) {
        const r = await runLocal<{ problems: { channel_id: string; problems: string[] }[] }>('publish.prepare', { article_id: a.id, channel_ids: ids, scheduled_at: at })
        if (r.problems.length) toast(r.problems.flatMap((x) => x.problems).join('；') + ' ' + s('sched_reverted'), 'error')
      }
      onChanged()
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const saveMeta = async () => {
    const key = JSON.stringify([targets, variants, items])
    if (key === metaSaved.current) return
    setState('saving')
    try {
      const first = ctx.channels.find((c) => c.id === targets[0])
      await dbPatch('articles', a.id, { targets: JSON.stringify(targets), variants: JSON.stringify(variants), media: JSON.stringify(items), ...legacyOf(items), images: JSON.stringify(legacyOf(items).images), type: items.some((i) => i.kind === 'video') ? 'video' : 'post', target_account_id: targets[0] || '', target_platform: first?.type || '', updated_at: new Date().toISOString() } as Partial<Article>)
      metaSaved.current = key
      setState('saved'); setErr('')
      onChanged()
      void syncSchedule()
    } catch (e) { setState('error'); setErr((e as Error).message) }
  }
  useEffect(() => {
    if (JSON.stringify([targets, variants, items]) === metaSaved.current) return
    setState('saving')
    const t = setTimeout(() => void saveMeta(), 800)
    return () => clearTimeout(t)
  }, [targets, variants, items])
  const flush = async () => { if (!sameDraft(draft, saved.current)) await save(draft); await saveMeta() }

  // 改账号：取消勾选一个单独改过的账号（或换掉主文案），它那一版文字会丢，先确认
  const differs = (id: string) => !!variants[id] && (variants[id].body !== draft.body || variants[id].tags !== draft.tags || (!!variants[id].media && JSON.stringify(variants[id].media) !== JSON.stringify(items)))
  const applyTargets = (next: string[]) => {
    let d = draft
    const v = { ...variants }
    const oldMain = targets[0], newMain = next[0]
    if (newMain && newMain !== oldMain && v[newMain]) {
      // 新的主账号有自己的版本：它的文字成为主文案；原来的主账号还在的话，把原来的主文案留给它当单独版本
      const nm = v[newMain].media
      if (oldMain && next.includes(oldMain)) v[oldMain] = { body: d.body, tags: d.tags, ...(nm ? { media: items } : {}) }
      d = { ...d, body: v[newMain].body, tags: v[newMain].tags }
      if (nm) setItems(nm)
      delete v[newMain]
    }
    for (const k of Object.keys(v)) if (!next.includes(k)) delete v[k]
    setDraft(d); setVariants(v); setTargets(next)
    setActive(next.includes(active) ? active : next[0] || '')
  }
  const changeTargets = (next: string[]) => {
    const lost = targets.filter((id) => !next.includes(id) && differs(id))
    const losesMain = !!targets[0] && !next.includes(targets[0]) && !!next[0] && !!variants[next[0]] && !!draft.body.trim()
    if (lost.length || losesMain) setConfirm({ text: s('confirm_drop'), run: () => applyTargets(next) })
    else applyTargets(next)
  }
  const toggleMedia = (own: boolean) => {
    if (own) return setVariants((m) => ({ ...m, [curId]: { ...m[curId], media: items } }))
    const run = () => setVariants((m) => { const n = { ...m[curId] }; delete n.media; return { ...m, [curId]: n } })
    if (variant?.media && JSON.stringify(variant.media) !== JSON.stringify(items)) setConfirm({ text: s('confirm_media'), run })
    else run()
  }
  const toggleFollow = (on: boolean) => {
    if (!on) return setVariants((m) => ({ ...m, [curId]: { body: draft.body, tags: draft.tags } }))
    const run = () => setVariants((m) => { const n = { ...m }; delete n[curId]; return n })
    if (differs(curId)) setConfirm({ text: s('confirm_follow'), run })
    else run()
  }

  // 粘贴、拖进来、选文件：视频存成本机文件（local:）；图片进资料库。有视频时图片当视频封面
  const addFiles = async (files: File[]) => {
    const ok = files.filter((f) => f.type.startsWith('video/') || f.type.startsWith('image/'))
    if (!ok.length) return toast(s('unsupported'), 'error')
    const target = mediaTarget
    const stamp = Date.now()
    const holders = ok.map((f, i) => ({ id: `${stamp}-${i}`, kind: (f.type.startsWith('video/') ? 'video' : 'image') as 'video' | 'image', name: f.name, pct: 0, src: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined, f }))
    setPending((l) => [...l, ...holders.map(({ f, ...h }) => h)])
    const existing = await dbList('assets').catch(() => [] as Asset[])
    // 一个个传，每个先占一格；传完按完成的顺序接在后面（已有的不重复）
    for (const h of holders) {
      try {
        let item: MediaItem | null = null
        if (h.kind === 'video') {
          const r = await uploadLocalFile(h.f, (p) => setPending((l) => l.map((x) => (x.id === h.id ? { ...x, pct: Math.round(p * 100) } : x))))
          item = { kind: 'video', url: r.ref }
        } else {
          const [r] = await uploadAssets([h.f], existing, () => {})
          if (r.status === 'failed' || !r.asset?.url) toast(r.error || s('upload_failed'), 'error')
          else item = { kind: 'image', url: r.asset.url }
        }
        if (item) { const n = item; updateMedia(target, (m) => (m.some((x) => x.url === n.url) ? m : [...m, n].slice(0, MAX_ITEMS))) }
      } catch (e) { toast((e as Error).message, 'error') } finally {
        setPending((l) => l.filter((x) => x.id !== h.id))
        if (h.src) URL.revokeObjectURL(h.src)
      }
    }
  }
  usePasteFiles(!picking && coverFor === null && !asking && !publishing, addFiles, /^(image|video)\//)

  const move = (from: number, to: number) => updateMedia(mediaTarget, (m) => { const n = [...m]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n })
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  // 发布前检查：每个要发的账号，按它那一版的文字算字数、按这种形式查平台收不收、图数
  const splitTags = (x: string) => x.split(/[\s,，#]+/).filter(Boolean)
  const checkRows = tabAccounts.map((ch) => {
    const v = variants[ch.id]
    const text = v ? v.body : draft.body
    const mv = v?.media ?? items
    const l = legacyOf(mv)
    const ty = l.video ? 'video' : 'post'
    const vids = mv.filter((i) => i.kind === 'video').length
    const { length, max } = lengthOn({ ...a, type: ty, body: text, tags: JSON.stringify(splitTags(v ? v.tags : draft.tags)), images: JSON.stringify(l.images), video: l.video }, ch.type)
    const f = fieldsFor(ch.type, ty)
    // 能混放的平台（X）：图片、视频合计不超过 f.media 个；别的一条一个视频、图片和视频不能同发
    const issues = [...(!typePlatforms(ty).includes(ch.type) ? [s('not_take', { type: ty === 'video' ? s('type_video') : s('type_post') })] : []),
      ...(f?.media ? (mv.length > f.media ? [s('too_many_media', { name: ch.name, n: f.media })] : []) : [
        ...(vids > 1 ? [s('multi_video', { name: ch.name, n: vids })] : []),
        ...(vids && l.images.length ? [s('mixed_media', { name: ch.name })] : [])]),
      ...(ty === 'post' && f?.images && l.images.length > f.images ? [s('too_many_images', { name: ch.name, n: f.images })] : [])]
    return { ch, length, max, ok: (!max || length <= max) && !issues.length, own: !!v, issues }
  })
  const chars = [...body].length
  const tagList = splitTags(tagsText)
  const empty = !draft.body.trim() && !items.length
  // 右栏（发布前检查、预览）默认收起，大屏上点按钮浮在编辑区右边、不占宽度；开没开记在这台电脑上
  const [side, setSide] = useState(() => { try { return localStorage.getItem('social_ws.side') === '1' } catch { return false } })
  const barRef = useRef<HTMLDivElement>(null)
  const toggleSide = () => setSide((v) => { try { localStorage.setItem('social_ws.side', v ? '0' : '1') } catch {} ; return !v })

  const publish = async () => { await flush(); setPublishing(true) }
  const startAI = async () => {
    await flush()
    const id = await reviser.run({ article_id: a.id, note: note.trim() })
    if (id) { setAsking(false); setNote('') }
  }
  const draftPost = { ...a, ...patchOf({ ...draft, title: draft.title.trim() || firstLine(draft.body) }, type), type } as Article & { targets?: string; variants?: string }
  draftPost.targets = JSON.stringify(targets.filter((id) => !sentIds.has(id))); draftPost.variants = JSON.stringify(variants); draftPost.media = JSON.stringify(items)

  return <div className={cx('relative flex h-full min-h-0', drag && 'bg-primary/5')}
    onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDrag(true) } }}
    onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
    onDrop={(e) => { setDrag(false); const files = [...e.dataTransfer.files]; if (files.length) { e.preventDefault(); void addFiles(files) } }}>
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={barRef} className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
        <div role="tablist" className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl bg-muted p-1">
          {tabAccounts.map((ch, i) => {
            const Icon = CHANNEL_TYPES[ch.type]?.icon
            return <button key={ch.id} type="button" role="tab" aria-selected={ch.id === curId} onClick={() => setActive(ch.id)} title={ch.name}
              className={cx('flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors', ch.id === curId ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {Icon && <Icon size={14} />}<span className="max-w-28 truncate">{ch.name}</span>
              {i === 0 ? <span className="rounded bg-primary/10 px-1 text-[10px] leading-4 font-bold text-primary-text">{s('main')}</span> : variants[ch.id] && <span title={s('own_version')} className="size-1.5 rounded-full bg-primary" />}
              {mark(ch.id) === 'sent' && <span title={s('mark_sent')}><Check className="size-3.5 text-emerald-600" /></span>}{mark(ch.id) === 'sched' && <span title={s('mark_sched')}><Clock className="size-3.5 text-indigo-600" /></span>}{mark(ch.id) === 'failed' && <span title={s('mark_failed')}><AlertTriangle className="size-3.5 text-red-600" /></span>}
            </button>
          })}
          <button type="button" onClick={() => setAccountsOpen(true)} className="flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"><Plus className="size-3.5" />{tabAccounts.length ? s('accounts') : s('pick_accounts')}</button>
        </div>
        <Badge tone="default">{curType === 'video' ? s('type_video') : s('type_post')}</Badge>
        <span className="ml-2 text-xs text-muted-foreground" aria-live="polite">{state === 'saving' ? s('saving') : state === 'error' ? s('save_failed') : s('saved')}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={empty || revising} onClick={() => setAsking(true)}>{revising ? <Loader2 className="animate-spin" /> : <Sparkles />}{s('ai_edit')}</Button>
          <Button size="sm" disabled={empty || !!upload} onClick={publish}><Send />{s('publish')}</Button>
          <Button variant={side ? 'outline' : 'ghost'} size="sm" className="relative max-xl:hidden" aria-pressed={side} title={s('side_toggle')} aria-label={s('side_toggle')} onClick={toggleSide}>
            <PanelRight />{!empty && checkRows.some((r) => !r.ok) && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-amber-500" />}</Button>
          <RowMore items={posts.length ? [{ label: s('full_detail'), icon: <Layers className="size-4" />, onSelect: onFull }] : []} onDelete={async () => { try { await removeArticle(a, data.posts, data.publications); onDeleted() } catch (e) { toast((e as Error).message, 'error') } }} />
        </div>
      </div>
      <PostStatusBar ctx={ctx} a={a} posts={posts} onChanged={onChanged} />
      {curId && sentIds.has(curId) && sentPostOf(curId) ? <SentContent ctx={ctx} post={sentPostOf(curId)} data={data} onChanged={onChanged} hint={false} /> : <>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {err && <Notice tone="error">{err}</Notice>}
        {!isMain && <button type="button" role="switch" aria-checked={following} onClick={() => toggleFollow(!following)} className="mb-4 inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <span className={cx('relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors', following ? 'bg-primary' : 'bg-muted-foreground/30')}><span className={cx('absolute top-0.5 size-3.5 rounded-full bg-white transition-all', following ? 'left-[14px]' : 'left-0.5')} /></span>
          {s('follow_main', { name: tabAccounts[0]?.name || '' })}<span className="text-xs opacity-70">{following ? s('follow_on') : s('follow_off')}</span>
        </button>}
        {!isMain && !following && <button type="button" role="switch" aria-checked={!!variant?.media} onClick={() => toggleMedia(!variant?.media)} className="mb-4 ml-6 inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <span className={cx('relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors', variant?.media ? 'bg-primary' : 'bg-muted-foreground/30')}><span className={cx('absolute top-0.5 size-3.5 rounded-full bg-white transition-all', variant?.media ? 'left-[14px]' : 'left-0.5')} /></span>
          {s('own_media')}<span className="text-xs opacity-70">{variant?.media ? s('own_media_on') : s('own_media_off')}</span>
        </button>}
        {isMain && <input value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder={s('title_ph')} aria-label={s('title')} className="mb-3 w-full bg-transparent text-lg font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/60" />}
        <textarea autoFocus={isMain} readOnly={following} value={body} onChange={(e) => setBody(e.target.value)} placeholder={s('body_ph')} aria-label={s('body')}
          className={cx('min-h-44 w-full resize-y text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/60', following ? 'rounded-lg bg-muted/50 p-3 text-muted-foreground' : 'bg-transparent')} />
        {following && <p className="mt-1 text-xs text-muted-foreground">{s('follow_hint')}</p>}
        {/* 图和视频 */}
        <div className="mt-3 flex flex-wrap items-start gap-3">
          {media.map((it, i) => <div key={it.url + i} draggable={media.length > 1} className={cx('relative', dragFrom === i && 'opacity-40')}
            onDragStart={() => setDragFrom(i)} onDragOver={(e) => { if (dragFrom !== null) e.preventDefault() }}
            onDrop={(e) => { if (dragFrom !== null) { e.preventDefault(); e.stopPropagation(); if (dragFrom !== i) move(dragFrom, i) } setDragFrom(null) }} onDragEnd={() => setDragFrom(null)}>
            {it.kind === 'image'
              ? <button type="button" onClick={() => setZoom(it.url)} className="block cursor-zoom-in"><img src={fileSrc(it.url)} alt="" draggable={false} className="size-32 rounded-xl border border-border object-cover" /></button>
              : <div className="relative"><video src={videoSrc(it.url)} poster={videoSrc(it.cover) || undefined} controls preload="metadata" className="h-32 max-w-56 rounded-xl border border-border bg-black" />
                <button type="button" onClick={() => setCoverFor(i)} className="absolute top-1.5 left-1.5 cursor-pointer rounded bg-black/60 px-1.5 text-[10px] leading-4 text-white hover:bg-black/80">{it.cover ? s('cover_set') : s('cover_pick')}</button></div>}
            {i === 0 && it.kind === 'image' && <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1 text-[10px] text-white">{s('cover')}</span>}
            <button type="button" aria-label={s('remove')} onClick={() => updateMedia(mediaTarget, (m) => m.filter((_, j) => j !== i))} className="absolute -top-2 -right-2 flex size-6 cursor-pointer items-center justify-center rounded-full bg-foreground text-background opacity-80 hover:opacity-100"><X className="size-3.5" /></button>
          </div>)}
          {pending.map((h) => <div key={h.id} className="relative flex size-32 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40" role="status" aria-label={s('uploading', { name: h.name })}>
            {h.src ? <img src={h.src} alt="" className="absolute inset-0 size-full object-cover opacity-40" /> : <Film className="absolute size-8 opacity-20" />}
            <span className="relative flex flex-col items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-5 animate-spin" />{h.kind === 'video' ? `${h.pct ?? 0}%` : s('uploading_short')}</span>
          </div>)}
          {media.length < MAX_ITEMS && <button type="button" onClick={() => fileRef.current?.click()} className="flex size-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-border text-xs text-muted-foreground hover:bg-muted/40">
            {upload ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}<span>{upload ? s('uploading_short') : s('add_media')}</span></button>}
        </div>
        <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
        <p className="mt-4 text-xs text-muted-foreground">{s('paste_hint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-border px-6 py-2.5 text-xs text-muted-foreground">
        <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 hover:text-foreground" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" />{s('tool_media')}</button>
        <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 hover:text-foreground" onClick={() => setPicking(true)}><Library className="size-4" />{s('tool_library')}</button>
        <label className="inline-flex items-center gap-1.5">#<input value={tagsText} readOnly={following} onChange={(e) => setTagsText(e.target.value)} placeholder={s('tags_ph')} aria-label={s('tags')} className="w-56 bg-transparent outline-none placeholder:text-muted-foreground/60" /></label>
        <span className="ml-auto tabular-nums">{chars}</span>
      </div>
      </>}
    </div>

    {/* 右栏：发布前检查、预览。默认收起，点工具栏的按钮浮出来（不挤编辑区） */}
    {side && <aside style={{ top: (barRef.current?.offsetHeight ?? 56) + 12 }} className="absolute right-3 bottom-3 z-20 hidden w-72 space-y-4 overflow-y-auto rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur xl:block">
      <div className="-mb-2 flex justify-end"><button type="button" aria-label={s('side_close')} title={s('side_close')} onClick={toggleSide} className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button></div>
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">{s('checks')}</h4>
        <div className="space-y-1 rounded-xl border border-border bg-background p-3 text-xs">
          {empty && <p className="text-muted-foreground">{s('checks_empty')}</p>}
          {!empty && !checkRows.length && <p className="text-muted-foreground">{s('checks_no_accounts')}</p>}
          {!empty && checkRows.map((r) => <div key={r.ch.id}>
            <p className="flex items-center gap-1.5"><span className={r.ok ? 'text-emerald-600' : 'text-amber-600'}>{r.ok ? '✓' : '!'}</span><span className="min-w-0 flex-1 truncate">{r.ch.name}</span>
              {r.own && <span className="rounded bg-primary/10 px-1 text-[10px] text-primary-text">{s('own_version')}</span>}<span className="tabular-nums text-muted-foreground">{r.max ? `${r.length} / ${r.max}` : r.length}</span></p>
            {r.issues.map((x) => <p key={x} className="pl-5 text-amber-700">{x}</p>)}
          </div>)}
        </div>
      </div>
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">{s('preview')}</h4>
        <div className="space-y-2 rounded-xl border border-border bg-background p-3 text-xs">
          <p className="line-clamp-6 whitespace-pre-wrap leading-relaxed">{body || <span className="text-muted-foreground">{s('body_ph')}</span>}</p>
          {media[0]?.kind === 'video' ? <video src={videoSrc(media[0].url)} poster={videoSrc(media[0].cover) || undefined} className="max-h-48 w-full rounded-lg bg-black" /> : media[0] && <img src={fileSrc(media[0].url)} alt="" className="max-h-48 w-full rounded-lg object-cover" />}
          {!!tagList.length && <p className="text-sky-600">{tagList.map((x) => '#' + x).join(' ')}</p>}
        </div>
      </div>
    </aside>}

    <AssetPicker open={picking} kind="media" max={MAX_ITEMS - media.length} onClose={() => setPicking(false)} onPick={(_urls, assets) => {
      setPicking(false)
      const add = assets.flatMap((x) => (x.url && (x.kind === 'image' || x.kind === 'video') ? [{ kind: x.kind, url: x.url } as MediaItem] : []))
      updateMedia(mediaTarget, (m) => [...m, ...add.filter((n) => !m.some((x) => x.url === n.url))].slice(0, MAX_ITEMS))
    }} />
    <AssetPicker open={coverFor !== null} kind="image" max={1} onClose={() => setCoverFor(null)} onPick={(urls) => { const at = coverFor; setCoverFor(null); if (at !== null && urls[0]) updateMedia(mediaTarget, (m) => m.map((x, j) => (j === at ? { ...x, cover: urls[0] } : x))) }} />
    <Dialog open={accountsOpen} onClose={() => setAccountsOpen(false)} title={s('acc_title')} width={460} footer={<Button onClick={() => setAccountsOpen(false)}>{s('done')}</Button>}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{s('acc_hint')}</p>
        <AccountList accounts={accounts} picked={targets} onChange={changeTargets} onMain={(id) => changeTargets([id, ...targets.filter((x) => x !== id)])} compact />
      </div>
    </Dialog>
    <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={s('confirm_title')} width={420} footer={<>
      <Button variant="ghost" onClick={() => setConfirm(null)}>{tr('common.cancel')}</Button>
      <Button onClick={() => { confirm?.run(); setConfirm(null) }}>{s('confirm_ok')}</Button></>}>
      <p className="text-sm leading-relaxed">{confirm?.text}</p>
    </Dialog>
    {zoom && <Lightbox src={fileSrc(zoom)} onClose={() => setZoom('')} />}
    <PublishDialog open={publishing} ctx={ctx} article={draftPost} posts={posts} pubs={pubs} scope="social" onClose={() => { setPublishing(false); onChanged() }} onRewrite={() => { setPublishing(false); setAsking(true) }} />
    <Dialog open={asking} onClose={() => setAsking(false)} title={s('ai_edit')} width={520} footer={<>
      <Button variant="ghost" onClick={() => setAsking(false)}>{tr('common.cancel')}</Button>
      <Button disabled={reviser.starting} onClick={startAI}>{reviser.starting ? <Loader2 className="animate-spin" /> : <Sparkles />}{s('ai_go')}</Button></>}>
      <div className="space-y-3">
        <textarea autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={s('ai_ph')} className={cx(inputCls, 'py-2')} />
        {reviser.error && <Notice tone="error">{reviser.error}</Notice>}
      </div>
    </Dialog>
  </div>
}
