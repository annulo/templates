// Google 搜索结果页：打开、判断被拦（验证码、同意页）、取前 10 条自然结果。
// 来自 https://github.com/annulo/references 的 serp/（怎么用见 README.md，坏了怎么修见 MAINTAIN.md）。验证于 2026-10-22。
//
// Google 没有给普通网页的结果接口，只能读页面：
//   - 自然结果：#search 里每条结果的标题是 a 里面的 h3，a 的 href 就是结果网址；广告在 #tads / #tadsb / #bottomads 里，不算；
//   - 摘要：结果块里 [data-sncf] 或 .VwiC3b 的文字，取不到就空着（摘要只给人看，不参与判断）；
//   - 被拦：地址跳到 /sorry/ 或页面上有 #captcha-form 是验证码；跳到 consent.google.com 是欧盟的 Cookie 同意页。
// 页面结构常改，所以在页面里只取「原始条目」（extract），清洗、去重、编号放在纯函数 parse 里，能拿 fixtures/ 离线检查。

import { fail, type Raw, type Result } from './_serp_common'

export const GOOGLE = {
  id: 'google',
  verified: '2026-10-22',
  /** 搜索地址：hl 界面语言、gl 国家；pws=0 尽量不按用户个性化 */
  url: (q: string, hl = 'en', gl = 'us') => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&pws=0&num=10`,
}

const SEL = {
  results: '#search', // 结果区（有它说明结果出来了）
  captcha: '#captcha-form, form[action*="/sorry/"]',
  ads: '#tads, #tadsb, #bottomads',
}

/** 在页面里跑：取每条 h3 标题所在的链接，带上是不是在广告区、摘要。会被转成文字送进页面，不能用这个文件里别的东西 */
export function extract(sel: typeof SEL) {
  const out: { href: string; title: string; snippet: string; ad: boolean }[] = []
  const ads = Array.from(document.querySelectorAll(sel.ads))
  for (const h3 of Array.from(document.querySelectorAll('#search a h3, #rso a h3'))) {
    const a = h3.closest('a') as HTMLAnchorElement | null
    if (!a?.href) continue
    const block = (a.closest('[data-hveid], div.g') as HTMLElement | null) ?? a.parentElement
    const snip = block?.querySelector('[data-sncf], .VwiC3b') as HTMLElement | null
    out.push({ href: a.href, title: (h3.textContent || '').trim(), snippet: (snip?.innerText || '').trim().slice(0, 300), ad: ads.some((x) => x.contains(a)) })
  }
  return { url: location.href, items: out, ads: ads.reduce((n, x) => n + x.querySelectorAll('a h3, [role="heading"]').length, 0) }
}

/** 原始条目 → 前 10 条自然结果：去掉广告、Google 自己的链接、重复的网址，按出现顺序编号 */
export function parse(raw: Raw, max = 10): Result[] {
  const seen = new Set<string>()
  const out: Result[] = []
  for (const it of raw.items) {
    if (it.ad || !it.title) continue
    let url = it.href
    try {
      const u = new URL(url)
      // 少数结果是 /url?q= 跳转
      if (/(^|\.)google\./.test(u.hostname) && u.pathname === '/url') url = u.searchParams.get('q') || u.searchParams.get('url') || ''
      if (!url) continue
      const host = new URL(url).hostname.toLowerCase()
      if (/(^|\.)google\.[a-z.]+$/.test(host) || host.endsWith('.googleusercontent.com')) continue
      const key = url.replace(/#.*$/, '')
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ position: out.length + 1, url, domain: host.replace(/^www\./, ''), title: it.title, snippet: it.snippet })
    } catch {
      continue
    }
    if (out.length >= max) break
  }
  return out
}

/** 在已经打开的浏览器里搜一个词。被拦 throw（code 见 _serp_common.ts） */
/** opts.sleep 传 ctx.sleep（等结果填满用；本机函数里没有 setTimeout） */
export async function searchGoogle(b: any, q: string, opts: { hl?: string; gl?: string; sleep?: (ms: number) => Promise<void> } = {}) {
  // 不用 b.goto：它要等整页的 load 事件，Google 结果页常有资源一直在加载（尤其走代理时），30 秒等不到就算失败，
  // 其实结果早就出来了。改成自己跳转，等新页面上出现结果区或验证码就读。
  // 同一个窗口连着查好几个词：跳转前给旧页面打个标记，只等没标记的（新的）页面，免得读到上一个词的结果。
  // b.eval 的字符串是一个表达式（不能有分号分开的几句）：用逗号连起来
  await b.eval(`(document.documentElement.setAttribute('data-serp-old', '1'), location.href = ${JSON.stringify(GOOGLE.url(q, opts.hl, opts.gl))}, true)`)
  const fresh = (sel: string) => sel.split(',').map((s) => `html:not([data-serp-old]) ${s.trim()}`).join(', ')
  try {
    await b.waitFor(fresh(`${SEL.results}, ${SEL.captcha}`), { timeout: 30000, visible: false })
  } catch {
    let url = ''
    try {
      url = await b.url()
    } catch {}
    if (/consent\.google\./.test(url)) fail('consent', '打开的是 Google 的 Cookie 同意页：在这个 Chrome 里打开一次 google.com，点「全部接受」或「全部拒绝」')
    if (/\/sorry\//.test(url)) fail('captcha', 'Google 要求人机验证：在这个 Chrome 里打开 google.com 搜一次，做完验证，过一会儿再查')
    fail('changed', '30 秒没等到搜索结果区（#search）：网络太慢，或者 Google 改版了，照 MAINTAIN.md 排查')
  }
  const url: string = await b.url()
  if (/\/sorry\//.test(url) || (await b.exists(SEL.captcha))) fail('captcha', 'Google 要求人机验证：在这个 Chrome 里打开 google.com 搜一次，做完验证，过一会儿再查')
  // 结果区出来了，结果条目还在往里填（实测刚出来时可能只有 1 条）：等标题链接的个数 1.5 秒不变、或者够 10 条再读，最多等 8 秒
  let last = -1, stable = 0
  for (let waited = 0; waited < 8000; waited += 500) {
    const n: number = await b.eval(`document.querySelectorAll('#search a h3').length`)
    stable = n === last ? stable + 500 : 0
    last = n
    if (n >= 10 || (n > 0 && stable >= 1500)) break
    await opts.sleep?.(500)
  }
  // b.eval 不收参数（传函数时把函数转成文字在页面里调用）：把选择器拼进表达式
  const raw: Raw = await b.eval(`(${extract.toString()})(${JSON.stringify(SEL)})`)
  const results = parse(raw)
  if (!results.length && raw.items.length) fail('changed', `页面上有 ${raw.items.length} 个标题链接，但一条自然结果都没取出来：照 MAINTAIN.md 排查`)
  return { query: q, url: raw.url, results, ads: raw.ads }
}
