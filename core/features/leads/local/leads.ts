import { isEn, L } from './_i18n'
import { askJSON, profile, projectBrief } from './_ai'
import { formSubmissions, formWebhookCreate, formWebhookDelete, formWebhookTest, type FormSubmission } from './_creght'

// 手机上打开后台（不在 Shuttle 里）时这几个也能用：annulo push 会把它们打包成站点 Func，只能用 ctx.db、ctx.mcp('creght', …)、ctx.locale
export const cloud = ['stats', 'update']

// 要电脑的（浏览器、本机授权、密钥、外部接口）：手机上点了转给电脑上开着的 Shuttle 跑（设置 → 远程访问）
export const remote = ['formHook', 'judge', 'sync']

// 询盘线索（本机函数，Shuttle 在用户电脑上直接跑）。
//
// 两步：
// 1. 入库：表单提交原样写进 leads 表，标 pending=true（待判断），页面马上就能看到。两条路：
//    - 实时：每个独立站注册一个 creght 表单 webhook（connect），提交一来平台就 POST 到运营后台的 Func
//      （backend/func/leads_hook.ts），Func 验签后写入。电脑关着也不漏。
//    - 兜底：sync 通过 creght MCP 的 form_submissions 按游标增量拉，webhook 漏掉的在这里补上（按 source_ref 去重）。
// 2. 判断（judge）：取 pending 的行，让模型判断是不是真实询盘、意向高低，整理出联系人和留言摘要，写回去、pending=false。
//    要调模型，只能在本机跑：定时任务每 5 分钟跑一次，询盘页面开着时看到待判断的也会马上跑。
//
//   leads.sync({ channel_id? })               connect → 增量拉取（从 channels.leads_cursor 接着读）→ judge
//   leads.judge({ limit? })                   判断待判断（pending）的线索
//   leads.context({ id })                     写回复要的上下文：这条询盘（联系人、原始字段、留言）、公司与产品资料、上次的草稿
//   leads.saveReply({ id, subject, body })    存回复草稿（reply_subject / reply_body），页面上复制或用邮件发送；写回复交给助手按任务 tasks/reply-lead.md 做
//   leads.formHook({ channel_id })           外部表单（WordPress 插件、Zapier…）的 webhook：给这个渠道一个接收地址和密钥（有就沿用），页面上显示给用户贴进插件
//   leads.connect({ channel_id? })            给还没注册 webhook 的独立站注册、发测试事件确认能收到；清掉已删除渠道的 webhook。
//                                             webhook 记在 lead_hooks 表（含签名密钥，Func 验签用；这张表不对页面公开）
//   leads.update({ id, status?, owner?, note?, log? })   改跟进阶段；log 是一条跟进记录（追加到 activities），改阶段也会记一条
//   leads.saveResearch({ id, research })      存客户背调（助手按任务 tasks/research-lead.md 做），记一条跟进记录
//   leads.stats({ days? })                    近 N 天询盘数、真实、高意向，和上一周期对比；按落地页、utm_source 分组
//
//   命令行：annulo run leads.sync --input '{}'

type Channel = { id: string; name: string; type: string; project_id?: string; site_id?: string; leads_cursor?: string }
type Lead = {
  id: string
  channel_id: string
  source: string
  source_ref: string
  submitted_at?: string
  is_real?: boolean
  intent?: string
  status?: string
  pending?: boolean
  fields?: string
  form_name?: string
  landing_page?: string
  utm?: string
  created_at?: string
}

const BATCH = 20
const MAX_PER_RUN = 500 // 一次最多拉 / 判断这么多条，剩下的下次接着来（第一次同步历史很多时不至于跑太久）
// 跟进阶段，照商机看板的列：新询盘 → 已联系 → 已报价 → 谈判中 → 已成交 / 已流失；spam 不上看板。
// 以前的 qualified（有效商机）在 judge 里改成 negotiating
const STATUSES = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost', 'spam']
const TAGS = ['quote', 'sample', 'oem', 'bulk', 'distributor', 'urgent']
const VERDICTS = ['pursue', 'normal', 'caution', 'avoid']
const MAX_ACTIVITIES = 200

const nowISO = () => new Date().toISOString()

/** 字段值变成一行可读的文字 */
function str(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ')
  return JSON.stringify(v)
}

/** form_url 拆成落地页（去掉 query 和 hash）和 utm_* 参数 */
function splitURL(u?: string): { page: string; utm: Record<string, string> } {
  if (!u) return { page: '', utm: {} }
  const [noHash] = u.split('#')
  const [page, query = ''] = noHash.split('?')
  const utm: Record<string, string> = {}
  for (const kv of query.split('&')) {
    const [k, v = ''] = kv.split('=')
    if (!k || !/^utm_/i.test(k)) continue
    try {
      utm[k.toLowerCase()] = decodeURIComponent(v.replace(/\+/g, ' '))
    } catch {
      utm[k.toLowerCase()] = v
    }
  }
  return { page, utm }
}

type Judged = { i: number; is_real: boolean; intent: string; intent_reason: string; tags?: string[]; contact: Record<string, string>; company: string; message: string }

/** 一批提交调一次模型：判断真实询盘、意向，整理联系人和留言 */
async function judgeBatch(ctx: any, project: any, leads: Lead[]): Promise<Judged[]> {
  const system = `你帮一个做外贸 / 独立站的团队筛选网站表单提交，判断哪些是真实的买家询盘。

${projectBrief(project)}

判断规则：
- 真实询盘（is_real=true）：潜在客户在问产品、价格、起订量、样品、定制、合作、交期，哪怕写得很短、语言不通顺。
- 不是真实询盘（is_real=false）：推销 SEO / 建站 / 推广 / 外链 / 贷款等服务、群发广告、明显的垃圾内容（乱码、只有链接）、测试提交（test、123、asdf 之类）、求职、无关的咨询。
- 意向 intent：high = 有明确产品和数量 / 预算 / 时间，或要报价、要样品；medium = 有具体产品兴趣但信息不全；low = 泛泛而问，或不是真实询盘。
- intent_reason：一句话中文理由，说清楚依据（比如「问 500 台 XX 的 FOB 价和交期」）。
- tags：符合的都标，没有就空数组。quote = 要报价 / 问价格；sample = 要样品；oem = 定制、贴牌、OEM / ODM；bulk = 大批量（写了明确的大数量、整柜、长期采购）；distributor = 想做代理、经销、分销；urgent = 写明着急、有截止时间。不是真实询盘的不标。
- contact：从字段里整理 name、email、phone、company、title、country（没有的不写）；company 单独再给一次。
- message：留言的中文摘要（原文是中文就保留原话），不超过 300 字；没有留言写空字符串。
只根据提交的内容判断，不要编造。` + (isEn(ctx) ? '\n\nWrite "message" (the summary — keep the original words if they are already in English) and "intent_reason" in English; they are shown to the user.' : '')
  const items = leads.map((l, i) => ({ i, form: l.form_name ?? '', page: l.landing_page ?? '', fields: parseObj(l.fields) }))
  const out = await askJSON<{ list: Judged[] } | Judged[]>(
    ctx,
    system,
    `下面是 ${items.length} 条表单提交（JSON）。逐条判断，返回 JSON：{"list":[{"i":序号,"is_real":true/false,"intent":"high|medium|low","intent_reason":"…","tags":["quote"],"contact":{…},"company":"…","message":"…"}]}，每条都要有。

${JSON.stringify(items, null, 1).slice(0, 30000)}`,
  )
  const list = Array.isArray(out) ? out : (out?.list ?? [])
  return list.filter((x) => typeof x?.i === 'number')
}

function parseObj(v?: string): Record<string, unknown> {
  try {
    const o = JSON.parse(v || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

/** 一条提交写成待判断的线索：先按真实询盘、新线索存，模型判断完再改（避免漏掉真询盘） */
function toLead(ch: Channel, s: FormSubmission) {
  const { page, utm } = splitURL(s.form_url)
  const fields = s.fields ?? {}
  const raw = Object.entries(fields)
    .map(([k, v]) => `${k}: ${str(v)}`)
    .join('\n')
  return {
    channel_id: ch.id,
    source: 'form',
    source_ref: String(s.id),
    form_name: s.form_name ?? s.form_key ?? '',
    submitted_at: s.created_at,
    contact: '{}',
    company: '',
    message: raw.slice(0, 1000),
    fields: JSON.stringify(fields),
    landing_page: page,
    utm: JSON.stringify(utm),
    referrer: '',
    country: s.country ?? '',
    is_real: true,
    intent: 'medium',
    intent_reason: '',
    status: 'new',
    pending: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  }
}

/** 模型的判断写回线索；用户已经手动改过状态的（不是 new）不动状态 */
function verdict(ctx: any, l: Lead, j?: Judged) {
  if (!j) return { pending: false, intent_reason: L(ctx, '模型没给出判断，先按待确认处理', 'The model gave no verdict, so this is marked to be confirmed'), updated_at: nowISO() }
  const isReal = j.is_real !== false
  const intent = ['high', 'medium', 'low'].includes(String(j.intent)) ? String(j.intent) : 'medium'
  const patch: Record<string, unknown> = {
    pending: false,
    is_real: isReal,
    intent: isReal ? intent : 'low',
    intent_reason: j.intent_reason ?? '',
    tags: JSON.stringify(isReal && Array.isArray(j.tags) ? [...new Set(j.tags.filter((t) => TAGS.includes(t)))] : []),
    contact: JSON.stringify(j.contact ?? {}),
    company: j.company ?? '',
    updated_at: nowISO(),
  }
  if (j.message) patch.message = j.message.slice(0, 1000)
  if (j.contact?.country && !(l as any).country) patch.country = j.contact.country
  if (!l.status || l.status === 'new') patch.status = isReal ? 'new' : 'spam'
  return patch
}

/** 判断待判断的线索：一批批调模型。模型调用失败的这批留着 pending，下次再判断 */
export async function judge(input: { limit?: number }, ctx: any) {
  // 旧阶段「有效商机」并进「谈判中」（每次都查一下，便宜；改完就查不到了）
  for (const l of ctx.db.query('leads', { where: { status: 'qualified' }, limit: 1000 }).list) ctx.db.update('leads', l.id, { status: 'negotiating' })
  const limit = Math.min(Math.max(Math.floor(input?.limit ?? MAX_PER_RUN), 1), 1000)
  const pending: Lead[] = ctx.db.query('leads', { where: { pending: true }, limit }).list
  if (!pending.length) return { judged: 0, real: 0 }
  const project = profile(ctx)
  let judged = 0
  let real = 0
  const errors: string[] = []
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH)
    ctx.progress({ done: i, total: pending.length, message: L(ctx, `判断第 ${i + 1}–${i + batch.length} 条（共 ${pending.length} 条待判断）`, `Checking ${i + 1}–${i + batch.length} of ${pending.length} pending leads`) })
    let list: Judged[]
    try {
      list = await judgeBatch(ctx, project, batch)
    } catch (e: any) {
      errors.push(e.message)
      continue
    }
    const byIndex = new Map(list.map((j) => [j.i, j]))
    for (const [k, l] of batch.entries()) {
      const patch = verdict(ctx, l, byIndex.get(k))
      ctx.db.update('leads', l.id, patch)
      judged++
      if (patch.is_real !== false) real++
    }
  }
  return { judged, real, left: pending.length - judged, ...(errors.length ? { errors } : {}) }
}

type Hook = { id: string; channel_id: string; project_id: string; webhook_id: string; url: string }

/**
 * webhook 的接收地址：运营后台的预览地址 + /func/leads_hook。
 * 用预览不用正式域名：Func 跟着站点版本走，模板升级只推到预览、不发布，正式域名上的 Func 可能还是旧的（甚至没有）；
 * 预览永远是最新推上去的代码，和本机函数、页面一致。
 */
function receiverURL(ctx: any): string {
  const ws = ctx.workspace ?? {}
  if (!ws.site_id) throw new Error(L(ctx, '不知道运营后台的站点地址', "Can't tell the back office's site address"))
  const host = /^https?:\/\/([^/]+)/.exec(String(ws.api_host ?? 'https://creght.cn'))?.[1] ?? 'creght.cn'
  return `https://${ws.site_id}.preview.${host}/func/leads_hook`
}

export async function connect(input: { channel_id?: string }, ctx: any) {
  const all: Channel[] = ctx.db.query('channels', { where: { type: 'creght_site' }, limit: 1000 }).list
  const url = receiverURL(ctx)
  // 只管 creght 的表单 webhook；外部表单的密钥（kind=form，leads.formHook）不在这里清
  let hooks: Hook[] = ctx.db.query('lead_hooks', { limit: 1000 }).list.filter((h: any) => h.kind !== 'form')
  // 渠道删掉了：平台上的 webhook 一起删；接收地址变了（比如以前用正式域名）：删掉，下面重新注册
  for (const h of hooks) {
    if (all.some((c) => c.id === h.channel_id) && h.url === url) continue
    try {
      await formWebhookDelete(ctx, h.project_id, h.webhook_id)
    } catch {
      // 平台上已经没有了也没关系
    }
    ctx.db.delete('lead_hooks', h.id)
  }
  hooks = hooks.filter((h) => all.some((c) => c.id === h.channel_id) && h.url === url)
  const todo = all.filter((c) => c.project_id && (!input?.channel_id || c.id === input.channel_id) && !hooks.some((h) => h.channel_id === c.id))
  if (!todo.length) return { connected: 0, total: all.length }

  let connected = 0
  const errors: string[] = []
  for (const ch of todo) {
    let hookRow = ''
    let webhookID = ''
    try {
      const r = await formWebhookCreate(ctx, ch.project_id!, url)
      webhookID = r.webhook.id
      hookRow = ctx.db.insert('lead_hooks', { channel_id: ch.id, project_id: ch.project_id, webhook_id: webhookID, url, secret: r.secret, created_at: nowISO() })?.id
      // 测试事件确认 Func 能收到、能验签（运营后台的 Func 还没推上去时会失败，删掉下次再来）
      const t = await formWebhookTest(ctx, ch.project_id!, webhookID)
      const code = Number(t?.status_code ?? 0)
      if (code < 200 || code >= 300) throw new Error(L(ctx, `测试推送没收到（${code || t?.error || '无响应'}）`, `The test push was not received (${code || t?.error || 'no response'})`))
      connected++
    } catch (e: any) {
      if (webhookID) {
        try {
          await formWebhookDelete(ctx, ch.project_id!, webhookID)
        } catch {
          // 删不掉就留着：lead_hooks 里没有它，Func 收到会回 410，平台就不再推
        }
      }
      if (hookRow) ctx.db.delete('lead_hooks', hookRow)
      errors.push(`「${ch.name}」：${e.message}`)
    }
  }
  return { connected, total: all.length, url, ...(errors.length ? { errors } : {}) }
}

export async function sync(input: { channel_id?: string }, ctx: any) {
  let chs: Channel[] = ctx.db.query('channels', { where: { type: 'creght_site' }, limit: 1000 }).list
  if (input?.channel_id) {
    chs = chs.filter((c) => c.id === input.channel_id)
    if (!chs.length) throw new Error(L(ctx, '没有这个独立站渠道：', 'No such site channel: ') + input.channel_id)
  }
  if (!chs.length) return { channels: 0, fetched: 0, created: 0, real: 0, note: L(ctx, '还没有独立站渠道', 'No site channels yet') }

  // 0. 还没注册实时推送的独立站先注册；失败不影响下面的拉取
  let hookErrors: string[] = []
  try {
    hookErrors = ((await connect({ channel_id: input?.channel_id }, ctx)) as { errors?: string[] }).errors ?? []
  } catch (e: any) {
    hookErrors = [e.message]
  }

  let fetched = 0
  let created = 0
  const errors: string[] = []
  for (const [ci, ch] of chs.entries()) {
    if (!ch.project_id) continue
    ctx.progress({ done: ci, total: chs.length, message: L(ctx, `在读「${ch.name}」的表单提交…`, `Reading form submissions for "${ch.name}"…`) })
    // 1. 从游标（上次最后一条的 id）接着拉，直到没有更多或到了本次上限
    const subs: FormSubmission[] = []
    let cursor = ch.leads_cursor || ''
    try {
      for (let page = 0; page < 10 && subs.length < MAX_PER_RUN; page++) {
        const r = await formSubmissions(ctx, ch.project_id, { cursor, limit: 200 })
        subs.push(...r.submissions)
        cursor = r.next_cursor || cursor
        if (!r.has_more || !r.submissions.length) break
      }
    } catch (e: any) {
      // 平台还没开放接口：所有渠道都一样，直接报一次，不逐个渠道刷
      if (/还没开放/.test(e.message)) throw e
      errors.push(`「${ch.name}」：${e.message}`)
      continue
    }
    fetched += subs.length

    // 2. 去重（同一渠道已经有这个 source_ref 的跳过），原样写成待判断的线索。
    //    游标等这个渠道全写完才推进：中途失败下次从旧游标重拉，靠 source_ref 去重
    const have = new Set((ctx.db.query('leads', { where: { channel_id: ch.id }, limit: 1000 }).list as Lead[]).map((l) => l.source_ref))
    for (const s of subs) {
      if (s?.id == null || have.has(String(s.id))) continue
      ctx.db.insert('leads', toLead(ch, s))
      have.add(String(s.id))
      created++
    }
    ctx.db.update('channels', ch.id, { leads_cursor: cursor, leads_synced_at: nowISO() })
  }
  if (errors.length && errors.length === chs.length) throw new Error(L(ctx, '同步失败：', 'Sync failed: ') + errors.join('; '))
  // 3. 判断待判断的（包括这次入库的，和别处写入、之前没判断完的）
  const j = await judge({}, ctx)
  return { channels: chs.length, fetched, created, judged: j.judged, real: j.real, ...(errors.length ? { errors } : {}), ...((j as { errors?: string[] }).errors ? { judge_errors: (j as { errors?: string[] }).errors } : {}), ...(hookErrors.length ? { webhook_errors: hookErrors } : {}) }
}

type Activity = { at: string; kind: 'status' | 'note' | 'reply' | 'research'; text: string }

/** 往线索的跟进记录里追加一条（返回新的 activities 字段值，和别的改动一起写） */
function withActivity(lead: any, kind: Activity['kind'], text: string): string {
  let list: Activity[] = []
  try {
    const v = JSON.parse(lead?.activities || '[]')
    if (Array.isArray(v)) list = v
  } catch {
    // 坏了就从头记
  }
  list.push({ at: nowISO(), kind, text: text.slice(0, 2000) })
  return JSON.stringify(list.slice(-MAX_ACTIVITIES))
}

export function update(input: { id: string; status?: string; owner?: string; note?: string; log?: string }, ctx: any) {
  if (!input?.id) throw new Error(L(ctx, '缺 id', 'Missing id'))
  const lead = ctx.db.get('leads', input.id)
  if (!lead) throw new Error(L(ctx, '没有这条线索：', 'No such lead: ') + input.id)
  const patch: Record<string, unknown> = { updated_at: nowISO() }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw new Error(L(ctx, '状态只能是 ', 'Status must be one of ') + STATUSES.join(' / '))
    patch.status = input.status
    if (input.status !== lead.status) patch.activities = withActivity(lead, 'status', input.status)
    // 手动标成垃圾 / 从垃圾里捞回来，is_real 跟着改
    if (input.status === 'spam') patch.is_real = false
    else if (lead.status === 'spam') patch.is_real = true
  }
  if (input.owner !== undefined) patch.owner = input.owner
  if (input.note !== undefined) patch.note = input.note
  const log = String(input.log ?? '').trim()
  if (log) patch.activities = withActivity({ activities: patch.activities ?? lead.activities }, 'note', log)
  return ctx.db.update('leads', input.id, patch)
}

type Group = { key: string; count: number; real: number }

export function stats(input: { days?: number }, ctx: any) {
  const days = Math.min(Math.max(Math.floor(input?.days ?? 30), 1), 365)
  const all: Lead[] = ctx.db.query('leads', { limit: 1000 }).list
  const now = Date.now()
  const at = (l: Lead) => Date.parse(l.submitted_at || l.created_at || '') || 0
  const cur = all.filter((l) => at(l) > now - days * 86400_000)
  const prev = all.filter((l) => at(l) <= now - days * 86400_000 && at(l) > now - 2 * days * 86400_000)
  const sum = (ls: Lead[]) => ({ total: ls.length, real: ls.filter((l) => l.is_real).length, high: ls.filter((l) => l.is_real && l.intent === 'high').length })
  const group = (key: (l: Lead) => string): Group[] => {
    const m = new Map<string, Group>()
    for (const l of cur) {
      const k = key(l) || '（无）'
      const g = m.get(k) ?? { key: k, count: 0, real: 0 }
      g.count++
      if (l.is_real) g.real++
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => b.real - a.real || b.count - a.count).slice(0, 10)
  }
  const utmSource = (l: Lead) => {
    try {
      return JSON.parse(l.utm || '{}').utm_source ?? ''
    } catch {
      return ''
    }
  }
  const month = new Date()
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1).getTime()
  return {
    days,
    current: sum(cur),
    previous: sum(prev),
    this_month: sum(all.filter((l) => at(l) >= monthStart)),
    by_page: group((l) => l.landing_page ?? ''),
    by_utm_source: group(utmSource),
  }
}

/** 写回复要的上下文 */
export function context(input: { id: string }, ctx: any) {
  const l = ctx.db.get('leads', input?.id)
  if (!l) throw new Error(L(ctx, '没有这条线索：', 'No such lead: ') + input?.id)
  const obj = (v: any) => {
    try {
      return typeof v === 'string' ? JSON.parse(v || '{}') : (v ?? {})
    } catch {
      return {}
    }
  }
  let products: any[] = []
  try {
    products = ctx.db.query('products', { limit: 200 }).list
  } catch {
    // 还没有产品表
  }
  return {
    lead: {
      id: l.id,
      company: l.company,
      contact: obj(l.contact),
      fields: obj(l.fields),
      message: l.message,
      intent: l.intent,
      intent_reason: l.intent_reason,
      country: l.country,
      landing_page: l.landing_page,
      submitted_at: l.submitted_at,
      status: l.status,
      tags: obj(l.tags),
    },
    // 背调结果（有的话）：回复时照 next_steps 定报价口径和下一步，不要把背调内容写给买家
    research: l.research ? obj(l.research) : null,
    activities: (() => {
      const a = obj(l.activities)
      return Array.isArray(a) ? a.slice(-20) : []
    })(),
    project: profile(ctx),
    brief: projectBrief(profile(ctx)),
    products: products.map((p) => ({ name: p.name, model: p.model, summary: p.summary, specs: p.specs, moq: p.moq, price: p.price, certs: p.certs, url: p.url })),
    previous: l.reply_body ? { subject: l.reply_subject, body: l.reply_body, at: l.reply_at } : null,
  }
}

/** 存回复草稿：只存，不发（用户在页面上复制或用自己的邮箱发） */
export function saveReply(input: { id: string; subject: string; body: string }, ctx: any) {
  const l = ctx.db.get('leads', input?.id)
  if (!l) throw new Error(L(ctx, '没有这条线索：', 'No such lead: ') + input?.id)
  const subject = String(input.subject ?? '').trim()
  const body = String(input.body ?? '').trim()
  if (!body) throw new Error(L(ctx, '回复正文是空的', 'The reply body is empty'))
  return ctx.db.update('leads', l.id, { reply_subject: subject, reply_body: body.slice(0, 8000), reply_at: nowISO(), activities: withActivity(l, 'reply', subject || body.slice(0, 80)) })
}

type Cited = { text: string; url?: string }
export type Research = {
  verdict: string
  conclusion: string
  company?: Record<string, string>
  signals?: Cited[]
  risks?: Cited[]
  domain?: Record<string, string>
  next_steps?: string[]
  sources?: string[]
}

/** 存客户背调：校验结构，整份覆盖上一次的 */
export function saveResearch(input: { id: string; research: Research | string }, ctx: any) {
  const l = ctx.db.get('leads', input?.id)
  if (!l) throw new Error(L(ctx, '没有这条线索：', 'No such lead: ') + input?.id)
  let r: any = input.research
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r)
    } catch {
      throw new Error(L(ctx, 'research 不是合法的 JSON', 'research is not valid JSON'))
    }
  }
  if (!r || typeof r !== 'object') throw new Error(L(ctx, '缺 research', 'Missing research'))
  if (!VERDICTS.includes(r.verdict)) throw new Error(L(ctx, 'verdict 只能是 ', 'verdict must be one of ') + VERDICTS.join(' / '))
  const conclusion = String(r.conclusion ?? '').trim()
  if (!conclusion) throw new Error(L(ctx, '缺 conclusion（一段结论）', 'Missing conclusion'))
  const text = (v: unknown) => String(v ?? '').trim()
  const cited = (v: unknown): Cited[] => (Array.isArray(v) ? v : []).map((x: any) => (typeof x === 'string' ? { text: x } : { text: text(x?.text), url: text(x?.url) || undefined })).filter((x) => x.text).slice(0, 20)
  const record = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).map(([k, x]) => [k, text(x)]).filter(([, x]) => x))
  const clean = {
    verdict: r.verdict,
    conclusion: conclusion.slice(0, 3000),
    company: record(r.company),
    signals: cited(r.signals),
    risks: cited(r.risks),
    domain: record(r.domain),
    next_steps: (Array.isArray(r.next_steps) ? r.next_steps : []).map(text).filter(Boolean).slice(0, 10),
    sources: (Array.isArray(r.sources) ? r.sources : []).map(text).filter((u: string) => /^https?:\/\//.test(u)).slice(0, 30),
  }
  return ctx.db.update('leads', l.id, { research: JSON.stringify(clean), research_at: nowISO(), activities: withActivity(l, 'research', clean.verdict) })
}

/**
 * 外部表单的 webhook 地址和密钥（有就沿用）：表单插件提交时 POST 到运营后台的 /func/leads_hook，带上密钥。
 * 密钥三种带法（插件支持哪个用哪个）：地址上的 ?k=、请求头 x-shuttle-key、表单里的隐藏字段 shuttle_key。
 */
export function formHook(input: { channel_id: string; reset?: boolean }, ctx: any) {
  const ch = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  let row = ctx.db.query('lead_hooks', { where: { kind: 'form', channel_id: ch.id }, limit: 1 }).list[0]
  if (row && input.reset) {
    ctx.db.delete('lead_hooks', row.id)
    row = null
  }
  if (!row) {
    let token = ''
    while (token.length < 32) token += Math.random().toString(36).slice(2)
    row = ctx.db.insert('lead_hooks', { kind: 'form', channel_id: ch.id, project_id: ch.project_id ?? '', token: token.slice(0, 32), created_at: nowISO() })
  }
  const url = receiverURL(ctx)
  return { url: `${url}?k=${row.token}`, base: url, key: row.token, header: 'x-shuttle-key', field: 'shuttle_key' }
}
