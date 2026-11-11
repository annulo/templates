import { kindOf } from './_serp_common'
import type { Serp } from './serp'

// 从企业官网反查买家：Google 搜索结果里挑出公司官网，读首页和联系页，取公司简介和公开的邮箱、电话、领英。
// 搜 Google 用 core 的 serp（用户自己的 Chrome）；读官网用 ctx.fetchAll，读不到的只留搜索结果的标题和摘要。

export type Site = {
  domain: string
  url: string
  title: string
  desc: string
  snippet: string
  text: string
  emails: string[]
  phones: string[]
  linkedin: string
  read: boolean
}

/** 不是买家官网的域名：媒体、政府、学校、目录站、建站平台的二级域名…（B2B 平台、电商、论坛、社媒由 kindOf 排除） */
const SKIP = /(^|\.)(gov|edu|ac\.[a-z]{2}|gov\.[a-z]{2}|mil)$|(^|\.)(yelp|yellowpages|bbb|crunchbase|zoominfo|dnb|bloomberg|reuters|forbes|statista|glassdoor|indeed|trustpilot|wix|wixsite|blogspot|wordpress|squarespace|shopify|myshopify|github|apple|google|microsoft|amazonaws|cloudfront)\.[a-z.]+$/

/** 搜索结果 → 要读的公司官网（每个域名一次，按出现顺序），exclude 里的域名（自己、竞品、已经找过的）跳过 */
export function pickSites(serps: Serp[], exclude: Set<string>, max: number): { domain: string; url: string; title: string; snippet: string }[] {
  const out: { domain: string; url: string; title: string; snippet: string }[] = []
  const seen = new Set<string>()
  for (const s of serps) {
    for (const r of s.results) {
      const d = bare(r.domain)
      if (!d || seen.has(d) || exclude.has(d) || kindOf(d) !== 'site' || SKIP.test(d)) continue
      seen.add(d)
      // 用结果里的原样来源（带不带 www），有的站裸域名打不开
      let url = `https://${r.domain}`
      try {
        url = new URL(r.url).origin
      } catch {}
      out.push({ domain: d, url, title: r.title, snippet: r.snippet ?? '' })
      if (out.length >= max) return out
    }
  }
  return out
}

export const bare = (host: string) => String(host || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/:].*$/, '')

/** 联系页、关于页（各语言常见的写法） */
const CONTACT = /contact|kontakt|contacto|contato|contatti|impressum|imprint|about|ueber-uns|uber-uns|über-uns|chi-siamo|qui-sommes|quienes-somos|over-ons|company/i

/** Cloudflare 的邮箱保护：data-cfemail 是异或过的十六进制 */
export function cfDecode(hex: string): string {
  try {
    const key = parseInt(hex.slice(0, 2), 16)
    let s = ''
    for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
    return s
  } catch {
    return ''
  }
}

const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/gi
const JUNK_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|domain|email|sentry|wixpress|sentry-next)\.|^(no-?reply|donotreply|privacy|gdpr|abuse|webmaster|postmaster)@/i

/** 页面里公开的邮箱、电话、领英公司页（纯函数，能离线测） */
export function contactsOf(doc: any, html: string, domain: string): { emails: string[]; phones: string[]; linkedin: string } {
  const links = doc.find('a[href]').map((a: any) => String(a.attrs.href || ''))
  const raw = [
    ...links.filter((h: string) => /^mailto:/i.test(h)).map((h: string) => decodeURIComponent(h.slice(7).split('?')[0])),
    ...doc.find('[data-cfemail]').map((x: any) => cfDecode(String(x.attrs['data-cfemail'] || ''))),
    ...(doc.text().match(EMAIL) ?? []),
    ...(html.replace(/<script[\s\S]*?<\/script>/gi, '').match(EMAIL) ?? []),
  ]
  const emails = [...new Set(raw.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL.test(e)))]
  // 官网域名下的邮箱排前面（第三方的多半是建站商、插件留下的）
  emails.sort((a, b) => Number(bare(b.split('@')[1]).endsWith(domain)) - Number(bare(a.split('@')[1]).endsWith(domain)))
  const phones = [...new Set(links.filter((h: string) => /^tel:/i.test(h)).map((h: string) => decodeURIComponent(h.slice(4)).replace(/[^\d+]/g, '')).filter((p: string) => p.replace(/\D/g, '').length >= 7))] as string[]
  const linkedin = links.find((h: string) => /linkedin\.com\/company\//i.test(h)) ?? ''
  return { emails: emails.slice(0, 5), phones: phones.slice(0, 3), linkedin }
}

/** 首页里指向联系页、关于页的站内链接（最多 n 个） */
function contactLinks(doc: any, base: string, n = 2): string[] {
  const host = bare(new URL(base).hostname)
  const out: string[] = []
  for (const a of doc.find('a[href]')) {
    try {
      const u = new URL(String(a.attrs.href), base)
      if (bare(u.hostname) !== host || u.pathname === '/' || !/^https?:$/.test(u.protocol)) continue
      if (!CONTACT.test(u.pathname) && !CONTACT.test(String(a.text || ''))) continue
      const url = `${u.protocol}//${u.host}${u.pathname}`
      if (!out.includes(url)) out.push(url)
      if (out.length >= n) break
    } catch {
      continue
    }
  }
  // 联系页优先于关于页
  return out.sort((a, b) => Number(/contact|kontakt|impressum|imprint/i.test(b)) - Number(/contact|kontakt|impressum|imprint/i.test(a)))
}

/** 读一批官网：首页 + 最多两个联系页、关于页。读不到的 read=false，只有搜索结果的标题和摘要 */
export async function readSites(ctx: any, sites: { domain: string; url: string; title: string; snippet: string }[], onProgress?: (done: number) => void): Promise<Site[]> {
  const out: Site[] = []
  const CHUNK = 8
  for (let i = 0; i < sites.length; i += CHUNK) {
    const part = sites.slice(i, i + CHUNK)
    const homes = await ctx.fetchAll(part.map((s) => s.url))
    const docs: { s: (typeof part)[number]; doc: any; html: string; extra: string[] }[] = []
    for (const [k, s] of part.entries()) {
      const r = homes[k]
      let html = ''
      try {
        if (r?.ok) html = await r.text()
      } catch {
        html = ''
      }
      docs.push({ s, doc: html ? ctx.html(html) : null, html, extra: [] })
    }
    const more = docs.flatMap((d) => (d.doc ? contactLinks(d.doc, d.s.url).map((u) => ({ d, u })) : []))
    const rs = more.length ? await ctx.fetchAll(more.map((m) => m.u)) : []
    for (const [k, m] of more.entries()) {
      try {
        if (rs[k]?.ok) m.d.extra.push(await rs[k].text())
      } catch {
        // 联系页读不到就只用首页
      }
    }
    for (const { s, doc, html, extra } of docs) {
      if (!doc) {
        out.push({ domain: s.domain, url: s.url, title: s.title, desc: '', snippet: s.snippet, text: '', emails: [], phones: [], linkedin: '', read: false })
        continue
      }
      const pages = [{ doc, html }, ...extra.map((h) => ({ doc: ctx.html(h), html: h }))]
      const c = pages.map((p) => contactsOf(p.doc, p.html, s.domain))
      const main = (d: any, h: string) => ctx.html(h.replace(/<(nav|footer|header|script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, '')).text() || d.text()
      out.push({
        domain: s.domain,
        url: s.url,
        title: (doc.find('title')[0]?.text ?? s.title).trim().slice(0, 200),
        desc: String(doc.find('meta[name="description" i]')[0]?.attrs.content ?? '').trim().slice(0, 300),
        snippet: s.snippet,
        text: pages.map((p) => main(p.doc, p.html).replace(/\s+/g, ' ').trim()).join(' … ').slice(0, 1500),
        emails: [...new Set(c.flatMap((x) => x.emails))].slice(0, 5),
        phones: [...new Set(c.flatMap((x) => x.phones))].slice(0, 3),
        linkedin: c.map((x) => x.linkedin).find(Boolean) ?? '',
        read: true,
      })
    }
    onProgress?.(Math.min(i + CHUNK, sites.length))
  }
  return out
}
