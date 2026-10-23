// 站点体检里的关键词检查（文件名以 _ 开头：只给 audit.ts import）。设计见 docs/keywords.md「页面体检」、docs/site-audit.md。
//
// 关键词和站点体检看的是同一批页面，所以关键词的页面问题也记成体检问题（site_issues），走体检现成的「交给助手修复 → 确认上线 → 重新体检标已解决 → 改动复查」：
//   - keyword_missing：筛过的词（值得看、在做）的目标页面（没有目标页面用 GSC 曝光最多的页面），标题或 H1 没用上这个页面的主词。
//     一个页面的标题只放得下一两个主词：每个页面只看主词（曝光最多的，一样多时在做的优先），别的词记下事实、不算问题；
//   - keyword_cannibal：几个本站页面在抢同一个词（keywords.refresh 从 GSC 算的 gsc_pages）。
// 顺带把每个词的检查结果写回 keywords.onpage，关键词页点开一个词能看到标题、H1、描述、网址各用没用上。
// 没有关键词表（老项目、没挖过词）就什么都不做。

import { isEn } from './_i18n'
import { onPageFacts } from './_keywords'

type P = { url: string; html: boolean; title: string; description: string; h1: string[] }
type Found = { check: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; pages: string[] }
type Kw = { id: string; keyword: string; status?: string; target_page?: string; gsc_page?: string; gsc_pages?: string; gsc_impressions?: number }

const MAX_EXTRA = 20 // 目标页面不在这次体检抓到的页面里时，最多再读几个
const pathKey = (u: string) => {
  try {
    return (decodeURIComponent(new URL(u).pathname).replace(/\/+$/, '') || '/').toLowerCase()
  } catch {
    return u
  }
}

/**
 * pages 是这次体检抓到的页面；read(urls) 读这次没抓到的目标页面（audit.ts 传进来，按同样的规则解析）。
 * 按网址的路径对页面（体检用预览地址时，域名和 GSC 里的正式域名不一样，路径是一样的）。
 */
export async function keywordChecks(channelId: string, pages: P[], ctx: any, read: (urls: string[]) => Promise<P[]>): Promise<Found[]> {
  let kws: Kw[] = []
  try {
    kws = ctx.db.query('keywords', { where: { channel_id: channelId }, limit: 1000 }).list.filter((k: Kw) => k.status === 'idea' || k.status === 'targeting')
  } catch {
    return []
  }
  if (!kws.length) return []
  const en = isEn(ctx)
  const q = (s: string) => (en ? `"${s}"` : `「${s}」`)
  const byPath = new Map(pages.filter((p) => p.html).map((p) => [pathKey(p.url), p]))
  const targetOf = (k: Kw) => k.target_page || k.gsc_page || ''
  const missingPaths = [...new Set(kws.map(targetOf).filter((u) => u && !byPath.has(pathKey(u))))].slice(0, MAX_EXTRA)
  if (missingPaths.length) for (const p of await read(missingPaths)) if (p.html) byPath.set(pathKey(p.url), p)

  const at = new Date().toISOString()
  // 每个页面的主词
  const primary = new Map<string, Kw>()
  const better = (a: Kw, b: Kw) => (a.gsc_impressions ?? 0) - (b.gsc_impressions ?? 0) || Number(a.status === 'targeting') - Number(b.status === 'targeting')
  for (const k of kws) {
    const t = targetOf(k)
    if (!t) continue
    const cur = primary.get(pathKey(t))
    if (!cur || better(k, cur) > 0) primary.set(pathKey(t), k)
  }
  const missing = new Map<string, { title: string[]; h1: string[] }>() // 页面 → 没用上的主词
  for (const k of kws) {
    const target = targetOf(k)
    const p = target ? byPath.get(pathKey(target)) : undefined
    if (!p) continue
    const main = primary.get(pathKey(target))?.id === k.id
    const f = { ...onPageFacts(target, p, k.keyword, at), primary: main }
    ctx.db.update('keywords', k.id, { onpage: JSON.stringify(f) })
    if (!main || (f.title && f.h1)) continue
    const m = missing.get(target) ?? { title: [], h1: [] }
    if (!f.title) m.title.push(k.keyword)
    if (!f.h1) m.h1.push(k.keyword)
    missing.set(target, m)
  }

  const out: Found[] = []
  if (missing.size) {
    const lines = [...missing].slice(0, 8).map(([page, m]) => {
      const parts = [
        m.title.length ? (en ? `title is missing ${m.title.slice(0, 4).map(q).join(', ')}` : `标题没用上${m.title.slice(0, 4).map(q).join('')}`) : '',
        m.h1.length ? (en ? `H1 is missing ${m.h1.slice(0, 4).map(q).join(', ')}` : `H1 没用上${m.h1.slice(0, 4).map(q).join('')}`) : '',
      ].filter(Boolean)
      return `${pathKey(page)}：${parts.join(en ? '; ' : '；')}`
    })
    out.push({
      check: 'keyword_missing', severity: 'medium',
      title: en ? "Pages' main keywords missing from titles and H1s" : '页面的主词没用在标题和 H1 里',
      detail: (en
        ? "Each page's main keyword (the one with the most Google impressions on the Keywords tab) is missing from its title or H1. Work it into the title and H1 naturally, without stuffing: "
        : '这些页面的主词（关键词页里这个页面曝光最多的词）没用在标题或 H1 里。把它自然地写进标题和 H1，不要堆砌：') + lines.join(en ? ' | ' : '；'),
      pages: [...missing.keys()],
    })
  }

  const fights = kws
    .map((k) => {
      try {
        return { k, ps: JSON.parse(k.gsc_pages || '[]') as { page: string; position: number }[] }
      } catch {
        return { k, ps: [] }
      }
    })
    .filter((x) => x.ps.length > 1)
  if (fights.length) {
    const lines = fights.slice(0, 6).map(({ k, ps }) => `${q(k.keyword)}${en ? ': ' : '：'}${ps.map((p) => `${pathKey(p.page)}（${en ? 'pos' : '排'} ${p.position}）`).join(en ? ', ' : '、')}`)
    out.push({
      check: 'keyword_cannibal', severity: 'medium',
      title: en ? 'Several pages compete for the same keyword' : '几个页面在抢同一个关键词',
      detail: (en
        ? 'Google splits the keyword between these pages and none ranks in the top 3. Pick one main page; refocus the others on different keywords and link them to the main page, or merge them: '
        : 'Google 把这个词分给了几个页面，没有一个排进前 3。选一个主页面，别的页面改写重点换别的词、加内链指向主页面，或者合并：') + lines.join(en ? ' | ' : '；'),
      pages: [...new Set(fights.flatMap((x) => x.ps.map((p) => p.page)))].slice(0, 20),
    })
  }
  return out
}
