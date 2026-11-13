import { L } from './_i18n'

// 只读写业务表：手机上也能看计划、标做完
export const cloud = ['get', 'mark', 'metrics', 'thisWeek', 'keywordMap']

// 90 天增长计划（设计见 docs/growth-plan.md）：把关键词、竞品、网站检查、内容、社媒、谷歌数据、询盘这些现有功能串成一份有目标、有基线、有检查点的计划。
// 起草和检查点的分析交给助手（任务 draft-plan、plan-checkpoint）；这里只取数、存表、按数据算进度，不调模型。
//
//   plan.context({})                       起草要用的：现在的指标、数据历史、建议从哪个阶段开始、能用的页面和任务
//   plan.saveDraft({ ... })                存 AI 起草的计划（三档目标、阶段、当前阶段每周的事），状态 draft
//   plan.activate({ level, targets? })     用户选一档目标，开始执行：记基线、算第 1 天
//   plan.get({})                           当前计划：第几天、第几阶段、目标进度、每周的事（按数据自动判断做完）、该做哪个检查点
//   plan.mark({ id, status })              标一条计划项：done / skipped / 空
//   plan.metrics({})                       现在的各项指标（和基线同一个口径）
//   plan.checkpointContext({})             检查点要用的：和基线比、做了哪些、GSC 的页面和词、询盘从哪来、增长机会
//   plan.saveCheckpoint({ day, ... })      存检查点的结论和下一阶段每周的事
//   plan.thisWeek({})                      这周还没做的计划项（总览的「今天要做的」用）

const DAY = 86400_000
const PHASE_DAYS = 30
const TOTAL_DAYS = 90
const LEVELS = ['conservative', 'normal', 'aggressive'] as const
type Level = (typeof LEVELS)[number]
type Tier = 'process' | 'leading' | 'result'
type Action = { kind: 'go'; view: string; params?: Record<string, string> } | { kind: 'task'; task: string; input?: unknown }
type Check = { metric: string; gte: number; delta?: boolean }

const nowISO = () => new Date().toISOString()
const p2 = (n: number) => String(n).padStart(2, '0')
const localDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const dayMs = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
const parse = <T,>(v: unknown, d: T): T => {
  try {
    return typeof v === 'string' ? ((v ? JSON.parse(v) : d) as T) : ((v as T) ?? d)
  } catch {
    return d
  }
}
/** 读整张表：一次最多 1000 行，按 cursor 翻页（关键词表常常上千行），最多读 20000 行 */
const all = (ctx: any, table: string): any[] => {
  const out: any[] = []
  try {
    let cursor = ''
    do {
      const r = ctx.db.query(table, { limit: 1000, cursor })
      out.push(...(r.list ?? []))
      cursor = r.next_cursor ?? ''
    } while (cursor && out.length < 20000)
  } catch {
    // 表还没建（老项目、这个模板没开这个功能）
  }
  return out
}
declare const require: (path: string) => any
/** 模板里有没有这个本机函数文件（拼出来的路径：没有这个文件的模板打包不报错） */
const hasFn = (name: string) => {
  try {
    return !!require('./' + name + '.ts')
  } catch {
    return false
  }
}

// ---------- 指标 ----------

/** 计划用的指标：口径和数据看板、增长机会一样，全从业务表算，秒出 */
export const METRICS: Record<string, { tier: Tier; better: 'up' | 'down'; zh: string; en: string; unit?: string }> = {
  pages_published: { tier: 'process', better: 'up', zh: '网站上发了的文章', en: 'Articles published on the site', unit: 'n' },
  social_published: { tier: 'process', better: 'up', zh: '社媒发了的帖子', en: 'Social posts published', unit: 'n' },
  keywords_targeting: { tier: 'process', better: 'up', zh: '在做的关键词', en: 'Keywords being targeted', unit: 'n' },
  competitors_watched: { tier: 'process', better: 'up', zh: '在盯的竞品', en: 'Competitors monitored', unit: 'n' },
  clusters_live: { tier: 'process', better: 'up', zh: '已有页面的关键词主题', en: 'Keyword topics with a live page', unit: 'n' },
  backlinks_live: { tier: 'process', better: 'up', zh: '在线的外链', en: 'Live backlinks', unit: 'n' },
  issues_high_open: { tier: 'process', better: 'down', zh: '没修的严重网站问题', en: 'Open serious site issues', unit: 'n' },
  pages_with_impressions: { tier: 'leading', better: 'up', zh: '在谷歌有展示的页面', en: 'Pages shown on Google', unit: 'n' },
  impressions_28d: { tier: 'leading', better: 'up', zh: '近 28 天谷歌展示次数', en: 'Google impressions (28 days)', unit: 'n' },
  keywords_top30: { tier: 'leading', better: 'up', zh: '排进前 30 的关键词', en: 'Keywords in the top 30', unit: 'n' },
  keywords_top10: { tier: 'leading', better: 'up', zh: '排进前 10 的关键词', en: 'Keywords in the top 10', unit: 'n' },
  geo_visibility: { tier: 'leading', better: 'up', zh: 'AI 搜索可见度', en: 'AI search visibility', unit: 'score' },
  clicks_28d: { tier: 'result', better: 'up', zh: '近 28 天谷歌点击', en: 'Google clicks (28 days)', unit: 'n' },
  leads_28d: { tier: 'result', better: 'up', zh: '近 28 天真实询盘', en: 'Real inquiries (28 days)', unit: 'n' },
  deals_open: { tier: 'result', better: 'up', zh: '推进中的商机', en: 'Open deals', unit: 'n' },
}
const PIPE = ['contacted', 'quoted', 'negotiating', 'qualified']

const sites = (ctx: any) => all(ctx, 'channels').filter((c) => c.type === 'creght_site' || c.type === 'wordpress')

/** GSC 的数据有多久了：连没连上、有几天的数、最早哪天 */
function gscHistory(ctx: any) {
  const rows = all(ctx, 'search_daily')
  const dates = [...new Set(rows.map((r) => String(r.date).slice(0, 10)))].sort()
  return { connected: rows.length > 0 || sites(ctx).some((c) => c.gsc_property && !c.gsc_link_disabled), days: dates.length, first: dates[0] ?? '', last: dates[dates.length - 1] ?? '' }
}

/** 现在的各项指标；拿不到的是 null（GSC 没连、没做过 AI 搜索检测），不当成 0 */
export function compute(ctx: any): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  const pubs = all(ctx, 'publications').filter((p) => p.status === 'published' || p.published_at)
  out.pages_published = new Set(pubs.map((p) => p.article_id)).size
  out.social_published = all(ctx, 'social_posts').filter((p) => p.status === 'published').length
  const kws = all(ctx, 'keywords')
  out.keywords_targeting = kws.filter((k) => k.status === 'targeting').length
  const comp = all(ctx, 'competitors')
  out.competitors_watched = comp.filter((c) => c.status !== 'suggested' && c.status !== 'rejected' && c.status !== 'paused').length
  out.issues_high_open = all(ctx, 'site_issues').filter((i) => i.status === 'open' && i.severity === 'high').length
  out.clusters_live = mapRows(ctx).filter((r) => STAGES.indexOf(r.stage) >= STAGES.indexOf('live')).length
  out.backlinks_live = all(ctx, 'backlinks').filter((b) => b.status === 'live').length

  const gsc = gscHistory(ctx)
  if (gsc.connected && gsc.days) {
    // GSC 有 2~3 天延迟：从有数据的最后一天往前数 28 天
    const end = dayMs(gsc.last)
    const from = localDay(new Date(end - 27 * DAY))
    const recent = all(ctx, 'search_daily').filter((r) => String(r.date).slice(0, 10) >= from)
    out.impressions_28d = recent.reduce((s, r) => s + (Number(r.impressions) || 0), 0)
    out.clicks_28d = recent.reduce((s, r) => s + (Number(r.clicks) || 0), 0)
    out.pages_with_impressions = all(ctx, 'search_pages').filter((p) => (Number(p.impressions) || 0) > 0).length
    const pos = (k: any) => Number(k.gsc_position) || Number(k.serp_position) || 0
    out.keywords_top30 = kws.filter((k) => k.status !== 'dismissed' && pos(k) > 0 && pos(k) <= 30).length
    out.keywords_top10 = kws.filter((k) => k.status !== 'dismissed' && pos(k) > 0 && pos(k) <= 10).length
  } else {
    for (const k of ['impressions_28d', 'clicks_28d', 'pages_with_impressions', 'keywords_top30', 'keywords_top10']) out[k] = null
  }

  // AI 搜索可见度：每个网站最近一次检测的分数取平均（和看板一样）
  const runs = all(ctx, 'geo_runs').filter((r) => r.visibility != null && (r.finished_at || r.created_at))
  const last = new Map<string, any>()
  for (const r of runs) {
    const t = String(r.finished_at || r.created_at)
    const o = last.get(r.channel_id)
    if (!o || t > String(o.finished_at || o.created_at)) last.set(r.channel_id, r)
  }
  out.geo_visibility = last.size ? Math.round([...last.values()].reduce((s, r) => s + (Number(r.visibility) || 0), 0) / last.size) : null

  // 询盘、竞品：这个模板没开这个功能就不出这几个指标
  if (hasFn('leads')) {
    const leads = all(ctx, 'leads').filter((l) => l.is_real !== false && l.status !== 'spam')
    const since = localDay(new Date(Date.now() - 27 * DAY))
    out.leads_28d = leads.filter((l) => String(l.submitted_at || l.created_at).slice(0, 10) >= since).length
    out.deals_open = leads.filter((l) => PIPE.includes(l.status)).length
  }
  if (!hasFn('competitors')) delete out.competitors_watched
  return out
}

export function metrics(_input: {}, ctx: any) {
  return { metrics: compute(ctx), defs: defs(ctx) }
}

const defs = (ctx: any) => Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, { tier: m.tier, better: m.better, label: L(ctx, m.zh, m.en) }]))

// ---------- 阶段：老项目从哪开始 ----------

/** 按已有数据判断从哪个阶段开始（规则；助手可以改，但要写清理由） */
export function judgeStage(ctx: any, m = compute(ctx)) {
  const gsc = gscHistory(ctx)
  const pubs = all(ctx, 'publications').filter((p) => p.published_at).map((p) => String(p.published_at)).sort()
  const facts = {
    gsc_connected: gsc.connected,
    gsc_days: gsc.days,
    gsc_first_date: gsc.first,
    pages_published: m.pages_published ?? 0,
    first_published: pubs[0]?.slice(0, 10) ?? '',
    keywords_targeting: m.keywords_targeting ?? 0,
    impressions_28d: m.impressions_28d,
    clicks_28d: m.clicks_28d,
    keywords_top30: m.keywords_top30,
    leads_28d: m.leads_28d ?? null,
  }
  const reasons: string[] = []
  let phase = 1
  const grounded = gsc.days >= 28 && (m.pages_published ?? 0) >= 8 && (m.impressions_28d ?? 0) > 0
  if (grounded) {
    phase = 2
    reasons.push(L(ctx, `已经发了 ${m.pages_published} 篇文章、谷歌有 ${gsc.days} 天的数据，地基已经有了`, `${m.pages_published} articles published and ${gsc.days} days of Google data: the groundwork exists`))
    if ((m.pages_published ?? 0) >= 15 && ((m.clicks_28d ?? 0) >= 30 || (m.keywords_top30 ?? 0) >= 5)) {
      phase = 3
      reasons.push(L(ctx, `近 28 天有 ${m.clicks_28d} 次点击、${m.keywords_top30} 个词排进前 30，可以把重点放到转化询盘上`, `${m.clicks_28d} clicks in 28 days and ${m.keywords_top30} keywords in the top 30: focus can shift to inquiries`))
    }
  } else {
    if (!gsc.connected) reasons.push(L(ctx, '还没连上谷歌数据', 'Google data is not connected yet'))
    else if (gsc.days < 28) reasons.push(L(ctx, `谷歌数据只有 ${gsc.days} 天`, `Only ${gsc.days} days of Google data`))
    if ((m.pages_published ?? 0) < 8) reasons.push(L(ctx, `网站上只发了 ${m.pages_published ?? 0} 篇文章`, `Only ${m.pages_published ?? 0} articles published`))
    if (!reasons.length) reasons.push(L(ctx, '谷歌上还没有展示', 'No impressions on Google yet'))
  }
  return { phase, reasons, facts }
}

// ---------- 能用的页面和任务（给助手排计划项用） ----------

function catalog(ctx: any) {
  const views: { view: string; params?: Record<string, string>; what: string }[] = [
    { view: 'search', params: { tab: 'keywords' }, what: L(ctx, '关键词：挖词（免费的下拉联想）、AI 筛词归主题、在用户的 Chrome 里查 Google 结果页、快赢词补内容', 'Keywords: expand, screen and cluster with AI, check Google results, strengthen quick wins') },
    { view: 'search', what: L(ctx, '谷歌排名：关联 Search Console、差一点上首页和点击率低的页面', 'Google rankings: link Search Console, near-page-one and low-CTR pages') },
    { view: 'search', params: { tab: 'decay' }, what: L(ctx, '内容掉量的页面', 'Declining pages') },
    { view: 'search', params: { tab: 'review' }, what: L(ctx, '效果追踪：改动上线前后的数据', 'Change tracking: data before and after changes') },
    { view: 'audit', what: L(ctx, '网站检查：技术和 SEO 问题，交给助手修', 'Site check: technical and SEO issues, fixed by the assistant') },
    { view: 'website-content', what: L(ctx, '网站文章：出选题、写文章、发布', 'Website articles: topics, writing, publishing') },
    { view: 'landing', what: L(ctx, '落地页', 'Landing pages') },
    { view: 'geo', what: L(ctx, 'AI 搜索：ChatGPT 推不推荐你', 'AI search: whether ChatGPT recommends you') },
    { view: 'social-content', what: L(ctx, '社媒内容：图文、视频，发到 IG / FB / LinkedIn 等（帖子里带网站链接）', 'Social content: posts and videos for IG / FB / LinkedIn (with links to the site)') },
    { view: 'social', what: L(ctx, '社媒账号：添加账号、主页资料', 'Social accounts: add accounts, profile info') },
    { view: 'channels', what: L(ctx, '网站和账号：添加网站、表单接入', 'Sites and accounts: add sites, connect forms') },
    { view: 'site', what: L(ctx, '网站访问：访客和来源', 'Site visits: visitors and sources') },
    { view: 'growth', what: L(ctx, '增长机会：每周汇总的信号', 'Growth opportunities: weekly signals') },
    { view: 'company', what: L(ctx, '公司与产品资料', 'Company and products') },
    { view: 'plan', params: { tab: 'map' }, what: L(ctx, '关键词地图：每个主题对应的页面、走到哪一步、带来的展示点击和询盘', 'Keyword map: page per topic, progress, impressions, clicks and inquiries') },
    { view: 'plan', params: { tab: 'links' }, what: L(ctx, '外链：登记社媒、B2B 平台、行业目录上指向网站的链接，检查还在不在', 'Backlinks: record links from social, B2B platforms and directories; check they are live') },
  ]
  if (hasFn('competitors')) views.push({ view: 'competitors', what: L(ctx, '竞品监控：竞品新页面、竞对总览、规格对比', 'Competitors: new pages, overview, spec comparison') })
  if (hasFn('leads')) views.push({ view: 'leads', what: L(ctx, '询盘：回复、背调、跟进', 'Inquiries: reply, research, follow up') })
  if (hasFn('prospects')) views.push({ view: 'prospects', what: L(ctx, '主动获客', 'Prospecting') })
  if (hasFn('campaigns')) views.push({ view: 'opportunities', what: L(ctx, '增长计划：SEO 页面地图、增长机会', 'Growth planning: SEO page map, opportunities') })
  if (!hasFn('growth')) views.splice(views.findIndex((v) => v.view === 'growth'), 1)

  const tasks: { task: string; what: string }[] = [
    { task: 'keyword-research', what: L(ctx, '挖一批关键词并筛选归主题', 'Find and screen a batch of keywords') },
    { task: 'suggest-topics', what: L(ctx, '出一批选题（input 可带 workspace: website）', 'Suggest topics (input may include workspace: website)') },
    { task: 'geo-questions', what: L(ctx, '生成 AI 搜索检测的问题', 'Generate AI search questions') },
  ]
  if (hasFn('competitors')) tasks.push({ task: 'competitor-suggest', what: L(ctx, 'AI 推荐竞品', 'AI suggests competitors') }, { task: 'competitor-overview', what: L(ctx, '写竞对总览', 'Write a competitor overview') })
  return { views, tasks }
}

// ---------- 计划 ----------

type PlanRow = Record<string, any> & { id: string }

const plans = (ctx: any): PlanRow[] => all(ctx, 'growth_plans').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
const activePlan = (ctx: any) => plans(ctx).find((p) => p.status === 'active') ?? null
const draftPlan = (ctx: any) => plans(ctx).find((p) => p.status === 'draft') ?? null
/** 页面上显示哪份：进行中的 > 等确认的草稿 > 刚结束的（90 天复盘完，还没起草下一份） */
const shownPlan = (ctx: any) => activePlan(ctx) ?? draftPlan(ctx) ?? plans(ctx).find((p) => p.status === 'done') ?? null

/** 第几天、第几周、第几阶段（第 1 天是 start_date） */
export function position(start: string, now = Date.now()) {
  const today = dayMs(localDay(new Date(now)))
  const day = Math.max(1, Math.floor((today - dayMs(start)) / DAY) + 1)
  return { day, week: Math.min(13, Math.ceil(day / 7)), phase: Math.min(3, Math.ceil(Math.min(day, TOTAL_DAYS) / PHASE_DAYS)) }
}

export function context(_input: {}, ctx: any) {
  const m = compute(ctx)
  const profile = all(ctx, 'profile')[0] ?? {}
  const products = all(ctx, 'products').slice(0, 30).map((p) => ({ name: p.name, category: p.category, keywords: p.keywords }))
  const active = activePlan(ctx)
  return {
    profile,
    products,
    sites: sites(ctx).map((c) => ({ id: c.id, name: c.name, type: c.type, url: c.live_url || c.url || '', gsc: !!c.gsc_property })),
    social_accounts: all(ctx, 'social_accounts').map((a) => ({ id: a.id, platform: a.platform || a.type, name: a.name })),
    metrics: m,
    metric_defs: defs(ctx),
    stage: judgeStage(ctx, m),
    keywords: {
      total: all(ctx, 'keywords').length,
      by_status: countBy(all(ctx, 'keywords'), 'status'),
      by_bucket: countBy(all(ctx, 'keywords'), 'bucket'),
      clusters: [...new Set(all(ctx, 'keywords').filter((k) => k.cluster && k.status !== 'dismissed').map((k) => k.cluster))].slice(0, 40),
    },
    competitors: hasFn('competitors') ? all(ctx, 'competitors').filter((c) => c.status !== 'rejected').map((c) => ({ name: c.name, url: c.url, status: c.status })) : undefined,
    growth: all(ctx, 'growth_items').filter((g) => !g.status).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10).map((g) => ({ kind: g.kind, title: g.title, next: g.next })),
    catalog: catalog(ctx),
    previous: active ? { summary: active.summary, level: active.level, targets: parse(active.targets, {}), checkpoints: parse(active.checkpoints, []), start_date: active.start_date } : null,
  }
}

function countBy(rows: any[], key: string) {
  const out: Record<string, number> = {}
  for (const r of rows) out[r[key] || '-'] = (out[r[key] || '-'] ?? 0) + 1
  return out
}

/** 校验并整理一条计划项 */
function cleanItem(ctx: any, it: any, phase: number, views: Set<string>, tasks: Set<string>) {
  const week = Math.round(Number(it?.week))
  if (!it?.title || !(week >= 1 && week <= 13)) throw new Error(L(ctx, `计划项要有 title 和 1~13 的 week：${JSON.stringify(it).slice(0, 120)}`, `Each item needs a title and week 1–13: ${JSON.stringify(it).slice(0, 120)}`))
  const a = it.action
  if (a && a.kind === 'go' && !views.has(a.view)) throw new Error(L(ctx, `没有「${a.view}」这个页面，只能用 context 里 catalog.views 的`, `No view "${a.view}"; use catalog.views from context`))
  if (a && a.kind === 'task' && !tasks.has(a.task)) throw new Error(L(ctx, `没有「${a.task}」这个任务，只能用 context 里 catalog.tasks 的`, `No task "${a.task}"; use catalog.tasks from context`))
  const c = it.check
  if (c && (!METRICS[c.metric] || typeof c.gte !== 'number')) throw new Error(L(ctx, `check 的 metric 要是 metric_defs 里的、gte 是数字：${JSON.stringify(c)}`, `check.metric must be in metric_defs and gte a number: ${JSON.stringify(c)}`))
  return {
    phase: Number(it.phase) || phase,
    week,
    area: String(it.area || ''),
    title: String(it.title),
    why: String(it.why || ''),
    action: a ? JSON.stringify(a) : '',
    check: c ? JSON.stringify({ metric: c.metric, gte: c.gte, ...(c.delta ? { delta: true } : {}) }) : '',
    status: '',
    created_at: nowISO(),
  }
}

function itemSets(ctx: any) {
  const cat = catalog(ctx)
  return { views: new Set(cat.views.map((v) => v.view)), tasks: new Set(cat.tasks.map((t) => t.task)) }
}

function cleanTargets(ctx: any, t: any) {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(t ?? {})) {
    if (!METRICS[k]) throw new Error(L(ctx, `没有「${k}」这个指标`, `Unknown metric "${k}"`))
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(L(ctx, `指标「${k}」的目标要是数字`, `Target for "${k}" must be a number`))
    out[k] = v
  }
  return out
}

/** 存 AI 起草的计划（draft）：三档目标 + 推荐哪档、三个阶段、开始阶段这几周每周的事。再起草会替换掉上一份没选定的草稿 */
export function saveDraft(input: any, ctx: any) {
  const phase = Math.min(3, Math.max(1, Math.round(Number(input?.stage?.phase) || 1)))
  const options = (input?.options ?? []).map((o: any) => {
    if (!LEVELS.includes(o?.level)) throw new Error(L(ctx, 'options 的 level 只能是 conservative / normal / aggressive', 'options.level must be conservative / normal / aggressive'))
    return { level: o.level as Level, note: String(o.note || ''), targets: cleanTargets(ctx, o.targets) }
  })
  if (options.length !== 3) throw new Error(L(ctx, '要给保守、正常、激进三档目标', 'Give three target levels: conservative, normal, aggressive'))
  const phases = (input?.phases ?? []).map((p: any) => ({ phase: Number(p.phase), title: String(p.title || ''), focus: String(p.focus || ''), goals: (p.goals ?? []).map(String) }))
  if (phases.length !== 3) throw new Error(L(ctx, 'phases 要有三个阶段', 'phases must have three phases'))
  const { views, tasks } = itemSets(ctx)
  const items = (input?.items ?? []).map((it: any) => cleanItem(ctx, it, phase, views, tasks))
  if (!items.length) throw new Error(L(ctx, '至少要有开始阶段每周的事（items）', 'Add the weekly items for the starting phase'))

  const old = draftPlan(ctx)
  if (old) {
    for (const it of all(ctx, 'plan_items').filter((i) => i.plan_id === old.id)) ctx.db.delete('plan_items', it.id)
    ctx.db.delete('growth_plans', old.id)
  }
  const recommended = LEVELS.includes(input?.recommended) ? input.recommended : 'normal'
  const row = ctx.db.insert('growth_plans', {
    status: 'draft',
    start_phase: phase,
    stage_reason: String(input?.stage?.reason || ''),
    summary: String(input?.summary || ''),
    phases: JSON.stringify(phases),
    options: JSON.stringify(options),
    recommended,
    ...(ctx.chat_id ? { chat_id: String(ctx.chat_id) } : {}),
    created_at: nowISO(),
    updated_at: nowISO(),
  })
  const id = row?.id ?? row
  for (const it of items) ctx.db.insert('plan_items', { ...it, plan_id: id })
  return { id, status: 'draft', items: items.length, next: L(ctx, '请用户到「增长计划」页选一档目标、点「开始执行」', 'Ask the user to pick a target level on the Growth plan page and start') }
}

/** 用户选定一档目标，开始执行：记基线；从第 2、3 阶段开始的，第 1 天往前推 */
export function activate(input: { level: Level; targets?: Record<string, number> }, ctx: any) {
  const d = draftPlan(ctx)
  if (!d) throw new Error(L(ctx, '没有待确认的计划，先让 AI 起草一份', 'No draft plan; have AI draft one first'))
  const options = parse<any[]>(d.options, [])
  const opt = options.find((o) => o.level === input?.level) ?? options.find((o) => o.level === d.recommended)
  if (!opt) throw new Error(L(ctx, '找不到这一档目标', 'Target level not found'))
  const targets = { ...opt.targets, ...(input?.targets ? cleanTargets(ctx, input.targets) : {}) }
  for (const p of plans(ctx).filter((p) => p.status === 'active')) ctx.db.update('growth_plans', p.id, { status: 'archived', updated_at: nowISO() })
  const offset = ((Number(d.start_phase) || 1) - 1) * PHASE_DAYS
  const start = localDay(new Date(dayMs(localDay(new Date())) - offset * DAY))
  ctx.db.update('growth_plans', d.id, {
    status: 'active',
    level: opt.level,
    targets: JSON.stringify(targets),
    baseline: JSON.stringify({ at: nowISO(), metrics: compute(ctx) }),
    start_date: start,
    activated_at: nowISO(),
    updated_at: nowISO(),
  })
  return get({}, ctx)
}

/** 一条计划项按数据算出来做没做完 */
function autoDone(it: any, m: Record<string, number | null>, base: Record<string, number | null>) {
  const c = parse<Check | null>(it.check, null)
  if (!c) return false
  const cur = m[c.metric]
  if (cur == null) return false
  const better = METRICS[c.metric]?.better ?? 'up'
  const v = c.delta ? (better === 'up' ? cur - (base[c.metric] ?? 0) : (base[c.metric] ?? 0) - cur) : cur
  return better === 'down' && !c.delta ? v <= c.gte : v >= c.gte
}

export function get(_input: {}, ctx: any) {
  const p = shownPlan(ctx)
  if (!p) return { plan: null, stage: judgeStage(ctx) }
  const m = compute(ctx)
  const base = parse<{ at?: string; metrics?: Record<string, number | null> }>(p.baseline, {})
  const baseM = base.metrics ?? {}
  const targets = parse<Record<string, number>>(p.targets, {})
  const pos = p.status !== 'draft' && p.start_date ? position(p.start_date) : null
  const checkpoints = parse<any[]>(p.checkpoints, [])
  const items = all(ctx, 'plan_items')
    .filter((i) => i.plan_id === p.id)
    .map((i) => {
      // 草稿还没有基线，不自动判断
      const auto = !i.status && p.status !== 'draft' && autoDone(i, m, baseM)
      return { ...i, action: parse<Action | null>(i.action, null), check: parse<Check | null>(i.check, null), status: i.status || (auto ? 'done' : ''), auto }
    })
    .sort((a, b) => a.week - b.week || String(a.created_at).localeCompare(String(b.created_at)))
  const progress = Object.entries(targets).map(([k, target]) => {
    const def = METRICS[k]
    const b = baseM[k] ?? null
    const cur = m[k] ?? null
    const span = def?.better === 'down' ? (b ?? 0) - target : target - (b ?? 0)
    const got = cur == null ? null : def?.better === 'down' ? (b ?? 0) - cur : cur - (b ?? 0)
    const pct = cur == null ? null : span <= 0 ? (got! >= 0 ? 100 : 0) : Math.max(0, Math.min(100, Math.round((got! / span) * 100)))
    return { metric: k, tier: def?.tier ?? 'result', better: def?.better ?? 'up', label: def ? L(ctx, def.zh, def.en) : k, baseline: b, current: cur, target, pct }
  })
  // 该做的检查点：到了 30 / 60 / 90 天、还没做过的最早那个
  const due = pos && p.status === 'active' ? [30, 60, 90].find((d) => pos.day >= d && !checkpoints.some((c) => c.day === d) && d > ((Number(p.start_phase) || 1) - 1) * PHASE_DAYS) ?? null : null
  return {
    plan: {
      id: p.id, status: p.status, summary: p.summary, start_date: p.start_date, start_phase: p.start_phase, stage_reason: p.stage_reason,
      phases: parse(p.phases, []), options: parse(p.options, []), recommended: p.recommended, level: p.level, targets, baseline: base, checkpoints, chat_id: p.chat_id,
    },
    position: pos,
    progress,
    items,
    checkpoint_due: due,
    metrics: m,
  }
}

export function mark(input: { id: string; status: '' | 'done' | 'skipped' }, ctx: any) {
  const it = ctx.db.get('plan_items', input?.id)
  if (!it) throw new Error(L(ctx, '找不到这条计划项', 'Plan item not found'))
  const status = input.status === 'done' || input.status === 'skipped' ? input.status : ''
  ctx.db.update('plan_items', it.id, { status, done_at: status ? nowISO() : '' })
  return { ok: true }
}

/** 这周还没做完的计划项（总览「今天要做的」用）；没有进行中的计划是空的 */
export function thisWeek(_input: {}, ctx: any) {
  const g = get({}, ctx) as any
  if (!g.plan || g.plan.status !== 'active' || !g.position) return { week: 0, day: 0, items: [], checkpoint_due: null }
  const items = g.items.filter((i: any) => !i.status && i.week <= g.position.week)
  return { week: g.position.week, day: g.position.day, items, checkpoint_due: g.checkpoint_due }
}

// ---------- 检查点 ----------

const path = (u: string) => String(u || '').replace(/^https?:\/\/[^/]+/, '') || '/'

export function checkpointContext(input: { day?: number }, ctx: any) {
  const g = get({}, ctx) as any
  if (!g.plan || g.plan.status !== 'active') throw new Error(L(ctx, '没有进行中的计划', 'No active plan'))
  const day = Number(input?.day) || g.checkpoint_due || [30, 60, 90].filter((d) => d <= g.position.day).pop() || 30
  const pages = all(ctx, 'search_pages')
    .sort((a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0))
    .slice(0, 25)
    .map((p) => ({ page: path(p.page), impressions: p.impressions, clicks: p.clicks, position: p.position, prev_impressions: p.prev_impressions, prev_clicks: p.prev_clicks, prev_position: p.prev_position, opportunity: p.opportunity || '', top_queries: parse<any[]>(p.top_queries, []).slice(0, 3) }))
  const kws = all(ctx, 'keywords').filter((k) => k.status === 'targeting' || k.bucket === 'quick_win' || k.bucket === 'ranking')
  const leads = all(ctx, 'leads').filter((l) => l.is_real !== false && l.status !== 'spam' && String(l.submitted_at || l.created_at) >= (g.plan.baseline?.at || ''))
  const byPage = countBy(leads.map((l) => ({ p: l.landing_page ? path(l.landing_page) : '?' })), 'p')
  const byRef = countBy(leads.map((l) => ({ r: (parse<any>(l.utm, {})?.source) || (l.referrer ? String(l.referrer).replace(/^https?:\/\/([^/]+).*/, '$1') : '?') })), 'r')
  return {
    day,
    next_phase: day >= TOTAL_DAYS ? null : Math.min(3, day / PHASE_DAYS + 1),
    plan: { summary: g.plan.summary, phases: g.plan.phases, level: g.plan.level, start_date: g.plan.start_date, previous_checkpoints: g.plan.checkpoints },
    progress: g.progress,
    metrics: g.metrics,
    baseline: g.plan.baseline,
    items: g.items.map((i: any) => ({ week: i.week, phase: i.phase, title: i.title, status: i.status, auto: i.auto })),
    gsc: { ...gscHistory(ctx), top_pages: pages },
    keywords: kws.slice(0, 40).map((k) => ({ keyword: k.keyword, cluster: k.cluster, status: k.status, bucket: k.bucket, position: k.gsc_position || k.serp_position || null, impressions: k.gsc_impressions, page: k.gsc_page ? path(k.gsc_page) : k.target_page ? path(k.target_page) : '', review: k.review_verdict || '' })),
    leads: { since_start: leads.length, by_landing_page: byPage, by_source: byRef },
    keyword_map: (() => {
      const m = keywordMap({}, ctx)
      return { by_stage: m.by_stage, rows: m.rows.slice(0, 30).map((r: any) => ({ cluster: r.cluster, main: r.main, page: r.page ? path(r.page) : '', stage: r.stage, best_position: r.best_position, impressions: r.impressions, clicks: r.clicks, leads: r.leads })) }
    })(),
    backlinks: (() => {
      const b = all(ctx, 'backlinks')
      return { total: b.length, live: b.filter((x) => x.status === 'live').length, lost: b.filter((x) => x.status === 'lost').length, by_kind: countBy(b, 'kind') }
    })(),
    changes: all(ctx, 'site_changes').filter((c) => c.status === 'reviewed').slice(-15).map((c) => ({ title: c.title, verdict: c.verdict, summary: c.summary })),
    growth: all(ctx, 'growth_items').filter((x) => !x.status).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10).map((x) => ({ kind: x.kind, title: x.title, next: x.next })),
    catalog: catalog(ctx),
  }
}

export function saveCheckpoint(input: any, ctx: any) {
  const p = activePlan(ctx)
  if (!p) throw new Error(L(ctx, '没有进行中的计划', 'No active plan'))
  const day = Number(input?.day)
  if (![30, 60, 90].includes(day)) throw new Error(L(ctx, 'day 只能是 30 / 60 / 90', 'day must be 30 / 60 / 90'))
  const { views, tasks } = itemSets(ctx)
  const nextPhase = day / PHASE_DAYS + 1
  const items = day < TOTAL_DAYS ? (input?.items ?? []).map((it: any) => cleanItem(ctx, it, nextPhase, views, tasks)) : []
  if (day < TOTAL_DAYS && !items.length) throw new Error(L(ctx, '要给下一阶段每周的事（items）', 'Add the weekly items for the next phase'))
  const cps = parse<any[]>(p.checkpoints, []).filter((c) => c.day !== day)
  cps.push({
    day, at: nowISO(), metrics: compute(ctx),
    summary: String(input?.summary || ''), wins: (input?.wins ?? []).map(String), issues: (input?.issues ?? []).map(String), adjustments: (input?.adjustments ?? []).map(String),
    ...(ctx.chat_id ? { chat_id: String(ctx.chat_id) } : {}),
  })
  cps.sort((a, b) => a.day - b.day)
  const patch: Record<string, unknown> = { checkpoints: JSON.stringify(cps), updated_at: nowISO() }
  if (input?.targets) patch.targets = JSON.stringify({ ...parse(p.targets, {}), ...cleanTargets(ctx, input.targets) })
  if (input?.phases) patch.phases = JSON.stringify(input.phases)
  if (day >= TOTAL_DAYS) patch.status = 'done'
  ctx.db.update('growth_plans', p.id, patch)
  // 下一阶段还没做的旧计划项换成新的（做完的留着）
  if (items.length) {
    for (const it of all(ctx, 'plan_items').filter((i) => i.plan_id === p.id && !i.status && (Number(i.phase) || 0) >= nextPhase)) ctx.db.delete('plan_items', it.id)
    for (const it of items) ctx.db.insert('plan_items', { ...it, plan_id: p.id })
  }
  return { ok: true, day, items: items.length, done: day >= TOTAL_DAYS }
}

// ---------- 关键词地图：主题 → 目标页面 → 走到哪一步 → 带来了什么 ----------
//
//   plan.keywordMap({})   每个主题一行（关键词表里筛过、没放弃的词按 cluster 分）：目标页面、阶段、谷歌数据、落在这个页面的询盘、下一步
//
// 不新建表：关键词转选题记 topic_id，选题写成文章、发布后 _keyword_track.ts 记 article_id、live_at、target_page，谷歌数据在 gsc_*。

/** 阶段：没页面 → 有选题 → 写好没发 → 已上线 → 谷歌有展示 → 排进前 30 → 排进前 10 */
export const STAGES = ['none', 'topic', 'draft', 'live', 'shown', 'top30', 'top10'] as const
type Stage = (typeof STAGES)[number]

const samePath = (a?: string, b?: string) => !!a && !!b && path(a).replace(/\/$/, '') === path(b).replace(/\/$/, '')

function mapRows(ctx: any) {
  const kws = all(ctx, 'keywords').filter((k) => k.cluster && (k.status === 'idea' || k.status === 'targeting'))
  if (!kws.length) return []
  const topics = new Map(all(ctx, 'topics').map((t) => [t.id, t]))
  const articles = all(ctx, 'articles')
  const pubs = all(ctx, 'publications')
  const pages = all(ctx, 'search_pages')
  const groups = new Map<string, any[]>()
  for (const k of kws) groups.set(k.cluster, [...(groups.get(k.cluster) ?? []), k])
  const rows = []
  for (const [cluster, list] of groups) {
    const pos = (k: any) => Number(k.gsc_position) || Number(k.serp_position) || 0
    const imp = (k: any) => Number(k.gsc_impressions) || 0
    const main = [...list].sort((a, b) => (b.status === 'targeting' ? 1 : 0) - (a.status === 'targeting' ? 1 : 0) || imp(b) - imp(a))[0]
    const topicIds = [...new Set(list.map((k) => k.topic_id).filter(Boolean))]
    const arts = articles.filter((a) => list.some((k) => k.article_id === a.id) || (a.topic_id && topicIds.includes(a.topic_id)))
    const live = pubs.filter((p) => arts.some((a) => a.id === p.article_id) && (p.status === 'published' || p.published_at) && p.url)
    const page = list.find((k) => k.target_page)?.target_page || live[0]?.url || list.find((k) => k.gsc_page)?.gsc_page || ''
    const sp = page ? pages.find((p) => samePath(p.page, page)) : null
    // 阶段只看主题里的词自己的排名；页面的平均排名是所有搜索词混在一起的，只作参考（page_position）
    const best = Math.min(...list.map(pos).filter((x) => x > 0), 999)
    const pagePos = Number(sp?.nb_position) || Number(sp?.position) || null
    const impressions = sp ? Number(sp.impressions) || 0 : list.reduce((s, k) => s + imp(k), 0)
    const clicks = sp ? Number(sp.clicks) || 0 : list.reduce((s, k) => s + (Number(k.gsc_clicks) || 0), 0)
    const stage: Stage = best <= 10 ? 'top10' : best <= 30 ? 'top30' : impressions > 0 ? 'shown' : page || live.length || list.some((k) => k.live_at) ? 'live' : arts.length ? 'draft' : topicIds.length ? 'topic' : 'none'
    rows.push({
      cluster, keywords: list.length, targeting: list.filter((k) => k.status === 'targeting').length, main: main.keyword, channel_id: main.channel_id || '',
      page, stage, best_position: best === 999 ? null : Math.round(best * 10) / 10, page_position: pagePos ? Math.round(pagePos * 10) / 10 : null, impressions, clicks,
      topic_id: topicIds[0] || '', article_id: (arts.find((a) => !live.some((p) => p.article_id === a.id)) ?? arts[0])?.id || '',
      search_page_id: sp?.id || list.find((k) => k.search_page_id)?.search_page_id || '',
      words: list.map((k) => ({ keyword: k.keyword, status: k.status, position: pos(k) || null, impressions: imp(k) })).sort((a, b) => b.impressions - a.impressions).slice(0, 12),
    })
  }
  return rows
}

/** 下一步：按阶段给一个现有页面的动作 */
function nextStep(ctx: any, r: any): { text: string; action: Action } {
  const kw = { tab: 'keywords', ...(r.channel_id ? { channel: r.channel_id } : {}) }
  switch (r.stage as Stage) {
    case 'none': return { text: L(ctx, '转成选题，写一篇专门的页面', 'Turn it into a topic and write a dedicated page'), action: { kind: 'go', view: 'search', params: kw } }
    case 'topic': return { text: L(ctx, '按选题写文章', 'Write the article for the topic'), action: { kind: 'go', view: 'website-content', params: { topic: r.topic_id } } }
    case 'draft': return { text: L(ctx, '文章写好了，发布到网站', 'The article is written; publish it'), action: { kind: 'go', view: 'website-content', params: { article: r.article_id } } }
    case 'live': return { text: L(ctx, '已上线，等谷歌收录（一般一两周）；太久没展示就去网站检查看收录', 'Live; wait for Google to index it (usually 1–2 weeks), check indexing if it takes long'), action: { kind: 'go', view: 'search', params: r.channel_id ? { channel: r.channel_id } : {} } }
    case 'shown': return { text: L(ctx, '谷歌上有展示了，主题词还没排进前 30：补内容、加内链', 'Shown on Google, but the topic keywords are not in the top 30 yet: add content and internal links'), action: { kind: 'go', view: 'search', params: kw } }
    case 'top30': return { text: L(ctx, '排进前 30 了：给页面写补内容要点，冲首页', 'In the top 30: strengthen the page to reach page one'), action: { kind: 'go', view: 'search', params: kw } }
    default: return { text: L(ctx, '排进前 10：看点击率，必要时改标题描述；页面加询盘入口', 'In the top 10: watch CTR, rewrite title if needed; add an inquiry call to action'), action: { kind: 'go', view: 'search', params: r.channel_id ? { channel: r.channel_id } : {} } }
  }
}

export function keywordMap(_input: {}, ctx: any) {
  const p = activePlan(ctx)
  const since = parse<{ at?: string }>(p?.baseline, {}).at || ''
  const leads = hasFn('leads') ? all(ctx, 'leads').filter((l) => l.is_real !== false && l.status !== 'spam' && l.landing_page && String(l.submitted_at || l.created_at) >= since) : []
  const rows = mapRows(ctx).map((r) => {
    const n = r.page ? leads.filter((l) => samePath(l.landing_page, r.page)).length : 0
    return { ...r, leads: hasFn('leads') ? n : null, next: nextStep(ctx, r) }
  })
  rows.sort((a, b) => STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage) || b.impressions - a.impressions || b.targeting - a.targeting)
  const by: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]))
  for (const r of rows) by[r.stage]++
  return { rows, by_stage: by, leads_since: since }
}
