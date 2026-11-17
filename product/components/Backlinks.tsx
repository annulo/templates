import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, MessageSquareText, MoreHorizontal, PenLine, Plus, RefreshCw, ScanSearch, Send, Share2, Trash2 } from 'lucide-react'
import Markdown from './Markdown'
import RunButton from './RunButton'
import Select from './Select'
import { TaskButton, TaskRequirements, useTask } from './Task'
import { Badge, Button, Dialog, Field, Notice, Skeleton, cx, inputCls, type Tone } from './ui'
import { openChat, runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import type { Ctx } from './views/types'

type Kind = 'social' | 'b2b' | 'directory' | 'article' | 'forum' | 'other'
type Status = 'planned' | 'applied' | 'live' | 'lost' | 'unknown'
type Link = {
  id: string; kind: Kind; platform: string; source_url: string; target_url: string; anchor?: string; nofollow?: boolean
  status: Status; auto?: boolean; note?: string; checked_at?: string; check_error?: string; created_at: string; domain: string; leads: number
  ai?: boolean; reason?: string; how_to?: string; effort?: 'easy' | 'medium' | 'hard'; paid?: boolean; chat_id?: string
  days_applied?: number; follow_up?: boolean; outreach?: string; outreach_chat_id?: string
}
type Data = { list: Link[]; by_status: Partial<Record<Status, number>>; leads_tracked: boolean }

const KINDS: Kind[] = ['b2b', 'directory', 'article', 'social', 'forum', 'other']
const STATUSES: Status[] = ['live', 'applied', 'planned', 'lost', 'unknown']
const TONE: Record<Status, Tone> = { live: 'ok', applied: 'primary', planned: 'default', lost: 'bad', unknown: 'warn' }
/** tasks/backlink-opportunities.md：AI 联网找能拿到外链的具体地方，存成「打算做」；写法（找多少、偏重哪类）用户可改 */
const IDEAS_TASK = 'backlink-opportunities'
/** tasks/backlink-outreach.md：给一条机会写申请材料（目录、平台要填的介绍）或邀请邮件，只写不发；写好了回到那段对话接着改 */
const OUTREACH_TASK = 'backlink-outreach'

/**
 * 外链（增长计划 → 外链）：先简单做，登记别的网站上指向我们网站的链接，社媒帖子里带了网站链接的自动登记，
 * 每 7 天读一次来源页面看还在不在，按询盘的来源网址看带来了几条询盘（docs/growth-plan.md「外链」）。
 * 「AI 找外链机会」把能拿到外链的地方存成「打算做」，用户去申请了点「已申请」，上线了点「上线了」填上外链所在的页面。
 */
export default function Backlinks({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<Status | ''>('')
  const [going, setGoing] = useState<Link | null>(null)
  const { task, setTask } = useTask(IDEAS_TASK)
  const outreach = useTask(OUTREACH_TASK)
  const load = useCallback(() => {
    runLocal<Data>('backlinks.list', {})
      .then((d) => (setData(d), setError('')))
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(load, [load, ctx.rev])

  const list = (data?.list ?? []).filter((b) => !filter || b.status === filter)
  return (
    <div className="space-y-4">
      <Notice tone="info">{tr('plan.links_desc')}</Notice>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => setFilter(filter === s ? '' : s)} className={cx('cursor-pointer rounded-lg border px-3 py-1.5 text-xs', filter === s ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}>
              {tr(`plan.ls_${s}`)} <span className="font-semibold tabular-nums">{data?.by_status[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TaskRequirements task={outreach.task} onSaved={outreach.setTask} label={tr('plan.links_outreach_req')} title={tr('plan.links_outreach_req_title')} hint={tr('plan.links_outreach_req_hint')} />
          <TaskRequirements task={task} onSaved={setTask} label={tr('plan.links_req')} title={tr('plan.links_req_title')} hint={tr('plan.links_req_hint')} />
          <TaskButton task={IDEAS_TASK} input={{}} onFinished={load} variant="outline" icon={ScanSearch}>{tr('plan.links_find')}</TaskButton>
          <RunButton inline variant="outline" fn="backlinks.sync" input={{}} icon={Share2} onDone={load}>{tr('plan.links_sync')}</RunButton>
          <RunButton inline variant="outline" fn="backlinks.check" input={{}} icon={RefreshCw} onDone={load}>{tr('plan.links_check')}</RunButton>
          <Button size="sm" feedback={false} onClick={() => setAdding(true)}><Plus /> {tr('plan.links_add')}</Button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !list.length ? (
        <Notice>{tr(data.list.length ? 'plan.links_none_filter' : 'plan.links_empty')}</Notice>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {list.map((b) => (
            <Row key={b.id} b={b} onLive={() => setGoing(b)} onChanged={load} />
          ))}
        </div>
      )}
      <LiveDialog link={going} onClose={() => setGoing(null)} onDone={() => (setGoing(null), load())} />
      <AddDialog open={adding} sites={ctx.channels.filter((c) => ['creght_site', 'wordpress', 'website'].includes(c.type))} onClose={() => setAdding(false)} onDone={() => (setAdding(false), load())} />
    </div>
  )
}

/** 去掉协议和结尾的 /，长了留开头 */
const short = (u: string, n = 48) => {
  const t = u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/**
 * 一条外链：右上角只放「下一步」一个按钮（打算做：还没写申请材料就写，写了就标已申请；已申请：上线了），
 * 其余（改申请材料、继续对话、上线了、删除）收进「···」，正文占满整行
 */
function Row({ b, onLive, onChanged }: { b: Link; onLive: () => void; onChanged: () => void }) {
  const open = b.status === 'planned' || b.status === 'applied'
  const set = (patch: Record<string, unknown>) => () => runLocal('backlinks.update', { id: b.id, ...patch }).then(onChanged)
  const remove = () => runLocal('backlinks.remove', { id: b.id }).then(onChanged)
  const writeTask = (variant: 'outline' | 'ghost') => (
    <TaskButton task={OUTREACH_TASK} input={{ id: b.id }} match={(r) => (r.input as any)?.id === b.id} onFinished={onChanged} variant={variant} icon={PenLine}>{tr('plan.links_outreach')}</TaskButton>
  )
  const hasOutreach = !!(b.outreach && b.outreach_chat_id)
  const primary = b.status === 'planned'
    ? (b.outreach ? <RunButton inline variant="outline" fn="backlinks.update" input={{ id: b.id, status: 'applied' }} icon={Send} onDone={onChanged}>{tr('plan.links_mark_applied')}</RunButton> : writeTask('outline'))
    : b.status === 'applied'
      ? <Button variant="outline" size="sm" onClick={onLive}><Check /> {tr('plan.links_mark_live')}</Button>
      : null
  const items: { icon: typeof Check; label: string; onClick: () => void }[] = [
    ...(open && hasOutreach ? [{ icon: PenLine, label: tr('plan.links_outreach_edit'), onClick: () => openChat(b.outreach_chat_id!) }] : []),
    ...(b.status === 'planned' && !b.outreach ? [{ icon: Send, label: tr('plan.links_mark_applied'), onClick: set({ status: 'applied' }) }] : []),
    ...(b.status === 'planned' ? [{ icon: Check, label: tr('plan.links_mark_live'), onClick: onLive }] : []),
    ...(b.chat_id ? [{ icon: MessageSquareText, label: tr('plan.links_chat'), onClick: () => openChat(b.chat_id!) }] : []),
    { icon: Trash2, label: tr('plan.links_remove'), onClick: remove },
  ]
  const meta = [b.ai && tr('plan.links_ai'), b.auto && tr('plan.links_auto'), b.effort && tr(`plan.le_${b.effort}`), b.nofollow && 'nofollow'].filter(Boolean) as string[]
  return (
    <div className="space-y-2 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={TONE[b.status] ?? 'default'}>{tr(`plan.ls_${b.status || 'live'}`)}</Badge>
          <a href={b.source_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline [overflow-wrap:anywhere]">{b.platform || b.domain}</a>
          <span className="text-xs text-muted-foreground">
            {[tr(`plan.lk_${b.kind || 'other'}`), ...meta].join(' · ')}
            {b.paid && <span className="text-amber-700 dark:text-amber-400"> · {tr('plan.links_paid')}</span>}
          </span>
          {b.leads > 0 && <Badge tone="ok">{tr('plan.links_leads', { n: b.leads })}</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {primary}
          <RowMenu items={items} />
        </div>
      </div>
      <p className="truncate text-xs text-muted-foreground" title={`${b.source_url}${b.target_url ? ' → ' + b.target_url : ''}`}>
        {short(b.source_url)}
        {b.target_url && <> → {short(b.target_url, 40)}</>}
      </p>
      {b.reason && <p className="text-xs leading-relaxed text-muted-foreground">{b.reason}</p>}
      {b.how_to && open && <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed whitespace-pre-line">{b.how_to}</p>}
      {b.status === 'applied' && b.days_applied !== undefined && (
        <p className={cx('text-xs', b.follow_up ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
          {tr(b.follow_up ? 'plan.links_follow_up' : 'plan.links_applied_days', { n: b.days_applied })}
        </p>
      )}
      {(b.check_error || b.note) && <p className="text-xs text-muted-foreground">{b.check_error || b.note}</p>}
      {b.outreach && (
        <details className="rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">{tr('plan.links_outreach_show')}</summary>
          <div className="mt-2 text-sm"><Markdown text={b.outreach} /></div>
        </details>
      )}
    </div>
  )
}

/** 「···」菜单（照增长计划页的 RowMenu） */
function RowMenu({ items }: { items: { icon: typeof Check; label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <Button size="icon-sm" variant="ghost" feedback={false} aria-label={tr('plan.more')} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-background p-1 shadow-lg">
          {items.map(({ icon: Icon, label, onClick }) => (
            <button key={label} type="button" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted" onClick={() => (setOpen(false), onClick())}>
              <Icon className="size-4" />{label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddDialog({ open, sites, onClose, onDone }: { open: boolean; sites: { id: string; name: string; live_url?: string }[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ source_url: '', kind: 'b2b' as Kind, platform: '', target_url: '', status: 'live' as Status, note: '' })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const site = sites[0]?.live_url ?? ''
  const save = async () => {
    await runLocal('backlinks.add', { ...form, target_url: form.target_url || site })
    setForm({ source_url: '', kind: 'b2b', platform: '', target_url: '', status: 'live', note: '' })
    onDone()
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr('plan.links_add')}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr('common.cancel')}</Button>
          <Button onClick={save} disabled={!/^https?:\/\//.test(form.source_url.trim())}>{tr('plan.links_save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={tr('plan.lf_source')} hint={tr('plan.lf_source_hint')}>
          <input autoFocus value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://" className={inputCls} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr('plan.lf_kind')}>
            <Select value={form.kind} onChange={(v) => set('kind', v)} options={KINDS.map((k) => ({ value: k, label: tr(`plan.lk_${k}`), sub: tr(`plan.lk_${k}_sub`) }))} />
          </Field>
          <Field label={tr('plan.lf_status')}>
            <Select value={form.status} onChange={(v) => set('status', v)} options={(['live', 'applied', 'planned'] as Status[]).map((s) => ({ value: s, label: tr(`plan.ls_${s}`) }))} />
          </Field>
        </div>
        <Field label={tr('plan.lf_platform')}>
          <input value={form.platform} onChange={(e) => set('platform', e.target.value)} placeholder={tr('plan.lf_platform_ph')} className={inputCls} />
        </Field>
        <Field label={tr('plan.lf_target')} hint={site ? tr('plan.lf_target_hint', { site }) : undefined}>
          <input value={form.target_url} onChange={(e) => set('target_url', e.target.value)} placeholder={site || 'https://'} className={inputCls} />
        </Field>
        <Field label={tr('plan.lf_note')}>
          <input value={form.note} onChange={(e) => set('note', e.target.value)} className={inputCls} />
        </Field>
      </div>
    </Dialog>
  )
}

/** 「上线了」：填上外链实际所在的页面（申请时记的多半是申请页、目录首页），之后每周检查读的是它 */
function LiveDialog({ link, onClose, onDone }: { link: Link | null; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    setUrl(link?.source_url ?? '')
    setError('')
  }, [link])
  const save = async () => {
    try {
      await runLocal('backlinks.update', { id: link!.id, status: 'live', source_url: url.trim() })
      onDone()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Dialog
      open={!!link}
      onClose={onClose}
      title={tr('plan.links_live_title', { name: link?.platform || link?.domain || '' })}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr('common.cancel')}</Button>
          <Button onClick={save} disabled={!/^https?:\/\//.test(url.trim())}>{tr('plan.links_save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={tr('plan.lf_source')} hint={tr('plan.links_live_hint')}>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={inputCls} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  )
}
