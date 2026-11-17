import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, GripVertical, LayoutGrid, List, ListOrdered, Loader, MessageSquareText, Package, PenLine, Plus, Search, Sparkles, Trash2, TriangleAlert, Users, X } from 'lucide-react'
import { dbList, isPublishSite, openChat, runLocal, shuttleImage, type Task, type BriefSection, type Product, type Topic, type WritingBrief } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { Button, Notice, cx, inputCls } from './ui'
import type { Ctx } from './views/types'
import { TopicOrigins } from './Origins'
import { LandingButton } from './views/Landing'
import { TaskButton, TaskRequirements, useTask } from './Task'

/** tasks/brief-outline.md：AI 出大纲初稿，存进简报；模板没有这个任务（自媒体）就不显示按钮 */
const OUTLINE_TASK = 'brief-outline'

// 选题的写作简报：整页分步填（写什么 → 关联产品 → 大纲 → 确认开写），改了自动存到选题上（content.saveBrief）。
// 没有产品表的模板（自媒体）没有「关联产品」这一步。大纲按节存在 brief.sections，同时拼成 brief.outline 文字给写作任务读。

const r = (key: string, vars?: Record<string, unknown>) => tr('brief.' + key, vars)
const parse = <T,>(value: string | undefined, fallback: T): T => { try { return JSON.parse(value || '') ?? fallback } catch { return fallback } }

type StepId = 'what' | 'products' | 'outline' | 'review'
type Draft = { title: string; angle: string; keywords: string }
type OutlineAI = { task: Task; setTask: (t: Task) => void; input: () => Promise<unknown>; onFinished: () => void; chatId?: string }

/** 老选题的大纲是一段文字：一行一节，缩进的行接在上一节后面当要点 */
function sectionsFrom(brief: WritingBrief): BriefSection[] {
  if (Array.isArray(brief.sections)) return brief.sections.map((s) => ({ heading: s.heading || '', note: s.note || '', product_ids: s.product_ids || [] }))
  const out: BriefSection[] = []
  for (const raw of String(brief.outline || '').split('\n')) {
    if (!raw.trim()) continue
    const sub = /^(\s{2,}|\t)/.test(raw) && out.length > 0
    const text = raw.trim().replace(/^(#{1,6}\s*|[-*•]\s*|\d+[.、)]\s*)/, '').trim()
    if (!text) continue
    if (sub) out[out.length - 1].note = [out[out.length - 1].note, text].filter(Boolean).join('；')
    else out.push({ heading: text, note: '', product_ids: [] })
  }
  return out
}

function outlineText(sections: BriefSection[], products: Product[]) {
  return sections.filter((s) => s.heading.trim() || s.note?.trim()).map((s, i) => {
    const names = (s.product_ids || []).map((id) => products.find((p) => p.id === id)?.name).filter(Boolean)
    return `${i + 1}. ${s.heading.trim()}${s.note?.trim() ? ' — ' + s.note.trim() : ''}${names.length ? `（${r('outline_products')}: ${names.join(', ')}）` : ''}`
  }).join('\n')
}

const keywordList = (s: string) => s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean)
const firstImage = (p: Product) => parse<string[]>(p.images, [])[0]

/** 卡片上的三格参数：规格的前几行（「排量: 6 mL/r」这种），不够用起订量、价格、交期、认证补 */
function factsOf(p: Product): { k: string; v: string }[] {
  const lines = String(p.specs || '').split(/\n|；|;/).map((l) => l.trim()).filter(Boolean)
  const kv = lines.map((l) => l.match(/^([^:：]{1,16})[:：]\s*(.+)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => ({ k: m[1].trim(), v: m[2].trim() }))
  const extra = [
    p.moq && { k: r('spec_moq'), v: p.moq },
    p.price && { k: r('spec_price'), v: p.price },
    p.lead_time && { k: r('spec_lead'), v: p.lead_time },
    p.certs && { k: r('spec_certs'), v: p.certs },
  ].filter(Boolean) as { k: string; v: string }[]
  return [...kv, ...extra].slice(0, 3)
}

/** 和选题标题、关键词的相关度：关键词整段出现在产品资料里分高，单词命中分低 */
function relevance(p: Product, title: string, keywords: string[]) {
  const text = [p.name, p.model, p.category, p.keywords, p.summary].filter(Boolean).join(' ').toLowerCase()
  let score = 0
  for (const k of keywords) if (k.length > 2 && text.includes(k.toLowerCase())) score += 3
  const words = new Set(`${title} ${keywords.join(' ')}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))
  for (const w of words) if (text.includes(w)) score += 1
  if (p.model && title.toLowerCase().includes(p.model.toLowerCase())) score += 3
  return score
}

/** header：放在标题下面的东西（内容工作区放状态和发布链接）；defaults：没写过简报时的默认值（自媒体不默认英文、官网） */
export function WritingBriefPage({ ctx, topic, onClose, onChanged, onWrite, header, defaults }: { ctx: Ctx; topic: Topic; onClose: () => void; onChanged: () => void; onWrite: () => void; header?: ReactNode; defaults?: Partial<WritingBrief> }) {
  const [draft, setDraft] = useState<Draft>({ title: topic.title, angle: topic.angle || '', keywords: topic.keywords || '' })
  const [brief, setBrief] = useState<WritingBrief>(() => parse(topic.brief, { language: 'English', channels: 'Website, LinkedIn', product_ids: [], ...defaults }))
  const [sections, setSections] = useState<BriefSection[]>(() => sectionsFrom(parse(topic.brief, {} as WritingBrief)))
  const [products, setProducts] = useState<Product[] | null>([]) // null：这个模板没有产品表（自媒体），没有「关联产品」这一步
  const [step, setStep] = useState<StepId>('what')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [busy, setBusy] = useState(false)
  useEffect(() => { dbList('products').then((p) => setProducts(p.filter((x) => x.status !== 'hidden'))).catch(() => setProducts(null)) }, [])

  const steps: StepId[] = products ? ['what', 'products', 'outline', 'review'] : ['what', 'outline', 'review']
  const index = Math.max(0, steps.indexOf(step))
  const picked = (brief.product_ids || []).map((id) => products?.find((p) => p.id === id)).filter(Boolean) as Product[]

  // 改了就存（停手 0.8 秒后）；标题空着不存，content.saveBrief 会拒绝
  const payload = () => ({ topic_id: topic.id, ...draft, brief: { ...brief, sections: sections.filter((s) => s.heading.trim() || s.note?.trim()), outline: outlineText(sections, products || []) } })
  // 只看不改不写：和上次存的（打开时就是选题原样）一样就不存
  const snapshot = () => JSON.stringify([draft, brief, sections])
  const lastSaved = useRef(snapshot())
  const save = async () => {
    if (!draft.title.trim()) return false
    const now = snapshot()
    setSaved('saving')
    try { await runLocal('content.saveBrief', payload()); lastSaved.current = now; setSaved('saved'); setError(''); return true } catch (e) { setSaved('error'); setError((e as Error).message); return false }
  }
  useEffect(() => {
    if (snapshot() === lastSaved.current) return
    const timer = setTimeout(() => { save() }, 800)
    return () => clearTimeout(timer)
  }, [draft, brief, sections])
  // AI 出大纲：先把页面上的存了（AI 要看到选中的产品），跑完从选题上读回新大纲
  const outliner = useTask(OUTLINE_TASK)
  const reloadOutline = async () => {
    const t = (await dbList('topics')).find((x) => x.id === topic.id)
    if (!t) return
    const b = parse(t.brief, {} as WritingBrief)
    const next: WritingBrief = { ...brief, sections: b.sections, outline: b.outline, cta: b.cta ?? brief.cta, gaps: b.gaps ?? brief.gaps, outline_chat_id: b.outline_chat_id }
    const secs = sectionsFrom(b)
    setBrief(next); setSections(secs)
    lastSaved.current = JSON.stringify([draft, next, secs])
  }
  const outlineAI: OutlineAI | undefined = outliner.task ? {
    task: outliner.task, setTask: outliner.setTask, onFinished: reloadOutline, chatId: brief.outline_chat_id,
    input: async () => { if (!(await save())) throw new Error(r('save_first')); return { topic_id: topic.id } },
  } : undefined
  const finish = async (write: boolean) => {
    setBusy(true)
    try {
      if ((write || snapshot() !== lastSaved.current) && !(await save())) return false
      onChanged(); onClose()
      if (write) onWrite()
      return true
    } finally { setBusy(false) }
  }
  const top = useRef<HTMLDivElement>(null)
  const go = (s: StepId) => { setStep(s); top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }

  const label = (s: StepId) => r('step_' + s)
  const kws = keywordList(draft.keywords)
  const filled = [draft.title.trim(), kws.length, brief.audience?.trim(), ...(products ? [picked.length] : []), sections.some((s) => s.heading.trim()), brief.cta?.trim()]
  const percent = Math.round((filled.filter(Boolean).length / filled.length) * 100)

  return (
    <div ref={top} className="@container scroll-mt-4 space-y-6 pb-2">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => finish(false)} className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{r('back')}</button>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {saved === 'saving' ? <><Loader className="size-3 animate-spin" />{r('saving')}</> : saved === 'error' ? <span className="text-destructive">{r('save_failed')}</span> : saved === 'saved' ? <><span className="size-1.5 rounded-full bg-emerald-500" />{r('saved')}</> : null}
          </span>
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary-text">{r('kicker')}</span>
            {brief.language && <span className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">{brief.language}</span>}
          </div>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]">{draft.title.trim() || r('untitled')}</h1>
          <p className="text-sm text-muted-foreground">{r('page_sub')}</p>
        </div>
        {/* 步骤条：随时点哪一步都行 */}
        <ol className="flex overflow-x-auto border-b border-border">
          {steps.map((s, i) => {
            const state = i < index ? 'done' : i === index ? 'on' : 'todo'
            return (
              <li key={s} className="flex min-w-44 flex-1 items-center">
                <button type="button" onClick={() => go(s)} className={cx('relative flex cursor-pointer items-center gap-2.5 py-3 pr-2 text-left', state === 'on' && 'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary')}>
                  <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition',
                    state === 'on' ? 'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15' : state === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950' : 'border-border bg-background text-muted-foreground')}>
                    {state === 'done' ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cx('block text-sm font-medium', state === 'todo' && 'text-muted-foreground')}>{label(s)}</span>
                    <span className="block text-xs whitespace-nowrap text-muted-foreground">{r('step_' + s + '_desc')}</span>
                  </span>
                </button>
                {i < steps.length - 1 && <span className={cx('mx-3 hidden h-px flex-1 lg:block', i < index ? 'bg-emerald-200 dark:bg-emerald-900' : 'bg-border')} />}
              </li>
            )
          })}
        </ol>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          {step === 'what' && <WhatStep ctx={ctx} topic={topic} draft={draft} setDraft={setDraft} brief={brief} setBrief={setBrief} />}
          {step === 'products' && products && <ProductsStep products={products} draft={draft} ids={brief.product_ids || []} setIds={(ids) => { setBrief({ ...brief, product_ids: ids }); setSections(sections.map((s) => ({ ...s, product_ids: (s.product_ids || []).filter((id) => ids.includes(id)) }))) }} />}
          {step === 'outline' && <OutlineStep ai={outlineAI} sections={sections} setSections={setSections} picked={picked} brief={brief} setBrief={setBrief} />}
          {step === 'review' && <ReviewStep draft={draft} brief={brief} sections={sections} picked={picked} hasProducts={!!products} go={go} />}
        </div>
        <aside className="space-y-3 @4xl:sticky @4xl:top-4">
          {step === 'review' ? <>
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
              <h3 className="mb-3 text-sm font-semibold">{r('after_title')}</h3>
              <ol className="space-y-2.5">
                {[1, 2, 3].map((n) => <li key={n} className="flex gap-2.5 text-xs leading-relaxed"><span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background text-[11px] font-semibold text-primary-text">{n}</span>{r('after_' + n)}</li>)}
              </ol>
            </div>
            <LandingButton variant="outline" className="w-full" sites={ctx.channels.filter(isPublishSite)} onStarted={onClose} preset={() => ({ topic_id: topic.id, product_ids: brief.product_ids ?? [], keyword: kws[0] ?? '', goal: tr('landing.goal_from_topic', { title: draft.title.trim() || topic.title }) })} />
          </> : (
            // 窄的时候（右侧助手开着）不放简报卡：步骤条已经看得出进度，留宽度给表单
            <div className="hidden @4xl:block"><Summary draft={draft} brief={brief} sections={sections} picked={picked} hasProducts={!!products} percent={percent} /></div>
          )}
          {header && <div className="rounded-xl border border-border bg-background p-4 text-sm">{header}</div>}
        </aside>
      </div>

      {/* 底部操作条：吸在窗口下面 */}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-lg shadow-black/5 backdrop-blur">
        <span className="mr-auto text-xs text-muted-foreground">{r('step_n', { n: index + 1, total: steps.length })}{step === 'products' && picked.length > 0 && ` · ${r('picked_n', { n: picked.length })}`}</span>
        {index > 0 && <Button variant="ghost" feedback={false} onClick={() => go(steps[index - 1])}><ArrowLeft />{r('prev')}</Button>}
        <Button variant="outline" disabled={busy || !draft.title.trim()} onClick={() => finish(false)}>{r('save_later')}</Button>
        {step === 'review'
          ? <Button fn="content.saveBrief" needsShuttle disabled={busy || !draft.title.trim()} onClick={() => finish(true)}><Sparkles />{r('save_and_write')}</Button>
          : <Button feedback={false} onClick={() => go(steps[index + 1])}>{r('next', { name: label(steps[index + 1]) })}<ArrowRight /></Button>}
      </div>
    </div>
  )
}

/** compact：内容多的（产品）头部收紧，多留地方给内容 */
function Card({ icon: Icon, title, desc, action, compact, children }: { icon: typeof PenLine; title: ReactNode; desc?: ReactNode; action?: ReactNode; compact?: boolean; children: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-border bg-background shadow-xs', compact ? 'p-4' : 'p-5')}>
      <div className={cx('flex items-start gap-3', compact ? 'mb-3' : 'mb-4')}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text"><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{title}</h2>{desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}</div>
        {action}
      </div>
      <div className={compact ? 'space-y-3' : 'space-y-4'}>{children}</div>
    </section>
  )
}

function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return <span className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-sm font-medium">{children}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}</span>
}

function WhatStep({ ctx, topic, draft, setDraft, brief, setBrief }: { ctx: Ctx; topic: Topic; draft: Draft; setDraft: (d: Draft) => void; brief: WritingBrief; setBrief: (b: WritingBrief) => void }) {
  const [kw, setKw] = useState('')
  const kws = keywordList(draft.keywords)
  const setKws = (list: string[]) => setDraft({ ...draft, keywords: list.join(', ') })
  const addKw = () => { const v = kw.trim(); if (v && !kws.includes(v)) setKws([...kws, v]); setKw('') }
  const stats = [
    topic.search_impressions ? { v: topic.search_impressions.toLocaleString(), k: r('stat_impressions') } : null,
    topic.search_position ? { v: '#' + Math.round(topic.search_position), k: r('stat_position') } : null,
  ].filter(Boolean) as { v: string; k: string }[]
  return <>
    {stats.length > 0 && (
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-primary/15 bg-gradient-to-r from-primary/5 to-transparent px-4 py-3">
        <div className="min-w-0 flex-1"><div className="text-sm font-medium">{r('from_search')}</div>{topic.search_query && <div className="truncate text-xs text-muted-foreground">{topic.search_query}</div>}</div>
        {stats.map((s) => <div key={s.k} className="border-l border-primary/15 pl-4"><div className="text-lg leading-tight font-semibold text-primary-text">{s.v}</div><div className="text-[11px] text-muted-foreground">{s.k}</div></div>)}
      </div>
    )}
    <TopicOrigins ctx={ctx} topic={topic} />
    <Card icon={PenLine} title={r('what_title')} desc={r('what_desc')}>
      <label className="block"><Label>{r('brief_title')}</Label><input aria-label={r('brief_title')} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={cx(inputCls, 'h-11 text-base font-semibold')} /></label>
      <label className="block"><Label hint={r('angle_hint')}>{r('brief_angle')}</Label><textarea aria-label={r('brief_angle')} rows={Math.min(5, Math.max(2, Math.ceil(draft.angle.length / 70)))} value={draft.angle} onChange={(e) => setDraft({ ...draft, angle: e.target.value })} className={cx(inputCls, 'resize-none py-2 leading-relaxed')} /></label>
      <div>
        <Label hint={r('kw_hint')}>{r('brief_keywords')}</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-input-background p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          {kws.map((k, i) => (
            <span key={k} className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs whitespace-nowrap', i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
              {i === 0 && <span className="opacity-75">{r('kw_main')} ·</span>}{k}
              <button type="button" aria-label={tr('common.delete')} onClick={() => setKws(kws.filter((x) => x !== k))} className="cursor-pointer opacity-60 hover:opacity-100"><X className="size-3" /></button>
            </span>
          ))}
          <input value={kw} onChange={(e) => setKw(e.target.value)} onBlur={addKw} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); addKw() } else if (e.key === 'Backspace' && !kw && kws.length) setKws(kws.slice(0, -1)) }}
            aria-label={r('brief_keywords')} placeholder={kws.length ? r('kw_add') : r('kw_add_first')} className="h-7 min-w-32 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground" />
        </div>
      </div>
    </Card>
    <Card icon={Users} title={r('reader_title')} desc={r('reader_desc')}>
      <div className="grid gap-4 sm:grid-cols-2">
        {(['audience', 'buyer_question'] as const).map((key) => <label key={key} className="block"><Label>{r('brief_' + key)}</Label><textarea aria-label={r('brief_' + key)} rows={3} value={brief[key] || ''} onChange={(e) => setBrief({ ...brief, [key]: e.target.value })} className={cx(inputCls, 'resize-none py-2 leading-relaxed')} /></label>)}
      </div>
    </Card>
  </>
}

function Thumb({ p, className }: { p: Product; className?: string }) {
  const img = firstImage(p)
  return img
    ? <img src={shuttleImage(img)} alt="" className={cx('shrink-0 rounded-md bg-muted object-cover', className)} />
    : <span className={cx('flex shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/10 to-muted text-primary-text/70', className)}><Package className="size-1/2" /></span>
}

/** 产品是网格还是列表，记在本浏览器 */
const VIEW_KEY = 'brief.product_view'

function ProductsStep({ products, draft, ids, setIds }: { products: Product[]; draft: Draft; ids: string[]; setIds: (ids: string[]) => void }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [view, setViewState] = useState<'grid' | 'list'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' } })
  const setView = (v: 'grid' | 'list') => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* 存不了就只这次 */ } }
  // 相关的排前面；只在打开这一步时排一次，勾选时卡片不跳
  const scored = useMemo(() => products.map((p) => ({ p, score: relevance(p, draft.title, keywordList(draft.keywords)) })).sort((a, b) => b.score - a.score), [products])
  const categories = [...new Set(products.map((p) => p.category?.trim()).filter(Boolean) as string[])]
  const query = q.trim().toLowerCase()
  const list = scored.filter(({ p }) => (cat === '__picked' ? ids.includes(p.id) : !cat || p.category?.trim() === cat)
    && (!query || [p.name, p.model, p.category, p.keywords, p.summary].filter(Boolean).join(' ').toLowerCase().includes(query)))
  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  const picked = ids.map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[]
  const tabs = [
    { v: '', l: `${r('all')} ${products.length}` },
    ...(categories.length > 1 ? categories.map((c) => ({ v: c, l: `${c} ${products.filter((p) => p.category?.trim() === c).length}` })) : []),
    { v: '__picked', l: r('picked_only', { n: ids.length }) },
  ]
  return (
    <Card icon={Package} title={r('brief_products')} desc={r('products_desc')} compact>
      {!products.length ? <Notice>{r('products_empty')}</Notice> : <>
        <div className="flex flex-wrap gap-2">
          <div className="flex w-full gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={r('search_ph')} aria-label={r('search_ph')} className={cx(inputCls, 'h-9 pl-9')} />
            </div>
            <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">
              {([['grid', LayoutGrid], ['list', List]] as const).map(([v, Icon]) => <button key={v} type="button" aria-label={r('view_' + v)} title={r('view_' + v)} aria-pressed={view === v} onClick={() => setView(v)} className={cx('flex cursor-pointer items-center rounded-md px-2.5', view === v ? 'bg-background shadow-xs' : 'text-muted-foreground hover:text-foreground')}><Icon className="size-3.5" /></button>)}
            </div>
          </div>
          <div className="flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5">
            {tabs.map((t) => <button key={t.v} type="button" onClick={() => setCat(t.v)} className={cx('cursor-pointer rounded-md px-3 py-1.5 text-xs whitespace-nowrap', cat === t.v ? 'bg-background font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground')}>{t.l}</button>)}
          </div>
        </div>
        {!picked.length ? <p className="text-xs text-muted-foreground">{r('none_picked')} · {r('product_hint')}</p> : <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-xs">
          {<>
            <span className="font-semibold text-primary-text">{r('picked_n', { n: picked.length })}</span>
            {picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-background py-0.5 pr-1.5 pl-0.5 font-medium">
                <Thumb p={p} className="size-6" />{p.name}
                <button type="button" aria-label={tr('common.delete')} onClick={() => toggle(p.id)} className="cursor-pointer text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
              </span>
            ))}
          </>}
          <span className="ml-auto text-muted-foreground">{r('product_hint')}</span>
        </div>}
        {!list.length ? <Notice>{r('no_match')}</Notice> : view === 'list' ? (
          // 列表：一行一个，一屏能看十几个
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {list.map(({ p, score }) => {
              const on = ids.includes(p.id)
              const facts = factsOf(p)
              return (
                <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on} title={p.summary || p.name}
                  className={cx('flex w-full cursor-pointer items-center gap-3 px-3 py-1.5 text-left transition', on ? 'bg-primary/5' : 'hover:bg-muted/50')}>
                  <span className={cx('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/25')}>{on && <Check className="size-3" />}</span>
                  <Thumb p={p} className="size-9" />
                  <span className="w-48 min-w-0 shrink-0">
                    <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{p.name}</span>{score >= 3 && <Sparkles aria-label={r('related')} className="size-3 shrink-0 text-violet-500" />}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[p.model, p.category].filter(Boolean).join(' · ') || '\u00a0'}</span>
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground @2xl:block">{facts.map((x) => `${x.k} ${x.v}`).join('  ·  ') || p.summary}</span>
                </button>
              )
            })}
          </div>
        ) : (
          // 网格：小卡片按宽度自动排，窄的时候也能一行放好几个
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2.5">
            {list.map(({ p, score }) => {
              const on = ids.includes(p.id)
              const facts = factsOf(p)
              const img = firstImage(p)
              return (
                <div key={p.id} className="group relative">
                  <button type="button" onClick={() => toggle(p.id)} aria-pressed={on}
                    className={cx('flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-lg border bg-background text-left transition', on ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-foreground/20 hover:shadow-md')}>
                    <span className="relative block aspect-[4/3] w-full bg-muted/50">
                      {img ? <img src={shuttleImage(img)} alt="" loading="lazy" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center bg-gradient-to-br from-primary/10 via-muted/60 to-background text-primary-text/50"><Package className="size-8" /></span>}
                      {score >= 3 && <span title={r('related_hint')} className="absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-full bg-background/90 px-1.5 py-px text-[10px] font-semibold text-violet-600 shadow-xs dark:text-violet-400"><Sparkles className="size-2.5" />{r('related')}</span>}
                      <span className={cx('absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full border-2 shadow-xs', on ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/25 bg-background/90')}>{on && <Check className="size-3" />}</span>
                    </span>
                    <span className="block px-2.5 pt-2 pb-2.5">
                      <span className="block truncate text-[13px] leading-tight font-semibold">{p.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{p.model || p.category || '\u00a0'}</span>
                      {facts.length > 0 && <span className="mt-1 block truncate text-[11px]" title={facts.map((x) => `${x.k}：${x.v}`).join('\n')}>{facts.slice(0, 2).map((x) => x.v).join(' · ')}</span>}
                    </span>
                  </button>
                  {/* 停一会儿看产品资料：确认写进文章的事实是对的 */}
                  {(p.summary || p.price || p.lead_time || p.url || facts.length > 0) && (
                    <div className="pointer-events-none invisible absolute top-[calc(100%-4px)] left-1/2 z-20 w-64 -translate-x-1/2 rounded-xl border border-border bg-popover p-3.5 text-xs opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-hover:delay-500">
                      <div className="mb-1.5 text-sm font-semibold">{p.name}</div>
                      {p.summary && <p className="line-clamp-4 leading-relaxed text-muted-foreground">{p.summary}</p>}
                      {facts.length > 0 && <div className="mt-2 space-y-0.5">{facts.map((x) => <div key={x.k} className="flex gap-2"><span className="w-12 shrink-0 text-muted-foreground">{x.k}</span><span className="min-w-0">{x.v}</span></div>)}</div>}
                      {(p.price || p.lead_time) && <p className="mt-1.5">{[p.price && `${r('spec_price')} ${p.price}`, p.lead_time && `${r('spec_lead')} ${p.lead_time}`].filter(Boolean).join(' · ')}</p>}
                      {p.url && <p className="mt-1.5 truncate text-primary-text">{p.url}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </>}
    </Card>
  )
}

function OutlineStep({ ai, sections, setSections, picked, brief, setBrief }: { ai?: OutlineAI; sections: BriefSection[]; setSections: (s: BriefSection[]) => void; picked: Product[]; brief: WritingBrief; setBrief: (b: WritingBrief) => void }) {
  // 只有按住拖动把手时整行才能拖，不然在输入框里选字会变成拖动
  const [armed, setArmed] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [attach, setAttach] = useState<number | null>(null)
  const set = (i: number, patch: Partial<BriefSection>) => setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const move = (from: number, to: number) => { const next = [...sections]; const [x] = next.splice(from, 1); next.splice(to, 0, x); setSections(next) }
  return <>
    <Card icon={ListOrdered} title={r('brief_outline')} desc={r('outline_desc')} action={ai && (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <TaskRequirements task={ai.task} onSaved={ai.setTask} label={r('outline_req')} title={r('outline_req_title')} hint={r('outline_req_hint')} />
        {ai.chatId && <Button variant="ghost" size="sm" feedback={false} onClick={() => openChat(ai.chatId!)}><MessageSquareText />{r('outline_chat')}</Button>}
        <TaskButton task={OUTLINE_TASK} beforeRun={ai.input} onFinished={ai.onFinished} variant={sections.length ? 'outline' : 'default'} icon={Sparkles}>{r(sections.length ? 'ai_outline_again' : 'ai_outline')}</TaskButton>
      </div>
    )}>
      <div className="space-y-2">
        {!sections.length && <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">{r(ai ? 'outline_empty_ai' : 'outline_empty')}</p>}
        {sections.map((s, i) => (
          <div key={i} draggable={armed === i}
            onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => { if (dragging === null) return; e.preventDefault(); if (dragging !== i) { move(dragging, i); setDragging(i) } }}
            onDragEnd={() => { setDragging(null); setArmed(null) }}
            className={cx('flex items-start gap-2 rounded-xl border bg-background p-2.5 transition', dragging === i ? 'border-primary/40 opacity-60 shadow-lg' : 'border-border')}>
            <button type="button" aria-label={r('drag')} title={r('drag')} onMouseDown={() => setArmed(i)} onMouseUp={() => setArmed(null)} className="mt-1.5 cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"><GripVertical className="size-4" /></button>
            <span className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">{i + 1}</span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <input aria-label={r('section_heading')} value={s.heading} placeholder={r('section_heading')} onChange={(e) => set(i, { heading: e.target.value })} className="h-8 w-full rounded-md bg-transparent px-1.5 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground hover:bg-muted/50 focus:bg-muted/50" />
              <input aria-label={r('section_note')} value={s.note || ''} placeholder={r('section_note')} onChange={(e) => set(i, { note: e.target.value })} className="h-7 w-full rounded-md bg-transparent px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted/50 focus:bg-muted/50" />
            </div>
            <div className="relative mt-1 flex shrink-0 flex-wrap items-center justify-end gap-1">
              {(s.product_ids || []).map((id) => picked.find((p) => p.id === id)).filter((p): p is Product => !!p).map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 py-0.5 pr-1.5 pl-0.5 text-xs font-medium text-primary-text">
                  <Thumb p={p} className="size-5" /><span className="max-w-28 truncate">{p.model || p.name}</span>
                  <button type="button" aria-label={tr('common.delete')} onClick={() => set(i, { product_ids: (s.product_ids || []).filter((x) => x !== p.id) })} className="cursor-pointer opacity-60 hover:opacity-100"><X className="size-3" /></button>
                </span>
              ))}
              {picked.some((p) => !(s.product_ids || []).includes(p.id)) && (
                <button type="button" onClick={() => setAttach(attach === i ? null : i)} className="cursor-pointer rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary-text">+ {r('attach_product')}</button>
              )}
              {attach === i && (
                <div className="absolute top-full right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg">
                  {picked.filter((p) => !(s.product_ids || []).includes(p.id)).map((p) => (
                    <button key={p.id} type="button" onClick={() => { set(i, { product_ids: [...(s.product_ids || []), p.id] }); setAttach(null) }} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"><Thumb p={p} className="size-6" /><span className="truncate">{p.name}</span></button>
                  ))}
                </div>
              )}
              <button type="button" aria-label={tr('common.delete')} title={tr('common.delete')} onClick={() => setSections(sections.filter((_, j) => j !== i))} className="cursor-pointer rounded-md p-1 text-muted-foreground/60 hover:bg-muted hover:text-destructive"><Trash2 className="size-3.5" /></button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setSections([...sections, { heading: '', note: '', product_ids: [] }])} className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary-text"><Plus className="size-4" />{r('add_section')}</button>
      </div>
    </Card>
    <Card icon={TriangleAlert} title={r('more_title')} desc={r('more_desc')}>
      <div className="grid gap-4 sm:grid-cols-2">
        {(['cta', 'gaps'] as const).map((key) => <label key={key} className="block"><Label hint={key === 'gaps' ? r('gaps_hint') : undefined}>{r('brief_' + key)}</Label><textarea aria-label={r('brief_' + key)} rows={3} value={brief[key] || ''} onChange={(e) => setBrief({ ...brief, [key]: e.target.value })} className={cx(inputCls, 'resize-none py-2 leading-relaxed')} /></label>)}
        {(['language', 'channels'] as const).map((key) => <label key={key} className="block"><Label>{r('brief_' + key)}</Label><input aria-label={r('brief_' + key)} value={brief[key] || ''} onChange={(e) => setBrief({ ...brief, [key]: e.target.value })} className={cx(inputCls, 'h-9')} /></label>)}
      </div>
    </Card>
  </>
}

function ReviewStep({ draft, brief, sections, picked, hasProducts, go }: { draft: Draft; brief: WritingBrief; sections: BriefSection[]; picked: Product[]; hasProducts: boolean; go: (s: StepId) => void }) {
  const kws = keywordList(draft.keywords)
  const outline = sections.filter((s) => s.heading.trim())
  const empty = <span className="text-muted-foreground">{r('not_set')}</span>
  const row = (k: ReactNode, to: StepId, children: ReactNode) => (
    <div className="flex gap-4 border-t border-border px-5 py-3.5 text-sm">
      <div className="w-24 shrink-0 pt-px text-xs text-muted-foreground">{k}</div>
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      <button type="button" onClick={() => go(to)} className="shrink-0 cursor-pointer self-start text-xs font-medium text-primary-text hover:underline">{r('edit')}</button>
    </div>
  )
  return <>
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-xs">
      <div className="bg-gradient-to-b from-primary/5 to-transparent px-5 pt-5 pb-4">
        <h2 className="text-lg leading-snug font-semibold [overflow-wrap:anywhere]">{draft.title}</h2>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {kws[0] && <span>{r('kw_main_is', { k: kws[0] })}</span>}
          {brief.audience && <span className="line-clamp-1">{r('for_reader', { a: brief.audience })}</span>}
        </div>
      </div>
      {row(r('brief_angle'), 'what', draft.angle || empty)}
      {row(r('brief_buyer_question'), 'what', brief.buyer_question || empty)}
      {hasProducts && row(r('brief_products'), 'products', picked.length ? <div className="flex flex-wrap gap-2">{picked.map((p) => {
        const at = sections.map((s, i) => ((s.product_ids || []).includes(p.id) ? i + 1 : 0)).filter(Boolean)
        return <span key={p.id} className="inline-flex items-center gap-2 rounded-lg border border-border py-1 pr-3 pl-1"><Thumb p={p} className="size-9" /><span><span className="block text-xs font-semibold">{p.name}</span><span className="block text-[11px] text-muted-foreground">{at.length ? r('in_sections', { n: at.join(', ') }) : p.model || ' '}</span></span></span>
      })}</div> : empty)}
      {row(r('outline_n', { n: outline.length }), 'outline', outline.length
        ? <ol className="space-y-1">{outline.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold text-muted-foreground">{i + 1}</span><span>{s.heading}</span></li>)}</ol>
        : <span className="text-muted-foreground">{r('outline_auto')}</span>)}
      {row(r('brief_cta'), 'outline', brief.cta || empty)}
      {row(r('brief_channels'), 'outline', [brief.language, brief.channels].filter(Boolean).join(' · ') || empty)}
    </div>
    {brief.gaps?.trim() && (
      <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" /><span>{r('gaps_warn', { g: brief.gaps.trim() })}</span>
      </div>
    )}
  </>
}

function Summary({ draft, brief, sections, picked, hasProducts, percent }: { draft: Draft; brief: WritingBrief; sections: BriefSection[]; picked: Product[]; hasProducts: boolean; percent: number }) {
  const kws = keywordList(draft.keywords)
  const outline = sections.filter((s) => s.heading.trim())
  const item = (k: string, done: boolean, children: ReactNode) => (
    <div className="border-t border-dashed border-border px-4 py-3 text-xs">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cx('size-1.5 rounded-full', done ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />{k}</div>
      <div className={cx('leading-relaxed', !done && 'text-muted-foreground')}>{children}</div>
    </div>
  )
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-xs">
      <div className="flex items-center px-4 pt-3.5 pb-3 text-sm font-semibold">{r('summary')}<span className="ml-auto text-xs font-normal text-muted-foreground">{percent}%</span></div>
      <div className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} /></div>
      {item(r('step_what'), !!draft.title.trim(), <><span className="line-clamp-2 font-medium">{draft.title || r('not_set')}</span>{(kws.length > 0 || brief.audience) && <span className="mt-0.5 line-clamp-1 block text-muted-foreground">{[kws.length ? r('kw_count', { n: kws.length }) : '', brief.audience].filter(Boolean).join(' · ')}</span>}</>)}
      {hasProducts && item(r('brief_products'), picked.length > 0, picked.length ? <span className="flex flex-wrap gap-1.5">{picked.map((p) => <span key={p.id} title={p.name}><Thumb p={p} className="size-9 border border-border" /></span>)}</span> : r('sum_no_products'))}
      {item(r('brief_outline'), outline.length > 0, outline.length ? r('outline_n', { n: outline.length }) : r('outline_auto'))}
      {item(r('brief_cta'), !!brief.cta?.trim(), <span className="line-clamp-2">{brief.cta || r('not_set')}</span>)}
    </div>
  )
}
