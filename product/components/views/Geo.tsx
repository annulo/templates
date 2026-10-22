import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ExternalLink, Lightbulb, ListPlus, Loader2, MessageCircle, Pause, Pencil, Play, Plus, RotateCw, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { Badge, Button, Dialog, ErrorDetails, Field, Notice, Panel, PageHeader, Skeleton, cx, fmtTime, inputCls, toast, type Tone } from '../ui'
import { dbCreate, dbDelete, dbList, dbPatch, geoBatchDoneText, geoBatchOf, geoSummary, geoUnseen, newestFirst, runLocal, type Article, type Channel, type GeoQuestion, type GeoResult, type GeoRun, type GeoSummary, type SearchPage, type Topic, isSite } from '../../lib/shuttle'
import { topicsFrom } from '../../lib/origins'
import SitePicker from '../SitePicker'
import Markdown from '../Markdown'
import { GeoEnginesBar, GeoEnginesDialog, useGeoEngines } from '../GeoEngines'
import { TaskButton, TaskLaunchButton } from '../Task'
import { TOPICS_TASK } from './Content'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

/** 任务 id（tasks/geo-questions.md）：「生成问题」交给助手，写还不知道这家公司的买家会问的问题 */
const GEO_Q_TASK = 'geo-questions'
/** 任务 id（tasks/geo-ask.md）：就一条 AI 回答问助手（为什么没引用我们、怎么优化、说错了…），结论存回这条回答下面 */
const GEO_ASK_TASK = 'geo-ask'

/** 问题的问题类型 */
const INTENT: Record<string, string> = Object.defineProperties(
  {},
  Object.fromEntries(['commercial', 'comparison', 'informational', 'brand'].map((k) => [k, { enumerable: true, get: () => tr(`geo.i_${k}`) }])),
)

/** 引擎的显示名；老数据没有 engine 字段的是 Perplexity */
const ENGINE_NAME: Record<string, string> = { openai: 'ChatGPT', perplexity: 'Perplexity', chatgpt: 'ChatGPT', deepseek: 'DeepSeek', kimi: 'Kimi', get doubao() { return tr('geo.doubao') }, get yuanbao() { return tr('geo.yuanbao') } }
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
  /** 写成的选题和它们的文章（不分网站：文章不一定填了 channel_id）：问题下面显示这个问题写成了什么、发布后有没有被引用 */
  const [topics, setTopics] = useState<Topic[]>([])
  const [allArticles, setAllArticles] = useState<Article[]>([])
  /** 品牌词（小写）：资料里的品牌词、公司名、网站名。问题里带着它的算品牌问题（和 local/geo.ts 的 isBrandQ 一样） */
  const [brands, setBrands] = useState<string[]>([])
  const [error, setError] = useState('')
  const [noTable, setNoTable] = useState(false)
  /** 正在编辑的问题；没有 id 表示新建 */
  const [editing, setEditing] = useState<Partial<GeoQuestion> | null>(null)
  /** 检测记录里点开看明细的那次检测 */
  const [openRun, setOpenRun] = useState('')
  /** 这个页面发起的检测的进度（geo.check 的 progress：done / total / asking：每个 AI 正在问哪个问题） */
  const [prog, setProg] = useState<CheckProgress | null>(null)
  const [checkErr, setCheckErr] = useState('')
  const [checkedNow, setCheckedNow] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // 问哪些 AI、接口用 Annulo 里的哪个服务商：「检测设置」里配（local/geo.ts engines / saveEngine）
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
        // 表刚建好、Annulo 还没重启时读不到，单独给一句能懂的话
        if (/没有这张表|table not found/i.test(e.message)) setNoTable(true)
        else setError(e.message)
      })
    // 「AI 推荐了谁」对照用：GSC 的页面和搜索词、本站文章；读不到（没连 Google、表没建）就不显示这些提示
    dbList('search_pages').then((l) => setPages(l.filter((x) => x.channel_id === channel.id))).catch(() => setPages([]))
    dbList('articles').then((l) => (setArticles(l.filter((x) => x.channel_id === channel.id)), setAllArticles(l))).catch(() => (setArticles([]), setAllArticles([])))
    dbList('topics').then(setTopics).catch(() => setTopics([]))
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
      await Promise.all([load(), eng$.reload()])
    } finally {
      setRefreshing(false)
    }
  }
  // 助手改了数据：静默重拉，不清空
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])

  // 一次检测 = 几个 AI 同时问，每个一条 geo_runs（batch_id 一样）；老数据一条就是一次
  const last = runs[0]
  const batch = useMemo(() => (last ? geoBatchOf(last, runs) : []), [runs])
  const recent = (r: GeoRun) => Date.now() - (Date.parse(r.started_at || r.created_at || '') || 0) < 60 * 60 * 1000
  // 别处发起、还在跑的检测（定时任务、离开页面前点的）：这次检测里有开始没结束、一小时内开始的
  const busyRun = !prog ? (batch.find((r) => !r.finished_at && recent(r)) ?? null) : null
  // 别处发起的检测还在跑：每 8 秒重拉，问完一个就显示一个
  useEffect(() => {
    if (!busyRun) return
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [busyRun?.id, load])
  const batchKey = last ? last.batch_id || last.id : ''
  const finished = !prog && !busyRun && batch.length > 0 && batch.every((r) => r.finished_at)

  const startCheck = async (retryRunId?: string) => {
    if (!channel) return
    setJustDone('')
    setCheckErr('')
    setCheckedNow(false)
    setProg({ done: 0, total: 0, started: Date.now() })
    let done = -1
    try {
      const res = await runLocal<{ run_id?: string; batch_id?: string }>('geo.check', { channel_id: channel.id, ...(retryRunId ? { retry_run_id: retryRunId } : {}) }, (ev) => {
        if (ev.type !== 'progress') return
        const d = ev.data as CheckProgress
        setProg((p) => ({ ...d, started: p?.started ?? Date.now() }))
        // 问完一个（done 变了）就重拉，答案马上出现在格子里
        if (typeof d.done === 'number' && d.done !== done) {
          done = d.done
          load()
        }
      })
      setCheckedNow(true)
      setTimeout(() => setCheckedNow(false), 2000)
      setJump(true) // 跑完滚到第一个有变化的问题
      if (res?.batch_id || res?.run_id) setJustDone(res.batch_id || res.run_id || '')
    } catch (e) {
      setCheckErr((e as Error).message)
    } finally {
      setProg(null)
      load()
      window.postMessage({ type: 'shuttle:refresh' }, window.location.origin)
    }
  }

  // 每个问题在每个 AI 上最新一次的结果（dbList 按时间倒序，第一条就是最新的）
  const latest = useMemo(() => {
    const m = new Map<string, GeoResult>()
    for (const r of results) {
      const k = `${r.question_id}|${engineOf(r)}`
      if (r.question_id && !m.has(k)) m.set(k, r)
    }
    return m
  }, [results])
  const get = useCallback((qid: string, eng: string) => latest.get(`${qid}|${eng}`), [latest])
  // 矩阵的列：检测设置里打开的 AI，加上这些问题有结果的（关掉了也还看得到上次的结果）
  const cols = useMemo<Col[]>(() => {
    const qids = new Set((questions ?? []).map((q) => q.id))
    const used = new Set<string>()
    for (const k of latest.keys()) {
      const [qid, e] = k.split('|')
      if (qids.has(qid)) used.add(e)
    }
    const list = eng$.data?.engines ?? []
    const out: Col[] = list.filter((e) => e.enabled || used.has(e.engine)).map((e) => ({ key: e.engine, name: e.name, enabled: e.enabled }))
    for (const e of used) if (!out.some((c) => c.key === e)) out.push({ key: e, name: engineName(e), enabled: false })
    return out
  }, [eng$.data, latest, questions])
  const nameOf = (k: string) => cols.find((c) => c.key === k)?.name ?? engineName(k)

  // 这次检测的结论（每个 AI 一份）；里面的变化标到对应的格子上
  const sums = useMemo(() => (finished ? batch.map((run) => ({ run, s: geoSummary(run) })).filter((x): x is { run: GeoRun; s: GeoSummary } => !!x.s) : []), [finished, batch])
  const changeOf = useMemo(() => {
    const m = new Map<string, Change>()
    for (const { run, s } of sums) {
      const e = engineOf(run)
      for (const id of s.fresh) m.set(`${id}|${e}`, 'fresh')
      for (const id of s.gained) m.set(`${id}|${e}`, 'gained')
      for (const id of s.lost) m.set(`${id}|${e}`, 'lost')
    }
    return m
  }, [sums])
  // 看到了就算看过：侧栏「AI 搜索推荐」的「新」去掉（Index 听 db:changed）
  useEffect(() => {
    if (prog) return
    for (const r of batch) if (geoUnseen(r)) dbPatch('geo_runs', r.id, { seen_at: new Date().toISOString() }).catch(() => {})
  }, [batchKey, batch.map((r) => `${r.seen_at}${r.finished_at}`).join(), !!prog])
  // 滚到第一个有变化的问题（跑完时，或点了结论里的「新引用了 / 这次没引用」）
  const [jump, setJump] = useState(false)
  const firstChanged = (only?: Change) =>
    (questions ?? []).find((q) => cols.some((c) => {
      const ch = changeOf.get(`${q.id}|${c.key}`)
      return only ? ch === only : ch && ch !== 'fresh'
    }))
  const scrollTo = (q?: GeoQuestion) => q && document.getElementById(`geo-q-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // 从选题的「来源」点过来（?q=问题 id）：定位到那个问题
  useEffect(() => {
    if (!params.q || !questions?.length) return
    setTimeout(() => scrollTo(questions.find((q) => q.id === params.q)), 300)
  }, [params.q, questions?.length])
  useEffect(() => {
    if (!jump || !sums.length) return
    setJump(false)
    setTimeout(() => scrollTo(firstChanged()), 300)
  }, [jump, sums.length])
  // 在这个页面上跑完的那次检测（这页点的，或者别处发起、在这页看着跑完的）：卡片变成「检测完成」、弹提示
  const [justDone, setJustDone] = useState('')
  const watching = useRef('')
  useEffect(() => {
    if (busyRun) watching.current = batchKey
    else if (watching.current && watching.current === batchKey && finished) {
      setJustDone(batchKey)
      watching.current = ''
    }
  }, [busyRun?.id, batchKey, finished])
  const toasted = useRef('')
  const done = !!justDone && justDone === batchKey && finished ? last : null
  useEffect(() => {
    if (!done || toasted.current === batchKey) return
    toasted.current = batchKey
    toast(geoBatchDoneText(batch))
  }, [done?.id, batchKey])
  const isBrand = (q: GeoQuestion) => q.intent === 'brand' || brands.some((b) => q.question.toLowerCase().includes(b))
  const brandQs = useMemo(() => (questions ?? []).filter(isBrand), [questions, brands])
  const recQs = useMemo(() => (questions ?? []).filter((q) => !isBrand(q)), [questions, brands])
  // 「AI 推荐了谁」：推荐类问题在各个 AI 上最新的回答引用的网站，按被几个问题引用排
  const citedSites = useMemo(() => {
    const m = new Map<string, { host: string; ours: boolean; questions: Set<string>; pages: Set<string> }>()
    for (const q of recQs) {
      for (const c of cols) {
        const r = get(q.id, c.key)
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
    }
    return [...m.values()].sort((a, b) => b.questions.size - a.questions.size)
  }, [recQs, cols, get])

  if (!channel)
    return (
      <div className="space-y-6">
        <PageHeader title={tr('geo.title')} />
        <Notice>{tr('geo.no_site')}</Notice>
      </div>
    )

  // 推荐类问题：哪个 AI 都没引用本站的，可以写成选题
  const uncited = recQs.filter((q) => q.status === 'active' && cols.some((c) => get(q.id, c.key)) && !cols.some((c) => get(q.id, c.key)?.cited))
  // 品牌问题：还没看过的回答、标了说错还没查原因的
  const brandResults = brandQs.flatMap((q) => cols.map((c) => get(q.id, c.key)).filter((r): r is GeoResult => !!r))
  const pending = brandResults.filter((r) => !r.seen_at).length
  const reported = brandResults.filter((r) => r.user_report && !r.fix_note).length
  const running = !!prog || !!busyRun
  const noEngine = !!eng$.data && !eng$.data.engines.some((e) => e.enabled)
  // 正在问：页面发起的看 progress 里每个 AI 在问哪个；别处发起的看不到逐步进度
  const askingOf = (qid: string, eng: string) => prog?.asking?.find((a) => a.question_id === qid && a.engine === eng)?.step || (!prog?.asking && prog?.question_id === qid && cols[0]?.key === eng ? prog.step || tr('geo.asking') : '')
  const batchIds = new Set(batch.map((r) => r.id))

  return (
    <div className="space-y-8">
      {/* 问哪些 AI、检测设置放在标题右边：一行说清，不单独占一块 */}
      <PageHeader title={tr('geo.title')} desc={tr('geo.desc2')} actions={<GeoEnginesBar data={eng$.data} error={eng$.error} onOpen={() => setEngOpen(true)} />} />
      <SitePicker sites={sites} value={channel.id} onChange={(v) => setParam('channel', v)} />
      <GeoEnginesDialog open={engOpen} onClose={() => setEngOpen(false)} data={eng$.data} onSaved={eng$.reload} />
      {error && <Notice tone="error">{error}</Notice>}
      {noTable && <Notice>{tr('geo.no_table')}</Notice>}

      {!noTable && questions === null ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : noTable ? null : (
        <>
          {/* 检测：一次问完打开的所有 AI，每周自动一次。跑的时候这里显示完整进度 */}
          <div className={cx('rounded-xl border bg-background px-5 py-4 transition-colors', running ? 'border-primary/40' : done ? 'border-emerald-500/50' : 'border-border')}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="min-w-0 flex-1 text-sm">
                {running ? (
                  <div className="flex items-center gap-2 font-semibold">
                    <Loader2 className="size-4 animate-spin text-primary-text" />
                    {prog ? tr('geo.checking', { done: prog.done ?? 0, total: prog.total || '…' }) : tr('geo.checking_bg', { time: fmtTime(busyRun?.started_at || busyRun?.created_at) })}
                  </div>
                ) : done ? (
                  <div className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-4" />
                    {tr('geo.just_done', { t: durationOf(batch) })}
                  </div>
                ) : (
                  <div className="font-semibold">{last ? tr('geo.last_run', { time: fmtTime(last.finished_at || last.created_at) }) : tr('geo.never_run')}</div>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {noEngine ? tr('geo.pick_engine_first') : running && !prog ? tr('geo.checking_bg_hint', { n: results.filter((x) => batchIds.has(x.run_id ?? '')).length }) : tr('geo.run_hint2')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* 拉一次要一两秒（在线项目每张表都要去 creght 跑一趟）：拉的时候图标转起来，看得出点到了 */}
                <Button feedback={false} variant="ghost" size="sm" disabled={refreshing} onClick={refresh} className="text-muted-foreground">
                  <RotateCw className={cx(refreshing && 'animate-spin')} /> {tr('common.refresh')}
                </Button>
                {/* 一个 AI 都没开（默认不开，让用户挑自己的买家在用的）：这里直接去「检测设置」打开 */}
                {noEngine ? (
                  <Button feedback={false} size={last ? 'sm' : 'default'} onClick={() => setEngOpen(true)}>
                    <Settings2 /> {tr('geo.pick_engine_btn')}
                  </Button>
                ) : (
                  <Button feedback={false} size={last ? 'sm' : 'default'} disabled={running} onClick={() => startCheck()}>
                    {running ? <Loader2 className="animate-spin" /> : <Play />}
                    {running ? tr('ui.running') : checkedNow ? tr('ui.done') : last ? tr('geo.rerun') : tr('geo.start')}
                  </Button>
                )}
              </div>
            </div>
            {prog && <CheckProgressBar p={prog} nameOf={nameOf} />}
            {sums.length > 0 && (
              <BatchSummary
                items={sums}
                nameOf={nameOf}
                pending={pending}
                reported={reported}
                onRetry={(id) => startCheck(id)}
                onJump={(c) => scrollTo(firstChanged(c))}
                onBrand={() => document.getElementById('geo-s1')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                onGen={() => document.getElementById('geo-s2')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
            )}
            {checkErr && (
              <div className="mt-3">
                <ErrorDetails message={checkErr} actions={engAction(checkErr)} />
              </div>
            )}
          </div>

          {/* 1. AI 怎么介绍你：问题 × AI 的矩阵，格子里是「新 / 已看 / 说错」，点开一行几家的回答并排看 */}
          <section id="geo-s1" className="scroll-mt-4 space-y-3">
            <SectionHead n={1} title={tr('geo.s1_title')} desc={tr('geo.s1_desc2')}>
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
              <Matrix cols={cols} head={tr('geo.m_brand_head', { n: brandQs.length })}>
                {brandQs.map((q) => (
                  <BrandRow key={q.id} q={q} cols={cols} get={get} askingOf={askingOf} onChanged={load} onEdit={() => setEditing(q)} />
                ))}
              </Matrix>
            )}
            {brandQs.length > 0 && cols.length > 0 && <p className="text-xs leading-relaxed text-muted-foreground">{tr('geo.m_brand_legend')}</p>}
          </section>

          {/* 2. AI 推荐了谁：问题 × AI 的矩阵，格子里是引用了本站没有，点格子看那家的回答 */}
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
                {citedSites.length > 0 && <CitedSites sites={citedSites} total={recQs.filter((q) => cols.some((c) => get(q.id, c.key))).length} />}
                {uncited.length > 0 && (
                  <div className="flex justify-end">
                    <TaskLaunchButton task={TOPICS_TASK} reqKey="topic_requirements" input={{ channel_id: channel.id }} match={(r) => r.input?.channel_id === channel.id && !r.input?.question_ids} title={tr('geo.to_topics', { n: uncited.length })} desc={tr('geo.topics_desc', { n: uncited.length })} reqTitle={tr('geo.topics_req_title')} reqHint={tr('geo.topics_req_hint')} startLabel={tr('geo.topics_start')} variant="outline" icon={Lightbulb}>
                      {tr('geo.to_topics', { n: uncited.length })}
                    </TaskLaunchButton>
                  </div>
                )}
                <Matrix cols={cols} head={tr('geo.m_rec_head', { n: recQs.length })} sub={(c) => <RecColHead runs={runs} eng={c.key} />}>
                  {recQs.map((q) => (
                    <RecRow key={q.id} q={q} cols={cols} get={get} askingOf={askingOf} changeOf={changeOf} channel={channel} onChanged={load} onEdit={() => setEditing(q)} hint={<Hints q={q} pages={pages} articles={articles} linked={<Linked ctx={ctx} q={q} topics={topics} articles={allArticles} results={results} />} />} />
                  ))}
                </Matrix>
                <p className="text-xs leading-relaxed text-muted-foreground">{tr('geo.m_rec_legend')}</p>
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
                    {runs.slice(0, 20).map((r) => (
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

/** 这次检测用了多久（几个 AI 同时问：最早开始到最晚结束）：「23 秒」「2 分 05 秒」 */
function durationOf(batch: GeoRun[]): string {
  const start = Math.min(...batch.map((r) => Date.parse(r.started_at || r.created_at || '') || Infinity))
  const end = Math.max(...batch.map((r) => Date.parse(r.finished_at || '') || 0))
  const secs = Math.max(0, Math.round((end - start) / 1000)) || 0
  return secs >= 60 ? tr('geo.dur_min', { m: Math.floor(secs / 60), s: String(secs % 60).padStart(2, '0') }) : tr('geo.dur_sec', { s: secs })
}

type CheckProgress = { done?: number; total?: number; message?: string; question_id?: string; question?: string; step?: string; started?: number; asking?: { engine: string; question_id: string; question?: string; step?: string; done?: number; total?: number }[] }

/** 检测进度：进度条、每个 AI 正在问哪个问题（第几个）、用了多久 */
function CheckProgressBar({ p, nameOf }: { p: CheckProgress; nameOf: (k: string) => string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.round((Date.now() - (p.started ?? Date.now())) / 1000))
  const pct = p.total ? Math.round(((p.done ?? 0) / p.total) * 100) : 0
  const list = p.asking ?? []
  return (
    <div className="mt-3 space-y-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(pct, p.total ? 3 : 0)}%` }} />
      </div>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs">
        {list.length ? (
          <ul className="min-w-0 flex-1 space-y-0.5">
            {list.map((a) => (
              <li key={a.engine} className="flex min-w-0 gap-2">
                <span className="w-24 shrink-0 truncate font-semibold">{nameOf(a.engine)}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {(a.done ?? 0) + 1}/{a.total ?? '…'}
                </span>
                <span className="min-w-0 truncate">{a.question}</span>
              </li>
            ))}
          </ul>
        ) : p.question ? (
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

/** 矩阵的一列：一个 AI。enabled = 检测设置里开着（关掉的只是还留着上次的结果） */
type Col = { key: string; name: string; enabled: boolean }
type GetResult = (qid: string, eng: string) => GeoResult | undefined
type AskingOf = (qid: string, eng: string) => string

/** 格子一列的宽度：放得下「已看」「说错」和引擎名的前几个字 */
const CELL_W = '6.5rem'
const gridOf = (n: number) => ({ gridTemplateColumns: `minmax(16rem, 1fr) repeat(${n}, ${CELL_W})` })

/**
 * 问题 × AI 的矩阵：左边一列问题，每个 AI 一列格子。格子里只放事实（新 / 已看 / 说错，或者引用了没有），
 * 回答原文点开再看：10 个问题 × 5 个 AI 也是 10 行，不是 50 段回答。列多了左右滑
 */
function Matrix({ cols, head, sub, children }: { cols: Col[]; head: string; sub?: (c: Col) => ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-background">
      <div style={{ minWidth: `calc(16rem + ${cols.length} * ${CELL_W})` }}>
        <div className="grid items-end border-b border-border bg-muted/40 text-xs text-muted-foreground" style={gridOf(cols.length)}>
          <div className="px-4 py-2 font-medium">{head}</div>
          {cols.map((c) => (
            <div key={c.key} className="px-1.5 py-2 text-center" title={c.enabled ? c.name : tr('geo.m_col_off', { name: c.name })}>
              <div className={cx('line-clamp-2 leading-tight font-medium break-words', !c.enabled && 'opacity-60')}>{c.name}</div>
              {sub?.(c)}
            </div>
          ))}
        </div>
        {cols.length === 0 ? <p className="px-4 py-3 text-xs text-muted-foreground">{tr('geo.m_no_cols')}</p> : children}
      </div>
    </div>
  )
}

/** 「AI 推荐了谁」每一列的表头：这个 AI 最近一次检测里，推荐类问题引用了本站几个 */
function RecColHead({ runs, eng }: { runs: GeoRun[]; eng: string }) {
  const r = runs.find((x) => engineOf(x) === eng && x.finished_at && (x.questions ?? 0) > 0)
  if (!r) return <div className="mt-0.5 tabular-nums opacity-60">–</div>
  const v = r.visibility ?? 0
  return (
    <div className={cx('mt-0.5 font-semibold tabular-nums', v >= 60 ? 'text-emerald-600 dark:text-emerald-400' : v > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-destructive')} title={tr('geo.m_vis_title', { c: r.cited ?? 0, n: r.questions ?? 0, v })}>
      {r.cited ?? 0}/{r.questions}
    </div>
  )
}

/** 「新」：和内容中心的新文章同一个样子（core/components/views/Content.tsx） */
function NewTag() {
  return <span className="inline-flex h-5 items-center rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{tr('article.new_badge')}</span>
}

/** 编辑、暂停、删除（点两下才删：第一下变成「再点一次删除」，移开就取消） */
function QuestionActions({ q, onChanged, onEdit }: { q: GeoQuestion; onChanged: () => void; onEdit: () => void }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await f()
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex shrink-0 items-center opacity-70 group-hover:opacity-100">
      <Button variant="ghost" size="icon-sm" disabled={busy} onClick={onEdit} className="text-muted-foreground" title={tr('geo.edit_title')}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => run(() => dbPatch('geo_questions', q.id, { status: q.status === 'paused' ? 'active' : 'paused' }))} className="text-muted-foreground" title={q.status === 'paused' ? tr('geo.resume_title') : tr('geo.pause_title')}>
        {q.status === 'paused' ? <Play /> : <Pause />}
      </Button>
      <Button
        feedback={false}
        variant={confirmDel ? 'default' : 'ghost'}
        size="sm"
        disabled={busy}
        onClick={() => (confirmDel ? run(() => dbDelete('geo_questions', q.id)) : setConfirmDel(true))}
        onMouseLeave={() => setConfirmDel(false)}
        className={cx(confirmDel ? 'bg-destructive text-white hover:bg-destructive/90' : 'px-2 text-muted-foreground')}
        title={tr('geo.del_title')}
      >
        <Trash2 />
        {confirmDel && tr('geo.del_again')}
      </Button>
    </div>
  )
}

/** 品牌问题的格子：这个 AI 的回答要不要你看——新（还没看）、已看、说错（你标过）；引用了本站加个绿点 */
function BrandCell({ r, asking }: { r?: GeoResult; asking: string }) {
  if (asking) return <Loader2 className="size-4 animate-spin text-primary-text" aria-label={asking} />
  if (!r) return <span className="text-muted-foreground/60" title={tr('geo.q_not_run')}>·</span>
  return (
    <span className="inline-flex items-center gap-1">
      {r.user_report ? (
        <span className="inline-flex h-5 items-center rounded bg-destructive/10 px-1.5 text-[11px] font-semibold text-destructive">{tr('geo.m_reported')}</span>
      ) : !r.seen_at ? (
        <NewTag />
      ) : (
        <span className="text-xs text-muted-foreground">{tr('geo.m_seen')}</span>
      )}
      {r.cited && <span className="size-1.5 rounded-full bg-emerald-500" title={tr('geo.r_cited')} />}
    </span>
  )
}

/**
 * 品牌问题的一行：每个 AI 一个格子。点开一行，几家 AI 的回答并排看（「各家怎么说你」），看了的格子变成「已看」；
 * 哪家说错了就在那家的回答下面写下来，交给助手查出处、写修正建议
 */
function BrandRow({ q, cols, get, askingOf, onChanged, onEdit }: { q: GeoQuestion; cols: Col[]; get: GetResult; askingOf: AskingOf; onChanged: () => void; onEdit: () => void }) {
  const [open, setOpen] = useState(false)
  const rs = cols.map((c) => get(q.id, c.key))
  const asking = cols.some((c) => askingOf(q.id, c.key))
  const toggle = async () => {
    const next = !open
    setOpen(next)
    // 点开了就算看过这几家的回答
    const unseen = rs.filter((r): r is GeoResult => !!r && !r.seen_at)
    if (next && unseen.length) {
      const now = new Date().toISOString()
      await Promise.all(unseen.map((r) => dbPatch('geo_results', r.id, { seen_at: now }).catch(() => {})))
      onChanged()
    }
  }
  return (
    <div id={`geo-q-${q.id}`} className={cx('group scroll-mt-24 border-b border-border last:border-b-0', q.status === 'paused' && 'opacity-60', asking && 'bg-primary/5', rs.some((r) => r && !r.seen_at) && !open && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]')}>
      <div className="grid items-center" style={gridOf(cols.length)}>
        <div className="flex min-w-0 items-start gap-2 py-2 pr-2 pl-4">
          <button type="button" onClick={toggle} aria-expanded={open} className="min-w-0 flex-1 cursor-pointer text-left">
            <span className="text-sm font-medium">{q.question}</span>
            <span className="ml-2 inline-flex flex-wrap items-center gap-2 align-middle text-xs text-muted-foreground">
              {q.status === 'paused' && <Badge>{tr('geo.paused')}</Badge>}
              {q.source === 'auto' && <span>{tr('geo.auto')}</span>}
              <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
            </span>
          </button>
          <QuestionActions q={q} onChanged={onChanged} onEdit={onEdit} />
        </div>
        {cols.map((c, i) => (
          <button key={c.key} type="button" onClick={toggle} className="flex h-full cursor-pointer items-center justify-center border-l border-border/60 px-1 hover:bg-accent/40" title={`${c.name}`}>
            <BrandCell r={rs[i]} asking={askingOf(q.id, c.key)} />
          </button>
        ))}
      </div>
      {open && (
        <div className="grid gap-3 px-4 pb-4 md:grid-cols-2 2xl:grid-cols-3">
          {cols.map((c, i) => (
            <AnswerCard key={c.key} name={c.name} r={rs[i]} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 一家 AI 对一个品牌问题的回答：原文、引用了本站没有；「回答和引用」看搜了什么、引用了哪些网址；说错了写下来交给助手 */
function AnswerCard({ name, r, onChanged }: { name: string; r?: GeoResult; onChanged: () => void }) {
  const [more, setMore] = useState(false)
  if (!r)
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{name}</span> · {tr('geo.q_not_run')}
      </div>
    )
  const answer = r.answer || r.answer_excerpt || ''
  return (
    <div className={cx('flex min-w-0 flex-col rounded-lg border p-3', r.user_report ? 'border-destructive/40' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">{name}</span>
        <Badge tone={r.cited ? 'ok' : 'default'}>{r.cited ? tr('geo.r_cited') : tr('geo.r_no_site')}</Badge>
        <span className="text-muted-foreground">{fmtTime(r.created_at)}</span>
      </div>
      {answer ? (
        <div className="mt-2 max-h-72 overflow-y-auto pr-1 text-xs leading-relaxed">
          <Markdown text={answer} />
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{tr('common.none')}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="inline-flex cursor-pointer items-center gap-1 font-medium text-primary-text">
          {r.searches !== undefined ? tr('geo.m_sources', { s: searchedUrls(r).length, n: resultUrls(r).length }) : tr('geo.m_sources_cited', { n: resultUrls(r).length })}
          <ChevronDown className={cx('size-3.5 transition-transform', more && 'rotate-180')} />
        </button>
      </div>
      {more && (
        <div className="mt-2">
          <ResultDetail r={r} noAnswer />
        </div>
      )}
      {/* 看了有疑问就问助手：为什么没引用我们、怎么优化、说错了……都行，不限一种 */}
      <AskBox r={r} engine={name} onChanged={onChanged} />
      {r.fix_note && (
        <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-2.5 text-xs">
          <div className="font-semibold text-primary-text">{tr('geo.ask_note', { time: fmtTime(r.fixed_at) })}</div>
          <div className="mt-1 leading-relaxed">
            <Markdown text={r.fix_note} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 就这家 AI 的这条回答问助手：用户想问什么都行（为什么没引用我们、怎么让它推荐我们、这里说错了、这个说法从哪来……），
 * 给几个常用的问法点一下就填上。交给助手（tasks/geo-ask.md，新开一段对话在后台跑），助手的结论存回这条回答下面。
 * 用的是「这里说错了」的，同时记成说错（格子显示「说错」）
 */
function AskBox({ r, engine, onChanged }: { r: GeoResult; engine: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [ask, setAsk] = useState('')
  const recommend = r.kind !== 'facts'
  const presets = [r.cited ? '' : tr('geo.ask_why'), tr('geo.ask_how'), tr('geo.ask_wrong')].filter(Boolean)
  const wrong = tr('geo.ask_wrong')
  const beforeRun = async () => {
    const text = ask.trim()
    // 说的是说错了：记下来，格子显示「说错」
    if (text.startsWith(wrong.replace(/[:：]\s*$/, ''))) await dbPatch('geo_results', r.id, { user_report: text, reported_at: new Date().toISOString() })
    return { result_id: r.id, ask: text }
  }
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary-text">
        <MessageCircle className="size-3.5" /> {tr('geo.ask_open', { engine })}
      </button>
    )
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border p-2.5">
      <div className="text-xs font-semibold">{tr('geo.ask_title', { engine })}</div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => setAsk(p)} className="inline-flex h-6 cursor-pointer items-center rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
            {p}
          </button>
        ))}
      </div>
      <textarea autoFocus value={ask} onChange={(e) => setAsk(e.target.value)} rows={2} className={`${inputCls} py-2 text-xs`} placeholder={recommend ? tr('geo.ask_ph_rec') : tr('geo.ask_ph')} />
      <div className="flex flex-wrap items-center gap-2">
        <TaskButton task={GEO_ASK_TASK} beforeRun={beforeRun} disabled={!ask.trim()} match={(t) => t.input?.result_id === r.id} onFinished={onChanged} variant="outline" icon={MessageCircle}>
          {tr('geo.ask_send')}
        </TaskButton>
        <span className="text-xs text-muted-foreground">{tr('geo.ask_hint')}</span>
      </div>
    </div>
  )
}

/** 推荐类问题的格子：这个 AI 的回答引用了本站（✓）、只提到了（◐）、都没有（·）、还没问（–）；比上次多了 / 少了加个箭头 */
function RecCell({ r, asking, change }: { r?: GeoResult; asking: string; change?: Change }) {
  if (asking) return <Loader2 className="size-4 animate-spin text-primary-text" aria-label={asking} />
  if (!r) return <span className="text-muted-foreground/60" title={tr('geo.q_not_run')}>–</span>
  const mark = r.cited ? (
    <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-600 dark:text-emerald-400" title={tr('geo.r_cited')}>✓</span>
  ) : r.mentioned ? (
    <span className="inline-flex size-5 items-center justify-center rounded-full bg-amber-500/15 text-xs font-bold text-amber-600 dark:text-amber-400" title={tr('geo.r_mentioned')}>◐</span>
  ) : (
    <span className="inline-flex size-5 items-center justify-center text-muted-foreground" title={tr('geo.r_none')}>·</span>
  )
  return (
    <span className="inline-flex items-center gap-0.5">
      {mark}
      {change === 'gained' && <ArrowUp className="size-3 text-emerald-600 dark:text-emerald-400" aria-label={tr('geo.ch_gained')} />}
      {change === 'lost' && <ArrowDown className="size-3 text-amber-600 dark:text-amber-400" aria-label={tr('geo.ch_lost')} />}
    </span>
  )
}

/** 推荐类问题的一行：每个 AI 一个格子，点格子在下面看那家的回答、搜了什么、引用了谁；GSC 排名和本站文章的对照在问题下面 */
function RecRow({ q, cols, get, askingOf, changeOf, channel, onChanged, onEdit, hint }: { q: GeoQuestion; cols: Col[]; get: GetResult; askingOf: AskingOf; changeOf: Map<string, Change>; channel: Channel; onChanged: () => void; onEdit: () => void; hint?: ReactNode }) {
  const [open, setOpen] = useState('')
  const rs = cols.map((c) => get(q.id, c.key))
  const asked = rs.some(Boolean)
  const anyCited = rs.some((r) => r?.cited)
  const firstWithResult = cols.find((_, i) => rs[i])?.key ?? cols[0]?.key ?? ''
  const openR = open ? get(q.id, open) : undefined
  return (
    <div id={`geo-q-${q.id}`} className={cx('group scroll-mt-24 border-b border-border last:border-b-0', q.status === 'paused' && 'opacity-60', cols.some((c) => askingOf(q.id, c.key)) && 'bg-primary/5')}>
      <div className="grid items-center" style={gridOf(cols.length)}>
        <div className="flex min-w-0 items-start gap-2 py-2 pr-2 pl-4">
          <button type="button" onClick={() => setOpen((o) => (o ? '' : firstWithResult))} aria-expanded={!!open} className="min-w-0 flex-1 cursor-pointer text-left">
            <span className="text-sm font-medium">{q.question}</span>
            <span className="ml-2 inline-flex flex-wrap items-center gap-2 align-middle text-xs text-muted-foreground">
              {q.status === 'paused' && <Badge>{tr('geo.paused')}</Badge>}
              {q.intent && INTENT[q.intent] && <span>{INTENT[q.intent]}</span>}
            </span>
            {hint && <span className="mt-0.5 block">{hint}</span>}
          </button>
          <div className="flex shrink-0 items-center">
            {asked && !anyCited && (
              <TaskLaunchButton task={TOPICS_TASK} reqKey="topic_requirements" input={{ channel_id: channel.id, question_ids: [q.id] }} match={(r) => (r.input?.question_ids as string[] | undefined)?.includes(q.id) ?? false} title={tr('geo.gen_topic')} desc={tr('geo.topic_one_desc', { q: q.question })} reqTitle={tr('geo.topics_req_title')} reqHint={tr('geo.topics_req_hint')} startLabel={tr('geo.topics_start')} variant="ghost" icon={Lightbulb} className="text-primary-text">
                {tr('geo.gen_topic')}
              </TaskLaunchButton>
            )}
            <QuestionActions q={q} onChanged={onChanged} onEdit={onEdit} />
          </div>
        </div>
        {cols.map((c, i) => (
          <button key={c.key} type="button" onClick={() => setOpen((o) => (o === c.key ? '' : c.key))} aria-pressed={open === c.key} className={cx('flex h-full cursor-pointer items-center justify-center border-l border-border/60 px-1 hover:bg-accent/40', open === c.key && 'bg-accent/60')} title={c.name}>
            <RecCell r={rs[i]} asking={askingOf(q.id, c.key)} change={changeOf.get(`${q.id}|${c.key}`)} />
          </button>
        ))}
      </div>
      {open && (
        <div className="space-y-2 px-4 pb-4">
          {/* 换着看别家：同一行点别的格子也行 */}
          <div className="flex flex-wrap gap-1">
            {cols.map((c, i) => (
              <button key={c.key} type="button" disabled={!rs[i]} onClick={() => setOpen(c.key)} className={cx('inline-flex h-7 cursor-pointer items-center rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-40', open === c.key ? 'border-primary/40 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}>
                {c.name}
              </button>
            ))}
          </div>
          {!openR ? (
            <p className="text-xs text-muted-foreground">{tr('geo.q_not_run')}</p>
          ) : (
            <>
              <ResultDetail r={openR} />
              <AskBox r={openR} engine={cols.find((c) => c.key === open)?.name ?? ''} onChanged={onChanged} />
              {openR.fix_note && (
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-2.5 text-xs">
                  <div className="font-semibold text-primary-text">{tr('geo.ask_note', { time: fmtTime(openR.fixed_at) })}</div>
                  <div className="mt-1 leading-relaxed">
                    <Markdown text={openR.fix_note} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** 检测卡片里这次的结论：品牌回答待看几个、说错的还没查原因几个；每个 AI 推荐类引用了本站几个（比上次）、没问成的（重试） */
function BatchSummary({ items, nameOf, pending, reported, onRetry, onJump, onBrand, onGen }: { items: { run: GeoRun; s: GeoSummary }[]; nameOf: (k: string) => string; pending: number; reported: number; onRetry: (runId: string) => void; onJump: (c: Change) => void; onBrand: () => void; onGen: () => void }) {
  const [showFail, setShowFail] = useState('')
  const link = 'cursor-pointer font-medium underline-offset-2 hover:underline'
  const anyRec = items.some((x) => x.s.questions > 0)
  const gained = items.reduce((n, x) => n + x.s.gained.length, 0)
  const lost = items.reduce((n, x) => n + x.s.lost.length, 0)
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
      {(pending > 0 || reported > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {pending > 0 && (
            <button type="button" onClick={onBrand} className={cx(link, 'inline-flex items-center gap-1.5 text-primary-text')}>
              <NewTag /> {tr('geo.m_pending', { n: pending })}
            </button>
          )}
          {reported > 0 && (
            <button type="button" onClick={onBrand} className={cx(link, 'text-destructive')}>
              {tr('geo.m_reported_n', { n: reported })}
            </button>
          )}
        </div>
      )}
      <ul className="space-y-1">
        {items.map(({ run, s }) => {
          const delta = s.prev_visibility == null || !s.questions ? null : s.visibility - s.prev_visibility
          return (
            <li key={run.id}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="w-28 shrink-0 truncate font-semibold">{nameOf(engineOf(run))}</span>
                {s.questions > 0 ? (
                  <span className="tabular-nums">{tr('geo.m_sum_rec', { c: s.cited, n: s.questions, v: s.visibility })}</span>
                ) : (
                  <span className="text-muted-foreground">{tr('geo.m_sum_brand', { n: s.brand_asked })}</span>
                )}
                {delta != null && delta !== 0 && (
                  <span className={cx('inline-flex items-center text-xs tabular-nums', delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                    {delta > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                    {tr('geo.sum_delta', { d: `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`, p: s.prev_visibility })}
                  </span>
                )}
                {s.failed.length > 0 && (
                  <>
                    <button type="button" onClick={() => setShowFail((v) => (v === run.id ? '' : run.id))} aria-expanded={showFail === run.id} className={cx(link, 'inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400')}>
                      <AlertTriangle className="size-3.5" />
                      {tr('geo.sum_failed', { n: s.failed.length })}
                    </button>
                    <Button size="sm" variant="outline" onClick={() => onRetry(run.id)}>
                      <RotateCw /> {tr('geo.sum_retry')}
                    </Button>
                  </>
                )}
              </div>
              {showFail === run.id && (
                <ul className="mt-1 space-y-1 pl-30 text-xs text-muted-foreground">
                  {s.failed.map((f) => (
                    <li key={f.question_id}>
                      <span className="font-medium text-foreground">{f.question}</span>：{f.error.replace(/^\[\w+\]\s*/, '')}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {!anyRec && (
        <div className="text-muted-foreground">
          {tr('geo.sum_no_rec')}{' '}
          <button type="button" onClick={onGen} className={cx(link, 'text-primary-text')}>
            {tr('geo.sum_go_gen')}
          </button>
        </div>
      )}
      {(gained > 0 || lost > 0) && (
        <div className="flex flex-wrap gap-x-3 text-xs">
          {gained > 0 && (
            <button type="button" onClick={() => onJump('gained')} className={cx(link, 'text-emerald-600 dark:text-emerald-400')}>
              {tr('geo.sum_gained', { n: gained })}
            </button>
          )}
          {lost > 0 && (
            <button type="button" onClick={() => onJump('lost')} className={cx(link, 'text-amber-600 dark:text-amber-400')}>
              {tr('geo.sum_lost', { n: lost })}
            </button>
          )}
        </div>
      )}
    </div>
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
function Hints({ q, pages, articles, linked }: { q: GeoQuestion; pages: SearchPage[]; articles: Article[]; linked?: ReactNode }) {
  const kws = splitTerms(q.keywords)
  if (!kws.length) return <>{linked}</>
  let best: { query: string; position: number; page: string } | null = null
  for (const p of pages)
    for (const x of jsonArr<{ query: string; position: number }>(p.top_queries))
      if (x?.query && kws.some((k) => x.query.toLowerCase().includes(k)) && (!best || x.position < best.position)) best = { query: x.query, position: x.position, page: p.page }
  const related = articles.find((a) => a.status === 'published' && (splitTerms(a.keywords).some((k) => kws.includes(k)) || kws.some((k) => a.title.toLowerCase().includes(k))))
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
      {pages.length > 0 && (best ? <span>{tr('geo.hint_rank', { q: best.query, n: best.position.toFixed(1), page: best.page.replace(/^https?:\/\/[^/]+/, '') || '/' })}</span> : <span className="text-amber-600 dark:text-amber-400">{tr('geo.hint_no_rank')}</span>)}
      {linked || (related ? <span>{tr('geo.hint_article', { t: related.title })}</span> : <span className="text-amber-600 dark:text-amber-400">{tr('geo.hint_no_article')}</span>)}
    </span>
  )
}

/**
 * 这个问题写成的选题（选题的出处里记着它）、文章发没发、发布后各 AI 有没有引用本站。没有就是 null，Hints 照旧按关键词猜相关文章。
 * 整行在问题的按钮里面，不能再放按钮：用 role=link 的 span，点了不展开那一行
 */
function Linked({ ctx, q, topics, articles, results }: { ctx: Ctx; q: GeoQuestion; topics: Topic[]; articles: Article[]; results: GeoResult[] }) {
  const own = topicsFrom(topics, 'geo_question', q.id).filter((t) => t.status !== 'dropped')
  if (!own.length) return null
  const go = (e: { stopPropagation: () => void }, extra: Record<string, string>) => {
    e.stopPropagation()
    ;(ctx.go as (v: string, p?: Record<string, string>) => void)('content', { workspace: 'website', ...extra })
  }
  const link = (label: string, extra: Record<string, string>, cls = '') => (
    <span role="link" tabIndex={0} onClick={(e) => go(e, extra)} onKeyDown={(e) => e.key === 'Enter' && go(e, extra)} className={cx('cursor-pointer hover:underline', cls)}>{label}</span>
  )
  return (
    <>
      {own.map((t) => {
        const a = articles.find((x) => x.id === t.article_id) ?? articles.find((x) => x.topic_id === t.id)
        const at = a?.status === 'published' ? a.published_at : ''
        const cited = at ? new Set(results.filter((r) => r.question_id === q.id && r.cited && String(r.created_at) > String(at)).map((r) => r.engine)).size : 0
        return (
          <span key={t.id} className="inline-flex flex-wrap items-center gap-x-2">
            {link(tr('origin.geo_linked', { t: t.title }), { topic: t.id }, 'text-primary-text')}
            {a && link(tr('origin.geo_article', { t: a.title, s: tr(at ? 'origin.st_published' : 'origin.st_draft') }), { article: a.id })}
            {at && <span className={cited ? 'text-emerald-600 dark:text-emerald-400' : ''}>{cited ? tr('origin.geo_after', { n: cited }) : tr('origin.geo_after_none')}</span>}
          </span>
        )
      })}
    </>
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

/** 状态标签那一列的宽度（放得下最长的「Not mentioned」）；详情的缩进 = 行的左边距 1rem + 这一列 6rem + 间距 0.75rem */
const BADGE_COL = 'flex w-24 shrink-0'

const RESULT: Record<'cited' | 'mentioned' | 'none' | 'idle', { label: string; tone: Tone }> = {
  cited: { get label() { return tr('geo.r_cited') }, tone: 'ok' },
  mentioned: { get label() { return tr('geo.r_mentioned') }, tone: 'warn' },
  none: { get label() { return tr('geo.r_none') }, tone: 'bad' },
  idle: { get label() { return tr('geo.r_idle') }, tone: 'default' },
}

/** 回答引用的全部网址；老数据没有 urls，用本站的引用 + 竞品域名凑 */
function resultUrls(r: GeoResult): string[] {
  const all = jsonList(r.urls)
  if (all.length) return all
  return [...jsonList(r.cited_urls), ...jsonList(r.competitor_domains).map((d) => `https://${d}`)]
}

/** 这次联网搜索搜到的网址（各步去重） */
function searchedUrls(r: GeoResult): string[] {
  return [...new Set(jsonArr<{ sources?: string[] }>(r.searches).flatMap((x) => x.sources || []))]
}

/** 一条检测结果的「回答和引用」：AI 的完整回答 + 回答引用的全部网址（本站的标出来） */
function ResultDetail({ r, noAnswer }: { r: GeoResult; noAnswer?: boolean }) {
  const ours = new Set(jsonList(r.cited_urls))
  const urls = resultUrls(r)
  const answer = r.answer || r.answer_excerpt || ''
  const steps = jsonArr<{ type: string; queries?: string[]; url?: string; sources?: string[] }>(r.searches)
  return (
    <div className="space-y-3">
      {r.searches !== undefined && <Searches steps={steps} />}
      {!noAnswer && (
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
      )}
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
            // 搜索步骤拿不到搜索词（ChatGPT 网页版）时 url 是对话链接，不当搜索词显示
            const label = x.queries?.length ? x.queries.join(' · ') : x.type === 'search' ? tr('geo.step_no_query') : x.url ? x.url.replace(/^https?:\/\//, '') : x.type
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
