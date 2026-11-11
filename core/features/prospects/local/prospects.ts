import { L, isEn } from './_i18n'
import { askJSON, profile, projectBrief } from './_ai'
import { apolloHow, apolloKey, enrichPerson, searchPeople, type ApolloFilters, type ApolloPerson } from './_apollo'
import { bare, pickSites, readSites, type Site } from './_webfind'
import { searchMany, type Serp } from './serp'

// 手机上也能看、能改状态、能转询盘：只用 ctx.db
export const cloud = ['list', 'saveIcp', 'update', 'convert']

// 要本机密钥、模型：手机上点了转给电脑上开着的 Annulo 跑
export const remote = ['run', 'enrich', 'status']

// 主动获客：客户画像（ICP）→ 找客户 → AI 评分写开场白 → 用户挑合格的转成询盘，进询盘的商机看板跟进。
// 找客户有两种（批次的 source）：
//   web：从企业官网反查买家。用用户自己的 Chrome 搜 Google（core 的 serp），挑出公司官网，读首页和联系页取简介和公开的邮箱、电话，
//        AI 判断是不是买家（进口商、分销商、零售商、品牌…）。不要任何账号，找到的是公司，不是具体的人；
//   apollo：Apollo 按职位、地区、行业找人（要 Apollo 付费套餐的 API Key），邮箱要另外 enrich（每人花 1 个积分）。
//
// 客户画像、搜索词和 Apollo 条件交给助手按任务 tasks/draft-icp.md 写（读公司资料、产品、企业资料），存成一个待确认的批次（saveIcp）；
// 用户在页面上改，点「开始获客」跑 run：找客户 → 评分（ctx.llm，后台的判断）。领英只给主页链接，用户自己在浏览器里看、自己加好友，不自动发消息。
//
//   prospects.status({})                       Apollo 配没配好、有没有浏览器
//   prospects.list({ batch_id? })              批次列表 + 这个批次（默认最新）的人
//   prospects.saveIcp({ batch_id?, name?, icp, source?, queries?, filters?, limit? })   存客户画像和条件（没给 batch_id 就新建一个待确认的批次）
//   prospects.run({ batch_id, source?, queries?, filters?, limit? })   找客户 + 评分（带了条件先存）
//   prospects.enrich({ ids })                  取邮箱（花积分，最多 25 个一次）
//   prospects.update({ id, status })           new / qualified / skipped
//   prospects.convert({ id })                  转成询盘（leads，source=prospect），之后在询盘里背调、写回复、跟进
//
//   命令行：annulo run prospects.run --input '{"batch_id":"…"}'

const SENIORITIES = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager', 'senior', 'entry', 'intern']
const RANGES = ['1,10', '11,20', '21,50', '51,100', '101,200', '201,500', '501,1000', '1001,2000', '2001,5000', '5001,10000', '10001,']
const QUALIFIED = 60
const BATCH = 20
const SOURCES = ['web', 'apollo']

const nowISO = () => new Date().toISOString()
const parse = <T,>(v: unknown, d: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : ((v as T) ?? d)
  } catch {
    return d
  }
}
const strs = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，\n]/) : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max)

/** 筛选条件校验整理：只留 Apollo 认的字段和取值 */
export function cleanFilters(f: any): ApolloFilters {
  const out: ApolloFilters = {
    person_titles: strs(f?.person_titles),
    person_seniorities: strs(f?.person_seniorities).filter((s) => SENIORITIES.includes(s)),
    person_locations: strs(f?.person_locations),
    organization_num_employees_ranges: strs(f?.organization_num_employees_ranges).filter((r) => RANGES.includes(r)),
    q_organization_keyword_tags: strs(f?.q_organization_keyword_tags),
  }
  const q = String(f?.q_keywords ?? '').trim()
  if (q) out.q_keywords = q.slice(0, 200)
  for (const k of Object.keys(out) as (keyof ApolloFilters)[]) if (Array.isArray(out[k]) && !(out[k] as string[]).length) delete out[k]
  return out
}

/** 搜索词：一行一个，英文 Google 搜索词，最多 20 个 */
export const cleanQueries = (v: unknown): string[] => [...new Set(strs(v, 40).map((q) => q.replace(/\s+/g, ' ').slice(0, 200)))].slice(0, 20)

export function status(_: unknown, ctx: any) {
  return { ready: !!apolloKey(ctx), how: apolloHow(ctx), browser: !!ctx.browser?.open, seniorities: SENIORITIES, ranges: RANGES }
}

export function list(input: { batch_id?: string }, ctx: any) {
  const batches: any[] = ctx.db.query('prospect_batches', { limit: 200 }).list
  batches.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const batch = input?.batch_id ? batches.find((b) => b.id === input.batch_id) : batches[0]
  const people = batch ? ctx.db.query('prospects', { where: { batch_id: batch.id }, limit: 1000 }).list.map(({ raw, ...p }: any) => p) : []
  people.sort((a: any, b: any) => (b.score ?? -1) - (a.score ?? -1))
  const view = (b: any) => ({ ...b, source: sourceOf(b), icp: parse(b.icp, {}), filters: parse(b.filters, {}), queries: parse(b.queries, []) })
  return { batches: batches.map((b) => ({ id: b.id, name: b.name, source: sourceOf(b), status: b.status, found: b.found ?? 0, qualified: b.qualified ?? 0, created_at: b.created_at })), batch: batch ? view(batch) : null, people }
}

/** 老批次没有 source：只有 Apollo 条件的是 apollo */
const sourceOf = (b: any) => (SOURCES.includes(b?.source) ? b.source : parse<string[]>(b?.queries, []).length ? 'web' : 'apollo')

export function saveIcp(input: { batch_id?: string; name?: string; icp?: any; source?: string; queries?: any; filters?: any; limit?: number }, ctx: any) {
  const old = input?.batch_id ? ctx.db.get('prospect_batches', input.batch_id) : null
  if (input?.batch_id && !old) throw new Error(L(ctx, '没有这个批次', 'No such batch'))
  if (old?.status === 'running') throw new Error(L(ctx, '这批正在跑，等跑完再改', 'This batch is running; wait until it finishes'))
  const filters = input?.filters !== undefined ? cleanFilters(input.filters) : parse<ApolloFilters>(old?.filters, {})
  const queries = input?.queries !== undefined ? cleanQueries(input.queries) : parse<string[]>(old?.queries, [])
  const source = SOURCES.includes(String(input?.source)) ? String(input.source) : old ? sourceOf(old) : queries.length || !Object.keys(filters).length ? 'web' : 'apollo'
  if (source === 'web' && !queries.length) throw new Error(L(ctx, '搜索词是空的：至少写一个，比如 LED lighting distributor Germany', 'No search queries: add at least one, e.g. LED lighting distributor Germany'))
  if (source === 'apollo' && !Object.keys(filters).length) throw new Error(L(ctx, '筛选条件是空的：至少写职位或行业关键词', 'The filters are empty: give at least job titles or industry keywords'))
  const limit = Math.min(Math.max(Math.floor(input?.limit ?? old?.limit ?? (source === 'web' ? 50 : 100)), 10), 500)
  const t = nowISO()
  const patch: Record<string, unknown> = { source, filters: JSON.stringify(filters), queries: JSON.stringify(queries), limit, updated_at: t }
  if (input.icp !== undefined) patch.icp = JSON.stringify(input.icp ?? {})
  if (input.name) patch.name = String(input.name).slice(0, 100)
  if (old) return ctx.db.update('prospect_batches', old.id, patch)
  return ctx.db.insert('prospect_batches', { name: input.name || L(ctx, `获客 ${t.slice(0, 10)}`, `Prospecting ${t.slice(0, 10)}`), icp: patch.icp ?? '{}', ...patch, status: 'draft', step: '', found: 0, qualified: 0, created_at: t })
}

type Scored = { i: number; score: number; reason: string; opener: string }

async function scoreBatch(ctx: any, icp: any, people: any[]): Promise<Scored[]> {
  const system = `你帮一个外贸团队筛选主动开发的潜在客户：按客户画像给每个人打分，写一句开场白。

${projectBrief(profile(ctx))}

客户画像（ICP）：${JSON.stringify(icp).slice(0, 3000)}

打分（score 0~100）：公司业务和我方产品对口、职位是采购决策人或能影响采购、规模和地区符合画像，越符合越高；明显不对口（同行竞争者、服务商、学生、求职者）给 20 以下。
reason：一句话依据。opener：一句英文开场白，用在领英邀请或开发信第一句，点出对方公司或职位的具体情况和我们能帮什么，不夸张、不群发腔，不超过 300 个字符。
只根据给的信息判断，不要编造。` + (isEn(ctx) ? '\n\nWrite "reason" in English.' : '\n\nreason 用中文写。')
  const items = people.map((p, i) => ({ i, name: p.name, title: p.title, seniority: p.seniority, company: p.company, domain: p.company_domain, size: p.company_size, industry: p.industry, country: p.country }))
  const out = await askJSON<{ list: Scored[] } | Scored[]>(ctx, system, `下面是 ${items.length} 个人（JSON）。逐个打分，返回 JSON：{"list":[{"i":序号,"score":0-100,"reason":"…","opener":"…"}]}\n\n${JSON.stringify(items)}`)
  const list = Array.isArray(out) ? out : (out?.list ?? [])
  return list.filter((x) => typeof x?.i === 'number')
}

export async function run(input: { batch_id: string; source?: string; queries?: any; filters?: any; limit?: number }, ctx: any) {
  // 页面上改过条件直接点「开始获客」：先存条件再跑
  if (input?.filters || input?.queries || input?.source) saveIcp({ batch_id: input.batch_id, source: input.source, queries: input.queries, filters: input.filters, limit: input.limit }, ctx)
  const b = ctx.db.get('prospect_batches', input?.batch_id)
  if (!b) throw new Error(L(ctx, '没有这个批次', 'No such batch'))
  return sourceOf(b) === 'web' ? runWeb(b, ctx) : runApollo(b, ctx)
}

async function runApollo(b: any, ctx: any) {
  if (!apolloKey(ctx)) throw new Error(apolloHow(ctx))
  const filters = parse<ApolloFilters>(b.filters, {})
  const icp = parse(b.icp, {})
  const limit = Number(b.limit ?? 100)
  ctx.db.update('prospect_batches', b.id, { status: 'running', step: 'search', error: '', updated_at: nowISO() })
  try {
    // 1. 找人：按页拉到 limit，所有批次里已经有的（同一个 Apollo id）跳过
    const seen = new Set((ctx.db.query('prospects', { limit: 1000 }).list as any[]).map((p) => p.apollo_id))
    const found: ApolloPerson[] = []
    for (let page = 1; found.length < limit && page <= 10; page++) {
      ctx.progress?.({ done: found.length, total: limit, message: L(ctx, `在 Apollo 找人（第 ${page} 页）…`, `Searching Apollo (page ${page})…`) })
      const r = await searchPeople(ctx, filters, page, Math.min(100, limit))
      for (const p of r.people) if (!seen.has(p.id) && found.length < limit) (seen.add(p.id), found.push(p))
      if (r.people.length < Math.min(100, limit)) break
    }
    const t = nowISO()
    const rows = found.map((p) => ctx.db.insert('prospects', {
      batch_id: b.id, source: 'apollo', apollo_id: p.id, name: p.name, title: p.title, seniority: p.seniority, company: p.company, company_domain: p.company_domain, company_size: p.company_size,
      industry: p.industry, country: p.country, city: p.city, linkedin_url: p.linkedin_url, email: p.email ?? '', email_status: p.email_status ?? '', phone: p.phone ?? '',
      status: 'new', raw: JSON.stringify(p.raw).slice(0, 4000), created_at: t, updated_at: t,
    }))
    // 2. 评分：一批批调模型，失败的这批留着不打分（页面上能重跑）
    ctx.db.update('prospect_batches', b.id, { step: 'score', found: rows.length, updated_at: nowISO() })
    let qualified = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = rows.slice(i, i + BATCH)
      ctx.progress?.({ done: i, total: rows.length, message: L(ctx, `AI 在给第 ${i + 1}–${i + part.length} 个人打分（共 ${rows.length} 个）`, `AI scoring ${i + 1}–${i + part.length} of ${rows.length}`) })
      let scored: Scored[] = []
      try {
        scored = await scoreBatch(ctx, icp, part)
      } catch {
        continue
      }
      const by = new Map(scored.map((s) => [s.i, s]))
      for (const [k, p] of part.entries()) {
        const s = by.get(k)
        if (!s) continue
        const score = Math.min(Math.max(Math.round(Number(s.score) || 0), 0), 100)
        if (score >= QUALIFIED) qualified++
        ctx.db.update('prospects', p.id, { score, score_reason: String(s.reason ?? '').slice(0, 500), opener: String(s.opener ?? '').slice(0, 400), status: score >= QUALIFIED ? 'qualified' : 'new', updated_at: nowISO() })
      }
    }
    ctx.db.update('prospect_batches', b.id, { status: 'done', step: 'done', found: rows.length, qualified, updated_at: nowISO() })
    return { found: rows.length, qualified }
  } catch (e: any) {
    ctx.db.update('prospect_batches', b.id, { status: 'failed', error: e.message, updated_at: nowISO() })
    throw e
  }
}

type ScoredSite = { i: number; score: number; reason: string; opener: string; company?: string; country?: string; industry?: string }

async function scoreSites(ctx: any, icp: any, sites: Site[]): Promise<ScoredSite[]> {
  const system = `你帮一个外贸团队从搜索到的企业官网里找买家：按客户画像判断每个网站背后的公司是不是我们要找的客户，打分，写一句开场白。

${projectBrief(profile(ctx))}

客户画像（ICP）：${JSON.stringify(icp).slice(0, 3000)}

打分（score 0~100）：对方会买我们的产品——进口商、分销商、批发商、零售商、品牌商、系统集成商、用我们产品做项目的公司——业务越对口、地区和规模越符合画像，越高。
同行工厂（和我们卖一样的东西的制造商）、B2B 平台、媒体、协会、目录站、服务商、个人博客给 20 以下；只有搜索摘要、官网没读到的，信息不够就给保守的分。
company：网站背后公司的正式名称（从标题、正文里认，认不出用域名）。country：公司所在国家（英文，看不出空着）。industry：一句很短的英文，说它是做什么的，如 "LED lighting distributor"。
reason：一句话依据。opener：一句英文开场白，用在开发信第一句，点出对方公司的具体业务和我们能帮什么，不夸张、不群发腔，不超过 300 个字符。
只根据给的信息判断，不要编造。` + (isEn(ctx) ? '\n\nWrite "reason" in English.' : '\n\nreason 用中文写。')
  const items = sites.map((s, i) => ({ i, domain: s.domain, title: s.title, description: s.desc, search_snippet: s.snippet, site_text: s.text.slice(0, 1000), read: s.read }))
  const out = await askJSON<{ list: ScoredSite[] } | ScoredSite[]>(ctx, system, `下面是 ${items.length} 个网站（JSON）。逐个判断，返回 JSON：{"list":[{"i":序号,"score":0-100,"company":"…","country":"…","industry":"…","reason":"…","opener":"…"}]}\n\n${JSON.stringify(items)}`)
  const list = Array.isArray(out) ? out : (out?.list ?? [])
  return list.filter((x) => typeof x?.i === 'number')
}

/** 不用找的域名：自己的网站、竞品、所有批次里已经找过的 */
function knownDomains(ctx: any): Set<string> {
  const out = new Set<string>()
  const add = (u: unknown) => {
    const d = bare(String(u ?? ''))
    if (d) out.add(d)
  }
  const all = (t: string) => {
    try {
      return ctx.db.query(t, { limit: 1000 }).list as any[]
    } catch {
      return []
    }
  }
  for (const c of all('channels')) (add(c.live_url), add(c.preview_url))
  for (const c of all('competitors')) (add(c.host), add(c.url))
  for (const p of all('prospects')) add(p.company_domain)
  return out
}

/** 从企业官网反查买家：Google 搜（用户的 Chrome）→ 挑官网 → 读首页和联系页 → AI 判断、打分 */
async function runWeb(b: any, ctx: any) {
  const queries = parse<string[]>(b.queries, [])
  if (!queries.length) throw new Error(L(ctx, '这批还没有搜索词', 'This batch has no search queries yet'))
  if (!ctx.browser?.open) throw new Error(L(ctx, '搜官网要用你的 Chrome 搜 Google：在 Chrome 里装 Annulo 插件、开着 Chrome，再点开始', 'Finding buyers via websites searches Google in your Chrome: install the Annulo extension, keep Chrome open, then start again'))
  const icp = parse(b.icp, {})
  const limit = Number(b.limit ?? 50)
  ctx.db.update('prospect_batches', b.id, { status: 'running', step: 'search', error: '', updated_at: nowISO() })
  try {
    // 1. 搜 Google：用户的 Chrome，一个词一个词查，碰到验证码停下、用已经查到的
    const serps: Serp[] = []
    let done = 0
    const r = await searchMany({ queries, hl: 'en' }, ctx, (q: string) => {
      done++
      ctx.progress?.({ done, total: queries.length, message: L(ctx, `在 Google 搜「${q}」（${done}/${queries.length}）`, `Searching Google for "${q}" (${done}/${queries.length})`) })
    }).catch((e: any) => {
      throw new Error(L(ctx, `没法用你的 Chrome 搜 Google（${String(e?.message ?? e).slice(0, 300)}）。要在 Chrome 里装 Annulo 插件、开着 Chrome，并允许 Annulo 操作 google.com`, `Couldn't search Google in your Chrome (${String(e?.message ?? e).slice(0, 300)}). Install the Annulo extension, keep Chrome open and allow Annulo on google.com`))
    })
    serps.push(...r.results)
    if (!serps.length) throw new Error(r.stopped || r.errors[0]?.message || L(ctx, 'Google 没搜到结果', 'Google returned no results'))
    const warn = r.stopped ? L(ctx, `搜到第 ${serps.length} 个词停下了：${r.stopped}`, `Stopped after ${serps.length} queries: ${r.stopped}`) : ''

    // 2. 挑官网、读首页和联系页
    const picked = pickSites(serps, knownDomains(ctx), limit)
    ctx.db.update('prospect_batches', b.id, { step: 'read', updated_at: nowISO() })
    const sites = await readSites(ctx, picked, (n) => ctx.progress?.({ done: n, total: picked.length, message: L(ctx, `读官网的联系方式（${n}/${picked.length}）`, `Reading websites for contacts (${n}/${picked.length})`) }))

    // 3. 评分：一批批调模型；评过的才存（没评上的下次「再找一批」还能再找到）
    ctx.db.update('prospect_batches', b.id, { step: 'score', updated_at: nowISO() })
    let found = 0
    let qualified = 0
    for (let i = 0; i < sites.length; i += BATCH) {
      const part = sites.slice(i, i + BATCH)
      ctx.progress?.({ done: i, total: sites.length, message: L(ctx, `AI 在判断第 ${i + 1}–${i + part.length} 个网站（共 ${sites.length} 个）`, `AI checking sites ${i + 1}–${i + part.length} of ${sites.length}`) })
      let scored: ScoredSite[] = []
      try {
        scored = await scoreSites(ctx, icp, part)
      } catch {
        continue
      }
      const by = new Map(scored.map((s) => [s.i, s]))
      const t = nowISO()
      for (const [k, s] of part.entries()) {
        const x = by.get(k)
        if (!x) continue
        const score = Math.min(Math.max(Math.round(Number(x.score) || 0), 0), 100)
        if (score >= QUALIFIED) qualified++
        found++
        const company = String(x.company || s.title || s.domain).trim().slice(0, 200)
        ctx.db.insert('prospects', {
          batch_id: b.id, source: 'web', apollo_id: '', name: company, title: '', seniority: '', company, company_domain: s.domain, company_size: '',
          industry: String(x.industry ?? '').slice(0, 120), country: String(x.country ?? '').slice(0, 60), city: '', linkedin_url: s.linkedin,
          email: s.emails[0] ?? '', email_status: s.emails.length ? 'public' : s.read ? 'unavailable' : '', phone: s.phones[0] ?? '',
          score, score_reason: String(x.reason ?? '').slice(0, 500), opener: String(x.opener ?? '').slice(0, 400), status: score >= QUALIFIED ? 'qualified' : 'new',
          raw: JSON.stringify({ url: s.url, title: s.title, desc: s.desc, snippet: s.snippet, emails: s.emails, phones: s.phones, read: s.read }).slice(0, 4000), created_at: t, updated_at: t,
        })
      }
    }
    const prev = ctx.db.query('prospects', { where: { batch_id: b.id }, limit: 1000 }).list as any[]
    const total = prev.length
    const ok = prev.filter((p) => (p.score ?? 0) >= QUALIFIED).length
    ctx.db.update('prospect_batches', b.id, { status: 'done', step: 'done', found: total, qualified: ok, error: warn, updated_at: nowISO() })
    return { found, qualified, ...(warn ? { warning: warn } : {}) }
  } catch (e: any) {
    ctx.db.update('prospect_batches', b.id, { status: 'failed', error: e.message, updated_at: nowISO() })
    throw e
  }
}

export async function enrich(input: { ids: string[] }, ctx: any) {
  const ids = (input?.ids ?? []).slice(0, 25)
  if (!ids.length) throw new Error(L(ctx, '先选要取邮箱的人', 'Pick the people to reveal emails for first'))
  let got = 0
  const errors: string[] = []
  for (const [i, id] of ids.entries()) {
    const p = ctx.db.get('prospects', id)
    if (!p || p.email || !p.apollo_id) continue
    ctx.progress?.({ done: i, total: ids.length, message: L(ctx, `取 ${p.name} 的邮箱…`, `Revealing ${p.name}'s email…`) })
    try {
      const r = await enrichPerson(ctx, p.apollo_id)
      const patch: Record<string, unknown> = { email_status: r?.email ? r.email_status || 'verified' : 'unavailable', updated_at: nowISO() }
      if (r?.email) (patch.email = r.email, got++)
      if (r?.linkedin_url && !p.linkedin_url) patch.linkedin_url = r.linkedin_url
      if (r?.phone && !p.phone) patch.phone = r.phone
      if (r?.name && r.name.length > String(p.name).length) patch.name = r.name
      ctx.db.update('prospects', id, patch)
    } catch (e: any) {
      errors.push(`${p.name}：${e.message}`)
      if (/API Key|限流|rate limit|rejected/i.test(e.message)) break
    }
  }
  return { emails: got, ...(errors.length ? { errors } : {}) }
}

export function update(input: { id: string; status: string }, ctx: any) {
  const p = ctx.db.get('prospects', input?.id)
  if (!p) throw new Error(L(ctx, '没有这个人', 'No such prospect'))
  if (!['new', 'qualified', 'skipped'].includes(input.status)) throw new Error(L(ctx, '状态只能是 new / qualified / skipped', 'Status must be new / qualified / skipped'))
  return ctx.db.update('prospects', p.id, { status: input.status, updated_at: nowISO() })
}

/** 转成询盘：进 leads（source=prospect），在询盘的看板、背调、回复里接着跟 */
export function convert(input: { id: string }, ctx: any) {
  const p = ctx.db.get('prospects', input?.id)
  if (!p) throw new Error(L(ctx, '没有这个人', 'No such prospect'))
  if (p.lead_id && ctx.db.get('leads', p.lead_id)) return { lead_id: p.lead_id, existed: true }
  const t = nowISO()
  const web = p.source === 'web'
  const contact = { name: web ? '' : p.name, email: p.email || '', phone: p.phone || '', company: p.company, title: p.title, country: p.country }
  const who = web ? p.company : `${p.title || ''} @ ${p.company}`
  const message = L(ctx, `主动开发：${who}${p.company_domain ? `（${p.company_domain}）` : ''}。${p.score_reason || ''}`, `Outbound: ${who}${p.company_domain ? ` (${p.company_domain})` : ''}. ${p.score_reason || ''}`)
  const lead = ctx.db.insert('leads', {
    channel_id: '', source: 'prospect', source_ref: p.apollo_id || p.company_domain || p.id, form_name: web ? L(ctx, '官网反查', 'Website search') : 'Apollo', submitted_at: t, contact: JSON.stringify(Object.fromEntries(Object.entries(contact).filter(([, v]) => v))),
    company: p.company, message: message.slice(0, 1000), fields: JSON.stringify({ linkedin: p.linkedin_url, opener: p.opener, score: p.score, domain: p.company_domain, size: p.company_size, industry: p.industry }),
    landing_page: p.linkedin_url || (web && p.company_domain ? `https://${p.company_domain}` : ''), utm: '{}', referrer: '', country: p.country, is_real: true, pending: false, intent: (p.score ?? 0) >= 80 ? 'high' : 'medium', intent_reason: p.score_reason || '',
    tags: '[]', status: 'new', created_at: t, updated_at: t,
  })
  ctx.db.update('prospects', p.id, { status: 'converted', lead_id: lead.id, updated_at: t })
  return { lead_id: lead.id }
}
