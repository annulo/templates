import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clapperboard, Globe, Images, Loader2, MessageSquareText, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button, Notice, Segmented, cx, inputCls, toast } from './ui'
import Select from './Select'
import RunButton from './RunButton'
import { TaskButton, TaskRequirements, useTask, useTaskRuns } from './Task'
import { typePlatforms } from './ArticleTypes'
import { CHANNEL_TYPES } from '../lib/channels'
import { dbList, isSite, openChat, runLocal, type Channel, type ChannelType } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import type { Ctx } from './views/types'

// 新建社媒内容：三步（要做什么 → 方案 → 成片与发布），设计见 docs/social-create.md。
// 状态都存在选题的 brief.social（local/social-create.ts）；第 1 步按用户那句话自动配好平台、形式、风格，要改就点。

const t = (key: string, vars?: Record<string, unknown>) => tr('social_create.' + key, vars)
const TASK = 'social-plan'

type Aspect = '9:16' | '3:4' | '4:3' | '16:9' | '1:1'
type Why = 'said' | 'recommended' | 'picked'
type Format = { type: 'video' | 'post'; duration: number; aspect: Aspect; media: 'record'; subtitles: boolean; music?: string; images: number }
type Screen = { n: number; y: number; file: string; heading?: string; text?: string }
type Shot = { start: number; end: number; screen?: number; y_from?: number; y_to?: number; caption?: string; note?: string; card?: { title: string; subtitle?: string } }
type Copy = { channel_id: string; title?: string; body: string; tags?: string[]; category?: string }
type Plan = { version: number; chat_id?: string; title: string; summary?: string; shots?: Shot[]; images?: { screen: number; title: string; subtitle?: string }[]; cover?: { title: string; subtitle?: string; screen?: number; ratio?: string }; rationale?: string[]; copies: Copy[] }
export type Social = {
  source?: { kind?: string; url?: string; product_id?: string; article_id?: string }
  site?: { url: string; title: string; description?: string; page_height: number; width: number; height: number; screens: Screen[] }
  request?: string
  platforms?: { channel_id: string; type: string; why: Why }[]
  format?: Format
  style?: 'playbook' | 'none' | 'reference'
  playbook_id?: string
  reference_url?: string
  notes?: string
  skip?: number[]
  plan?: Plan
  plans?: Plan[]
  produced?: { article_id: string; version: number; video?: string; cover?: string; images?: string[]; posts?: { channel_id: string; name: string; post_id?: string; problems?: string[]; error?: string }[] }
  touched?: { platforms?: boolean; format?: boolean; style?: boolean }
}
type Playbook = { id: string; name: string; platform?: string; content_type?: string; guide?: string; title_patterns?: { pattern?: string; example?: string }[]; hooks?: { pattern?: string }[]; uses: number }

/** 这条选题是不是「新建社媒内容」做的 */
export function socialOf(topic: any): Social | null {
  try {
    const b = typeof topic?.brief === 'string' ? JSON.parse(topic.brief || '{}') : topic?.brief || {}
    return b.social && typeof b.social === 'object' ? b.social : null
  } catch {
    return null
  }
}

/** 工作目录里的文件在页面上的地址 */
const workUrl = (path?: string) => (path ? '/_annulo/work-files/' + path.split('/').map(encodeURIComponent).join('/') : '')

// ---- 按那句话配平台、形式、风格（确定的规则，不调模型） ----

const NAMES: [ChannelType, RegExp][] = [
  ['xiaohongshu', /小红书|红书|xhs|rednote|xiaohongshu/i], ['douyin', /抖音|douyin|tiktok/i], ['bilibili', /b\s*站|哔哩|bilibili/i],
  ['x', /推特|twitter|(^|[^a-z])x([^a-z]|$)/i], ['linkedin', /领英|linkedin/i], ['youtube', /youtube|油管/i],
  ['facebook', /facebook|脸书|\bfb\b/i], ['instagram', /instagram|\bins\b|\big\b/i], ['zhihu', /知乎|zhihu/i],
]
const WIDE: ChannelType[] = ['bilibili', 'youtube', 'x', 'linkedin', 'facebook', 'zhihu']
const TALL: ChannelType[] = ['douyin', 'xiaohongshu', 'instagram']
const isTall = (a: Aspect) => a === '9:16' || a === '3:4'

type Parsed = { types: ChannelType[]; format?: 'video' | 'post'; duration?: number; aspect?: Aspect; images?: number }
export function parseRequest(text: string): Parsed {
  const s = text || ''
  const types = NAMES.filter(([, re]) => re.test(s)).map(([k]) => k)
  const sec = s.match(/(\d+(?:\.\d+)?)\s*(秒|s\b|sec|seconds?)/i), min = s.match(/(\d+(?:\.\d+)?)\s*(分钟|min)/i)
  const ratio = s.match(/(\d{1,2})\s*[:：比x×]\s*(\d{1,2})/)
  const aspect = ratio && ['9:16', '3:4', '4:3', '16:9', '1:1'].includes(`${ratio[1]}:${ratio[2]}`) ? `${ratio[1]}:${ratio[2]}` as Aspect
    : /竖屏|竖版|vertical/i.test(s) ? '9:16' : /横屏|横版|landscape/i.test(s) ? '16:9' : /方形|square/i.test(s) ? '1:1' : undefined
  const pics = s.match(/(\d+)\s*张/)
  const post = /图文|张图|配图|carousel|轮播/i.test(s), video = /视频|录|剪|video|clip|reel/i.test(s) || !!sec || !!min
  return {
    types, aspect, format: post && !video ? 'post' : video ? 'video' : undefined,
    duration: sec ? Math.round(Number(sec[1])) : min ? Math.round(Number(min[1]) * 60) : undefined,
    images: pics ? Number(pics[1]) : undefined,
  }
}

/** 按那句话和已连的账号配好：用户说到的平台选上，再按形式和画幅推荐一个；没说的形式、画幅按平台推荐 */
function suggest(request: string, accounts: Channel[], cur: Social): Pick<Social, 'platforms' | 'format'> & { why: Record<string, string> } {
  const p = parseRequest(request)
  const touched = cur.touched || {}
  const f0: Format = { type: 'video', duration: 30, aspect: '16:9', media: 'record', subtitles: true, images: 6, ...(cur.format || {}) }
  const type = touched.format ? f0.type : p.format || f0.type
  const supported = new Set(typePlatforms(type))
  const why: Record<string, string> = {}
  let platforms = cur.platforms || []
  if (!touched.platforms) {
    const said = p.types.flatMap((ty) => accounts.filter((a) => a.type === ty).slice(0, 1)).filter((a) => supported.has(a.type))
    platforms = said.map((a) => ({ channel_id: a.id, type: a.type, why: 'said' as Why }))
    const aspectGuess = p.aspect || (said.length && said.every((a) => TALL.includes(a.type)) ? (type === 'post' ? '3:4' : '9:16') : type === 'post' ? '3:4' : '16:9')
    const fit = (a: Channel) => supported.has(a.type) && (isTall(aspectGuess) ? TALL : WIDE).includes(a.type) && !platforms.some((x) => x.type === a.type)
    const extra = accounts.filter(fit).slice(0, said.length ? 1 : 3)
    for (const a of extra) {
      platforms.push({ channel_id: a.id, type: a.type, why: 'recommended' })
      why[a.id] = t(isTall(aspectGuess) ? 'why_tall' : 'why_wide', { platform: CHANNEL_TYPES[a.type]?.label })
    }
  }
  let format = { ...f0, type }
  if (!touched.format) {
    const types = platforms.map((x) => x.type as ChannelType)
    const tall = types.length > 0 && types.every((ty) => TALL.includes(ty))
    format = { ...format, aspect: p.aspect || (type === 'post' ? '3:4' : tall ? '9:16' : '16:9'), duration: p.duration || f0.duration, images: p.images || f0.images }
  }
  return { platforms, format, why }
}

function pickPlaybook(list: Playbook[], social: Social): Playbook | undefined {
  const types = (social.platforms || []).map((p) => p.type)
  const type = social.format?.type || 'video'
  const score = (p: Playbook) => (types.includes(p.platform || '') ? 4 : 0) + (p.content_type === type ? 2 : 0) + Math.min(p.uses, 3) * 0.1
  return [...list].sort((a, b) => score(b) - score(a))[0]
}

// ---- 页面 ----

type Props = { ctx: Ctx; topic: any | null; onCreated: (id: string) => void; onClose: () => void; onChanged: () => void; openArticle: (id: string) => void }
type Step = 'what' | 'plan' | 'produce'

export default function SocialCreate({ ctx, topic, onCreated, onClose, onChanged, openArticle }: Props) {
  const saved = socialOf(topic)
  const [social, setSocial] = useState<Social>(() => saved || { source: { kind: 'url', url: '' }, request: '', style: 'none', format: { type: 'video', duration: 30, aspect: '16:9', media: 'record', subtitles: true, images: 6 } })
  const [title] = useState<string>(topic?.title || '')
  const [step, setStep] = useState<Step>(saved?.produced ? 'produce' : saved?.plan ? 'plan' : 'what')
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null)
  const [why, setWhy] = useState<Record<string, string>>({})
  const [launched, setLaunched] = useState(0) // 刚点了出方案：任务列表几秒后才看得到它，这期间也显示「正在出方案」
  const topicId = useRef<string>(topic?.id || '')
  const creating = useRef<Promise<string> | null>(null)
  const accounts = ctx.channels.filter((c) => !isSite(c) && CHANNEL_TYPES[c.type])

  // 助手存了新方案、函数读完网站、做完成片：表里的 brief.social 变了，换进来（页面上正在改的要求、平台不丢）
  useEffect(() => {
    const s = socialOf(topic)
    if (!s) return
    setSocial((cur) => ({ ...cur, site: s.site, plan: s.plan, plans: s.plans, produced: s.produced, skip: s.skip ?? cur.skip }))
  }, [topic?.brief])
  useEffect(() => { if (topic?.id) topicId.current = topic.id }, [topic?.id])
  useEffect(() => {
    runLocal<{ playbooks: Playbook[] }>('playbooks.list', {}).then((r) => setPlaybooks((r.playbooks || []).filter((p: any) => p.status !== 'archived'))).catch(() => setPlaybooks([]))
  }, [ctx.rev])

  /** 存一下（没有选题先建一个），返回选题 id */
  const persist = async (s: Social = social): Promise<string> => {
    const { site: _site, plan: _plan, plans: _plans, produced: _produced, ...rest } = s
    if (!topicId.current) {
      if (!creating.current) creating.current = runLocal<{ topic_id: string }>('social-create.save', { title, social: rest }).then((r) => { topicId.current = r.topic_id; onCreated(r.topic_id); return r.topic_id })
      return creating.current
    }
    await runLocal('social-create.save', { topic_id: topicId.current, title, social: rest })
    return topicId.current
  }
  // 改了自动存（停手 0.8 秒后）
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!topicId.current && !social.request?.trim() && !social.source?.url?.trim()) return
    const h = window.setTimeout(() => { persist().catch((e) => toast((e as Error).message, 'error')) }, 800)
    return () => clearTimeout(h)
  }, [JSON.stringify({ ...social, site: undefined, plan: undefined, plans: undefined, produced: undefined })])

  // 那句话、风格卡读到了：自动配平台、形式、风格（用户手动改过的那一项不再动）
  useEffect(() => {
    const h = window.setTimeout(() => {
      setSocial((cur) => {
        const next = suggest(cur.request || '', accounts, cur)
        setWhy(next.why)
        let s: Social = { ...cur, platforms: next.platforms, format: next.format }
        if (!cur.touched?.style && playbooks) {
          const pb = pickPlaybook(playbooks, s)
          s = { ...s, style: pb ? 'playbook' : 'none', playbook_id: pb?.id || '' }
        }
        return JSON.stringify(s) === JSON.stringify(cur) ? cur : s
      })
    }, 400)
    return () => clearTimeout(h)
  }, [social.request, playbooks, ctx.channels.length])

  const update = (patch: Partial<Social>, touch?: keyof NonNullable<Social['touched']>) =>
    setSocial((cur) => ({ ...cur, ...patch, ...(touch ? { touched: { ...cur.touched, [touch]: true } } : {}) }))

  const steps: Step[] = ['what', 'plan', 'produce']
  const index = steps.indexOf(step)
  const ready = !!social.site?.screens?.length && !!social.request?.trim() && !!social.platforms?.length
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft />{t('back')}</Button>
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      {social.plan && <span className="text-sm text-muted-foreground">· {social.plan.title}</span>}
      <span className="ml-auto text-xs text-muted-foreground">{t('autosave')}</span>
    </div>
    <ol className="flex items-center rounded-xl border border-border bg-background px-5 py-4">
      {steps.map((s, i) => {
        const done = i < index, cur = i === index
        const can = s === 'what' || (s === 'plan' && !!social.plan) || (s === 'produce' && !!social.produced)
        return <li key={s} className={cx('flex items-center', i < steps.length - 1 && 'flex-1')}>
          <button type="button" disabled={!can && !cur} onClick={() => setStep(s)} className="flex cursor-pointer items-center gap-2.5 text-left disabled:cursor-default">
            <span className={cx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold', done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' : cur ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{done ? <Check className="size-3.5" /> : i + 1}</span>
            <span><span className="block text-sm font-semibold">{t('step_' + s)}</span><span className="block text-xs text-muted-foreground">{t('step_' + s + '_desc')}</span></span>
          </button>
          {i < steps.length - 1 && <span className={cx('mx-4 hidden h-px flex-1 sm:block', done ? 'bg-emerald-200 dark:bg-emerald-900' : 'bg-border')} />}
        </li>
      })}
    </ol>
    {step === 'what' && <WhatStep ctx={ctx} social={social} update={update} why={why} accounts={accounts} playbooks={playbooks} persist={persist} onChanged={onChanged}
      footer={<StepFooter n={1}>
        {!ready && <span className="text-xs text-muted-foreground">{t('not_ready')}</span>}
        <PlanButton social={social} topicId={topicId.current} persist={persist} ready={ready} onChanged={onChanged} onStarted={() => { setLaunched(Date.now()); setStep('plan') }} label={social.plan ? t('replan') : t('make_plan')} />
      </StepFooter>} />}
    {step === 'plan' && <PlanStep social={social} topicId={topicId.current} launched={Date.now() - launched < 15000} onChanged={onChanged} back={() => setStep('what')} persist={persist}
      next={() => setStep('produce')} accounts={accounts} />}
    {step === 'produce' && <ProduceStep social={social} topicId={topicId.current} onChanged={onChanged} back={() => setStep('plan')} openArticle={openArticle} />}
  </div>
}

function StepFooter({ n, children, left }: { n: number; children: ReactNode; left?: ReactNode }) {
  return <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/95 px-4 py-3 backdrop-blur">
    <span className="mr-auto text-xs text-muted-foreground">{t('step_n', { n })} · {t('no_publish_before')}</span>
    {left}
    {children}
  </div>
}

/** 「让 AI 出方案」：先存，再开一段对话交给助手（任务 tasks/social-plan.md） */
function PlanButton({ social, topicId, persist, ready, onStarted, onChanged, label }: { social: Social; topicId: string; persist: (s?: Social) => Promise<string>; ready: boolean; onStarted: () => void; onChanged: () => void; label: string }) {
  const [req, setReq] = useState(false)
  const plan = useTask(TASK)
  return <>
    {plan.task && <Button variant="ghost" size="sm" onClick={() => setReq(true)}>{t('ai_requirements')}</Button>}
    <TaskButton task={TASK} disabled={!ready} icon={Sparkles} size="default" onFinished={onChanged}
      match={(r) => !!topicId && r.input?.topic_id === topicId}
      beforeRun={async () => { const id = await persist(social); onStarted(); return { topic_id: id } }}>{label}</TaskButton>
    <TaskRequirements task={plan.task} onSaved={plan.setTask} title={t('ai_requirements')} hint={t('ai_requirements_hint')} open={req} onOpenChange={setReq} />
  </>
}

// ---- 第 1 步：要做什么 ----

function WhatStep({ ctx, social, update, why, accounts, playbooks, persist, onChanged, footer }: {
  ctx: Ctx; social: Social; update: (p: Partial<Social>, touch?: 'platforms' | 'format' | 'style') => void; why: Record<string, string>; accounts: Channel[]
  playbooks: Playbook[] | null; persist: (s?: Social) => Promise<string>; onChanged: () => void; footer: ReactNode
}) {
  const [url, setUrl] = useState(social.source?.url || social.site?.url || '')
  const [reading, setReading] = useState(''), [readErr, setReadErr] = useState('')
  const skip = new Set(social.skip || [])
  const read = async () => {
    const u = url.trim()
    if (!/^https?:\/\//i.test(u)) { setReadErr(t('url_invalid')); return }
    setReadErr(''); setReading(t('reading'))
    try {
      const next = { ...social, source: { ...social.source, kind: 'url', url: u } }
      update({ source: next.source })
      const id = await persist(next)
      await runLocal('social-create.readSite', { topic_id: id, url: u }, (e) => { if (e.type === 'progress' && e.data.message) setReading(e.data.message) })
      onChanged()
    } catch (e) { setReadErr((e as Error).message) } finally { setReading('') }
  }
  const site = social.site
  return <>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-5 rounded-xl border border-border bg-background p-5">
        <div className="space-y-2">
          <h2 className="font-semibold">{t('source')}</h2>
          <p className="text-xs text-muted-foreground">{t('source_desc')}</p>
          <div className="flex gap-2">
            <label className="relative flex-1"><Globe className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input aria-label={t('url')} placeholder="https://" className={cx(inputCls, 'pl-9')} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && read()} /></label>
            <Button variant={site ? 'outline' : 'default'} disabled={!!reading || !url.trim()} onClick={read}>{reading ? <Loader2 className="animate-spin" /> : site ? <RefreshCw /> : <Globe />}{site && site.url === url.trim() ? t('reread') : t('read')}</Button>
          </div>
          {reading && <p className="text-xs text-muted-foreground">{reading}</p>}
          {readErr && <Notice tone="error">{readErr}</Notice>}
        </div>
        {site && <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {site.screens.map((s) => {
              const off = skip.has(s.n)
              return <button key={s.n} type="button" title={s.heading || ''} onClick={() => update({ skip: off ? [...skip].filter((n) => n !== s.n) : [...skip, s.n] })}
                className={cx('relative aspect-[4/3] cursor-pointer overflow-hidden rounded-md border bg-muted', off ? 'border-border opacity-40' : 'border-primary/40')}>
                <img src={workUrl(s.file)} alt="" className="size-full object-cover" loading="lazy" />
                <span className="absolute top-1 left-1 rounded bg-black/55 px-1.5 text-[10px] text-white">{s.n}</span>
                {!off && <span className="absolute top-1 right-1 grid size-4 place-items-center rounded bg-primary text-primary-foreground"><Check className="size-3" /></span>}
              </button>
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t('screens_info', { title: site.title, n: site.screens.length, used: site.screens.length - skip.size })}</p>
        </div>}
        <Related ctx={ctx} social={social} update={update} />
        <div className="space-y-2">
          <h2 className="font-semibold">{t('request')}</h2>
          <textarea aria-label={t('request')} rows={3} className={inputCls} placeholder={t('request_ph')} value={social.request || ''} onChange={(e) => update({ request: e.target.value })} />
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t('presets')}</span>
            {['preset_video', 'preset_post', 'preset_launch'].map((k) => <button key={k} type="button" onClick={() => update({ request: t(k + '_text') })} className="cursor-pointer rounded-full bg-muted px-2.5 py-0.5 hover:text-foreground">{t(k)}</button>)}
          </div>
        </div>
      </section>
      <section className="space-y-2">
        <div className="flex items-baseline gap-2"><h2 className="font-semibold">{t('configured')}</h2><span className="text-xs text-muted-foreground">{t('configured_hint')}</span></div>
        <div className="divide-y divide-border rounded-xl border border-border bg-background px-4">
          <PlatformsRow social={social} accounts={accounts} why={why} update={update} />
          <FormatRow social={social} update={update} />
          <StyleRow social={social} playbooks={playbooks} update={update} go={ctx.go} />
          <NotesRow social={social} update={update} />
        </div>
      </section>
    </div>
    {footer}
  </>
}

/** 关联产品 / 已有文章（可选）：事实从这里取 */
function Related({ ctx, social, update }: { ctx: Ctx; social: Social; update: (p: Partial<Social>) => void }) {
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { dbList('products' as any).then((l: any) => setProducts(l || [])).catch(() => setProducts([])) }, [ctx.rev])
  if (!products.length) return null
  return <div className="space-y-2">
    <h2 className="font-semibold">{t('related')}</h2>
    <Select ariaLabel={t('related')} value={social.source?.product_id || ''} onChange={(v) => update({ source: { ...social.source, product_id: v } })}
      options={[{ value: '', label: t('related_none') }, ...products.map((p) => ({ value: p.id, label: p.name }))]} />
  </div>
}

function Row({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return <div className="grid grid-cols-[4.5rem_1fr_auto] items-start gap-3 py-3.5">
    <span className="pt-1 text-sm text-muted-foreground">{label}</span>
    <div className="min-w-0">{children}</div>
    {action}
  </div>
}
const linkBtn = 'cursor-pointer pt-1 text-sm text-primary-text hover:underline'

function PlatformsRow({ social, accounts, why, update }: { social: Social; accounts: Channel[]; why: Record<string, string>; update: (p: Partial<Social>, touch?: 'platforms') => void }) {
  const [edit, setEdit] = useState(false)
  const picked = social.platforms || []
  const supported = new Set(typePlatforms(social.format?.type || 'video'))
  const missing = parseRequest(social.request || '').types.filter((ty) => !accounts.some((a) => a.type === ty))
  const toggle = (a: Channel) => update({ platforms: picked.some((p) => p.channel_id === a.id) ? picked.filter((p) => p.channel_id !== a.id) : [...picked, { channel_id: a.id, type: a.type, why: 'picked' }] }, 'platforms')
  const shown = edit ? accounts : accounts.filter((a) => picked.some((p) => p.channel_id === a.id))
  const reasons = picked.map((p) => p.why === 'recommended' && why[p.channel_id]).filter(Boolean)
  return <Row label={t('platforms')} action={<button type="button" className={linkBtn} onClick={() => setEdit(!edit)}>{edit ? t('done') : t('change')}</button>}>
    {!accounts.length ? <p className="pt-1 text-sm text-muted-foreground">{t('no_accounts')}</p> : <>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((a) => {
          const p = picked.find((x) => x.channel_id === a.id), Icon = CHANNEL_TYPES[a.type]?.icon, ok = supported.has(a.type)
          return <button key={a.id} type="button" disabled={!edit || !ok} onClick={() => toggle(a)} title={ok ? a.name : t('not_supported')}
            className={cx('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm', p ? 'border-primary/50 bg-primary/5 font-medium' : 'border-border text-muted-foreground', edit && ok && 'cursor-pointer hover:border-primary/60', !ok && 'opacity-40')}>
            {Icon && <Icon size={14} />}<span className="max-w-32 truncate">{a.name}</span>
            {p?.why === 'said' && <span className="rounded bg-emerald-500/10 px-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">{t('why_said')}</span>}
            {p?.why === 'recommended' && <span className="rounded bg-emerald-500/10 px-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">{t('recommended')}</span>}
          </button>
        })}
        {!edit && <button type="button" onClick={() => setEdit(true)} className="inline-flex cursor-pointer items-center rounded-lg border border-dashed border-border px-2 text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /></button>}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{[...reasons, t('one_version_each')].join(' · ')}</p>
      {!!missing.length && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('missing_accounts', { names: missing.map((m) => CHANNEL_TYPES[m]?.label).join('、') })}</p>}
    </>}
  </Row>
}

function FormatRow({ social, update }: { social: Social; update: (p: Partial<Social>, touch?: 'format') => void }) {
  const [edit, setEdit] = useState(false)
  const f = social.format || { type: 'video', duration: 30, aspect: '16:9', media: 'record', subtitles: true, images: 6 } as Format
  const set = (patch: Partial<Format>) => update({ format: { ...f, ...patch } }, 'format')
  const tall = (social.platforms || []).filter((p) => TALL.includes(p.type as ChannelType))
  const video = f.type === 'video'
  const summary = video ? t('format_video', { duration: f.duration, aspect: f.aspect }) : t('format_post', { n: f.images, aspect: f.aspect })
  return <Row label={t('format')} action={<button type="button" className={linkBtn} onClick={() => setEdit(!edit)}>{edit ? t('done') : t('change')}</button>}>
    <div className="pt-1 text-sm"><span className="font-semibold">{summary}</span><span className="text-muted-foreground"> · {video ? t('media_record') + (f.subtitles ? ' · ' + t('subtitles') : '') : t('media_screens')}</span></div>
    {video && !isTall(f.aspect) && !!tall.length && <p className="mt-1 text-xs text-muted-foreground">{t('tall_tip', { names: tall.map((p) => CHANNEL_TYPES[p.type as ChannelType]?.label).join('、') })}</p>}
    {edit && <div className="mt-3 space-y-2.5">
      <Segmented value={f.type} onChange={(type) => set({ type, aspect: type === 'post' ? '3:4' : f.aspect === '3:4' ? '16:9' : f.aspect })} options={[{ value: 'video', label: <><Clapperboard className="size-3.5" />{t('t_video')}</> }, { value: 'post', label: <><Images className="size-3.5" />{t('t_post')}</> }]} />
      {video ? <Segmented value={String(f.duration)} onChange={(v) => set({ duration: Number(v) })} options={['15', '30', '60'].map((v) => ({ value: v, label: t('seconds', { n: v }) }))} />
        : <Segmented value={String(f.images)} onChange={(v) => set({ images: Number(v) })} options={['3', '6', '9'].map((v) => ({ value: v, label: t('images_n', { n: v }) }))} />}
      <Segmented<Aspect> value={f.aspect} onChange={(aspect) => set({ aspect })} options={(video ? ['9:16', '4:3', '16:9', '1:1'] : ['3:4', '1:1', '4:3']).map((v) => ({ value: v as Aspect, label: v }))} />
      {video && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.subtitles} onChange={(e) => set({ subtitles: e.target.checked })} />{t('subtitles')}</label>}
    </div>}
  </Row>
}

function StyleRow({ social, playbooks, update, go }: { social: Social; playbooks: Playbook[] | null; update: (p: Partial<Social>, touch?: 'style') => void; go: Ctx['go'] }) {
  const [open, setOpen] = useState(false)
  const [ref, setRef] = useState(social.reference_url || '')
  const pb = playbooks?.find((p) => p.id === social.playbook_id)
  const choose = (patch: Partial<Social>) => { update(patch, 'style'); setOpen(false) }
  const line = (p: Playbook) => [p.title_patterns?.[0]?.pattern, p.hooks?.[0]?.pattern].filter(Boolean).join(' · ') || (p.guide || '').split('\n').find((l) => l.trim())?.replace(/^[-#*\s]+/, '')
  return <Row label={t('style')} action={<div className="relative">
    <button type="button" className={cx(linkBtn, 'inline-flex items-center gap-0.5')} onClick={() => setOpen(!open)}>{t('switch')}<ChevronDown className="size-3.5" /></button>
    {open && <div className="absolute top-8 right-0 z-30 w-96 space-y-1 rounded-xl border border-border bg-popover p-2 shadow-lg">
      <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">{t('style_menu')}</p>
      {(playbooks || []).map((p) => <button key={p.id} type="button" onClick={() => choose({ style: 'playbook', playbook_id: p.id })}
        className={cx('flex w-full cursor-pointer items-start gap-2.5 rounded-lg p-2 text-left hover:bg-accent', social.style === 'playbook' && social.playbook_id === p.id && 'bg-primary/5')}>
        <Avatar name={p.name} />
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{p.name} <span className="text-xs font-normal text-muted-foreground">{[p.platform && CHANNEL_TYPES[p.platform as ChannelType]?.label, p.uses ? t('used_n', { n: p.uses }) : ''].filter(Boolean).join(' · ')}</span></span>
          <span className="line-clamp-1 block text-xs text-muted-foreground">{line(p)}</span></span>
        {social.style === 'playbook' && social.playbook_id === p.id && <Check className="mt-1 size-4 text-primary-text" />}
      </button>)}
      {playbooks && !playbooks.length && <p className="px-2 py-1 text-xs text-muted-foreground">{t('no_playbooks')}</p>}
      <div className="space-y-2 border-t border-border px-2 pt-2 pb-1">
        <button type="button" className="block cursor-pointer text-sm text-primary-text hover:underline" onClick={() => choose({ style: 'none', playbook_id: '' })}>{t('style_none')}</button>
        <div className="flex gap-1.5"><input aria-label={t('style_ref')} placeholder={t('style_ref')} className={cx(inputCls, 'h-8 text-xs')} value={ref} onChange={(e) => setRef(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!/^https?:\/\//.test(ref.trim())} onClick={() => choose({ style: 'reference', reference_url: ref.trim(), playbook_id: '' })}>{t('use')}</Button></div>
        <button type="button" className="block cursor-pointer text-sm text-primary-text hover:underline" onClick={() => go('inspiration')}>{t('to_inspiration')}</button>
      </div>
    </div>}
  </div>}>
    {social.style === 'playbook' && pb ? <div className="flex items-start gap-2.5 pt-0.5"><Avatar name={pb.name} />
      <div className="min-w-0"><div className="text-sm font-semibold">{pb.name}{!social.touched?.style && <span className="ml-1.5 rounded bg-emerald-500/10 px-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">{t('recommended')}</span>}</div>
        <p className="line-clamp-1 text-xs text-muted-foreground">{t('playbook_card')} · {line(pb)}</p></div></div>
      : social.style === 'reference' ? <p className="truncate pt-1 text-sm">{t('style_ref_used')} <a href={social.reference_url} target="_blank" rel="noreferrer" className="text-primary-text">{social.reference_url}</a></p>
        : <p className="pt-1 text-sm text-muted-foreground">{playbooks === null ? '…' : t('style_none')}</p>}
  </Row>
}

function Avatar({ name }: { name: string }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary-text">{[...(name || '?')][0]}</span>
}

function NotesRow({ social, update }: { social: Social; update: (p: Partial<Social>) => void }) {
  const [edit, setEdit] = useState(false)
  return <Row label={t('notes')} action={<button type="button" className={linkBtn} onClick={() => setEdit(!edit)}>{edit ? t('done') : t('change')}</button>}>
    {edit ? <textarea autoFocus aria-label={t('notes')} rows={2} className={inputCls} placeholder={t('notes_ph')} value={social.notes || ''} onChange={(e) => update({ notes: e.target.value })} />
      : <p className={cx('pt-1 text-sm', !social.notes && 'text-muted-foreground')}>{social.notes || t('notes_empty')}</p>}
  </Row>
}

// ---- 第 2 步：方案 ----

function screenAt(site: Social['site'], y = 0, n?: number) {
  const list = site?.screens || []
  return (n && list.find((s) => s.n === n)) || [...list].reverse().find((s) => s.y <= y) || list[0]
}

function Frame({ site, shot, ratio, className }: { site: Social['site']; shot: { screen?: number; y_from?: number; caption?: string; card?: { title: string; subtitle?: string } }; ratio: string; className?: string }) {
  const sc = screenAt(site, shot.y_from, shot.screen)
  const [w, h] = ratio.split(':').map(Number)
  return <div className={cx('relative overflow-hidden rounded-md border border-border bg-muted', className)} style={{ aspectRatio: `${w} / ${h}` }}>
    {shot.card ? <div className="flex size-full flex-col items-center justify-center bg-gradient-to-br from-primary to-zinc-900 p-2 text-center text-white">
      <span className="text-xs font-bold">{shot.card.title}</span>{shot.card.subtitle && <span className="mt-0.5 text-[10px] opacity-80">{shot.card.subtitle}</span>}</div>
      : sc && <img src={workUrl(sc.file)} alt="" loading="lazy" className="size-full object-cover" />}
    {shot.caption && !shot.card && <span className="absolute inset-x-1 bottom-1.5 text-center"><span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">{shot.caption}</span></span>}
  </div>
}

function PlanStep({ social, topicId, launched, onChanged, back, next, persist, accounts }: { social: Social; topicId: string; launched: boolean; onChanged: () => void; back: () => void; next: () => void; persist: (s?: Social) => Promise<string>; accounts: Channel[] }) {
  const { runs } = useTaskRuns([TASK], (r) => r.input?.topic_id === topicId, onChanged)
  const plan = social.plan
  const running = runs[0]
  const [tab, setTab] = useState('')
  const f = social.format
  const video = f?.type !== 'post'
  const copies = plan?.copies || []
  const cur = copies.find((c) => c.channel_id === tab) || copies[0]
  const acc = (id: string) => accounts.find((a) => a.id === id)
  const pick = async (version: number) => { try { await runLocal('social-create.pickPlan', { topic_id: topicId, version }); onChanged() } catch (e) { toast((e as Error).message, 'error') } }
  if (!plan) return <div className="space-y-4">
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-background p-8 text-center">
      {running || launched ? <><Loader2 className="size-6 animate-spin text-primary-text" /><p className="font-medium">{t('planning')}</p><p className="text-sm text-muted-foreground">{t('planning_desc')}</p>
        {running && <Button variant="outline" onClick={() => openChat(running.chat_id)}><MessageSquareText />{t('view_chat')}</Button>}</>
        : <><p className="text-sm text-muted-foreground">{t('no_plan')}</p><Button variant="outline" onClick={back}><ArrowLeft />{t('back_to_what')}</Button></>}
    </div>
  </div>
  return <>
    {running && <Notice>{t('replanning')} <button type="button" className="ml-1 font-semibold underline" onClick={() => openChat(running.chat_id)}>{t('view_chat')}</button></Notice>}
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-5">
        <section className="space-y-3 rounded-xl border border-border bg-background p-5">
          <div className="flex flex-wrap items-baseline gap-2"><h2 className="font-semibold">{video ? t('storyboard') : t('images_plan')}</h2>
            <span className="text-xs text-muted-foreground">{video ? t('storyboard_info', { n: plan.shots?.length || 0, duration: f?.duration, aspect: f?.aspect }) : t('images_info', { n: plan.images?.length || 0, aspect: f?.aspect })}</span></div>
          {plan.summary && <p className="text-sm">{plan.summary}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {video ? (plan.shots || []).map((s, i) => <div key={i} className="space-y-1">
              <div className="relative"><Frame site={social.site} shot={s} ratio={f?.aspect || '16:9'} /><span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">{s.start}–{s.end}s</span></div>
              {s.note && <p className="line-clamp-2 text-xs text-muted-foreground">{s.note}</p>}
            </div>) : (plan.images || []).map((im, i) => <div key={i} className="relative">
              <Frame site={social.site} shot={{ screen: im.screen }} ratio={f?.aspect || '3:4'} />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-xs font-bold text-white">{im.title}</span>
            </div>)}
          </div>
        </section>
        <section className="grid gap-5 rounded-xl border border-border bg-background p-5 sm:grid-cols-[12rem_1fr]">
          {plan.cover && video ? <div className="space-y-2"><h3 className="text-sm font-semibold">{t('cover')}</h3>
            <div className="relative"><Frame site={social.site} shot={{ screen: plan.cover.screen }} ratio={plan.cover.ratio || '3:4'} />
              <div className="absolute inset-0 flex flex-col justify-end rounded-md bg-gradient-to-b from-transparent via-transparent to-primary/90 p-3 text-white">
                <span className="text-base leading-tight font-black whitespace-pre-wrap">{plan.cover.title}</span>{plan.cover.subtitle && <span className="mt-1 text-[11px] font-semibold opacity-90">{plan.cover.subtitle}</span>}</div>
              <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">{plan.cover.ratio || '3:4'}</span></div></div> : <div />}
          <div className="space-y-2"><h3 className="text-sm font-semibold">{t('rationale')}</h3>
            <ul className="list-disc space-y-1.5 pl-4 text-sm">{(plan.rationale || []).map((r, i) => <li key={i}>{r}</li>)}</ul></div>
        </section>
      </div>
      <aside className="space-y-4">
        <section className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex gap-4 overflow-x-auto border-b border-border px-4">
            {copies.map((c) => { const a = acc(c.channel_id), Icon = a && CHANNEL_TYPES[a.type]?.icon
              return <button key={c.channel_id} type="button" onClick={() => setTab(c.channel_id)} className={cx('-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 py-2.5 text-sm', cur?.channel_id === c.channel_id ? 'border-foreground font-semibold' : 'border-transparent text-muted-foreground')}>{Icon && <Icon size={13} />}{a?.name || c.channel_id}</button> })}
          </div>
          {cur && <div className="space-y-3 p-4 text-sm">
            <div><p className="text-xs text-muted-foreground">{t('copy_title')} · {[...(cur.title || '')].length}</p><p className="mt-0.5 font-semibold">{cur.title}</p></div>
            <div><p className="text-xs text-muted-foreground">{t('copy_body')}</p><p className="mt-0.5 max-h-72 overflow-y-auto whitespace-pre-wrap">{cur.body}</p></div>
            {!!cur.tags?.length && <p className="text-xs text-primary-text">{cur.tags.map((x) => '#' + x).join(' ')}</p>}
          </div>}
        </section>
        <section className="space-y-2.5 rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-semibold">{t('revise_title')}</p>
          <p className="text-xs text-muted-foreground">{t('revise_desc')}</p>
          <div className="flex flex-wrap items-center gap-2">
            {plan.chat_id && <Button variant="outline" size="sm" onClick={() => openChat(plan.chat_id!)}><MessageSquareText />{t('continue_chat')}</Button>}
            {(social.plans || []).length > 1 && <span className="flex flex-wrap gap-1 text-xs">{(social.plans || []).map((p) => <button key={p.version} type="button" onClick={() => pick(p.version)}
              className={cx('cursor-pointer rounded px-1.5 py-0.5', p.version === plan.version ? 'bg-primary/10 font-semibold text-primary-text' : 'text-muted-foreground hover:text-foreground')}>{t('version_n', { n: p.version })}</button>)}</span>}
          </div>
        </section>
      </aside>
    </div>
    <StepFooter n={2} left={<Button variant="ghost" onClick={back}><ArrowLeft />{t('back_to_what')}</Button>}>
      <TaskButton task={TASK} variant="outline" size="default" icon={RefreshCw} onFinished={onChanged} match={(r) => r.input?.topic_id === topicId} beforeRun={async () => ({ topic_id: await persist() })}>{t('replan')}</TaskButton>
      <Button disabled={!!running} onClick={next}>{t('confirm_plan')}<ArrowRight /></Button>
    </StepFooter>
  </>
}

// ---- 第 3 步：成片与发布 ----

function ProduceStep({ social, topicId, onChanged, back, openArticle }: { social: Social; topicId: string; onChanged: () => void; back: () => void; openArticle: (id: string) => void }) {
  const p = social.produced
  const stale = !!p && !!social.plan && p.version !== social.plan.version
  const posts = useMemo(() => p?.posts || [], [p])
  return <>
    {!p && <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-background p-8 text-center">
      <p className="font-medium">{t('produce_ready', { version: social.plan?.version })}</p>
      <p className="max-w-lg text-sm text-muted-foreground">{social.format?.type === 'post' ? t('produce_desc_post') : t('produce_desc')}</p>
      <RunButton fn="social-create.produce" input={{ topic_id: topicId }} icon={Clapperboard} size="default" onDone={onChanged}>{t('produce')}</RunButton>
    </div>}
    {p && <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <section className="space-y-3 rounded-xl border border-border bg-background p-5">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{t('result')}</h2><span className="text-xs text-muted-foreground">{t('from_plan', { n: p.version })}</span></div>
        {stale && <Notice>{t('stale')}</Notice>}
        {p.video ? <video src={workUrl(p.video)} controls preload="metadata" className="max-h-[60vh] w-full rounded-lg bg-black object-contain" />
          : <div className="grid grid-cols-3 gap-2">{(p.images || []).map((im) => <img key={im} src={workUrl(im)} alt="" className="w-full rounded-md border border-border" />)}</div>}
        {p.cover && p.video && <div className="flex items-start gap-3"><img src={workUrl(p.cover)} alt="" className="w-28 rounded-md border border-border" /><p className="text-xs text-muted-foreground">{t('cover_note')}</p></div>}
      </section>
      <aside className="space-y-4">
        <section className="space-y-2 rounded-xl border border-border bg-background p-4">
          <h3 className="text-sm font-semibold">{t('posts')}</h3>
          {posts.map((x) => <div key={x.channel_id} className="flex items-start gap-2 text-sm">
            {x.error ? <X className="mt-0.5 size-4 text-destructive" /> : <Check className="mt-0.5 size-4 text-emerald-600" />}
            <div className="min-w-0"><p className="font-medium">{x.name}</p>
              <p className="text-xs text-muted-foreground">{x.error || (x.problems?.length ? x.problems.join('；') : t('post_pending'))}</p></div>
          </div>)}
          <Button className="mt-2 w-full" onClick={() => openArticle(p.article_id)}>{t('to_publish')}<ArrowRight /></Button>
        </section>
        <p className="text-xs text-muted-foreground">{t('publish_note')}</p>
      </aside>
    </div>}
    <StepFooter n={3} left={<Button variant="ghost" onClick={back}><ArrowLeft />{t('back_to_plan')}</Button>}>
      {p && <RunButton fn="social-create.produce" input={{ topic_id: topicId }} variant="outline" icon={RefreshCw} size="default" onDone={onChanged}>{t('reproduce')}</RunButton>}
    </StepFooter>
  </>
}
