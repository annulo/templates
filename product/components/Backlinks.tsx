import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, Share2, Trash2 } from 'lucide-react'
import RunButton from './RunButton'
import Select from './Select'
import { Badge, Button, Dialog, Field, Notice, Skeleton, cx, inputCls, type Tone } from './ui'
import { runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import type { Ctx } from './views/types'

type Kind = 'social' | 'b2b' | 'directory' | 'article' | 'forum' | 'other'
type Status = 'planned' | 'live' | 'lost' | 'unknown'
type Link = {
  id: string; kind: Kind; platform: string; source_url: string; target_url: string; anchor?: string; nofollow?: boolean
  status: Status; auto?: boolean; note?: string; checked_at?: string; check_error?: string; created_at: string; domain: string; leads: number
}
type Data = { list: Link[]; by_status: Partial<Record<Status, number>>; leads_tracked: boolean }

const KINDS: Kind[] = ['b2b', 'directory', 'article', 'social', 'forum', 'other']
const STATUSES: Status[] = ['live', 'planned', 'lost', 'unknown']
const TONE: Record<Status, Tone> = { live: 'ok', planned: 'default', lost: 'bad', unknown: 'warn' }

/**
 * 外链（增长计划 → 外链）：先简单做，登记别的网站上指向我们网站的链接，社媒帖子里带了网站链接的自动登记，
 * 每 7 天读一次来源页面看还在不在，按询盘的来源网址看带来了几条询盘（docs/growth-plan.md「外链」）。
 */
export default function Backlinks({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<Status | ''>('')
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
            <div key={b.id} className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[b.status] ?? 'default'}>{tr(`plan.ls_${b.status || 'live'}`)}</Badge>
                  <Badge>{tr(`plan.lk_${b.kind || 'other'}`)}</Badge>
                  <a href={b.source_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline [overflow-wrap:anywhere]">{b.platform || b.domain}</a>
                  {b.nofollow && <span className="text-[11px] text-muted-foreground">nofollow</span>}
                  {b.auto && <span className="text-[11px] text-muted-foreground">{tr('plan.links_auto')}</span>}
                  {b.leads > 0 && <Badge tone="ok">{tr('plan.links_leads', { n: b.leads })}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {b.source_url}
                  {b.target_url && <> → {b.target_url.replace(/^https?:\/\//, '')}</>}
                </p>
                {(b.check_error || b.note) && <p className="text-xs text-muted-foreground">{b.check_error || b.note}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {b.status === 'planned' && (
                  <RunButton inline variant="ghost" fn="backlinks.update" input={{ id: b.id, status: 'live' }} onDone={load}>{tr('plan.links_mark_live')}</RunButton>
                )}
                <RunButton inline variant="ghost" fn="backlinks.remove" input={{ id: b.id }} icon={Trash2} onDone={load}>{tr('plan.links_remove')}</RunButton>
              </div>
            </div>
          ))}
        </div>
      )}
      <AddDialog open={adding} sites={ctx.channels.filter((c) => c.type === 'creght_site' || c.type === 'wordpress')} onClose={() => setAdding(false)} onDone={() => (setAdding(false), load())} />
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
            <Select value={form.status} onChange={(v) => set('status', v)} options={(['live', 'planned'] as Status[]).map((s) => ({ value: s, label: tr(`plan.ls_${s}`) }))} />
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
