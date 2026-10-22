import { L } from './_i18n'
import { profile } from './_ai'
import { brandTerms, DAY, isNoise, notConnected, query, ymd } from './_gsc'
import { bucketOf, gscByKeyword, MODIFIERS, mergeSources, normKey, parseSuggest, scoreOf, splitTerms, suggestUrl, usable, type Bucket } from './_keywords'

// 只读写表的：手机上也能看、能改状态、能转选题
export const cloud = ['list', 'context', 'save', 'setStatus', 'toTopic', 'markSeen', 'add']

// 要出网（联想接口）、要 Google 授权的：手机上点了转给电脑上开着的 Annulo 跑
export const remote = ['expand', 'refresh']

// 关键词挖掘：哪些词值得做、能做起来（设计见 docs/keywords.md）。
//
//   keywords.expand({ channel_id, seeds?, modifiers?, lang?, country?, max_seeds? })
//       从种子词扩词：种子默认取项目资料的关键词和产品，每个种子拼上修饰词（外贸默认 manufacturer、supplier…，见 _keywords.ts 的 MODIFIERS）去拉搜索引擎的下拉联想
//       （先 Google，访问不了换 Bing）；再把本站在 GSC 里已有曝光的非品牌搜索词也加进来。新词 status=raw，等助手筛。连了 GSC 顺手 refresh
//   keywords.refresh({ channel_id?, manual? })   按 GSC 最近 28 天更新每个词的曝光、排名、曝光最多的页面，按规则分桶（定时任务每周一次）
//   keywords.list({ channel_id })                页面用：全部词（不含 raw 的明细只给条数）、分桶条数、最近一次筛词的对话
//   keywords.context({ channel_id, limit? })     给助手筛词用（任务 tasks/keyword-research.md）：待筛的词、已有主题、项目资料、产品、站内页面
//   keywords.save({ channel_id, items })         助手筛完存回：items 每条 { id 或 keyword, keep, intent, cluster, note, target_page? }，没有的词新建（source=agent）
//   keywords.setStatus({ ids, status })          idea / targeting / dismissed
//   keywords.toTopic({ ids })                    按主题转成选题（topics，source=keyword），这几个词标成在做
//   keywords.add({ channel_id, keywords })       用户手动加词（逗号、换行分开），status=raw
//   keywords.markSeen({ channel_id, ids? })      去掉「新」标识
//
// 分桶只看事实（GSC 里本站排第几、有多少曝光），规则在 _keywords.ts 的 bucketOf；相不相关、什么意图、归哪个主题要理解，交给助手。

type Channel = { id: string; name: string; type: string; preview_url?: string; gsc_property?: string; gsc_link_disabled?: boolean }
type Keyword = {
  id: string; channel_id: string; keyword: string; lang?: string; country?: string; sources?: string; seed?: string; suggest_engine?: string
  status?: string; intent?: string; cluster?: string; note?: string; target_page?: string
  gsc_impressions?: number; gsc_clicks?: number; gsc_position?: number; gsc_page?: string; search_page_id?: string; gsc_at?: string
  bucket?: Bucket; score?: number; topic_id?: string; chat_id?: string; seen?: boolean; created_at?: string; reviewed_at?: string
}

const WINDOW = 28
const LAG = 3 // GSC 数据延迟 2~3 天
const MAX_SEEDS = 12
const MAX_NEW = 300 // 一次最多新加多少个词
const MAX_GSC = 30 // 从 GSC 带进来的搜索词最多几个（按曝光）
const STATUSES = ['idea', 'targeting', 'dismissed']
const INTENTS = ['buy', 'compare', 'research', 'other']

function rowsOf(ctx: any, channelId?: string): Keyword[] {
  try {
    const out: Keyword[] = []
    let cursor = ''
    do {
      const r = ctx.db.query('keywords', { ...(channelId ? { where: { channel_id: channelId } } : {}), limit: 1000, cursor })
      out.push(...(r.list ?? []))
      cursor = r.next_cursor ?? ''
    } while (cursor)
    return out
  } catch {
    return [] // 表还没建（刚升级上来）
  }
}

function channelOf(ctx: any, id?: string): Channel {
  const list: Channel[] = ctx.db.query('channels', { where: { type: 'creght_site' }, limit: 500 }).list
  const ch = id ? list.find((c) => c.id === id) : list[0]
  if (!ch) throw new Error(L(ctx, '找不到这个独立站渠道', 'Site channel not found'))
  return ch
}

const gscReady = (ch: Channel) => !!ch.gsc_property && !ch.gsc_link_disabled

/** 产品表：外贸的有 category，产品运营的没有；表不在当空的 */
function productsOf(ctx: any): { name: string; summary?: string; keywords?: string; category?: string }[] {
  try {
    return (ctx.db.query('products', { limit: 200 }).list ?? []).filter((p: any) => p.status !== 'archived')
  } catch {
    return []
  }
}

/** 没给种子时：项目资料的关键词、产品的关键词和名称、产品分类 */
function defaultSeeds(ctx: any): string[] {
  const p = profile(ctx)
  const products = productsOf(ctx)
  return splitTerms(p.keywords, ...products.map((x) => x.keywords), ...products.slice(0, 10).map((x) => x.name), ...products.map((x) => x.category))
}

/** 修饰词：助手给了就用（最多 12 个）；没给时产品表像外贸的（有起订量、交期）用外贸那组，否则用通用的 */
function modifiersOf(given: string[] | string | undefined, lang: string, ctx: any): string[] {
  const list = Array.isArray(given) ? given.map((s) => String(s).trim()).filter(Boolean) : splitTerms(given)
  if (list.length) return list.slice(0, 12)
  const trade = productsOf(ctx).some((p: any) => p.moq || p.lead_time || p.certs)
  return MODIFIERS[trade ? 'trade' : 'general'][lang.startsWith('zh') ? 'zh' : 'en']
}

export async function expand(input: { channel_id?: string; seeds?: string[] | string; modifiers?: string[] | string; lang?: string; country?: string; max_seeds?: number }, ctx: any) {
  const ch = channelOf(ctx, input?.channel_id)
  const lang = String(input?.lang || 'en').toLowerCase()
  const country = String(input?.country || 'us').toLowerCase()
  const given = Array.isArray(input?.seeds) ? splitTerms(...input.seeds) : splitTerms(input?.seeds)
  const seeds = (given.length ? given : defaultSeeds(ctx)).slice(0, Math.min(Math.max(1, Number(input?.max_seeds) || MAX_SEEDS), 30))
  // 品牌词再加上项目名：站点在别人的域名下（xxx.talizen.com）时，按域名算出来的是平台名
  const p = profile(ctx)
  const brands = brandTerms(ch.gsc_property || ch.preview_url || '', [p.brand_terms, p.name].filter(Boolean).join(','))
  if (!seeds.length && !gscReady(ch)) throw new Error(L(ctx, '没有种子词：先在项目资料里填关键词、录入产品，或者直接给几个词', 'No seed keywords: add keywords to the project profile, add products, or give a few words'))

  const existing = rowsOf(ctx, ch.id)
  const byKey = new Map(existing.map((k) => [normKey(k.keyword), k]))
  const found = new Map<string, { keyword: string; seed: string; sources: string }>()
  const take = (kw: string, seed: string, source: string) => {
    const k = normKey(kw)
    if (!usable(kw) || isNoise(kw, brands)) return
    const f = found.get(k)
    if (f) f.sources = mergeSources(f.sources, source)
    else found.set(k, { keyword: kw.trim(), seed, sources: source })
  }

  // 1. 下拉联想：每个种子词本身 + 拼上修饰词。先用 Google 试第一条，访问不了（国内网络）整批换 Bing
  let engine: 'google' | 'bing' | '' = ''
  if (seeds.length) {
    const mods = modifiersOf(input?.modifiers, lang, ctx)
    const qs: { q: string; seed: string }[] = []
    for (const s of seeds) {
      qs.push({ q: s, seed: s })
      for (const m of mods) qs.push({ q: `${s} ${m}`, seed: s })
    }
    for (const e of ['google', 'bing'] as const) {
      // 国内网络连 Google 常常不报错、一直等：最多等 8 秒
      const probe = await Promise.race([ctx.fetchAll([suggestUrl(e, qs[0].q, lang, country)]).then((r: any[]) => r[0]), ctx.sleep(8000).then(() => null)])
      if (probe?.ok && /^\s*\[/.test(await textOf(probe))) {
        engine = e
        break
      }
    }
    if (!engine) ctx.log(L(ctx, 'Google 和 Bing 的联想接口都访问不了，这次只用 GSC 的搜索词', 'Neither Google nor Bing suggestions are reachable; using Search Console queries only'))
    else {
      ctx.progress({ message: L(ctx, `用 ${engine === 'google' ? 'Google' : 'Bing'} 联想扩展 ${seeds.length} 个种子词`, `Expanding ${seeds.length} seeds with ${engine === 'google' ? 'Google' : 'Bing'} suggestions`), done: 0, total: qs.length })
      const BATCH = 20
      for (let i = 0; i < qs.length; i += BATCH) {
        const part = qs.slice(i, i + BATCH)
        const res = await ctx.fetchAll(part.map((x) => suggestUrl(engine as 'google' | 'bing', x.q, lang, country)))
        for (let j = 0; j < part.length; j++) {
          if (!res[j]?.ok) continue
          for (const s of parseSuggest(await textOf(res[j]))) take(s, part[j].seed, 'suggest')
        }
        ctx.progress({ done: Math.min(qs.length, i + BATCH), total: qs.length })
      }
    }
  }

  // 2. 本站在 GSC 里已有曝光的非品牌搜索词：真实需求，按曝光取前几十个
  let gscNote = ''
  if (gscReady(ch)) {
    try {
      const end = Date.now() - LAG * DAY
      const rows = await query(ctx, ch.gsc_property!, { start: ymd(end - (WINDOW - 1) * DAY), end: ymd(end), dimensions: ['query'], rowLimit: 1000 })
      rows.filter((r) => !isNoise(r.keys[0], brands)).sort((a, b) => b.impressions - a.impressions).slice(0, MAX_GSC).forEach((r) => take(r.keys[0], '', 'gsc'))
    } catch (e) {
      gscNote = (e as Error).message
    }
  }

  // 3. 写表：已有的合并来源，新的建成 raw
  const now = new Date().toISOString()
  let added = 0
  for (const [k, f] of found) {
    const old = byKey.get(k)
    if (old) {
      const sources = mergeSources(old.sources, f.sources)
      if (sources !== old.sources) ctx.db.update('keywords', old.id, { sources })
      continue
    }
    if (added >= MAX_NEW) break
    ctx.db.insert('keywords', {
      channel_id: ch.id, keyword: f.keyword, lang, country, sources: f.sources, seed: f.seed,
      ...(f.sources.includes('suggest') && engine ? { suggest_engine: engine } : {}),
      status: 'raw', bucket: 'unchecked', score: 0, created_at: now,
    })
    added++
  }
  const refreshed = gscReady(ch) && !gscNote ? await refreshChannel(ch, ctx).catch((e) => ((gscNote = (e as Error).message), null)) : null
  return { seeds, engine, found: found.size, added, raw: rowsOf(ctx, ch.id).filter((k) => k.status === 'raw').length, refreshed, ...(gscNote ? { gsc_error: gscNote } : {}) }
}

async function textOf(r: any): Promise<string> {
  if (typeof r?.text === 'function') return r.text()
  return String(r?.body ?? '')
}

/** 按 GSC 更新一个网站所有词的曝光、排名、页面和分桶；值没变的不写 */
async function refreshChannel(ch: Channel, ctx: any) {
  const end = Date.now() - LAG * DAY
  const range = { start: ymd(end - (WINDOW - 1) * DAY), end: ymd(end) }
  ctx.progress({ message: L(ctx, `读取「${ch.name}」的搜索词排名（${range.start} ~ ${range.end}）`, `Reading query rankings for "${ch.name}" (${range.start} – ${range.end})`) })
  const [byQuery, byQueryPage] = await Promise.all([
    query(ctx, ch.gsc_property!, { ...range, dimensions: ['query'], rowLimit: 5000 }),
    query(ctx, ch.gsc_property!, { ...range, dimensions: ['query', 'page'], rowLimit: 10000 }),
  ])
  const gsc = gscByKeyword(byQuery, byQueryPage)
  let pages: { id: string; page: string }[] = []
  try {
    pages = ctx.db.query('search_pages', { where: { channel_id: ch.id }, limit: 1000 }).list
  } catch {}
  const pageId = new Map(pages.map((p) => [p.page, p.id]))
  const at = new Date().toISOString()
  let changed = 0
  const counts: Record<string, number> = {}
  for (const k of rowsOf(ctx, ch.id)) {
    const g = gsc.get(normKey(k.keyword))
    const m = { gsc_impressions: g?.impressions ?? 0, gsc_clicks: g?.clicks ?? 0, gsc_position: g?.position ?? 0, gsc_page: g?.page ?? '' }
    const bucket = bucketOf(m)
    const body = { ...m, search_page_id: (m.gsc_page && pageId.get(m.gsc_page)) || '', bucket, score: scoreOf(m, bucket) }
    counts[bucket] = (counts[bucket] ?? 0) + 1
    const same = (Object.keys(body) as (keyof typeof body)[]).every((f) => (k[f] ?? (typeof body[f] === 'number' ? 0 : '')) === body[f])
    if (same) continue
    // 新进快赢的词标「新」（筛过的才算，raw 的还没给用户看）
    const fresh = bucket === 'quick_win' && k.bucket !== 'quick_win' && k.status !== 'raw'
    ctx.db.update('keywords', k.id, { ...body, gsc_at: at, ...(fresh ? { seen: false } : {}) })
    changed++
  }
  return { channel: ch.name, changed, buckets: counts }
}

export async function refresh(input: { channel_id?: string; manual?: boolean }, ctx: any) {
  let chs: Channel[] = ctx.db.query('channels', { where: { type: 'creght_site' }, limit: 500 }).list
  if (input?.channel_id) chs = chs.filter((c) => c.id === input.channel_id)
  const used = new Set(rowsOf(ctx).map((k) => k.channel_id))
  chs = chs.filter((c) => gscReady(c) && used.has(c.id))
  if (!chs.length) {
    if (input?.manual) throw new Error(L(ctx, '这个网站还没关联 Search Console：先在「谷歌排名」里关联，才有排名数据', 'This site is not linked to Search Console yet: link it on the Google rankings page first'))
    return { skipped: L(ctx, '没有关联了 Search Console 且挖过关键词的网站', 'No site with Search Console linked and keywords collected') }
  }
  const list: any[] = []
  for (const ch of chs) {
    try {
      list.push(await refreshChannel(ch, ctx))
    } catch (e) {
      if (!input?.manual && notConnected(e)) return { skipped: L(ctx, '还没连接 Google', 'Google not connected') }
      throw e
    }
  }
  return { list }
}

const ORDER: Record<string, number> = { quick_win: 0, unchecked: 1, ranking: 2 }

export function list(input: { channel_id?: string }, ctx: any) {
  const rows = rowsOf(ctx, input?.channel_id)
  const raw = rows.filter((k) => k.status === 'raw')
  const reviewed = rows
    .filter((k) => k.status !== 'raw')
    .sort((a, b) => (ORDER[a.bucket ?? 'unchecked'] ?? 1) - (ORDER[b.bucket ?? 'unchecked'] ?? 1) || (b.score ?? 0) - (a.score ?? 0) || (b.gsc_impressions ?? 0) - (a.gsc_impressions ?? 0))
  const last = [...rows].filter((k) => k.chat_id && k.reviewed_at).sort((a, b) => (b.reviewed_at ?? '').localeCompare(a.reviewed_at ?? ''))[0]
  return {
    list: reviewed,
    raw: raw.length,
    raw_sample: raw.sort((a, b) => (b.gsc_impressions ?? 0) - (a.gsc_impressions ?? 0)).slice(0, 30).map((k) => k.keyword),
    chat_id: last?.chat_id ?? '',
    reviewed_at: last?.reviewed_at ?? '',
    gsc_at: rows.reduce((m, k) => ((k.gsc_at ?? '') > m ? k.gsc_at! : m), ''),
  }
}

export function context(input: { channel_id?: string; limit?: number }, ctx: any) {
  const ch = channelOf(ctx, input?.channel_id)
  const rows = rowsOf(ctx, ch.id)
  const limit = Math.min(Math.max(1, Number(input?.limit) || 150), 300)
  const raw = rows
    .filter((k) => k.status === 'raw')
    .sort((a, b) => (b.gsc_impressions ?? 0) - (a.gsc_impressions ?? 0))
    .slice(0, limit)
    .map((k) => ({ id: k.id, keyword: k.keyword, seed: k.seed, sources: k.sources, gsc_impressions: k.gsc_impressions || undefined, gsc_position: k.gsc_position || undefined, gsc_page: k.gsc_page || undefined }))
  const clusters = new Map<string, number>()
  for (const k of rows) if (k.cluster && k.status !== 'dismissed' && k.status !== 'raw') clusters.set(k.cluster, (clusters.get(k.cluster) ?? 0) + 1)
  let pages: any[] = []
  try {
    pages = ctx.db.query('search_pages', { where: { channel_id: ch.id }, limit: 1000 }).list
  } catch {}
  const p = profile(ctx)
  return {
    channel: { id: ch.id, name: ch.name, url: ch.preview_url, gsc: gscReady(ch) },
    raw,
    raw_total: rows.filter((k) => k.status === 'raw').length,
    clusters: [...clusters].map(([name, n]) => ({ name, keywords: n })),
    kept: rows.filter((k) => k.status === 'idea' || k.status === 'targeting').length,
    dismissed: rows.filter((k) => k.status === 'dismissed').slice(0, 100).map((k) => k.keyword),
    profile: { name: p.name, positioning: p.positioning, business: p.business, markets: p.markets, customer_types: p.customer_types, keywords: p.keywords },
    products: productsOf(ctx).slice(0, 40).map((x) => ({ name: x.name, category: x.category, keywords: x.keywords, summary: String(x.summary ?? '').slice(0, 160) })),
    site_pages: pages
      .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
      .slice(0, 40)
      .map((x) => ({ page: x.page, impressions: x.impressions, queries: safeQueries(x.top_queries).slice(0, 3) })),
  }
}

function safeQueries(s?: string): string[] {
  try {
    return (JSON.parse(s || '[]') as { query: string }[]).map((q) => q.query)
  } catch {
    return []
  }
}

type SaveItem = { id?: string; keyword?: string; keep?: boolean; intent?: string; cluster?: string; note?: string; target_page?: string }

export function save(input: { channel_id?: string; items: SaveItem[] }, ctx: any) {
  const ch = channelOf(ctx, input?.channel_id)
  const items = Array.isArray(input?.items) ? input.items : []
  if (!items.length) throw new Error(L(ctx, 'items 是空的：每个词一条 { id 或 keyword, keep, intent, cluster, note }', 'items is empty: one entry per keyword { id or keyword, keep, intent, cluster, note }'))
  const rows = rowsOf(ctx, ch.id)
  const byId = new Map(rows.map((k) => [k.id, k]))
  const byKey = new Map(rows.map((k) => [normKey(k.keyword), k]))
  const now = new Date().toISOString()
  const chat = ctx.chat_id || ''
  let kept = 0, dismissed = 0, added = 0
  const missing: string[] = []
  for (const it of items) {
    const keep = it.keep !== false
    const body: Partial<Keyword> = {
      intent: INTENTS.includes(String(it.intent)) ? it.intent : keep ? 'other' : '',
      cluster: String(it.cluster ?? '').trim().slice(0, 80),
      note: String(it.note ?? '').trim().slice(0, 300),
      reviewed_at: now,
      ...(chat ? { chat_id: chat } : {}),
      ...(it.target_page ? { target_page: String(it.target_page) } : {}),
    }
    const old = (it.id && byId.get(it.id)) || (it.keyword ? byKey.get(normKey(it.keyword)) : undefined)
    if (old) {
      const status = !keep ? 'dismissed' : old.status === 'targeting' ? 'targeting' : 'idea'
      ctx.db.update('keywords', old.id, { ...body, status, ...(status === 'idea' && old.status !== 'idea' ? { seen: false } : {}) })
    } else if (it.keyword && usable(it.keyword)) {
      const r = ctx.db.insert('keywords', { channel_id: ch.id, keyword: it.keyword.trim(), sources: 'agent', status: keep ? 'idea' : 'dismissed', bucket: 'unchecked', score: 0, seen: false, created_at: now, ...body })
      byKey.set(normKey(it.keyword), r)
      added++
    } else {
      missing.push(it.id || String(it.keyword ?? ''))
      continue
    }
    keep ? kept++ : dismissed++
  }
  return { kept, dismissed, added, ...(missing.length ? { missing } : {}), raw_left: rowsOf(ctx, ch.id).filter((k) => k.status === 'raw').length }
}

export function setStatus(input: { ids: string[]; status: string }, ctx: any) {
  if (!STATUSES.includes(input?.status)) throw new Error(L(ctx, 'status 只能是 idea / targeting / dismissed', 'status must be idea, targeting or dismissed'))
  let n = 0
  for (const id of input?.ids ?? []) if (ctx.db.get('keywords', id)) (ctx.db.update('keywords', id, { status: input.status, seen: true }), n++)
  return { updated: n }
}

/** 按主题转选题：一个主题一个选题，标题用曝光最多的词（没有曝光用第一个），关键词写全；已经有同名搜索词选题的直接挂上 */
export function toTopic(input: { ids: string[] }, ctx: any) {
  const rows: Keyword[] = (input?.ids ?? []).map((id) => ctx.db.get('keywords', id)).filter(Boolean)
  if (!rows.length) throw new Error(L(ctx, '没选中关键词', 'No keywords selected'))
  let topics: any[] = []
  try {
    topics = ctx.db.query('topics', { limit: 2000 }).list
  } catch {
    throw new Error(L(ctx, '这个项目没有选题表', 'This project has no topics table'))
  }
  const byQuery = new Map(topics.filter((t) => t.search_query).map((t) => [normKey(t.search_query), t]))
  const groups = new Map<string, Keyword[]>()
  for (const k of rows) {
    if (k.topic_id) continue
    const g = k.cluster || k.keyword
    groups.set(g, [...(groups.get(g) ?? []), k])
  }
  const now = new Date().toISOString()
  const created: string[] = []
  for (const [cluster, ks] of groups) {
    const main = [...ks].sort((a, b) => (b.gsc_impressions ?? 0) - (a.gsc_impressions ?? 0))[0]
    let topic = byQuery.get(normKey(main.keyword))
    if (!topic) {
      const notes = ks.map((k) => k.note).filter(Boolean)
      topic = ctx.db.insert('topics', {
        title: main.keyword,
        angle: L(ctx, `关键词主题「${cluster}」，一篇覆盖这几个词${notes[0] ? `：${notes[0]}` : ''}`, `Keyword cluster "${cluster}", one piece covering these keywords${notes[0] ? `: ${notes[0]}` : ''}`),
        keywords: ks.map((k) => k.keyword).join(', '),
        source: 'keyword', status: 'idea', search_query: main.keyword,
        ...(main.gsc_impressions ? { search_impressions: main.gsc_impressions, search_position: main.gsc_position } : {}),
        workspace: 'website', content_type: 'article', created_at: now,
      })
      created.push(main.keyword)
    }
    for (const k of ks) ctx.db.update('keywords', k.id, { topic_id: topic.id, status: 'targeting', seen: true })
  }
  return { created }
}

export function add(input: { channel_id?: string; keywords: string }, ctx: any) {
  const ch = channelOf(ctx, input?.channel_id)
  const have = new Set(rowsOf(ctx, ch.id).map((k) => normKey(k.keyword)))
  const now = new Date().toISOString()
  const added: string[] = []
  for (const kw of splitTerms(input?.keywords)) {
    if (have.has(normKey(kw))) continue
    ctx.db.insert('keywords', { channel_id: ch.id, keyword: kw, sources: 'manual', status: 'raw', bucket: 'unchecked', score: 0, created_at: now })
    have.add(normKey(kw))
    added.push(kw)
  }
  return { added }
}

export function markSeen(input: { channel_id?: string; ids?: string[] }, ctx: any) {
  const ids = input?.ids?.length ? new Set(input.ids) : null
  let n = 0
  for (const k of rowsOf(ctx, input?.channel_id)) if (k.seen === false && k.status !== 'raw' && (!ids || ids.has(k.id))) (ctx.db.update('keywords', k.id, { seen: true }), n++)
  return { marked: n }
}
