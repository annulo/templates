import { L } from './_i18n'

// 只读写业务表的能在手机上用；检查要出网读别人的页面，只在电脑上
export const cloud = ['list', 'add', 'update', 'remove', 'sync']
export const remote = ['check']

// 外链（设计见 docs/growth-plan.md「外链」）：别的网站上指向我们网站的链接。先简单做：登记、从社媒帖子自动登记、检查还在不在、看带来了几条询盘。
//
//   backlinks.list({})                                  全部外链 + 按来源统计的询盘（询盘的来源网址、utm_source 对上外链的域名）
//   backlinks.add({ source_url, kind?, platform?, target_url?, anchor?, nofollow?, status?, note? })   手动登记（同一地址只登记一次）
//   backlinks.update({ id, ...字段 })  /  backlinks.remove({ id })
//   backlinks.sync({})                                  从社媒帖子自动登记：发出去了、正文里有本站链接的帖子
//   backlinks.check({ ids? })                           读来源页面看链接还在不在（每 7 天定时）；社媒要登录、反爬的标 unknown，不算丢了
//
// 社媒和大多数 B2B 平台的链接是 nofollow：对谷歌排名直接帮助有限，价值是品牌、引流、让谷歌更快发现新页面；真正提排名的是行业目录、行业网站、媒体的引用。

declare const fetch: (url: string, init?: any) => Promise<any>

const KINDS = ['social', 'b2b', 'directory', 'article', 'forum', 'other']
const STATUSES = ['planned', 'live', 'lost', 'unknown']
// 这些平台要登录或反爬，读不到页面内容：检查不了，标 unknown
const UNCHECKABLE = /(^|\.)(instagram\.com|facebook\.com|fb\.com|linkedin\.com|x\.com|twitter\.com|tiktok\.com|xiaohongshu\.com|douyin\.com)$/i
const NOFOLLOW_BY_DEFAULT = /(^|\.)(instagram\.com|facebook\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|pinterest\.com|reddit\.com|quora\.com|medium\.com)$/i

const nowISO = () => new Date().toISOString()
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
    // 表还没建
  }
  return out
}
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}
const norm = (u: string) => String(u || '').trim().replace(/#.*$/, '').replace(/\/$/, '')

/** 我们自己的网站：域名 → 网站 id */
function ownSites(ctx: any) {
  const m = new Map<string, string>()
  for (const c of all(ctx, 'channels').filter((c) => c.type === 'creght_site' || c.type === 'wordpress'))
    for (const u of [c.live_url, c.url, c.preview_url, c.domain && 'https://' + c.domain]) if (u && host(u)) m.set(host(u), c.id)
  return m
}

/** 一段文字里指向本站的第一个链接 */
function siteLink(text: string, sites: Map<string, string>) {
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
    const h = host(m[0])
    if (sites.has(h)) return { url: m[0].replace(/[.,;!?]+$/, ''), channel_id: sites.get(h)! }
  }
  // 没写 https:// 的裸域名
  for (const [h, id] of sites) if (new RegExp(`(^|[\\s(])(www\\.)?${h.replace(/\./g, '\\.')}(/[^\\s]*)?`, 'i').test(String(text || ''))) return { url: 'https://' + h, channel_id: id }
  return null
}

export function list(_input: {}, ctx: any) {
  const rows = all(ctx, 'backlinks').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  // 询盘按来源域名对上外链（来源网址或 utm_source）
  const leads = all(ctx, 'leads').filter((l) => l.is_real !== false && l.status !== 'spam')
  const refOf = (l: any) => {
    let utm: any = {}
    try {
      utm = typeof l.utm === 'string' ? JSON.parse(l.utm || '{}') : l.utm || {}
    } catch {}
    return { ref: host(l.referrer || ''), src: String(utm?.source || utm?.utm_source || '').toLowerCase() }
  }
  const refs = leads.map(refOf)
  const out = rows.map((b) => {
    const h = host(b.source_url)
    const p = String(b.platform || '').toLowerCase()
    const n = refs.filter((r) => (r.ref && (r.ref === h || r.ref.endsWith('.' + h))) || (p && r.src && (r.src === p || r.src.includes(p)))).length
    return { ...b, domain: h, leads: n }
  })
  const by: Record<string, number> = {}
  for (const b of out) by[b.status || 'live'] = (by[b.status || 'live'] ?? 0) + 1
  return { list: out, by_status: by, leads_tracked: leads.length > 0 }
}

function clean(ctx: any, input: any, partial = false) {
  const out: Record<string, unknown> = {}
  if (input.source_url !== undefined || !partial) {
    const u = norm(input.source_url)
    if (!/^https?:\/\//i.test(u)) throw new Error(L(ctx, '外链所在页面要是完整网址（https://…）', 'The source page must be a full URL (https://…)'))
    out.source_url = u
  }
  if (input.kind !== undefined) {
    if (!KINDS.includes(input.kind)) throw new Error(L(ctx, `kind 只能是 ${KINDS.join(' / ')}`, `kind must be one of ${KINDS.join(' / ')}`))
    out.kind = input.kind
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw new Error(L(ctx, `status 只能是 ${STATUSES.join(' / ')}`, `status must be one of ${STATUSES.join(' / ')}`))
    out.status = input.status
  }
  for (const k of ['platform', 'target_url', 'anchor', 'note', 'channel_id']) if (input[k] !== undefined) out[k] = String(input[k] ?? '')
  if (input.nofollow !== undefined) out.nofollow = !!input.nofollow
  return out
}

export function add(input: any, ctx: any) {
  const row = clean(ctx, input ?? {})
  const dup = all(ctx, 'backlinks').find((b) => norm(b.source_url) === row.source_url)
  if (dup) return { id: dup.id, duplicate: true }
  const h = host(row.source_url as string)
  const sites = ownSites(ctx)
  const created = ctx.db.insert('backlinks', {
    kind: 'other', platform: h, status: 'live', nofollow: NOFOLLOW_BY_DEFAULT.test(h),
    ...(row.target_url && sites.has(host(row.target_url as string)) ? { channel_id: sites.get(host(row.target_url as string)) } : {}),
    ...row, created_at: nowISO(),
  })
  return { id: created.id }
}

export function update(input: any, ctx: any) {
  const b = ctx.db.get('backlinks', input?.id)
  if (!b) throw new Error(L(ctx, '找不到这条外链', 'Backlink not found'))
  ctx.db.update('backlinks', b.id, clean(ctx, input, true))
  return { ok: true }
}

export function remove(input: { id: string }, ctx: any) {
  if (!ctx.db.get('backlinks', input?.id)) throw new Error(L(ctx, '找不到这条外链', 'Backlink not found'))
  ctx.db.delete('backlinks', input.id)
  return { ok: true }
}

/** 从社媒帖子自动登记：发出去了、有帖子地址、正文里有本站链接的；同一帖子只登记一次 */
export function sync(_input: {}, ctx: any) {
  const sites = ownSites(ctx)
  if (!sites.size) return { added: 0, note: L(ctx, '还没有网站', 'No website yet') }
  const have = all(ctx, 'backlinks')
  const byPost = new Set(have.map((b) => b.post_id).filter(Boolean))
  const byUrl = new Set(have.map((b) => norm(b.source_url)))
  const accounts = new Map(all(ctx, 'social_accounts').map((a) => [a.id, a]))
  let added = 0
  for (const p of all(ctx, 'social_posts')) {
    if (p.status !== 'published' || !p.post_url || byPost.has(p.id) || byUrl.has(norm(p.post_url))) continue
    const link = siteLink(`${p.title || ''}\n${p.body || ''}`, sites)
    if (!link) continue
    const acc: any = accounts.get(p.channel_id)
    ctx.db.insert('backlinks', {
      kind: 'social', platform: acc?.platform || acc?.type || host(p.post_url), source_url: norm(p.post_url), target_url: link.url, channel_id: link.channel_id,
      nofollow: true, status: 'live', auto: true, post_id: p.id, anchor: '', created_at: p.published_at || nowISO(),
    })
    added++
  }
  return { added }
}

/** 读来源页面看还有没有指向本站的链接（每 7 天定时）。社媒这类读不到的标 unknown */
export async function check(input: { ids?: string[] }, ctx: any) {
  sync({}, ctx)
  const sites = ownSites(ctx)
  const ids = input?.ids?.length ? new Set(input.ids) : null
  const rows = all(ctx, 'backlinks').filter((b) => (ids ? ids.has(b.id) : b.status !== 'planned'))
  const res = { live: 0, lost: 0, unknown: 0 }
  for (const b of rows) {
    const h = host(b.source_url)
    let status = 'unknown', error = '', nofollow: boolean | undefined
    if (UNCHECKABLE.test(h)) {
      status = b.status === 'live' || b.status === 'lost' ? b.status : 'unknown' // 读不到就不改原来的结论
      error = L(ctx, '这个平台要登录才能看，检查不了；自己打开看一眼', 'This platform needs a login; open it to check yourself')
    } else {
      try {
        const r = await fetch(b.source_url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', accept: 'text/html' } })
        if (r.status === 404 || r.status === 410) {
          status = 'lost'
          error = L(ctx, `页面没了（${r.status}）`, `Page is gone (${r.status})`)
        } else if (!r.ok) {
          error = L(ctx, `打不开（${r.status}），可能是反爬`, `Could not open (${r.status}), maybe blocked`)
        } else {
          const html = String(await r.text())
          const tags = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)]
          const hit = tags.find((m) => sites.has(host(m[1].startsWith('//') ? 'https:' + m[1] : m[1])))
          if (hit) {
            status = 'live'
            nofollow = /rel=["'][^"']*(nofollow|ugc|sponsored)/i.test(hit[0])
          } else if ([...sites.keys()].some((s) => html.toLowerCase().includes(s))) {
            status = 'live'
            error = L(ctx, '页面上提到了网址，但不是可点的链接', 'The site is mentioned but not as a clickable link')
          } else {
            status = 'lost'
            error = L(ctx, '页面上找不到指向你网站的链接', 'No link to your site on the page')
          }
        }
      } catch (e) {
        error = String((e as Error)?.message ?? e).slice(0, 200)
      }
    }
    res[status as keyof typeof res]++
    ctx.db.update('backlinks', b.id, { status, check_error: error, checked_at: nowISO(), ...(nofollow !== undefined ? { nofollow } : {}) })
  }
  return { checked: rows.length, ...res }
}
