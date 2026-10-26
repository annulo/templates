// 站点体检里的谷歌收录检查（文件名以 _ 开头：只给 audit.ts import）。设计见 docs/site-audit.md「谷歌收录」。
//
// 关联了 Search Console 的网站，体检时用网址检查（URL Inspection）查这次抓到的页面有没有被 Google 收录、没收录的原因，
// 每页一条存进 index_status，按原因归成几个体检问题（index_crawled / index_discovered / index_unknown / index_canonical / index_excluded），
// 再看 sitemap 在 Search Console 里提交了没有、有没有错误（sitemap_unsubmitted / sitemap_errors）。
// 网址检查每个属性每天最多 2000 次：每次体检最多查 MAX_INSPECT 个，7 天内查过的、GSC 里有曝光的（肯定收录了）不重查。
// 没关联 Search Console、体检用的是预览地址（Google 本来就不收预览）就什么都不做。

import { isEn, L } from './_i18n'
import { inspectURLs, sitemaps } from './_gsc'

type P = { url: string; html: boolean; status: number; robots: string; text_chars: number; links: string[] }
type Found = { check: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; pages: string[] }
export type IndexState = 'indexed' | 'crawled' | 'discovered' | 'unknown' | 'duplicate' | 'alternate' | 'excluded'
/** 这次体检的收录概况：存进 audit_runs.index，报告里用 */
export type IndexSummary = { pages: number; checked: number; inspected_now: number; by_state: Partial<Record<IndexState, number>>; sitemaps: { path: string; submitted: number; last_read: string; errors: number }[] }

const MAX_INSPECT = 80
const FRESH_MS = 7 * 86400_000

const pathKey = (u: string) => {
  try {
    return (decodeURIComponent(new URL(u).pathname).replace(/\/+$/, '') || '/').toLowerCase()
  } catch {
    return u
  }
}

/** Search Console 给的 coverageState（英文原话）归成几类 */
export function stateOf(r: any): IndexState {
  const c = String(r?.coverageState ?? '')
  if (/alternate page with proper canonical/i.test(c)) return 'alternate'
  if (/duplicate|canonical/i.test(c)) return 'duplicate'
  if (/crawled.*not indexed/i.test(c)) return 'crawled'
  if (/discovered.*not indexed/i.test(c)) return 'discovered'
  if (/unknown to google/i.test(c)) return 'unknown'
  if (r?.verdict === 'PASS' || /indexed/i.test(c)) return 'indexed'
  return 'excluded'
}

/**
 * pages 是这次体检抓到的页面。返回体检问题和收录概况；读不到（授权失效、没权限）只记日志、返回空，不影响体检。dry 时查到的不写表；
 * complete：sitemap 全抓到了（没抓全时不说「站内平均几个页面链到它」，链到它的页面可能没抓到）
 */
export async function indexChecks(ch: { id: string; gsc_property?: string; gsc_link_disabled?: boolean }, pages: P[], root: string, ctx: any, dry = false, complete = true): Promise<{ found: Found[]; summary: IndexSummary | null }> {
  if (!ch.gsc_property || ch.gsc_link_disabled) return { found: [], summary: null }
  const en = isEn(ctx)
  const property = ch.gsc_property
  // 能收录的页面才查：打不开的、noindex 的体检已经单独报了
  const want = pages.filter((p) => p.html && p.status < 400 && !/noindex/i.test(p.robots))
  if (!want.length) return { found: [], summary: null }

  // GSC 里最近 28 天有曝光的页面肯定收录了，不用查
  const shown = new Set<string>()
  try {
    for (const r of ctx.db.query('search_pages', { where: { channel_id: ch.id }, limit: 1000 }).list as any[]) if ((r.impressions ?? 0) > 0) shown.add(pathKey(r.page))
  } catch {}
  const old = new Map<string, any>()
  try {
    for (const r of ctx.db.query('index_status', { where: { channel_id: ch.id }, limit: 1000 }).list as any[]) old.set(pathKey(r.page), r)
  } catch {}
  const now = Date.now()
  const todo = want
    .filter((p) => !shown.has(pathKey(p.url)) && !(old.get(pathKey(p.url))?.inspected_at && now - Date.parse(old.get(pathKey(p.url)).inspected_at) < FRESH_MS))
    .sort((a, b) => Date.parse(old.get(pathKey(a.url))?.inspected_at ?? '0') - Date.parse(old.get(pathKey(b.url))?.inspected_at ?? '0'))
    .slice(0, MAX_INSPECT)

  if (todo.length) ctx.progress({ message: L(ctx, `在 Search Console 查 ${todo.length} 个页面的收录…`, `Checking indexing for ${todo.length} pages in Search Console…`) })
  let inspected = 0
  try {
    const rs = await inspectURLs(ctx, property, todo.map((p) => p.url))
    const failed = rs.filter((r) => r.error)
    if (failed.length) ctx.log(L(ctx, `${failed.length} 个页面查收录失败：`, `Indexing check failed for ${failed.length} pages: `) + failed[0].error)
    // 一个都没查成（授权失效、没权限、配额用完）：这次不出收录问题，免得拿过期的结果误报
    if (failed.length && failed.length === rs.length && !old.size) return { found: [], summary: null }
    const at = new Date().toISOString()
    for (const r of rs) {
      if (!r.result) continue
      inspected++
      const row = {
        channel_id: ch.id, page: r.url, state: stateOf(r.result), coverage: String(r.result.coverageState ?? ''),
        google_canonical: String(r.result.googleCanonical ?? ''), user_canonical: String(r.result.userCanonical ?? ''),
        last_crawl: String(r.result.lastCrawlTime ?? ''), inspected_at: at,
      }
      const prev = old.get(pathKey(r.url))
      if (!dry) {
        if (prev) ctx.db.update('index_status', prev.id, row)
        else old.set(pathKey(r.url), ctx.db.insert('index_status', row))
      }
      if (prev || dry) old.set(pathKey(r.url), { ...prev, ...row })
    }
  } catch (e: any) {
    ctx.log(L(ctx, '查收录没做成：', 'Indexing check failed: ') + (e?.message ?? e))
    if (!old.size) return { found: [], summary: null }
  }

  // 每个页面现在的状态：有曝光的算已收录，其余用查到的（没查过的不算）
  const stateFor = (p: P): IndexState | null => (shown.has(pathKey(p.url)) ? 'indexed' : (old.get(pathKey(p.url))?.state as IndexState) ?? null)
  const groups = new Map<IndexState, P[]>()
  for (const p of want) {
    const s = stateFor(p)
    if (s) groups.set(s, [...(groups.get(s) ?? []), p])
  }
  const by_state: Partial<Record<IndexState, number>> = {}
  for (const [s, ps] of groups) by_state[s] = ps.length

  const sep = en ? ', ' : '、'
  const path = (u: string) => pathKey(u) || '/'
  const list = (ps: P[], n = 3) => ps.slice(0, n).map((p) => path(p.url)).join(sep) + (ps.length > n ? (en ? ` and ${ps.length - n} more` : ` 等 ${ps.length} 个页面`) : '')
  const found: Found[] = []
  const add = (check: string, severity: Found['severity'], title: string, ps: P[] | undefined, detail: string) => {
    if (ps?.length) found.push({ check, severity, title, detail, pages: ps.map((p) => p.url) })
  }
  const avgChars = (ps: P[]) => Math.round(ps.reduce((n, p) => n + p.text_chars, 0) / Math.max(ps.length, 1))
  const inbound = (ps: P[]) => {
    const keys = new Set(ps.map((p) => pathKey(p.url)))
    let n = 0
    for (const p of pages) for (const u of new Set(p.links)) if (keys.has(pathKey(u)) && pathKey(u) !== pathKey(p.url)) n++
    return Math.round((n / Math.max(ps.length, 1)) * 10) / 10
  }

  const crawled = groups.get('crawled')
  add('index_crawled', 'high', en ? 'Google crawled these pages but chose not to index them' : 'Google 抓过但没收录', crawled,
    en ? `Google read ${list(crawled ?? [])} and decided they weren't worth indexing. Usual reasons: too little content (these average ${avgChars(crawled ?? [])} characters of text) or too similar to other pages. Add specifics buyers need — specs, applications, FAQs, photos with alt — make each page clearly different, and link to them from related pages; then request indexing in Search Console.`
      : `Google 看过 ${list(crawled ?? [])}，觉得不值得收录。常见原因：内容太少（这几页正文平均 ${avgChars(crawled ?? [])} 字），或者和别的页面太像。补上买家要的具体内容（参数、应用场景、FAQ、带 alt 的实拍图），让每页和别的页明显不同，从相关页面多链过来，改完在 Search Console 里请求编入索引。`)
  const discovered = groups.get('discovered')
  add('index_discovered', 'medium', en ? 'Google found these pages but hasn\'t crawled them' : 'Google 发现了还没来抓', discovered,
    en ? `Google knows ${list(discovered ?? [])} exist but hasn't fetched them yet.${complete ? ` On average ${inbound(discovered ?? [])} pages on the site link to each.` : ''} Link them from the homepage, category pages and related articles, and keep pages fast so Google crawls more per visit.`
      : `Google 知道 ${list(discovered ?? [])}，但还没来抓。${complete ? `站内平均只有 ${inbound(discovered ?? [])} 个页面链到它们。` : ''}从首页、分类页、相关文章多链过去，页面速度快一些，Google 每次能多抓几页。`)
  const unknown = groups.get('unknown')
  add('index_unknown', 'medium', en ? 'Google doesn\'t know these pages exist' : 'Google 还不知道这些页面', unknown,
    en ? `${list(unknown ?? [])} have never been seen by Google. Make sure they're in the sitemap submitted in Search Console and linked from other pages; for the important ones use "Request indexing" in Search Console.`
      : `Google 还没见过 ${list(unknown ?? [])}。确认它们在 Search Console 里提交的 sitemap 里、站内有链接指过去；重要的页面在 Search Console 里点「请求编入索引」。`)
  const dup = groups.get('duplicate')
  const ex = dup?.map((p) => old.get(pathKey(p.url))).find((r) => r?.google_canonical)
  add('index_canonical', 'medium', en ? 'Google treats these pages as duplicates of others' : 'Google 把这些页面当成别的页面的重复', dup,
    en ? `Google indexed another URL instead of ${list(dup ?? [])}${ex ? ` (e.g. ${path(ex.page)} → ${path(ex.google_canonical)})` : ''}. Make each page's content distinct and its canonical point to itself; if they really are the same, merge them and redirect.`
      : `${list(dup ?? [])} 被 Google 当成别的页面的重复，收录的是另一个地址${ex ? `（比如 ${path(ex.page)} → ${path(ex.google_canonical)}）` : ''}。让每页内容明显不同、canonical 写自己；确实是同一个内容就合并成一页、旧地址跳转过去。`)
  const excluded = groups.get('excluded')
  const reasons = [...new Set((excluded ?? []).map((p) => old.get(pathKey(p.url))?.coverage).filter(Boolean))].slice(0, 3).join(sep)
  add('index_excluded', 'medium', en ? 'Google excluded these pages' : 'Google 没收录这些页面（其他原因）', excluded,
    en ? `${list(excluded ?? [])} aren't indexed (${reasons}). Open them with Search Console's URL inspection to see the details.`
      : `${list(excluded ?? [])} 没被收录（${reasons}）。在 Search Console 里用「网址检查」看具体原因。`)

  // sitemap 在 Search Console 里提交了没有
  let maps: IndexSummary['sitemaps'] = []
  try {
    const list = await sitemaps(ctx, property)
    maps = list.map((m: any) => ({
      path: String(m.path ?? ''),
      submitted: (m.contents ?? []).reduce((n: number, c: any) => n + Number(c.submitted ?? 0), 0),
      // contents[].indexed 谷歌已经不填了（总是 0），不用；收录看网址检查的结果
      last_read: String(m.lastDownloaded ?? ''),
      errors: Number(m.errors ?? 0),
    }))
    if (!list.length)
      found.push({ check: 'sitemap_unsubmitted', severity: 'medium', title: en ? 'No sitemap submitted to Google' : '没在 Search Console 提交 sitemap', pages: [root + '/'],
        detail: en ? `Search Console has no sitemap for ${property}. Submit ${root}/sitemap.xml under Sitemaps so Google finds new pages quickly.` : `Search Console 里 ${property} 还没有 sitemap。在「站点地图」里提交 ${root}/sitemap.xml，新页面 Google 才能很快发现。` })
    const bad = maps.filter((m) => m.errors > 0)
    if (bad.length)
      found.push({ check: 'sitemap_errors', severity: 'medium', title: en ? 'Google reports errors in the sitemap' : 'Google 读 sitemap 报错', pages: [root + '/'],
        detail: en ? `${bad.map((m) => `${m.path} (${m.errors} errors)`).join(', ')}. Open Sitemaps in Search Console for details and fix them.` : `${bad.map((m) => `${m.path}（${m.errors} 个错误）`).join('、')}。在 Search Console 的「站点地图」里看具体错误并修好。` })
  } catch (e: any) {
    ctx.log(L(ctx, '读不到 Search Console 的 sitemap：', "Couldn't read sitemaps from Search Console: ") + (e?.message ?? e))
  }

  return { found, summary: { pages: want.length, checked: [...groups.values()].reduce((n, g) => n + g.length, 0), inspected_now: inspected, by_state, sitemaps: maps } }
}
