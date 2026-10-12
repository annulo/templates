import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ExternalLink, Lightbulb, ListPlus, Loader2, Pause, Pencil, Play, Plus, RotateCw, Sparkles, Trash2, Wrench } from 'lucide-react'
import { Badge, Button, Dialog, ErrorDetails, Field, Notice, Panel, PageHeader, Skeleton, cx, fmtTime, inputCls, toast, type Tone } from '../ui'
import { dbCreate, dbDelete, dbList, dbPatch, geoDoneText, geoSummary, geoUnseen, newestFirst, runLocal, type Article, type Channel, type GeoQuestion, type GeoResult, type GeoRun, type GeoSummary, type SearchPage, isSite } from '../../lib/shuttle'
import SitePicker from '../SitePicker'
import Markdown from '../Markdown'
import { GeoEnginesBar, GeoEnginesDialog, useGeoEngines } from '../GeoEngines'
import { TaskButton, TaskLaunchButton } from '../Task'
import { TOPICS_TASK } from './Content'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

/** 任务 id（tasks/geo-questions.md）：「生成问题」交给助手，写还不知道这家公司的买家会问的问题 */
const GEO_Q_TASK = 'geo-questions'
/** 任务 id（tasks/geo-fix-facts.md）：查清 AI 说错的地方从哪来，写修正建议 */
const GEO_FIX_TASK = 'geo-fix-facts'

/** 问题的问题类型 */
const INTENT: Record<string, string> = Object.defineProperties(
  {},
  Object.fromEntries(['commercial', 'comparison', 'informational', 'brand'].map((k) => [k, { enumerable: true, get: () => tr(`geo.i_${k}`) }])),
)

/** 引擎的显示名；老数据没有 engine 字段的是 Perplexity */
const ENGINE_NAME: Record<string, string> = { openai: 'ChatGPT', perplexity: 'Perplexity', get doubao() { return tr('geo.doubao') } }
const engineOf = (x: { engine?: string }) => x.engine || 'perplexity'
const engineName = (k: string) => ENGINE_NAME[k] ?? k
/** 这次检测是谁在答：新数据存了 provider_name（本机 Claude Code 写的是 Claude），老数据按引擎名 */
const askerOf = (r: GeoRun) => r.provider_name || engineName(engineOf(r))
/** 这次检测里一个问题和它上一次的结果比：新引用了 / 这次没引用 / 第一次问 */
type Change = 'gained' | 'lost' | 'fresh'

function jsonList(s?: string): string[] {
  try {
    const v = JSON.parse(s ?? '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
function jsonArr<T>(s?: string): T[] {
  try {
    const v = JSON.parse(s ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

const hostOf = (u: string) => (/^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(u)?.[1] ?? '').replace(/^www\./, '').toLowerCase()
const splitTerms = (s?: string) => (s ?? '').split(/[,，、;；\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean)

/**
 * AI 搜索推荐：本机拿问题问 ChatGPT（联网搜索），分三块看：
 * 1. AI 怎么介绍你：品牌问题的回答和公司资料对照，说错的、漏掉的列出来，交给助手查原因、写修正建议；
 * 2. AI 推荐了谁：推荐类问题引用了哪些站（按网站汇总），每个问题对照 GSC 排名和本站文章；
 * 3. 可见度：推荐类问题里引用了本站的比例。
 */
export default function Geo({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const sites = ctx.channels.filter(isSite)
  const channel = sites.find((c) => c.id === params.channel) ?? sites[0]
  const [questions, setQuestions] = useState<GeoQuestion[] | null>(null)
  const [runs, setRuns] = useState<GeoRun[]>([])
  const [results, setResults] = useState<GeoResult[]>([])
  const [pages, setPages] = useState<SearchPage[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  /** 品牌词（小写）：资料里的品牌词、公司名、网站名。问题里带着它的算品牌问题（和 local/geo.ts 的 isBrandQ 一样） */
  const [brands, setBrands] = useState<string[]>([])
  const [error, setError] = useState('')
  const [noTable, setNoTable] = useState(false)
  /** 正在编辑的问题；没有 id 表示新建 */
  const [editing, setEditing] = useState<Partial<GeoQuestion> | null>(null)
  /** 检测记录里点开看明细的那次检测 */
  const [openRun, setOpenRun] = useState('')
  /** 这个页面发起的检测的进度（geo.check 的 progress：done / total / question_id / question / step） */
  const [prog, setProg] = useState<CheckProgress | null>(null)
  const [checkErr, setCheckErr] = useState('')
  const [checkedNow, setCheckedNow] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // 用 Shuttle 里的哪个服务商、哪个模型：「检测设置」里配（local/geo.ts engines / saveEngine）
  const eng$ = useGeoEngines()
  const [engOpen, setEngOpen] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)
  // 检测报错说要去「检测设置」：报错旁边直接给打开它的按钮
  const engAction = (err: string) =>
    /检测设置|check settings/i.test(err) ? (
      <button type="button" className="ml-1 font-semibold underline underline-offset-2" onClick={() => setEngOpen(true)}>
        {tr('geo.eng_btn')}
      </button>
    ) : null

  const load = useCallback((): Promise<void> | undefined => {
    if (!channel) return
    // 刷新按钮等这一份（问题、检测记录、结果）；下面对照用的几张表各自读，不拖住它
    const main = Promise.all([dbList('geo_questions'), dbList('geo_runs'), dbList('geo_results')])
      .then(([q, r, res]) => {
        setQuestions(q.filter((x) => x.channel_id === channel.id))
        setRuns(newestFirst(r.filter((x) => x.channel_id === channel.id)))
        setResults(res.filter((x) => x.channel_id === channel.id))
        setNoTable(false)
        setError('')
      })
      .catch((e: Error) => {
        // 表刚建好、Shuttle 还没重启时读不到，单独给一句能懂的话
        if (/没有这张表|table not found/i.test(e.message)) setNoTable(true)
        else setError(e.message)
      })
    // 「AI 推荐了谁」对照用：GSC 的页面和搜索词、本站文章；读不到（没连 Google、表没建）就不显示这些提示
    dbList('search_pages').then((l) => setPages(l.filter((x) => x.channel_id === channel.id))).catch(() => setPages([]))
    dbList('articles').then((l) => setArticles(l.filter((x) => x.channel_id === channel.id))).catch(() => setArticles([]))
    dbList('profile')
      .then((l) => {
        const p = [...l].sort((a, b) => (Date.parse(a.created_at || '') || 0) - (Date.parse(b.created_at || '') || 0))[0]
        setBrands([...new Set([...splitTerms(p?.brand_terms), (p?.name || '').trim().toLowerCase(), channel.name.trim().toLowerCase()].filter((x) => x.length >= 3))])
      })
      .catch(() => setBrands([channel.name.trim().toLowerCase()].filter((x) => x.length >= 3)))
    return main
  }, [channel?.id])

  useEffect(() => {
    setQuestions(null)
    setRuns([])
    setResults([])
    load()
  }, [load])
  const refresh = async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }
  // 助手改了数据：静默重拉，不清空
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])
  const last = runs[0]
  // 别处发起、还在跑的检测（定时任务、离开页面前点的）：geo_runs 有开始没结束、一小时内开始的
  const busyRun = !prog && last && !last.finished_at && Date.now() - (Date.parse(last.started_at || last.created_at || '') || 0) < 60 * 60 * 1000 ? last : null
  // 别处发起的检测还在跑：每 8 秒重拉，问完一个就显示一个
  useEffect(() => {
    if (!busyRun) return
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [busyRun?.id, load])

  const startCheck = async (retryRunId?: string) => {
    if (!channel) return
    setJustDone('')
    setCheckErr('')
    setCheckedNow(false)
    setProg({ done: 0, total: 0, started: Date.now() })
    let done = -1
    try {
      const res = await runLocal<{ run_id?: string }>('geo.check', { channel_id: channel.id, ...(retryRunId ? { retry_run_id: retryRunId } : {}) }, (ev) => {
        if (ev.type !== 'progress') return
        const d = ev.data as CheckProgress
        setProg((p) => ({ ...d, started: p?.started ?? Date.now() }))
        // 问完一个（done 变了）就重拉，答案马上出现在列表里
        if (typeof d.done === 'number' && d.done !== done) {
          done = d.done
          load()
        }
      })
      setCheckedNow(true)
      setTimeout(() => setCheckedNow(false), 2000)
      setJump(true) // 跑完滚到第一个有变化的问题
      if (res?.run_id) setJustDone(res.run_id)
    } catch (e) {
      setCheckErr((e as Error).message)
    } finally {
      setProg(null)
      load()
      window.postMessage({ type: 'shuttle:refresh' }, window.location.origin)
    }
  }

  // 每个问题最新一次结果（dbList 按时间倒序，第一条就是最新的）
  const latestOf = useMemo(() => {
    const m = new Map<string, GeoResult>()
    for (const r of results) if (r.question_id && !m.has(r.question_id)) m.set(r.question_id, r)
    return m
  }, [results])
  // 最近一次检测的结论；里面的变化标到对应的问题上（只标这次检测里问到的）
  const sum = !running0(prog, busyRun) && last?.finished_at ? geoSummary(last) : null
  const changeOf = useMemo(() => {
    const m = new Map<string, Change>()
    if (!sum) return m
    for (const id of sum.fresh) m.set(id, 'fresh')
    for (const id of sum.gained) m.set(id, 'gained')
    for (const id of sum.lost) m.set(id, 'lost')
    return m
  }, [last?.id, last?.summary, !!prog, !!busyRun])
  // 看到了就算看过：侧栏「AI 搜索推荐」的点去掉（Index 听 db:changed）
  useEffect(() => {
    if (geoUnseen(last) && !prog) dbPatch('geo_runs', last!.id, { seen_at: new Date().toISOString() }).catch(() => {})
  }, [last?.id, last?.seen_at, last?.finished_at, !!prog])
  // 滚到第一个有变化的问题（跑完时，或点了结论里的「新引用了 / 这次没引用」）
  const [jump, setJump] = useState(false)
  const firstChanged = (only?: Change) => (questions ?? []).find((q) => (only ? changeOf.get(q.id) === only : changeOf.get(q.id) && changeOf.get(q.id) !== 'fresh'))
  const scrollTo = (q?: GeoQuestion) => q && document.getElementById(`geo-q-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  useEffect(() => {
    if (!jump || !sum) return
    setJump(false)
    setTimeout(() => scrollTo(firstChanged()), 300)
  }, [jump, sum])
  // 在这个页面上跑完的那次检测（这页点的，或者别处发起、在这页看着跑完的）：卡片变成「检测完成」、弹提示、这次问到的行标出来
  const [justDone, setJustDone] = useState('')
  const watching = useRef('')
  useEffect(() => {
    if (busyRun) watching.current = busyRun.id
    else if (watching.current && last?.id === watching.current && last.finished_at) {
      setJustDone(last.id)
      watching.current = ''
    }
  }, [busyRun?.id, last?.id, last?.finished_at])
  const toasted = useRef('')
  const done = !!justDone && last?.id === justDone && !!last.finished_at && !prog && !busyRun ? last : null
  useEffect(() => {
    if (!done || toasted.current === done.id) return
    toasted.current = done.id
    toast(geoDoneText(done))
  }, [done?.id, done?.summary])
  const isBrand = (q: GeoQuestion) => q.intent === 'brand' || brands.some((b) => q.question.toLowerCase().includes(b))
  const brandQs = useMemo(() => (questions ?? []).filter(isBrand), [questions, brands])
  const recQs = useMemo(() => (questions ?? []).filter((q) => !isBrand(q)), [questions, brands])
  // 「AI 推荐了谁」：推荐类问题的最新回答引用的网站，按被几个问题引用排
  const citedSites = useMemo(() => {
    const m = new Map<string, { host: string; ours: boolean; questions: Set<string>; pages: Set<string> }>()
    for (const q of recQs) {
      const r = latestOf.get(q.id)
      if (!r) continue
      const ours = new Set(jsonList(r.cited_urls).map(hostOf))
      for (const u of resultUrls(r)) {
        const h = hostOf(u)
        if (!h) continue
        const e = m.get(h) ?? { host: h, ours: ours.has(h), questions: new Set(), pages: new Set() }
        e.questions.add(q.id)
        e.pages.add(u)
        m.set(h, e)
      }
    }
    return [...m.values()].sort((a, b) => b.questions.size - a.questions.size)
  }, [recQs, latestOf])

  if (!channel)
    return (
      <div className="space-y-6">
        <PageHeader title={tr('geo.title')} />
        <Notice>{tr('geo.no_site')}</Notice>
      </div>
    )

  const uncited = recQs.filter((q) => q.status === 'active' && !latestOf.get(q.id)?.cited)
  const recRuns = runs.filter((r) => (r.questions ?? 0) > 0)

  // 上次检测用的服务商、模型和现在的检测设置一样
  const nowEng = eng$.data?.engines.find((e) => e.ready)
  const sameAsNow = (r: GeoRun) => !!nowEng && r.provider === nowEng.provider && r.model === (nowEng.model || nowEng.default_model)
  const asking = prog?.question_id ?? ''
  const running = !!prog || !!busyRun

  return (
    <div className="space-y-8">
      {/* 谁在答、检测设置放在标题右边：一行说清，不单独占一块 */}
      <PageHeader title={tr('geo.title')} desc={tr('geo.desc')} actions={<GeoEnginesBar data={eng$.data} error={eng$.error} onOpen={() => setEngOpen(true)} />} />
      <SitePicker sites={sites} value={channel.id} onChange={(v) => setParam('channel', v)} />
      <GeoEnginesDialog
        open={engOpen}
        onClose={() => setEngOpen(false)}
        data={eng$.data}
        onSaved={() => {
          setEngOpen(false)
          eng$.reload()
        }}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {noTable && <Notice>{tr('geo.no_table')}</Notice>}

      {!noTable && questions === null ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : noTable ? null : (
        <>
          {/* 检测：一次跑完三块，每周自动一次。跑的时候这里显示完整进度 */}
          <div className={cx('rounded-xl border bg-background px-5 py-4 transition-colors', running ? 'border-primary/40' : done ? 'border-emerald-500/50' : 'border-border')}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="min-w-0 flex-1 text-sm">
                {running ? (
                  <div className="flex items-center gap-2 font-semibold">
                    <Loader2 className="size-4 animate-spin text-primary-text" />
                    {prog ? tr('geo.checking', { done: prog.done ?? 0, total: prog.total || '…' }) : tr('geo.checking_bg', { time: fmtTime(busyRun?.started_at || busyRun?.created_at) })}
                  </div>
                ) : (
                  done ? (
                    <div className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-4" />
                      {tr('geo.just_done', { t: durationOf(done) })}
                    </div>
                  ) : (
                    <div className="font-semibold">{last ? tr('geo.last_run', { time: fmtTime(last.finished_at || last.created_at) }) : tr('geo.never_run')}</div>
                  )
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {/* 上次用的和现在的检测设置一样就不重复写（标题右边写着）；换过设置才写上次用的是谁 */}
                  {last && !running && (!sameAsNow(last) || (last.note && !sum)) ? `${sameAsNow(last) ? '' : `${askerOf(last)}${last.model ? ` · ${last.model}` : ''}`}${last.note && !sum ? `${sameAsNow(last) ? '' : ' · '}${last.note}` : ''} · ` : ''}
                  {running && !prog ? tr('geo.checking_bg_hint', { n: results.filter((x) => x.run_id === busyRun?.id).length }) : tr('geo.run_hint')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* 拉一次要一两秒（在线项目每张表都要去 creght 跑一趟）：拉的时候图标转起来，看得出点到了 */}
                <Button feedback={false} variant="ghost" size="sm" disabled={refreshing} onClick={refresh} className="text-muted-foreground">
                  <RotateCw className={cx(refreshing && 'animate-spin')} /> {tr('common.refresh')}
                </Button>
                <Button feedback={false} size={last ? 'sm' : 'default'} disabled={running} onClick={() => startCheck()}>
                  {running ? <Loader2 className="animate-spin" /> : <Play />}
                  {running ? tr('ui.running') : checkedNow ? tr('ui.done') : last ? tr('geo.rerun') : tr('geo.start')}
                </Button>
              </div>
            </div>
            {prog && <CheckProgressBar p={prog} />}
            {sum && last && <RunSummary s={sum} onRetry={() => startCheck(last.id)} onJump={(c) => scrollTo(firstChanged(c))} onGen={() => document.getElementById('geo-s2')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />}
            {checkErr && (
              <div className="mt-3">
                <ErrorDetails message={checkErr} actions={engAction(checkErr)} />
              </div>
            )}
          </div>

          {/* 1. AI 怎么介绍你 */}
          <section className="space-y-3">
            <SectionHead n={1} title={tr('geo.s1_title')} desc={tr('geo.s1_desc')}>
              <Button variant="outline" size="sm" fn="geo.brandQuestions" onClick={() => setBrandOpen(true)}>
                <ListPlus /> {tr('geo.brand_fill')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing({ intent: 'brand' })} className="text-muted-foreground">
                <Plus /> {tr('geo.add_q')}
              </Button>
            </SectionHead>
            {brandQs.length === 0 ? (
              <Empty title={tr('geo.brand_empty')} desc={tr('geo.brand_empty_desc')}>
                <Button fn="geo.brandQuestions" onClick={() => setBrandOpen(true)}>
                  <ListPlus /> {tr('geo.brand_fill')}
                </Button>
              </Empty>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                {brandQs.map((q) => (
                  <FactRow key={q.id} q={q} r={latestOf.get(q.id)} justAsked={!!done && latestOf.get(q.id)?.run_id === done.id} change={changeOf.get(q.id)} asking={asking === q.id ? prog?.step || tr('geo.asking') : ''} onChanged={load} onEdit={() => setEditing(q)} />
                ))}
              </div>
            )}
          </section>

          {/* 2. AI 推荐了谁 */}
          <section id="geo-s2" className="scroll-mt-4 space-y-3">
            <SectionHead n={2} title={tr('geo.s2_title')} desc={tr('geo.s2_desc')}>
              <TaskLaunchButton task={GEO_Q_TASK} input={{ channel_id: channel.id }} match={(r) => r.input?.channel_id === channel.id} onFinished={load} title={tr('geo.gen')} desc={tr('geo.gen_desc')} reqTitle={tr('geo.req_title')} reqHint={tr('geo.req_hint')} startLabel={tr('geo.gen_start')} icon={Sparkles} variant="outline">
                {tr('geo.gen')}
              </TaskLaunchButton>
              <Button variant="ghost" size="sm" onClick={() => setEditing({})} className="text-muted-foreground">
                <Plus /> {tr('geo.add_q')}
              </Button>
            </SectionHead>
            {recQs.length === 0 ? (
              <Empty title={tr('geo.no_questions', { name: channel.name })} desc={tr('geo.no_questions_desc')}>
                <TaskLaunchButton task={GEO_Q_TASK} input={{ channel_id: channel.id }} match={(r) => r.input?.channel_id === channel.id} onFinished={load} title={tr('geo.gen')} desc={tr('geo.gen_desc')} reqTitle={tr('geo.req_title')} reqHint={tr('geo.req_hint')} startLabel={tr('geo.gen_start')} icon={Sparkles} size="default">
                  {tr('geo.gen')}
                </TaskLaunchButton>
              </Empty>
            ) : (
              <>
                {recRuns.length > 0 && <VisibilityStrip runs={recRuns} />}
                {citedSites.length > 0 && <CitedSites sites={citedSites} total={recQs.filter((q) => latestOf.get(q.id)).length} />}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {tr('geo.questions')} <span className="text-muted-foreground tabular-nums">{recQs.length}</span>
                  </h3>
                  {uncited.length > 0 && (
                    <TaskLaunchButton task={TOPICS_TASK} reqKey="topic_requirements" input={{ channel_id: channel.id }} match={(r) => r.input?.channel_id === channel.id && !r.input?.question_ids} title={tr('geo.to_topics', { n: uncited.length })} desc={tr('geo.topics_desc', { n: uncited.length })} reqTitle={tr('geo.topics_req_title')} reqHint={tr('geo.topics_req_hint')} startLabel={tr('geo.topics_start')} variant="outline" icon={Lightbulb}>
                      {tr('geo.to_topics', { n: uncited.length })}
                    </TaskLaunchButton>
                  )}
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-background">
                  {recQs.map((q) => (
                    <QuestionRow key={q.id} q={q} r={latestOf.get(q.id)} justAsked={!!done && latestOf.get(q.id)?.run_id === done.id} change={changeOf.get(q.id)} asking={asking === q.id ? prog?.step || tr('geo.asking') : ''} channel={channel} onChanged={load} onEdit={() => setEditing(q)} hint={<Hints q={q} pages={pages} articles={articles} />} />
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{tr('geo.rule')}</p>
              </>
            )}
          </section>

          {runs.length > 0 && (
            <Panel title={tr('geo.runs')}>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{tr('geo.th_time')}</th>
                      <th className="w-28 px-3 py-2 text-right font-medium">{tr('geo.th_facts')}</th>
                      <th className="w-28 px-3 py-2 text-right font-medium">{tr('geo.th_cited')}</th>
                      <th className="w-24 px-3 py-2 text-right font-medium">{tr('geo.th_vis')}</th>
                      <th className="px-3 py-2 font-medium">{tr('geo.th_engine')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.slice(0, 12).map((r) => (
                      <Fragment key={r.id}>
                        <tr onClick={() => setOpenRun((o) => (o === r.id ? '' : r.id))} aria-expanded={openRun === r.id} title={tr('geo.run_detail')} className="cursor-pointer border-b border-border last:border-b-0 hover:bg-accent/40">
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtTime(r.finished_at || r.created_at)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.fact_questions || '–'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.questions ? `${r.cited ?? 0}/${r.questions}` : '–'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.questions ? `${r.visibility ?? 0}%` : '–'}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-2">
                              <span className="min-w-0 flex-1">
                                {askerOf(r)}
                                {r.model ? ` · ${r.model}` : ''}
                                {r.note ? ` · ${r.note}` : ''}
                              </span>
                              <ChevronDown className={cx('size-3.5 shrink-0 transition-transform', openRun === r.id && 'rotate-180')} />
                            </span>
                          </td>
                        </tr>
                        {openRun === r.id && (
                          <tr className="border-b border-border bg-muted/20 last:border-b-0">
                            <td colSpan={5}>
                              <RunResults results={results.filter((x) => x.run_id === r.id)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}

      <BrandQuestionsDialog open={brandOpen} channelId={channel.id} onClose={() => setBrandOpen(false)} onAdded={load} onGoProfile={() => ctx.go('company')} />
      <QuestionDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
        channelId={channel.id}
        brand={channel.name}
      />
    </div>
  )
}

const running0 = (prog: unknown, busyRun: unknown) => !!prog || !!busyRun

/** 这次检测用了多久：「23 秒」「2 分 05 秒」 */
function durationOf(r: GeoRun): string {
  const secs = Math.max(0, Math.round(((Date.parse(r.finished_at || '') || 0) - (Date.parse(r.started_at || r.created_at || '') || 0)) / 1000))
  return secs >= 60 ? tr('geo.dur_min', { m: Math.floor(secs / 60), s: String(secs % 60).padStart(2, '0') }) : tr('geo.dur_sec', { s: secs })
}

type CheckProgress = { done?: number; total?: number; message?: string; question_id?: string; question?: string; step?: string; started?: number }

/** 检测进度：进度条、第几个、正在问的问题全文、现在在做什么、用了多久 */
function CheckProgressBar({ p }: { p: CheckProgress }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.round((Date.now() - (p.started ?? Date.now())) / 1000))
  const pct = p.total ? Math.round(((p.done ?? 0) / p.total) * 100) : 0
  return (
    <div className="mt-3 space-y-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(pct, p.total ? 3 : 0)}%` }} />
      </div>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs">
        {p.question ? (
          <span className="min-w-0 flex-1">
            <span className="text-muted-foreground">{tr('geo.now_asking', { i: (p.done ?? 0) + 1, n: p.total ?? 0 })}</span>
            <span className="font-medium">{p.question}</span>
            {p.step && <span className="ml-2 text-primary-text">{p.step}</span>}
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-muted-foreground">{p.message || tr('ui.preparing')}</span>
        )}
        <span className="shrink-0 text-muted-foreground tabular-nums">{tr('geo.elapsed', { t: secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}s` })}</span>
      </div>
    </div>
  )
}

/** 和这个问题上一次的结果比，这次变了什么 */
function ChangeBadge({ c }: { c: Change }) {
  if (c === 'gained') return <Badge tone="ok">{tr('geo.ch_gained')}</Badge>
  if (c === 'lost') return <Badge tone="warn">{tr('geo.ch_lost')}</Badge>
  return null // 第一次问：行上的「新」已经说明了
}

/** 刚出的结果标「新」：和内容中心的新文章同一个样子（core/components/views/Content.tsx） */
function NewPill() {
  return <span className="mr-1.5 inline-flex h-5 items-center rounded bg-primary px-1.5 align-[1px] text-[11px] font-semibold text-primary-foreground">{tr('article.new_badge')}</span>
}

/** 检测卡片里这次的结论：品牌问题、推荐问题和可见度（比上次）、变化（点了滚到那一题）、失败的（重试）；没有推荐问题时提示生成 */
function RunSummary({ s, onRetry, onJump, onGen }: { s: GeoSummary; onRetry: () => void; onJump: (c: Change) => void; onGen: () => void }) {
  const [showFail, setShowFail] = useState(false)
  const delta = s.prev_visibility == null || !s.questions ? null : s.visibility - s.prev_visibility
  const link = 'cursor-pointer font-medium underline-offset-2 hover:underline'
  return (
    <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
      {s.brand_asked > 0 && <div>{tr('geo.sum_brand', { n: s.brand_asked, c: s.brand_cited })}</div>}
      {s.questions > 0 ? (
        <div className="flex flex-wrap items-center gap-x-1.5">
          {tr('geo.sum_rec', { n: s.questions, c: s.cited, v: s.visibility })}
          {delta != null && (
            <span className={cx('inline-flex items-center text-xs tabular-nums', delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : delta < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
              {delta > 0 ? <ArrowUp className="size-3" /> : delta < 0 ? <ArrowDown className="size-3" /> : null}
              {delta === 0 ? tr('geo.sum_same') : tr('geo.sum_delta', { d: `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`, p: s.prev_visibility })}
            </span>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground">
          {tr('geo.sum_no_rec')}{' '}
          <button type="button" onClick={onGen} className={cx(link, 'text-primary-text')}>
            {tr('geo.sum_go_gen')}
          </button>
        </div>
      )}
      {(s.gained.length > 0 || s.lost.length > 0) && (
        <div className="flex flex-wrap gap-x-3 text-xs">
          {s.gained.length > 0 && (
            <button type="button" onClick={() => onJump('gained')} className={cx(link, 'text-emerald-600 dark:text-emerald-400')}>
              {tr('geo.sum_gained', { n: s.gained.length })}
            </button>
          )}
          {s.lost.length > 0 && (
            <button type="button" onClick={() => onJump('lost')} className={cx(link, 'text-amber-600 dark:text-amber-400')}>
              {tr('geo.sum_lost', { n: s.lost.length })}
            </button>
          )}
        </div>
      )}
      {s.failed.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <button type="button" onClick={() => setShowFail((v) => !v)} aria-expanded={showFail} className={cx(link, 'inline-flex items-center gap-1')}>
              {tr('geo.sum_failed', { n: s.failed.length })}
              <ChevronDown className={cx('size-3 transition-transform', showFail && 'rotate-180')} />
            </button>
            <Button size="sm" variant="outline" className="ml-auto" onClick={onRetry}>
              <RotateCw /> {tr('geo.sum_retry')}
            </Button>
          </div>
          {showFail && (
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {s.failed.map((f) => (
                <li key={f.question_id}>
                  <span className="font-medium text-foreground">{f.question}</span>：{f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** 列表里正在问的那一行：转圈 + 现在在做什么 */
function AskingBadge({ step }: { step: string }) {
  return (
    <span className="mt-0.5 inline-flex min-w-0 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary-text" title={step}>
      <Loader2 className="size-3 shrink-0 animate-spin" />
      <span className="truncate">{tr('geo.asking')}</span>
    </span>
  )
}

/** 一块的标题：序号、标题、一句说明，右边放这一块的操作 */
function SectionHead({ n, title, desc, children }: { n: number; title: string; desc: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-end">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary-text tabular-nums">{n}</span>
          {title}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

function Empty({ title, desc, children }: { title: string; desc: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{desc}</p>
      {children && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  )
}

/** AI 推荐类问题里引用最多的网站：本站标出来，点开看引用的页面 */
function CitedSites({ sites, total }: { sites: { host: string; ours: boolean; questions: Set<string>; pages: Set<string> }[]; total: number }) {
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState('')
  const shown = more ? sites : sites.slice(0, 8)
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="text-xs font-semibold text-muted-foreground">{tr('geo.sites_title', { n: total })}</div>
      <ul className="mt-2 divide-y divide-border">
        {shown.map((s) => (
          <li key={s.host} className="py-1.5">
            <button type="button" onClick={() => setOpen((o) => (o === s.host ? '' : s.host))} aria-expanded={open === s.host} className="flex w-full cursor-pointer items-center gap-2 text-left text-sm">
              <span className={cx('min-w-0 flex-1 truncate font-mono', s.ours ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{s.host}</span>
              {s.ours && <Badge tone="ok">{tr('geo.ours')}</Badge>}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{tr('geo.sites_q', { n: s.questions.size })}</span>
              <span className="h-1 w-20 shrink-0 rounded-full bg-muted">
                <span className={cx('block h-full rounded-full', s.ours ? 'bg-emerald-500' : 'bg-primary/60')} style={{ width: `${Math.round((s.questions.size / Math.max(1, total)) * 100)}%` }} />
              </span>
              <ChevronDown className={cx('size-3.5 shrink-0 text-muted-foreground transition-transform', open === s.host && 'rotate-180')} />
            </button>
            {open === s.host && (
              <ul className="mt-1 space-y-0.5 pl-2 text-xs">
                {[...s.pages].slice(0, 10).map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-mono text-muted-foreground hover:text-primary-text">
                      <span className="truncate">{u.replace(/^https?:\/\//, '')}</span>
                      <ExternalLink className="size-3 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {sites.length > 8 && (
        <Button variant="ghost" size="sm" onClick={() => setMore((m) => !m)} className="mt-1 text-muted-foreground">
          {more ? tr('geo.sites_less') : tr('geo.sites_more', { n: sites.length - 8 })}
        </Button>
      )}
    </div>
  )
}

/** 推荐类问题旁边的对照：这些词在 Google 上排第几（GSC），本站有没有回答它的文章 */
function Hints({ q, pages, articles }: { q: GeoQuestion; pages: SearchPage[]; articles: Article[] }) {
  const kws = splitTerms(q.keywords)
  if (!kws.length) return null
  let best: { query: string; position: number; page: string } | null = null
  for (const p of pages)
    for (const x of jsonArr<{ query: string; position: number }>(p.top_queries))
      if (x?.query && kws.some((k) => x.query.toLowerCase().includes(k)) && (!best || x.position < best.position)) best = { query: x.query, position: x.position, page: p.page }
  const related = articles.find((a) => a.status === 'published' && (splitTerms(a.keywords).some((k) => kws.includes(k)) || kws.some((k) => a.title.toLowerCase().includes(k))))
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
      {pages.length > 0 && (best ? <span>{tr('geo.hint_rank', { q: best.query, n: best.position.toFixed(1), page: best.page.replace(/^https?:\/\/[^/]+/, '') || '/' })}</span> : <span className="text-amber-600 dark:text-amber-400">{tr('geo.hint_no_rank')}</span>)}
      {related ? <span>{tr('geo.hint_article', { t: related.title })}</span> : <span className="text-amber-600 dark:text-amber-400">{tr('geo.hint_no_article')}</span>}
    </span>
  )
}

/**
 * 「添加常见品牌问题」：不用 AI，按公司资料（品牌名、主营类别、产品库前两款）套常见问法（local/geo.ts brandTemplates）。
 * 先列出会加哪些（已经在问题库里的不列），默认全勾，用户去掉不要的再加
 */
function BrandQuestionsDialog({ open, channelId, onClose, onAdded, onGoProfile }: { open: boolean; channelId: string; onClose: () => void; onAdded: () => void; onGoProfile: () => void }) {
  const [list, setList] = useState<{ key: string; question: string }[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setList(null)
    setError('')
    runLocal<{ candidates: { key: string; question: string }[] }>('geo.brandQuestions', { channel_id: channelId, preview: true })
      .then((r) => {
        setList(r.candidates)
        setPicked(new Set(r.candidates.map((c) => c.key)))
      })
      .catch((e: Error) => setError(e.message))
  }, [open, channelId])
  const add = async () => {
    setBusy(true)
    try {
      await runLocal('geo.brandQuestions', { channel_id: channelId, keys: [...picked] })
      onAdded()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr('geo.brand_fill')}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          {!!list?.length && (
            <Button feedback={false} onClick={add} disabled={busy || !picked.size}>
              {busy ? <Loader2 className="animate-spin" /> : <ListPlus />}
              {tr('geo.brand_add', { n: picked.size })}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">{tr('geo.brand_dialog_desc')}</p>
        {error ? (
          <Notice tone="error">
            {error}
            {/公司资料|company profile/i.test(error) && (
              <button type="button" onClick={() => (onClose(), onGoProfile())} className="ml-1 font-semibold underline underline-offset-2">
                {tr('geo.brand_go_profile')}
              </button>
            )}
          </Notice>
        ) : !list ? (
          <Skeleton className="h-32" />
        ) : !list.length ? (
          <Notice>{tr('geo.brand_none_left')}</Notice>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.map((c) => (
              <li key={c.key}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-accent/40">
                  <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]" />
                  <span className="min-w-0 flex-1 leading-relaxed">{c.question}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}

/** 加一个新的买家问题 / 改已有问题 */
function QuestionDialog({ editing, onClose, onSaved, channelId, brand }: { editing: Partial<GeoQuestion> | null; onClose: () => void; onSaved: () => void; channelId: string; brand: string }) {
  const [question, setQuestion] = useState('')
  const [keywords, setKeywords] = useState('')
  const [intent, setIntent] = useState('commercial')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editing) return
    setQuestion(editing.question ?? '')
    setKeywords(editing.keywords ?? '')
    setIntent(editing.intent || 'commercial')
    setError('')
  }, [editing?.id, !!editing])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = { question: question.trim(), keywords: keywords.trim(), intent }
      if (editing?.id) await dbPatch('geo_questions', editing.id, body)
      else await dbCreate('geo_questions', { ...body, channel_id: channelId, status: 'active', source: 'manual' })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={!!editing}
      onClose={onClose}
      title={editing?.id ? tr('geo.edit_q') : tr('geo.new_q')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          <Button successLabel={tr('ui.saved')} onClick={save} disabled={!question.trim() || busy}>
            {tr('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={tr('geo.q_label')} hint={tr('geo.q_hint')}>
          <textarea autoFocus value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} className={`${inputCls} py-2`} placeholder={tr(`geo.q_ph_${intent}`, { brand })} />
        </Field>
        <Field label={tr('geo.type')}>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(INTENT).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setIntent(k)}
                className={cx('inline-flex h-7 cursor-pointer items-center rounded-md border px-2.5 text-xs font-medium transition-colors', intent === k ? 'border-primary/40 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label={tr('geo.kw')} hint={tr('geo.kw_hint')}>
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className={`${inputCls} h-9`} placeholder={tr(`geo.kw_ph_${intent}`, { brand })} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  )
}

function Visibility({ value, small }: { value: number; small?: boolean }) {
  const tone = value >= 60 ? 'text-emerald-600 dark:text-emerald-400' : value >= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className={cx('relative shrink-0', small ? 'size-12' : 'size-16')} role="img" aria-label={tr('geo.vis_aria', { n: value })}>
      <svg viewBox="0 0 64 64" className={cx('-rotate-90', small ? 'size-12' : 'size-16')}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
        {/* 0% 不画：圆头的线帽长度为 0 时还会留一个点 */}
        {value > 0 && <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} className={tone} />}
      </svg>
      <span className={cx('absolute inset-0 flex items-center justify-center font-semibold tabular-nums', small ? 'text-xs' : 'text-base', tone)}>{value}%</span>
    </div>
  )
}

/** 「AI 推荐了谁」顶上的一行概况：可见度、本站被引用了几个、历次趋势（两次以上才画） */
function VisibilityStrip({ runs }: { runs: GeoRun[] }) {
  const cur = runs[0]
  const hist = [...runs].slice(0, 12).reverse()
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border bg-background px-4 py-3">
      <Visibility value={cur.visibility ?? 0} small />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">
          {tr('geo.vis_label')} · {tr('geo.cited_n', { c: cur.cited ?? 0, n: cur.questions ?? 0 })}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {(cur.mentioned ?? 0) > 0 ? `${tr('geo.mentioned_n', { n: cur.mentioned ?? 0 })} · ` : ''}
          {tr('geo.vis_rule')}
        </div>
      </div>
      {hist.length >= 2 && (
        <div className="flex items-end gap-1" title={tr('geo.history')}>
          {hist.map((r) => (
            <div key={r.id} title={`${r.visibility ?? 0}% · ${fmtTime(r.finished_at || r.created_at)}`} className={cx('w-2 rounded-t-[2px]', (r.visibility ?? 0) > 0 ? 'bg-primary/70' : 'bg-muted')} style={{ height: `${Math.max(3, ((r.visibility ?? 0) / 100) * 32)}px` }} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 状态标签那一列的宽度（放得下最长的「Not mentioned」）；详情的缩进 = 行的左边距 1rem + 这一列 6rem + 间距 0.75rem */
const BADGE_COL = 'flex w-24 shrink-0'
const DETAIL_INDENT = 'pr-4 pb-4 pl-[7.75rem]'

const RESULT: Record<'cited' | 'mentioned' | 'none' | 'idle', { label: string; tone: Tone }> = {
  cited: { get label() { return tr('geo.r_cited') }, tone: 'ok' },
  mentioned: { get label() { return tr('geo.r_mentioned') }, tone: 'warn' },
  none: { get label() { return tr('geo.r_none') }, tone: 'bad' },
  idle: { get label() { return tr('geo.r_idle') }, tone: 'default' },
}

/** 推荐类问题的一行：引用了本站没有、GSC 和本站文章的对照，点开看回答和引用 */
function QuestionRow({ q, r, justAsked, change, asking, channel, onChanged, onEdit, hint }: { q: GeoQuestion; r?: GeoResult; justAsked?: boolean; change?: Change; asking?: string; channel: Channel; onChanged: () => void; onEdit: () => void; hint?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const key = !r ? 'idle' : r.cited ? 'cited' : r.mentioned ? 'mentioned' : 'none'
  const badge = RESULT[key]

  const setStatus = async (status: GeoQuestion['status']) => {
    setBusy(true)
    try {
      await dbPatch('geo_questions', q.id, { status })
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!confirmDel) {
      setConfirmDel(true)
      return
    }
    setBusy(true)
    try {
      await dbDelete('geo_questions', q.id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id={`geo-q-${q.id}`} className={cx('scroll-mt-24 border-b border-border last:border-b-0', q.status === 'paused' && 'opacity-60', asking && 'bg-primary/5', !asking && (change === 'gained' || change === 'lost') && 'bg-amber-500/[0.04]', justAsked && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
      <div className="flex items-start gap-3 px-4 py-3">
        {/* 状态标签占固定宽度的一列：长短不一的标签后面，问题文字和展开的详情都对齐同一条线 */}
        <span className={BADGE_COL}>
          {asking ? <AskingBadge step={asking} /> : (
            <Badge tone={badge.tone} className="mt-0.5">
              {badge.label}
            </Badge>
          )}
        </span>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{justAsked && <NewPill />}{q.question}</span>
            {q.status === 'paused' && <Badge>{tr('geo.paused')}</Badge>}
            {q.intent && INTENT[q.intent] && <span className="text-xs text-muted-foreground">{INTENT[q.intent]}</span>}
            {r && <span className="text-xs text-muted-foreground">{fmtTime(r.created_at)}</span>}
            {change && <ChangeBadge c={change} />}
          </div>
          {q.keywords && <p className="mt-1 truncate text-xs text-muted-foreground">{tr('geo.keywords', { k: q.keywords })}</p>}
          {hint && <span className="mt-1 block">{hint}</span>}
          {r && (
            <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary-text">
              {tr('geo.view_answer', { n: resultUrls(r).length })}
              <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {r && !r.cited && (
            <TaskLaunchButton task={TOPICS_TASK} reqKey="topic_requirements" input={{ channel_id: channel.id, question_ids: [q.id] }} match={(r) => (r.input?.question_ids as string[] | undefined)?.includes(q.id) ?? false} title={tr('geo.gen_topic')} desc={tr('geo.topic_one_desc', { q: q.question })} reqTitle={tr('geo.topics_req_title')} reqHint={tr('geo.topics_req_hint')} startLabel={tr('geo.topics_start')} variant="ghost" icon={Lightbulb} className="text-primary-text">
              {tr('geo.gen_topic')}
            </TaskLaunchButton>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onEdit} className="text-muted-foreground" title={tr('geo.edit_title')}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStatus(q.status === 'paused' ? 'active' : 'paused')} className="text-muted-foreground" title={q.status === 'paused' ? tr('geo.resume_title') : tr('geo.pause_title')}>
            {q.status === 'paused' ? <Play /> : <Pause />}
          </Button>
          {/* 点两下才删：第一下变成「再点一次删除」（和内容中心的删除一样），移开就取消；删了这一行就没了，不要「已完成」 */}
          <Button feedback={false} variant={confirmDel ? 'default' : 'ghost'} size="sm" disabled={busy} onClick={remove} onMouseLeave={() => setConfirmDel(false)} className={cx(confirmDel ? 'bg-destructive text-white hover:bg-destructive/90' : 'text-muted-foreground')} title={tr('geo.del_title')}>
            <Trash2 />
            {confirmDel && tr('geo.del_again')}
          </Button>
        </div>
      </div>
      {open && (
        <div className={DETAIL_INDENT}>
          {!r ? <p className="text-xs text-muted-foreground">{tr('geo.q_not_run')}</p> : <ResultDetail r={r} />}
        </div>
      )}
    </div>
  )
}

/** 品牌问题的一行：AI 怎么回答的（原文 + 引用的网址），不判断对错——什么是对的系统不知道、资料也可能过时，由用户看了判断。
 * 用户觉得哪里说错了，写下来（geo_results.user_report），交给助手查出处、写修正建议（tasks/geo-fix-facts.md） */
function FactRow({ q, r, justAsked, change, asking, onChanged, onEdit }: { q: GeoQuestion; r?: GeoResult; justAsked?: boolean; change?: Change; asking?: string; onChanged: () => void; onEdit: () => void }) {
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState(r?.user_report ?? '')
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => setReport(r?.user_report ?? ''), [r?.id, r?.user_report])
  const answer = r?.answer || r?.answer_excerpt || ''
  // 品牌问题必然带着你的名字，「提到」没有意义：只说回答引用了本站没有
  const badge = !r ? RESULT.idle : r.cited ? RESULT.cited : { label: tr('geo.r_no_site'), tone: 'default' as Tone }
  const patch = async (body: Partial<GeoQuestion>) => {
    setBusy(true)
    try {
      await dbPatch('geo_questions', q.id, body)
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!confirmDel) {
      setConfirmDel(true)
      return
    }
    setBusy(true)
    try {
      await dbDelete('geo_questions', q.id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  // 交给助手前先把用户写的存下来，任务从 geo.factsContext 读
  const saveReport = async () => {
    if (!r) return
    await dbPatch('geo_results', r.id, { user_report: report.trim(), reported_at: new Date().toISOString() })
    return { result_id: r.id }
  }
  return (
    <div id={`geo-q-${q.id}`} className={cx('scroll-mt-24 border-b border-border last:border-b-0', q.status === 'paused' && 'opacity-60', asking && 'bg-primary/5', !asking && (change === 'gained' || change === 'lost') && 'bg-amber-500/[0.04]', justAsked && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className={BADGE_COL}>
          {asking ? <AskingBadge step={asking} /> : (
            <Badge tone={badge.tone} className="mt-0.5">
              {badge.label}
            </Badge>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{justAsked && <NewPill />}{q.question}</span>
            {q.status === 'paused' && <Badge>{tr('geo.paused')}</Badge>}
            {q.source === 'auto' && <span className="text-xs text-muted-foreground">{tr('geo.auto')}</span>}
            {r && <span className="text-xs text-muted-foreground">{fmtTime(r.created_at)}</span>}
            {change && <ChangeBadge c={change} />}
            {r?.user_report && <Badge tone="bad">{tr('geo.reported')}</Badge>}
          </div>
          {!r ? (
            <p className="mt-1 text-xs text-muted-foreground">{tr('geo.q_not_run')}</p>
          ) : (
            <>
              {/* 回答直接摆出来：这一块要的就是用户看 AI 怎么说 */}
              {!open && answer && (
                <button type="button" onClick={() => setOpen(true)} className="mt-1.5 block w-full cursor-pointer text-left">
                  <span className="line-clamp-3 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">{answer.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*|`]/g, '')}</span>
                </button>
              )}
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary-text">
                {open ? tr('geo.collapse') : tr('geo.view_answer', { n: resultUrls(r).length })}
                <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
              </button>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onEdit} className="text-muted-foreground" title={tr('geo.edit_title')}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => patch({ status: q.status === 'paused' ? 'active' : 'paused' })} className="text-muted-foreground" title={q.status === 'paused' ? tr('geo.resume_title') : tr('geo.pause_title')}>
            {q.status === 'paused' ? <Play /> : <Pause />}
          </Button>
          {/* 点两下才删：第一下变成「再点一次删除」（和内容中心的删除一样），移开就取消；删了这一行就没了，不要「已完成」 */}
          <Button feedback={false} variant={confirmDel ? 'default' : 'ghost'} size="sm" disabled={busy} onClick={remove} onMouseLeave={() => setConfirmDel(false)} className={cx(confirmDel ? 'bg-destructive text-white hover:bg-destructive/90' : 'text-muted-foreground')} title={tr('geo.del_title')}>
            <Trash2 />
            {confirmDel && tr('geo.del_again')}
          </Button>
        </div>
      </div>
      {open && r && (
        <div className={cx(DETAIL_INDENT, 'space-y-3')}>
          <ResultDetail r={r} />
          {/* 对不对由用户判断：哪里说错了写下来，交给助手查出处、写修正建议 */}
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="text-xs font-semibold">{tr('geo.report_title')}</div>
            <textarea value={report} onChange={(e) => setReport(e.target.value)} rows={3} className={`${inputCls} py-2 text-xs`} placeholder={tr('geo.report_ph')} />
            <div className="flex flex-wrap items-center gap-2">
              <TaskButton task={GEO_FIX_TASK} beforeRun={saveReport} disabled={!report.trim()} match={(t) => t.input?.result_id === r.id} onFinished={onChanged} variant="outline" icon={Wrench}>
                {r.fix_note ? tr('geo.fix_again') : tr('geo.fix')}
              </TaskButton>
              <span className="text-xs text-muted-foreground">{tr('geo.report_hint')}</span>
            </div>
          </div>
          {r.fix_note && (
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs">
              <div className="font-semibold text-primary-text">{tr('geo.fix_note', { time: fmtTime(r.fixed_at) })}</div>
              <div className="mt-1 leading-relaxed">
                <Markdown text={r.fix_note} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 回答引用的全部网址；老数据没有 urls，用本站的引用 + 竞品域名凑 */
function resultUrls(r: GeoResult): string[] {
  const all = jsonList(r.urls)
  if (all.length) return all
  return [...jsonList(r.cited_urls), ...jsonList(r.competitor_domains).map((d) => `https://${d}`)]
}

/** 一条检测结果的「回答和引用」：AI 的完整回答 + 回答引用的全部网址（本站的标出来） */
function ResultDetail({ r }: { r: GeoResult }) {
  const ours = new Set(jsonList(r.cited_urls))
  const urls = resultUrls(r)
  const answer = r.answer || r.answer_excerpt || ''
  const steps = jsonArr<{ type: string; queries?: string[]; url?: string; sources?: string[] }>(r.searches)
  return (
    <div className="space-y-3">
      {r.searches !== undefined && <Searches steps={steps} />}
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="font-semibold">{tr('geo.answer_full', { engine: engineName(engineOf(r)) })}</span>
          <span>
            {r.model ? r.model : ''}
            {r.tokens ? ` · ${r.tokens} tokens` : ''} · {fmtTime(r.created_at)}
          </span>
        </div>
        {answer ? (
          <div className="mt-2 max-h-96 overflow-y-auto pr-1 text-xs leading-relaxed">
            <Markdown text={answer} />
            {!r.answer && <p className="mt-2 text-muted-foreground">{tr('geo.answer_old')}</p>}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{tr('common.none')}</p>
        )}
      </div>
      <div className="text-xs">
        <div className="font-semibold text-muted-foreground">{tr('geo.all_urls', { n: urls.length })}</div>
        {urls.length === 0 ? (
          <p className="mt-1 text-muted-foreground">{tr('geo.no_urls')}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {urls.map((u) => (
              <li key={u} className="flex min-w-0 items-center gap-2">
                {ours.has(u) ? <Badge tone="ok">{tr('geo.ours')}</Badge> : <span className="w-1.5 shrink-0" />}
                <a href={u} target="_blank" rel="noreferrer" className={cx('inline-flex min-w-0 items-center gap-1 font-mono hover:text-primary-text', ours.has(u) ? 'text-foreground' : 'text-muted-foreground')}>
                  <span className="truncate">{u.replace(/^https?:\/\//, '')}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** AI 这次联网搜了什么：每一步的搜索词、打开的页面，点开看这次搜到的网址 */
function Searches({ steps }: { steps: { type: string; queries?: string[]; url?: string; sources?: string[] }[] }) {
  const [open, setOpen] = useState(-1)
  return (
    <div className="text-xs">
      <div className="font-semibold text-muted-foreground">{tr('geo.searches', { n: steps.length })}</div>
      {steps.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{tr('geo.no_searches')}</p>
      ) : (
        <ol className="mt-1 space-y-1">
          {steps.map((x, i) => {
            const label = x.queries?.length ? x.queries.join(' · ') : x.url ? x.url.replace(/^https?:\/\//, '') : x.type
            const kind = x.type === 'open_page' ? tr('geo.step_open') : x.type === 'find_in_page' ? tr('geo.step_find') : tr('geo.step_search')
            return (
              <li key={i}>
                <button type="button" disabled={!x.sources?.length} onClick={() => setOpen((o) => (o === i ? -1 : i))} className="flex w-full min-w-0 items-center gap-2 text-left enabled:cursor-pointer">
                  <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="shrink-0 text-muted-foreground">{kind}</span>
                  <span className={cx('min-w-0 flex-1 truncate', x.queries?.length ? 'text-foreground' : 'font-mono text-muted-foreground')}>{label}</span>
                  {!!x.sources?.length && (
                    <>
                      <span className="shrink-0 text-muted-foreground">{tr('geo.urls_n', { n: x.sources.length })}</span>
                      <ChevronDown className={cx('size-3.5 shrink-0 text-muted-foreground transition-transform', open === i && 'rotate-180')} />
                    </>
                  )}
                </button>
                {open === i && (
                  <ul className="mt-0.5 space-y-0.5 pl-7">
                    {x.sources!.map((u) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-mono text-muted-foreground hover:text-primary-text">
                          <span className="truncate">{u.replace(/^https?:\/\//, '')}</span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** 检测记录里一次检测的明细：每个问题一行，点开看回答和引用 */
function RunResults({ results }: { results: GeoResult[] }) {
  const [open, setOpen] = useState('')
  if (!results.length) return <p className="px-3 py-3 text-xs text-muted-foreground">{tr('geo.no_detail')}</p>
  return (
    <div className="divide-y divide-border">
      {results.map((r) => {
        const badge = RESULT[r.cited ? 'cited' : r.mentioned ? 'mentioned' : 'none']
        return (
          <div key={r.id} className="px-3 py-2">
            <button type="button" onClick={() => setOpen((o) => (o === r.id ? '' : r.id))} aria-expanded={open === r.id} className="flex w-full cursor-pointer items-center gap-2 text-left">
              <span className={BADGE_COL}>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{r.question}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{tr('geo.urls_n', { n: resultUrls(r).length })}</span>
              <ChevronDown className={cx('size-3.5 shrink-0 text-muted-foreground transition-transform', open === r.id && 'rotate-180')} />
            </button>
            {open === r.id && (
              <div className="mt-2 pl-[6.5rem]">
                <ResultDetail r={r} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
