import { L } from './_i18n'
import { profile, projectBrief, siteBase } from './_ai'
import { brandTerms, DAY, expectedCtr, isNoise, matchProperty, nonBrand, notConnected, opportunity, pickQueryTopics, query, sites, ymd, type Row } from './_gsc'
import { originsJson } from '../lib/origins'

// 要电脑的（浏览器、本机授权、密钥、外部接口）：手机上点了转给电脑上开着的 Shuttle 跑（设置 → 远程访问）
export const remote = ['day', 'link', 'properties', 'range', 'sync', 'unlink']

// 搜索表现（本机函数；Google 的授权走 Shuttle 的 设置 → 连接，接口封装在 _gsc.ts）。
//
//   gsc.properties()                        连着的 Google 账号能看的 Search Console 属性（google：哪个账号）
//   gsc.link({ channel_id, property? })     给独立站渠道配属性；不给就按站点域名自动匹配
//   gsc.unlink({ channel_id })             解除网站关联，保留历史数据，暂停自动匹配与同步
//   gsc.sync({ channel_id?, manual? })      同步最近 28 天 + 上一个 28 天的页面数据和主要搜索词，算机会，写 search_pages；
//                                           按天的点击曝光写 search_daily（最近 180 天）；有曝光、没有排得上的页面的搜索词加进选题（topics，source=search）
//   gsc.range({ channel_id, start, end })   按指定日期直接读 GSC 的页面、每日趋势和上一等长周期；不改每日同步的数据
//   gsc.pageContext({ id, related? })       一个页面现在的标题、描述、H1、小标题、正文开头和它的搜索词；related 时再给站内相关页面（挑内链用）
//   gsc.saveSuggestion({ id, title, description, reason, current_title?, current_description? })   存新的标题和描述（search_pages.suggestion）
//   gsc.saveBrief({ id, gaps, sections, faq, internal_links, summary })   存补内容的要点（search_pages.expand_brief）
//     改标题描述、写补内容要点交给助手按任务 tasks/search-meta.md、tasks/search-expand.md 做（过程看得见），这里只取数和存
//   gsc.day({ channel_id, date })          某一天曝光最多的搜索词和页面（趋势图上点一天时现查）
//   gsc.summary()                           总览用：近 28 天点击、曝光、平均排名，和上一周期比，机会页面数
//
// 定时任务每天跑一次 gsc.sync：没连 Google 时安静返回 skipped；页面上的按钮带 manual: true，没连就抛出去让用户去连。
//
// 噪音搜索词（site: 这类搜索指令、品牌词，见 _gsc.ts 的 isNoise）不算真实需求：页面的 nb_* 字段是去掉它们的「非品牌」口径，
// 机会、期望点击率、主要搜索词、搜索词选题都按这个口径；clicks / impressions 等原字段和 gsc.summary 仍是全站原始口径。
// 品牌词 = 属性域名的主体（www.creght.com → creght）+ 项目资料里的 brand_terms。

type Channel = { id: string; name: string; type: string; project_id?: string; site_id?: string; preview_url?: string; gsc_property?: string; gsc_link_disabled?: boolean }
type Page = { id: string; channel_id: string; page: string; impressions?: number; nb_impressions?: number; position?: number; nb_position?: number; top_queries?: string; suggestion?: string; expand_brief?: string; status?: string }
type Topic = { id: string; status: string; search_query?: string }

const WINDOW = 28
const LAG = 3 // GSC 数据延迟 2~3 天
const HISTORY = 180 // search_daily 每次拉最近多少天
const RECENT = 7 // 最近几天的数据 GSC 还会变，已有的也更新
const MAX_TOPICS = 10 // 每次同步最多新加几个搜索词选题

export async function properties(_: unknown, ctx: any) {
  return { list: await sites(ctx) }
}

async function resolveProperty(ch: Channel, ctx: any, props?: { siteUrl: string }[]): Promise<string> {
  if (ch.gsc_link_disabled) return ''
  if (ch.gsc_property) return ch.gsc_property
  const list = props ?? (await sites(ctx))
  const base = await siteBase(ch, ctx)
  return base ? matchProperty(list, base) : ''
}

export async function link(input: { channel_id: string; property?: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  if (ch.type !== 'creght_site') throw new Error(L(ctx, '只有独立站渠道能关联 Search Console', 'Only site channels can link Search Console'))
  const list = await sites(ctx)
  let property = input.property ?? ''
  if (property && !list.some((p) => p.siteUrl === property)) throw new Error(L(ctx, `连着的 Google 账号都看不到属性 ${property}`, `None of the connected Google accounts can see property ${property}`))
  if (!property) {
    const base = await siteBase(ch, ctx)
    property = base ? matchProperty(list, base) : ''
    if (!property) {
      const names = list.map((p) => p.siteUrl).join(L(ctx, '、', ', ')) || L(ctx, '（一个都没有）', '(none)')
      throw new Error(L(ctx, `没找到和「${ch.name}」（${base || '没有访问地址'}）对应的 Search Console 属性。连着的 Google 账号能看的属性：${names}。站点在别的 Google 账号下的话，在 Annulo 的连接设置里再连一个账号；还没加进 Search Console 的话，先去 search.google.com/search-console 添加并验证`, `No Search Console property matches "${ch.name}" (${base || 'no URL'}). Properties the connected Google accounts can see: ${names}. If the site is under another Google account, connect it in Annulo's connection settings; if it isn't in Search Console yet, add and verify it at search.google.com/search-console first`))
    }
  }
  ctx.db.update('channels', ch.id, { gsc_property: property, gsc_link_disabled: false, ...(ch.gsc_property !== property ? { gsc_synced_at: '' } : {}) })
  return { property }
}

/** 只解除本网站的关联；保留历史数据，阻止定时任务重新自动匹配。 */
export function unlink(input: { channel_id: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch || ch.type !== 'creght_site') throw new Error(L(ctx, '请选择一个独立站渠道', 'Choose a site channel'))
  ctx.db.update('channels', ch.id, { gsc_property: '', gsc_synced_at: '', gsc_link_disabled: true })
  return { unlinked: true }
}

type Agg = { clicks: number; impressions: number; ctr: number; position: number }
const agg = (r?: Row): Agg => ({ clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0, ctr: r?.ctr ?? 0, position: r?.position ?? 0 })
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d

/** 页面日期筛选：包含起止日，和前一段等长的区间比较。只读，不覆盖自动同步的 28 天机会数据。 */
export async function range(input: { channel_id: string; start: string; end: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch || ch.type !== 'creght_site') throw new Error(L(ctx, '请选择一个独立站渠道', 'Choose a site channel'))
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && ymd(Date.parse(v)) === v
  const start = String(input?.start ?? ''), end = String(input?.end ?? '')
  const latest = ymd(Date.now() - LAG * DAY)
  if (!valid(start) || !valid(end) || start > end || end > latest) throw new Error(L(ctx, `请选择不晚于 ${latest} 的有效起止日期`, `Choose valid dates ending no later than ${latest}`))
  const property = await resolveProperty(ch, ctx)
  if (!property) throw new Error(L(ctx, `「${ch.name}」还没关联 Search Console 属性`, `"${ch.name}" has no Search Console property linked`))
  const days = Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1
  if (days > 1000) throw new Error(L(ctx, '自定义时间最多 1000 天', 'Custom ranges can span at most 1,000 days'))
  const prev = { start: ymd(Date.parse(start) - days * DAY), end: ymd(Date.parse(start) - DAY) }
  const [now, before, byDate] = await Promise.all([
    query(ctx, property, { start, end, dimensions: ['page'], rowLimit: 1000 }),
    query(ctx, property, { ...prev, dimensions: ['page'], rowLimit: 1000 }),
    query(ctx, property, { start, end, dimensions: ['date'], rowLimit: 1000 }),
  ])
  const totals = (rows: Row[]) => {
    const clicks = rows.reduce((n, r) => n + r.clicks, 0)
    const impressions = rows.reduce((n, r) => n + r.impressions, 0)
    return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? rows.reduce((n, r) => n + r.position * r.impressions, 0) / impressions : 0 }
  }
  return {
    start, end, prev_start: prev.start, prev_end: prev.end,
    totals: totals(now), prev: totals(before),
    pages: now.map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    daily: byDate.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
  }
}

async function syncChannel(ch: Channel, property: string, ctx: any) {
  const end = Date.now() - LAG * DAY
  const cur = { start: ymd(end - (WINDOW - 1) * DAY), end: ymd(end) }
  const prev = { start: ymd(end - (2 * WINDOW - 1) * DAY), end: ymd(end - WINDOW * DAY) }
  const brands = brandTerms(property, profile(ctx).brand_terms)
  ctx.progress({ message: L(ctx, `读取「${ch.name}」的页面数据（${cur.start} ~ ${cur.end}）`, `Reading page data for "${ch.name}" (${cur.start} – ${cur.end})`) })
  const [now, before, byQuery, byDate] = await Promise.all([
    query(ctx, property, { ...cur, dimensions: ['page'], rowLimit: 1000 }),
    query(ctx, property, { ...prev, dimensions: ['page'], rowLimit: 1000 }),
    query(ctx, property, { ...cur, dimensions: ['query'], rowLimit: 1000 }),
    query(ctx, property, { start: ymd(end - (HISTORY - 1) * DAY), end: ymd(end), dimensions: ['date'], rowLimit: 1000 }),
  ])
  const prevBy = new Map(before.map((r) => [r.keys[0], r]))
  // 主要搜索词：一次按 page+query 拉，只留曝光前 50 的页面
  const top50 = new Set([...now].sort((a, b) => b.impressions - a.impressions).slice(0, 50).map((r) => r.keys[0]))
  const pq = top50.size ? await query(ctx, property, { ...cur, dimensions: ['page', 'query'], rowLimit: 5000 }) : []
  const latest: Channel | null = ctx.db.get('channels', ch.id)
  if (!latest || latest.gsc_link_disabled || latest.gsc_property !== property) return { skipped: L(ctx, '网站关联已变更，本次同步未写入数据', 'The site link changed. This sync did not write data.') }
  const queries = new Map<string, Row[]>()
  for (const r of pq) {
    if (!top50.has(r.keys[0])) continue
    if (!queries.has(r.keys[0])) queries.set(r.keys[0], [])
    queries.get(r.keys[0])!.push(r)
  }
  const res = writePages(ch, now, prevBy, queries, cur, brands, ctx)
  const days = writeDaily(ch, byDate, ymd(end - (RECENT - 1) * DAY), ctx)
  const topics = writeQueryTopics(byQuery, brands, ctx)
  return { ...res, days, new_topics: topics }
}

/** 把一次同步的结果写进 search_pages：有的更新、新的建、不再出现的删掉（改过标题正在复查的保留） */
function writePages(ch: Channel, now: Row[], prevBy: Map<string, Row>, queries: Map<string, Row[]>, period: { start: string; end: string }, brands: string[], ctx: any) {
  const existing: Page[] = ctx.db.query('search_pages', { where: { channel_id: ch.id }, limit: 1000 }).list
  const byPage = new Map(existing.map((p) => [p.page, p]))
  const syncedAt = new Date().toISOString()
  const seen = new Set<string>()
  let opps = 0
  for (const r of now) {
    const page = r.keys[0]
    seen.add(page)
    const a = agg(r)
    const p = agg(prevBy.get(page))
    // 非品牌口径：有 page+query 数据的页面减掉噪音词；没有的（曝光前 50 以外）就是原始数据
    const nb = nonBrand(a, queries.get(page) ?? [], brands)
    const opp = opportunity({ impressions: nb.nb_impressions, ctr: nb.nb_ctr, position: nb.nb_position })
    if (opp) opps++
    const top = nb.queries
      .sort((x, y) => y.impressions - x.impressions)
      .slice(0, 10)
      .map((q) => ({ query: q.keys[1], clicks: q.clicks, impressions: q.impressions, ctr: round(q.ctr), position: round(q.position, 1) }))
    const body = {
      channel_id: ch.id, page, period_start: period.start, period_end: period.end,
      clicks: a.clicks, impressions: a.impressions, ctr: round(a.ctr), position: round(a.position, 1),
      prev_clicks: p.clicks, prev_impressions: p.impressions, prev_ctr: round(p.ctr), prev_position: round(p.position, 1),
      nb_clicks: nb.nb_clicks, nb_impressions: nb.nb_impressions, nb_ctr: round(nb.nb_ctr), nb_position: round(nb.nb_position, 1), noise_impressions: nb.noise_impressions,
      top_queries: JSON.stringify(top), opportunity: opp, expected_ctr: expectedCtr(nb.nb_position), synced_at: syncedAt,
    }
    const old = byPage.get(page)
    if (old) ctx.db.update('search_pages', old.id, body)
    else ctx.db.insert('search_pages', { ...body, status: '' })
  }
  for (const old of existing) if (!seen.has(old.page) && !old.status) ctx.db.delete('search_pages', old.id)
  ctx.db.update('channels', ch.id, { gsc_synced_at: syncedAt })
  const sum = now.reduce((s, r) => ({ clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions }), { clicks: 0, impressions: 0 })
  return { channel: ch.name, pages: now.length, opportunities: opps, ...sum }
}

/** 按天的点击曝光写 search_daily：没有的日期新建；已有的只更新 recentFrom（含）之后的（更早的 GSC 不会再变），其余不动 */
function writeDaily(ch: Channel, rows: Row[], recentFrom: string, ctx: any) {
  const existing: { id: string; date: string }[] = ctx.db.query('search_daily', { where: { channel_id: ch.id }, limit: 1000 }).list
  const byDate = new Map(existing.map((d) => [d.date, d]))
  const syncedAt = new Date().toISOString()
  let n = 0
  for (const r of rows) {
    const date = r.keys[0]
    const body = { clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr), position: round(r.position, 1), synced_at: syncedAt }
    const old = byDate.get(date)
    if (!old) ctx.db.insert('search_daily', { channel_id: ch.id, date, ...body })
    else if (date >= recentFrom) ctx.db.update('search_daily', old.id, body)
    else continue
    n++
  }
  return n
}

/**
 * 有搜索需求、站内没有排得上的页面的词 → 选题（source=search）。同一个搜索词已有选题（任何状态）就不新建；
 * 还是 idea 的顺手更新曝光和排名。返回新加了几个。
 */
function writeQueryTopics(rows: Row[], brands: string[], ctx: any) {
  const existing: Topic[] = ctx.db.query('topics', { limit: 2000 }).list
  const byQuery = new Map(existing.filter((t) => t.search_query).map((t) => [t.search_query!.trim().toLowerCase(), t]))
  for (const r of rows) {
    const t = byQuery.get(String(r.keys[0] ?? '').trim().toLowerCase())
    if (t?.status === 'idea') ctx.db.update('topics', t.id, { search_impressions: r.impressions, search_position: round(r.position, 1) })
  }
  const picked = pickQueryTopics(rows, brands, new Set(byQuery.keys()), MAX_TOPICS)
  const now = new Date().toISOString()
  for (const r of picked) {
    const q = r.keys[0].trim()
    const pos = round(r.position, 1)
    ctx.db.insert('topics', {
      title: q, angle: L(ctx, `搜索需求：近 28 天曝光 ${r.impressions}、平均排名 ${pos}，站内还没有排得上的页面`, `Search demand: ${r.impressions} impressions in 28 days, average position ${pos}, and no page of yours ranks for it yet`), keywords: q,
      source: 'search', status: 'idea', search_query: q, search_impressions: r.impressions, search_position: pos, created_at: now,
      origins: originsJson([{ type: 'search_query', id: q, label: q }]),
    })
  }
  return picked.length
}

export async function sync(input: { channel_id?: string; manual?: boolean }, ctx: any) {
  let chs: Channel[] = ctx.db.query('channels', { where: { type: 'creght_site' }, limit: 500 }).list
  if (input?.channel_id) chs = chs.filter((c) => c.id === input.channel_id)
  if (!chs.length) return { skipped: L(ctx, '没有独立站渠道', 'No site channels') }
  chs = chs.filter((ch) => !ch.gsc_link_disabled)
  if (!chs.length) {
    if (input?.manual) throw new Error(L(ctx, '已解除 Search Console 关联，请先重新关联再同步', 'Search Console was unlinked. Link it again before syncing.'))
    return { skipped: L(ctx, 'Search Console 自动同步已暂停', 'Search Console automatic sync is paused') }
  }
  let props: { siteUrl: string }[]
  try {
    props = await sites(ctx)
  } catch (e) {
    // 定时任务：没用这个功能就别天天报失败
    if (!input?.manual && notConnected(e)) return { skipped: L(ctx, '还没连接 Google', 'Google not connected') }
    throw e
  }
  const results: any[] = []
  for (const ch of chs) {
    const current: Channel | null = ctx.db.get('channels', ch.id)
    if (!current || current.gsc_link_disabled) continue
    const property = await resolveProperty(current, ctx, props)
    if (!property) {
      results.push({ channel: ch.name, skipped: L(ctx, '没有对应的 Search Console 属性', 'No matching Search Console property') })
      continue
    }
    if (ctx.db.get('channels', ch.id)?.gsc_link_disabled) continue
    if (!current.gsc_property) ctx.db.update('channels', ch.id, { gsc_property: property })
    results.push(await syncChannel(ch, property, ctx))
  }
  if (input?.manual && input.channel_id && results[0]?.skipped) throw new Error(L(ctx, `「${chs[0].name}」${results[0].skipped}：在搜索表现页里选一个属性关联上`, `"${chs[0].name}": ${results[0].skipped} — link a property on the Search page`))
  return { list: results }
}

/**
 * 某一天的明细：那天曝光最多的搜索词和页面（各前 20），趋势图上点一天时现查（按天的词和页面不存表）。
 * 噪音词（品牌词、site: 查询）标出来，不过滤：看某天为什么突然涨，品牌词本身就可能是原因。
 */
export async function day(input: { channel_id: string; date: string }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input?.date ?? ''))) throw new Error(L(ctx, 'date 要写成 YYYY-MM-DD', 'date must be YYYY-MM-DD'))
  const property = await resolveProperty(ch, ctx)
  if (!property) throw new Error(L(ctx, `「${ch.name}」还没关联 Search Console 属性`, `"${ch.name}" has no Search Console property linked`))
  const brands = brandTerms(property, profile(ctx).brand_terms)
  const range = { start: input.date, end: input.date }
  const [qs, ps] = await Promise.all([
    query(ctx, property, { ...range, dimensions: ['query'], rowLimit: 20 }),
    query(ctx, property, { ...range, dimensions: ['page'], rowLimit: 20 }),
  ])
  const row = (r: Row) => ({ clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr), position: round(r.position, 1) })
  const byImp = (a: Row, b: Row) => b.impressions - a.impressions
  return {
    date: input.date,
    queries: [...qs].sort(byImp).map((r) => ({ query: r.keys[0], noise: isNoise(r.keys[0], brands), ...row(r) })),
    pages: [...ps].sort(byImp).map((r) => ({ page: r.keys[0], ...row(r) })),
  }
}

/** 读一个页面给助手看：现在的标题、描述、H1、小标题、正文开头，和它的主要搜索词（去掉品牌词和 site: 查询）；related 时再列站内相关页面 */
export async function pageContext(input: { id: string; related?: boolean }, ctx: any) {
  const p: Page | null = ctx.db.get('search_pages', input?.id)
  if (!p) throw new Error(L(ctx, '没有这个页面记录：', 'No such page record: ') + input?.id)
  const ch: Channel | null = ctx.db.get('channels', p.channel_id)
  const project = profile(ctx)
  const brands = brandTerms(ch?.gsc_property ?? p.page, project.brand_terms)
  ctx.progress({ message: L(ctx, '读取页面内容', 'Reading the page') })
  const r = await fetch(p.page).catch(() => null)
  if (!r?.ok) throw new Error(L(ctx, `打不开这个页面（${r?.status ?? '网络错误'}）：`, `Couldn't open this page (${r?.status ?? 'network error'}): `) + p.page)
  const doc = ctx.html(await r.text())
  const out: Record<string, unknown> = {
    project: projectBrief(project),
    page: p.page,
    position: p.nb_position ?? p.position,
    title: doc.find('title')[0]?.text ?? '',
    description: doc.find('meta[name="description" i]')[0]?.attrs.content ?? '',
    h1: doc.find('h1')[0]?.text ?? '',
    headings: [...doc.find('h2'), ...doc.find('h3')].map((h: any) => String(h.text ?? '').trim()).filter(Boolean).slice(0, 30),
    body: doc.text().slice(0, 3000),
    queries: parseQueries(p.top_queries).filter((q) => !isNoise(q.query, brands)),
  }
  if (input.related) {
    // 站内其他页面：挑相关的 15 个，读标题（内链只能从这里选）
    const others: Page[] = ctx.db.query('search_pages', { where: { channel_id: p.channel_id }, limit: 1000 }).list.filter((o: Page) => o.id !== p.id && o.page !== p.page)
    const cands = relatedPages(p, others, 15)
    ctx.progress({ message: L(ctx, `读取 ${cands.length} 个站内页面的标题`, `Reading titles of ${cands.length} site pages`) })
    const rs = cands.length ? await ctx.fetchAll(cands.map((o) => o.page)) : []
    const site: { url: string; title: string }[] = []
    for (let i = 0; i < cands.length; i++) {
      let t = ''
      if (rs[i]?.ok) t = ctx.html(await rs[i].text()).find('title')[0]?.text ?? ''
      site.push({ url: cands[i].page, title: String(t).trim() })
    }
    out.site_pages = site
  }
  return out
}

export function saveSuggestion(input: { id: string; title: string; description: string; reason?: string; current_title?: string; current_description?: string }, ctx: any) {
  const p: Page | null = ctx.db.get('search_pages', input?.id)
  if (!p) throw new Error(L(ctx, '没有这个页面记录：', 'No such page record: ') + input?.id)
  const title = String(input.title ?? '').trim()
  const description = String(input.description ?? '').trim()
  if (!title || !description) throw new Error(L(ctx, '标题和描述都要有', 'Both title and description are required'))
  const suggestion = { title, description, reason: String(input.reason ?? ''), current_title: String(input.current_title ?? ''), current_description: String(input.current_description ?? ''), created_at: new Date().toISOString() }
  ctx.db.update('search_pages', p.id, { suggestion: JSON.stringify(suggestion) })
  return suggestion
}

export type ExpandBrief = {
  gaps: string[]
  sections: { heading: string; what: string }[]
  faq: string[]
  internal_links: { from: string; anchor: string }[]
  summary: string
  created_at?: string
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2))
function parseQueries(s?: string): { query: string; impressions: number; clicks: number; position: number }[] {
  try {
    const v = JSON.parse(s ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** 同一渠道里和这个页面相关的其他页面（给模型挑内链用）：搜索词、路径里的词重合越多越相关，一样就按曝光 */
function relatedPages(p: Page, others: Page[], n: number): Page[] {
  const mine = words([...parseQueries(p.top_queries).map((q) => q.query), p.page.replace(/^https?:\/\/[^/]+/, '')].join(' '))
  const score = (o: Page) => {
    const theirs = words([...parseQueries(o.top_queries).map((q) => q.query), o.page.replace(/^https?:\/\/[^/]+/, '')].join(' '))
    let k = 0
    for (const w of theirs) if (mine.has(w)) k++
    return k
  }
  return others
    .map((o) => ({ o, k: score(o), imp: o.nb_impressions ?? o.impressions ?? 0 }))
    .sort((a, b) => b.k - a.k || b.imp - a.imp)
    .slice(0, n)
    .map((x) => x.o)
}

const strs = (v: any, n: number) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, n) : [])

export function saveBrief(input: { id: string } & Partial<ExpandBrief>, ctx: any) {
  const p: Page | null = ctx.db.get('search_pages', input?.id)
  if (!p) throw new Error(L(ctx, '没有这个页面记录：', 'No such page record: ') + input?.id)
  // 内链只收同一个站的页面
  const host = (u: string) => /^https?:\/\/([^/]+)/.exec(u)?.[1] ?? ''
  const brief: ExpandBrief = {
    gaps: strs(input.gaps, 8),
    sections: (Array.isArray(input.sections) ? input.sections : [])
      .map((x: any) => ({ heading: String(x?.heading ?? '').trim(), what: String(x?.what ?? '').trim() }))
      .filter((x) => x.heading)
      .slice(0, 8),
    faq: strs(input.faq, 8),
    internal_links: (Array.isArray(input.internal_links) ? input.internal_links : [])
      .map((x: any) => ({ from: String(x?.from ?? '').trim(), anchor: String(x?.anchor ?? '').trim() }))
      .filter((x) => x.anchor && host(x.from) === host(p.page))
      .slice(0, 8),
    summary: String(input.summary ?? '').trim(),
    created_at: new Date().toISOString(),
  }
  if (!brief.gaps.length && !brief.sections.length) throw new Error(L(ctx, '没有要补的内容：gaps 和 sections 至少要有一个', 'Nothing to add: give gaps or sections'))
  ctx.db.update('search_pages', p.id, { expand_brief: JSON.stringify(brief) })
  return brief
}

export function summary(_: unknown, ctx: any) {
  const rows: any[] = ctx.db.query('search_pages', { limit: 1000 }).list
  const sum = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  // 平均排名按曝光加权（和 GSC 的口径一致）
  const pos = (imp: string, p: string) => {
    const w = sum(imp)
    return w ? round(rows.reduce((s, r) => s + (Number(r[p]) || 0) * (Number(r[imp]) || 0), 0) / w, 1) : 0
  }
  const clicks = sum('clicks'), impressions = sum('impressions'), prevClicks = sum('prev_clicks'), prevImpressions = sum('prev_impressions')
  return {
    pages: rows.length,
    clicks, impressions, ctr: impressions ? round(clicks / impressions) : 0, position: pos('impressions', 'position'),
    prev: { clicks: prevClicks, impressions: prevImpressions, ctr: prevImpressions ? round(prevClicks / prevImpressions) : 0, position: pos('prev_impressions', 'prev_position') },
    opportunities: rows.filter((r) => r.opportunity).length,
    period_end: rows[0]?.period_end ?? '',
  }
}
