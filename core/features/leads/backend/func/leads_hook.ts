import type { TalizenFuncContext } from 'talizen/func-runtime'

// 独立站表单提交的实时推送：creght 表单 webhook → POST /func/leads_hook → 写进 leads 表（pending=true，待判断）。
// webhook 由本机函数 leads.connect 注册，签名密钥记在 lead_hooks 表（这张表不在 db.ts 的公开列表里）。
// 模型判断在本机 Shuttle 里做（leads.judge），这里只验签、去重、原样入库，电脑关着也不漏。
//
// 请求：头 X-Creght-Timestamp（unix 秒）、X-Creght-Signature: v1=<hex>，hex = HMAC-SHA256(secret, "<timestamp>.<原始请求体>")。
// 请求体 { event: "form.submitted" | "form.test", webhook_id, project_id, submission }，submission 和 MCP form_submissions 的一条一样。
// 回 2xx 算成功；回 410 平台不再重试（webhook 已经不是我们的了）；别的状态码平台会重试。
//
// 另一种：外部表单（WordPress 的 Elementor / WPForms / Contact Form 7、Zapier、Typeform…）的 webhook，没有 creght 的签名头。
// 用渠道的密钥认：地址上的 ?k=<密钥>（ctx.request.query，一般就用它）、请求头 x-shuttle-key、或者表单里的隐藏字段 shuttle_key；
// 密钥由 leads.formHook 生成，记在 lead_hooks（kind=form、token）。请求体 JSON 或 x-www-form-urlencoded 都认，字段原样存。

// 表单平台调它，不带成员登录：项目开了「Func 只给成员调」（func_members_only）也要放行，自己验签
export const config = { public: true }

const MAX_AGE = 300 // 秒：超过 5 分钟的请求当成重放

function query(ctx: TalizenFuncContext, table: string, opts: any) {
  try {
    return ctx.db.query(table, opts)
  } catch (e) {
    if (/table not found/i.test(String((e as Error)?.message ?? e))) return { list: [] }
    throw e
  }
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

function str(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ')
  return JSON.stringify(v)
}

/** form_url 拆成落地页（去掉 query 和 hash）和 utm_* 参数；和 local/leads.ts 的 splitURL 一样 */
function splitURL(u?: string): { page: string; utm: Record<string, string> } {
  if (!u) return { page: '', utm: {} }
  const [noHash] = u.split('#')
  const [page, q = ''] = noHash.split('?')
  const utm: Record<string, string> = {}
  for (const kv of q.split('&')) {
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

function fail(ctx: TalizenFuncContext, code: number, error: string) {
  ctx.response.status(code)
  return { ok: false, error }
}

export async function main(_input: unknown, ctx: TalizenFuncContext) {
  const req = ctx.request as any
  const raw: string = await req.text()
  if (!req.headers?.get?.('x-creght-signature')) return formHook(ctx, req, raw)
  const ts = String(req.headers?.get?.('x-creght-timestamp') ?? '')
  const sig = String(req.headers?.get?.('x-creght-signature') ?? '')
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > MAX_AGE) return fail(ctx, 400, 'stale')

  let evt: any
  try {
    evt = JSON.parse(raw)
  } catch {
    return fail(ctx, 400, 'bad body')
  }
  const hook = query(ctx, 'lead_hooks', { where: { webhook_id: String(evt?.webhook_id ?? '') }, limit: 1 }).list?.[0]
  if (!hook?.secret) return fail(ctx, 410, 'unknown webhook')
  if (!sameString(sig, 'v1=' + (await hmacHex(String(hook.secret), ts + '.' + raw)))) return fail(ctx, 401, 'bad signature')

  if (evt.event === 'form.test') return { ok: true }
  if (evt.event !== 'form.submitted') return { ok: true, ignored: evt.event }

  const s = evt.submission ?? {}
  if (s.id == null) return fail(ctx, 400, 'no submission id')
  const ref = String(s.id)
  // 同一条会推不止一次（重试），轮询也会拉到：按渠道 + 提交 id 去重
  if (query(ctx, 'leads', { where: { channel_id: hook.channel_id, source_ref: ref }, limit: 1 }).list?.length) return { ok: true, duplicate: true }

  // 字段和 local/leads.ts 的 toLead 一致：先按真实询盘、新线索存，Shuttle 判断完再改
  const fields: Record<string, unknown> = s.fields && typeof s.fields === 'object' ? s.fields : {}
  const { page, utm } = splitURL(s.form_url)
  const now = new Date().toISOString()
  const lead = ctx.db.insert('leads', {
    channel_id: hook.channel_id,
    source: 'form',
    source_ref: ref,
    form_name: s.form_name ?? s.form_key ?? '',
    submitted_at: s.created_at ?? now,
    contact: '{}',
    company: '',
    message: Object.entries(fields)
      .map(([k, v]) => `${k}: ${str(v)}`)
      .join('\n')
      .slice(0, 1000),
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
    created_at: now,
    updated_at: now,
  })
  return { ok: true, id: String(lead?.id ?? '') }
}

// ---- 外部表单的 webhook ----

/** 请求体变成字段：JSON（有 fields 就用它）或 x-www-form-urlencoded */
function bodyFields(req: any, raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (k: string, v: unknown) => {
    const key = String(k).trim()
    if (!key || v == null || v === '') return
    out[key] = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  const type = String(req.headers?.get?.('content-type') ?? '')
  let obj: any = null
  if (/json/i.test(type) || /^\s*[{[]/.test(raw)) {
    try {
      obj = JSON.parse(raw)
    } catch {
      obj = null
    }
  }
  if (obj && typeof obj === 'object') {
    const f = obj.fields ?? obj.data ?? obj
    if (Array.isArray(f)) for (const x of f) put(x?.name ?? x?.label ?? x?.id ?? x?.key, x?.value)
    else for (const [k, v] of Object.entries(f)) put(k, (v as any)?.value ?? v)
    for (const k of ['form_name', 'form_id', 'id', 'entry_id', 'submission_id', 'shuttle_key', 'page_url']) if (obj[k] != null && out[k] == null) put(k, obj[k])
  } else {
    for (const part of raw.split('&')) {
      if (!part) continue
      const [k, v = ''] = part.split('=')
      const dec = (x: string) => {
        try {
          return decodeURIComponent(x.replace(/\+/g, ' '))
        } catch {
          return x
        }
      }
      put(dec(k), dec(v))
    }
  }
  return out
}

/** 地址上的 ?k=（ctx.request.query / url，2026-09 起平台支持） */
function queryKey(req: any): string {
  const url = String(req.url ?? '')
  const m = /[?&]k=([^&#]+)/.exec(url)
  return m ? decodeURIComponent(m[1]) : String(req.query?.get?.('k') ?? '')
}

async function sha(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(d.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

const pick = (f: Record<string, string>, re: RegExp) => Object.entries(f).find(([k]) => re.test(k))?.[1]

async function formHook(ctx: TalizenFuncContext, req: any, raw: string) {
  const fields = bodyFields(req, raw)
  const key = queryKey(req) || String(req.headers?.get?.('x-shuttle-key') ?? '') || fields.shuttle_key || ''
  if (!key) return fail(ctx, 401, 'missing key')
  const hook = query(ctx, 'lead_hooks', { where: { kind: 'form', token: key }, limit: 1 }).list?.[0]
  if (!hook) return fail(ctx, 401, 'bad key')
  delete fields.shuttle_key
  if (!Object.keys(fields).length) return { ok: true, ignored: 'empty' } // 表单插件保存设置时的测试请求

  // 去重：有提交 id 用它，没有就按内容
  const sid = fields.submission_id || fields.entry_id || fields.id || ''
  const ref = sid ? `wh-${sid}` : `wh-${await sha(JSON.stringify(fields))}`
  if (query(ctx, 'leads', { where: { channel_id: hook.channel_id, source_ref: ref }, limit: 1 }).list?.length) return { ok: true, duplicate: true }

  const pageUrl = pick(fields, /^(page[_ ]?url|url|referr?er|source[_ ]?url|page)$/i) ?? ''
  const { page, utm } = splitURL(pageUrl)
  const formName = fields.form_name || fields.form_id || pick(fields, /^form/i) || ''
  const skip = new Set(['form_name', 'form_id', 'id', 'entry_id', 'submission_id'])
  const shown = Object.fromEntries(Object.entries(fields).filter(([k]) => !skip.has(k)))
  const now = new Date().toISOString()
  const lead = ctx.db.insert('leads', {
    channel_id: hook.channel_id,
    source: 'form',
    source_ref: ref,
    form_name: formName,
    submitted_at: now,
    contact: '{}',
    company: '',
    message: Object.entries(shown)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
      .slice(0, 1000),
    fields: JSON.stringify(shown),
    landing_page: page,
    utm: JSON.stringify(utm),
    referrer: '',
    country: '',
    is_real: true,
    intent: 'medium',
    intent_reason: '',
    status: 'new',
    pending: true,
    created_at: now,
    updated_at: now,
  })
  return { ok: true, id: String(lead?.id ?? '') }
}
