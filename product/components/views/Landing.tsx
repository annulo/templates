import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, ArrowUpRight, ChevronDown, ChevronRight, Globe, LayoutTemplate, Loader2, MessageSquareText, Plus, Sparkles, Trash2 } from 'lucide-react'
import Markdown from '../Markdown'
import Select from '../Select'
import { TaskRequirements, useTaskRuns } from '../Task'
import { Badge, Button, Dialog, Field, Notice, PageHeader, Skeleton, cx, fmtTime, inputCls, toast } from '../ui'
import { CHANNEL_TYPES } from '../../lib/channels'
import { tr } from '../../lib/i18n'
import { useTables } from '../../lib/useTables'
import { dbDelete, dbList, dbPatch, isSite, openChat, runLocal, runTask, type Channel, type LandingPage, type Product } from '../../lib/shuttle'
import type { Ctx } from './types'
import { localeName } from '../ArticleLanguages'

// 落地页（网站下单独一页）：为一个目标单独做的页面。新建时写这页要做什么，交给助手照任务 tasks/landing-page.md
// 写简报、直接改网站代码、推到预览；要改、要上线都回到做它的那段对话（「继续对话」），不在这里弹框收意见。记录在 landing_pages（local/landing.ts）。

export const LANDING_TASK = 'landing-page'

const STATUS_TONE = { planning: 'primary', preview: 'warn', live: 'ok', archived: 'default' } as const

/** 网站开的语言（渠道表的 locales）：两种以上才是多语言网站 */
const siteLocales = (ch?: Channel): { locales: string[]; def: string } | null => {
  const c = ch as (Channel & { locales?: string; default_locale?: string }) | undefined
  if (c?.type !== 'creght_site') return null
  const locales = parseIds(c.locales)
  return locales.length > 1 ? { locales, def: locales.includes(c.default_locale ?? '') ? c.default_locale! : locales[0] } : null
}
const parseUrls = (s?: string): Record<string, { preview?: string; live?: string }> => {
  try {
    const v = JSON.parse(s || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function parseIds(s?: string): string[] {
  try {
    const v = JSON.parse(s || '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export default function Landing({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const sites = ctx.channels.filter(isSite)
  const [list, setList] = useState<LandingPage[] | null>(null)
  const [products, setProducts] = useState<Product[] | null>(null) // null：这个模板没有产品表
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const load = useCallback(() => {
    dbList('landing_pages')
      .then((l) => { setList([...l].sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')))); setError('') })
      .catch((e: Error) => { if (/没有这张表|table not found/i.test(e.message)) setList([]); else setError(e.message) })
  }, [])
  useEffect(load, [load])
  useEffect(() => { if (ctx.rev) load() }, [ctx.rev])
  // 助手在对话里存了进度（landing.save）就重读
  useTables(['landing_pages'], load)
  useEffect(() => { dbList('products').then((p) => setProducts(p.filter((x) => x.status !== 'hidden'))).catch(() => setProducts(null)) }, [])
  const { tasks, runs, setTask, reload } = useTaskRuns([LANDING_TASK], () => true, load)
  const task = tasks.find((t) => t.id === LANDING_TASK) ?? null

  const shown = (list ?? []).filter((p) => showArchived || p.status !== 'archived')
  const archived = (list ?? []).filter((p) => p.status === 'archived').length
  const open = params.page ?? ''

  return (
    <div className="space-y-6">
      <PageHeader title={tr('landing.title')} desc={tr('landing.desc')} actions={sites.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <TaskRequirements task={task} onSaved={setTask} title={tr('landing.req_title')} hint={tr('landing.req_hint')} />
          <Button size="sm" needsShuttle onClick={() => setCreating(true)}><Plus />{tr('landing.new')}</Button>
        </div>
      )} />
      {error && <Notice tone="error">{error}</Notice>}
      {list === null ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !sites.length ? (
        <Empty text={tr('landing.no_site')} action={<Button size="sm" onClick={() => ctx.go('channels')}><Globe />{tr('landing.add_site')}</Button>} />
      ) : !shown.length ? (
        <Empty text={tr('landing.empty')} action={<Button size="sm" needsShuttle onClick={() => setCreating(true)}><Plus />{tr('landing.new')}</Button>} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {shown.map((p) => (
            <Row key={p.id} p={p} site={sites.find((s) => s.id === p.channel_id)} products={products ?? []} running={runs.find((r) => (r.input as any)?.id === p.id)?.chat_id}
              expanded={open === p.id} onToggle={() => setParam('page', open === p.id ? '' : p.id)} onChanged={() => { load(); reload() }} />
          ))}
        </div>
      )}
      {archived > 0 && <button type="button" onClick={() => setShowArchived((v) => !v)} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{showArchived ? tr('landing.hide_archived') : tr('landing.show_archived', { n: archived })}</button>}
      <LandingDialog open={creating} sites={sites} products={products} onClose={() => setCreating(false)} onStarted={() => { setCreating(false); load(); reload() }} />
    </div>
  )
}

function Empty({ text, action }: { text: string; action: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
      <LayoutTemplate className="mx-auto size-6 text-muted-foreground" />
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{text}</p>
      <div className="mt-4">{action}</div>
    </div>
  )
}

function Row({ p, site, products, running, expanded, onToggle, onChanged }: { p: LandingPage; site?: Channel; products: Product[]; running?: string; expanded: boolean; onToggle: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState('')
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await f(); onChanged() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const link = p.status === 'live' ? p.url : p.preview_url || p.url
  // 多语言网站：每种语言一个地址（landing.save 按默认语言的地址加前缀算好）
  const locales = parseIds(p.locales)
  const urls = parseUrls(p.urls)
  const localeLinks = locales.length > 1 ? locales.map((l) => ({ l, href: p.status === 'live' ? urls[l]?.live : urls[l]?.preview || urls[l]?.live })).filter((x) => x.href) : []
  const names = parseIds(p.product_ids).map((id) => products.find((x) => x.id === id)?.name).filter(Boolean) as string[]
  // 找不到原来的对话（老数据、对话删了）：新开一段接着做，任务从表里取上下文
  const resume = () => act(async () => { const r = await runTask(LANDING_TASK, { id: p.id }); openChat(r.chat_id) })
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div className={cx('border-b border-border last:border-b-0', expanded && 'bg-muted/30')}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left">
          <Chevron className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium [overflow-wrap:anywhere]">{p.title || p.goal}</span>
              <Badge tone={STATUS_TONE[p.status] ?? 'default'}>{tr(`landing.status.${p.status}`)}</Badge>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {[site?.name ?? tr('landing.removed_site'), p.path, p.keyword && `「${p.keyword}」`, names.join('、'), fmtTime(p.updated_at || p.created_at)].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 px-2 text-xs text-primary-text hover:underline">{p.status === 'live' ? tr('landing.view_live') : tr('landing.view_preview')}<ArrowUpRight className="size-3" /></a>}
          {localeLinks.length > 1 && localeLinks.slice(1).map((x) => <a key={x.l} href={x.href} target="_blank" rel="noreferrer" title={localeName(x.l)} className="inline-flex h-8 items-center px-1 text-xs text-primary-text hover:underline">{x.l}</a>)}
          {running ? (
            <Button size="sm" variant="outline" onClick={() => openChat(running)}><Loader2 className="animate-spin" />{tr('task.running')} · {tr('task.view')}</Button>
          ) : p.chat_id ? (
            <Button size="sm" variant="outline" needsShuttle onClick={() => openChat(p.chat_id!)}><MessageSquareText />{tr('landing.continue')}</Button>
          ) : p.status !== 'archived' && (
            <Button size="sm" variant="outline" needsShuttle disabled={busy} onClick={resume}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{tr('landing.resume')}</Button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="space-y-4 px-4 pb-4 pl-10">
          <dl className="grid gap-2 text-sm sm:grid-cols-[6rem_1fr]">
            <dt className="text-muted-foreground">{tr('landing.f_goal')}</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{p.goal}</dd>
            {p.note && <><dt className="text-muted-foreground">{tr('landing.f_note')}</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{p.note}</dd></>}
            {p.summary && <><dt className="text-muted-foreground">{tr('landing.f_summary')}</dt><dd className="[overflow-wrap:anywhere]">{p.summary}</dd></>}
            {p.live_at && <><dt className="text-muted-foreground">{tr('landing.f_live')}</dt><dd>{fmtTime(p.live_at)}</dd></>}
            {locales.length > 1 && <><dt className="text-muted-foreground">{tr('landing.f_locales')}</dt><dd className="flex flex-wrap gap-x-3 gap-y-1">{locales.map((l) => {
              const href = localeLinks.find((x) => x.l === l)?.href
              return href ? <a key={l} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary-text hover:underline">{localeName(l)}<ArrowUpRight className="size-3" /></a> : <span key={l}>{localeName(l)}</span>
            })}</dd></>}
          </dl>
          {p.brief ? (
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{tr('landing.brief')}</h3>
              <Markdown text={p.brief} className="text-sm" />
            </div>
          ) : <p className="text-xs text-muted-foreground">{tr('landing.no_brief')}</p>}
          {p.status !== 'live' && p.status !== 'archived' && p.preview_url && <p className="text-xs text-muted-foreground">{tr('landing.go_live_hint')}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            {p.status === 'archived'
              ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => dbPatch('landing_pages', p.id, { status: p.url ? 'live' : p.preview_url ? 'preview' : 'planning', updated_at: new Date().toISOString() }))}><ArchiveRestore />{tr('landing.unarchive')}</Button>
              : <Button size="sm" variant="ghost" disabled={busy} title={tr('landing.archive_hint')} onClick={() => act(() => dbPatch('landing_pages', p.id, { status: 'archived', updated_at: new Date().toISOString() }))}><Archive />{tr('landing.archive')}</Button>}
            <Button size="sm" variant="ghost" disabled={busy || !!running} title={tr('landing.delete_hint')} onClick={() => (confirmDel ? act(() => dbDelete('landing_pages', p.id)) : setConfirmDel(true))} className="text-muted-foreground hover:text-destructive">
              <Trash2 />{confirmDel ? tr('landing.delete_confirm') : tr('landing.delete')}
            </Button>
          </div>
          {err && <Notice tone="error">{err}</Notice>}
        </div>
      )}
    </div>
  )
}

/** 从别的地方做落地页时带进来的来源：产品、关键词、选题、增长机会，和一句建议的目标（用户能改） */
export type LandingPreset = { product_ids?: string[]; keyword?: string; keyword_id?: string; topic_id?: string; opportunity_id?: string; goal?: string; note?: string; channel_id?: string }

/** 这条来源已经做过的落地页（同一个关键词、选题、增长机会，或者推的产品一样），弹框里列出来，免得重复做 */
function sameSource(p: LandingPage, x: LandingPreset) {
  if (p.status === 'archived') return false
  if (x.keyword_id && p.keyword_id === x.keyword_id) return true
  if (x.topic_id && p.topic_id === x.topic_id) return true
  if (x.opportunity_id && p.opportunity_id === x.opportunity_id) return true
  const ids = x.product_ids ?? []
  return !x.keyword_id && !x.topic_id && !x.opportunity_id && ids.length > 0 && ids.every((id) => parseIds(p.product_ids).includes(id))
}

/**
 * 新建落地页的弹框：选网站、写这页要做什么（必填），可选推哪些产品、主关键词、其他要求；建一条记录再交给助手。
 * 从产品、关键词、选题上点「做落地页」时带着 preset：来源和建议的目标预先填好。
 */
export function LandingDialog({ open, sites, products, preset, onClose, onStarted }: { open: boolean; sites: Channel[]; products: Product[] | null; preset?: LandingPreset; onClose: () => void; onStarted: () => void }) {
  const [site, setSite] = useState('')
  const [goal, setGoal] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
  const [note, setNote] = useState('')
  const [langs, setLangs] = useState<string[]>([])
  const [existing, setExisting] = useState<LandingPage[]>([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const x = preset ?? {}
    setSite((s) => (x.channel_id && sites.some((c) => c.id === x.channel_id) ? x.channel_id : sites.some((c) => c.id === s) ? s : sites[0]?.id ?? ''))
    setGoal(x.goal ?? ''); setPicked(x.product_ids ?? []); setKeyword(x.keyword ?? ''); setNote(x.note ?? ''); setError(''); setExisting([]); setLangs([])
    if (preset) dbList('landing_pages').then((l) => setExisting(l.filter((p) => sameSource(p, x)))).catch(() => {})
  }, [open])
  const start = async () => {
    setStarting(true); setError('')
    try {
      const x = preset ?? {}
      const { id } = await runLocal<{ id: string }>('landing.create', {
        channel_id: site, goal: goal.trim(), product_ids: picked, keyword: keyword.trim(), note: note.trim(),
        ...(multi ? { locales: chosen } : {}),
        // 关键词改成了别的词，就不算从那个关键词来的
        ...(x.keyword_id && keyword.trim() === (x.keyword ?? '').trim() ? { keyword_id: x.keyword_id } : {}),
        ...(x.topic_id ? { topic_id: x.topic_id } : {}),
        ...(x.opportunity_id ? { opportunity_id: x.opportunity_id } : {}),
      })
      const r = await runTask(LANDING_TASK, { id })
      openChat(r.chat_id)
      toast(tr('landing.started'))
      onStarted()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }
  useEffect(() => setLangs([]), [site])
  const toggle = (id: string) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  // 多语言网站：默认全选；默认语言总要做（页面在默认语言的地址上也要能看），不能取消
  const multi = siteLocales(sites.find((c) => c.id === site))
  const chosen = multi ? (langs.length ? langs : multi.locales) : []
  const toggleLang = (l: string) => setLangs(chosen.includes(l) ? chosen.filter((x) => x !== l) : [...chosen, l])
  return (
    <Dialog open={open} onClose={onClose} title={tr('landing.new')} width={560} footer={<>
      <Button variant="ghost" size="sm" onClick={onClose}>{tr('common.cancel')}</Button>
      <Button size="sm" needsShuttle disabled={starting || !site || !goal.trim()} onClick={start}>{starting ? <Loader2 className="animate-spin" /> : <Sparkles />}{tr('landing.start')}</Button>
    </>}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{tr('landing.new_desc')}</p>
        {existing.length > 0 && (
          <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
            <p className="text-amber-700 dark:text-amber-400">{tr('landing.existing')}</p>
            {existing.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-medium">{p.title || p.goal}</span>
                <Badge tone={STATUS_TONE[p.status] ?? 'default'}>{tr(`landing.status.${p.status}`)}</Badge>
                {p.chat_id && <button type="button" onClick={() => { openChat(p.chat_id!); onClose() }} className="cursor-pointer text-xs text-primary-text hover:underline">{tr('landing.continue')}</button>}
              </div>
            ))}
          </div>
        )}
        {sites.length > 1 && (
          <Field label={tr('landing.f_site')}>
            <Select value={site} onChange={setSite} ariaLabel={tr('landing.f_site')} options={sites.map((s) => {
              const Icon = CHANNEL_TYPES[s.type]?.icon ?? Globe
              return { value: s.id, label: s.name, sub: CHANNEL_TYPES[s.type]?.label, icon: <Icon size={14} className="size-3.5" /> }
            })} />
          </Field>
        )}
        <Field label={tr('landing.f_goal')} hint={tr('landing.goal_hint')}>
          <textarea autoFocus rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={tr('landing.goal_ph')} className={cx(inputCls, 'py-2')} />
        </Field>
        {!!products?.length && (
          <Field group label={tr('landing.f_products')} hint={tr('landing.products_hint')}>
            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {/* 选中的排前面：从产品进来时一眼看到 */}
              {[...products].sort((a, b) => Number(picked.includes(b.id)) - Number(picked.includes(a.id))).map((x) => (
                <button key={x.id} type="button" aria-pressed={picked.includes(x.id)} onClick={() => toggle(x.id)}
                  className={cx('cursor-pointer rounded-full border px-2.5 py-1 text-xs', picked.includes(x.id) ? 'border-primary bg-primary/10 text-primary-text' : 'border-border hover:bg-accent')}>
                  {x.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        {multi && (
          <Field group label={tr('landing.f_locales')} hint={tr('landing.locales_hint')}>
            <div className="flex flex-wrap gap-1.5">
              {multi.locales.map((l) => {
                const on = l === multi.def || chosen.includes(l)
                return (
                  <button key={l} type="button" aria-pressed={on} disabled={l === multi.def} onClick={() => toggleLang(l)}
                    className={cx('cursor-pointer rounded-full border px-2.5 py-1 text-xs disabled:cursor-default', on ? 'border-primary bg-primary/10 text-primary-text' : 'border-border hover:bg-accent')}>
                    {localeName(l)}{l === multi.def && ` · ${tr('langs.default')}`}
                  </button>
                )
              })}
            </div>
          </Field>
        )}
        <Field label={tr('landing.f_keyword')} hint={tr('landing.keyword_hint')}>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className={inputCls} />
        </Field>
        <Field label={tr('landing.f_note')} hint={tr('landing.note_hint')}>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={cx(inputCls, 'py-2')} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  )
}

/**
 * 「做落地页」按钮：放在产品、关键词、选题这些地方，点了在原地弹出新建框（来源和建议的目标预先填好），交给助手后在右侧打开对话。
 * sites 是能选的网站（一般是 ctx.channels.filter(isSite)；关键词这种属于某个网站的只给那一个）。没有网站时不显示（落地页做在网站上）。
 */
export function LandingButton({ sites, preset, onStarted, variant = 'ghost', size = 'sm', className }: { sites: Channel[]; preset: () => LandingPreset; onStarted?: () => void; variant?: 'default' | 'outline' | 'ghost'; size?: 'default' | 'sm'; className?: string }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<LandingPreset>({})
  const [products, setProducts] = useState<Product[] | null>(null)
  if (!sites.length) return null
  const show = () => {
    setCurrent(preset())
    if (products === null) dbList('products').then((p) => setProducts(p.filter((x) => x.status !== 'hidden'))).catch(() => setProducts([]))
    setOpen(true)
  }
  return <>
    <Button variant={variant} size={size} className={className} needsShuttle onClick={show}><LayoutTemplate />{tr('landing.make')}</Button>
    <LandingDialog open={open} sites={sites} products={products} preset={current} onClose={() => setOpen(false)} onStarted={() => { setOpen(false); onStarted?.() }} />
  </>
}
