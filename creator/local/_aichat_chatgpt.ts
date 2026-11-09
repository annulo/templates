// ChatGPT 网页版（chatgpt.com）
// 来自 https://github.com/annulo/references 的 aichat/。验证于 2026-10-14。
//
// 怎么拿结果：ChatGPT 的回答流抓不到（不是普通的 HTTP 流），改成回答完以后读整段对话：
// 页面里用网页自己的登录态调 /api/auth/session 拿 accessToken，再 GET /backend-api/conversation/<对话 id>（JSON）。
//   mapping 里是全部消息。回答 = 最后一条 author.role=assistant、content_type=text、有内容的消息，status=finished_successfully 就是答完了
//   正文里的标记用私有区字符包着：类型内容
//     cite：引用，内容是 turn0search0（几个用  连着），对应 metadata.content_references 里 matched_text 同名、type=grouped_webpages 的那条（items 是网页）
//     entity：["company","Shopify"] 这类，换成名字；image_group 之类的去掉
//   搜到的全部网页在 tool 消息的 metadata.search_result_groups[].entries
//   拿不到搜索词（对话 JSON 里没有）：searches 是空的
// 用临时对话（?temporary-chat=true）：不进用户的历史记录、不用用户的记忆，更接近陌生买家看到的回答。
// 改版时先看 MAINTAIN.md「ChatGPT」一节。

import { type Answer, type Source, citedNumbers, dedupe, fail } from './_aichat_common'

export const CHATGPT = {
  id: 'chatgpt',
  name: 'ChatGPT',
  url: 'https://chatgpt.com/?temporary-chat=true',
  verified: '2026-10-14',
  queries: false, // 拿不到搜索词
  ask,
}

const SEL = {
  input: '.ProseMirror', // 输入框（contenteditable，id 是 prompt-textarea）
}

/** 在页面里读这段对话（用网页自己的登录态） */
const READ = `(async (id) => {
  const s = await (await fetch('/api/auth/session')).json().catch(() => ({}))
  if (!s || !s.accessToken) return { login: false }
  const r = await fetch('/backend-api/conversation/' + id, { headers: { Authorization: 'Bearer ' + s.accessToken } })
  return { login: true, status: r.status, text: r.status === 200 ? await r.text() : '' }
})`

async function ask(b: any, question: string, opt: { timeout?: number; raw?: boolean } = {}): Promise<Answer> {
  await b.goto(CHATGPT.url)
  try {
    await b.waitFor(SEL.input, { timeout: 20000 })
  } catch {
    fail('changed', `ChatGPT 页面上找不到输入框（${SEL.input}）`)
  }
  // 没登录也能聊，但读不了对话：先看有没有登录
  const session = await b.eval(`fetch('/api/auth/session').then((r) => r.json()).then((s) => !!(s && s.accessToken)).catch(() => false)`)
  if (!session) fail('login', 'ChatGPT 没登录：到这个 Chrome 里登录 chatgpt.com')
  await b.type(SEL.input, question)
  await b.press('Enter')
  const t0 = Date.now()
  const deadline = t0 + (opt.timeout || 240000)
  // 发出去以后地址变成 /c/<对话 id>
  let id = ''
  while (!id && Date.now() < deadline) {
    await sleep(b, 1000)
    id = (/\/c\/([0-9a-f-]{20,})/.exec(String(await b.url())) || [])[1] || ''
  }
  if (!id) fail('changed', 'ChatGPT 发出问题后地址没变成 /c/<对话 id>（发送按钮或地址格式可能变了）')
  // 每 3 秒读一次，最后一条回答答完了就停
  let last: any = null
  let text = ''
  while (Date.now() < deadline) {
    await sleep(b, 3000)
    const r = await b.eval(`${READ}(${JSON.stringify(id)})`)
    if (!r.login) fail('login', 'ChatGPT 登录过期：到这个 Chrome 里重新登录 chatgpt.com')
    if (r.status === 429) fail('limited', 'ChatGPT 限流了（HTTP 429），过一会儿再试')
    if (r.status !== 200) continue // 临时对话刚建好时可能还读不到
    text = r.text
    const out = parse(text)
    last = out
    if (out.done) break
  }
  if (!last?.done) fail('timeout', 'ChatGPT 等了太久还没回答完')
  if (!last.answer) fail('empty', `ChatGPT 没有返回回答。对话的开头：${text.slice(0, 300)}`)
  const { done, ...out } = last
  return { site: CHATGPT.id, ...out, ms: Date.now() - t0, url: String(await b.url()), ...(opt.raw ? { raw: text } : {}) }
}

// 本机函数的 ctx.sleep 不在 b 上：用页面里的 setTimeout 等
async function sleep(b: any, ms: number) {
  await b.eval(`new Promise((r) => setTimeout(r, ${ms}))`)
}

const clean = (u: string) => u.replace(/([?&])utm_source=chatgpt\.com&?/, '$1').replace(/[?&]$/, '')

/** 解析对话 JSON。导出给离线检查用。done：最后一条回答答完了 */
export function parse(text: string) {
  let conv: any
  try {
    conv = JSON.parse(text)
  } catch {
    return { done: false, answer: '', sources: [] as Source[], searches: [] as string[], search: false }
  }
  const msgs = Object.values(conv.mapping || {})
    .map((n: any) => n.message)
    .filter(Boolean)
    .sort((a: any, b: any) => (a.create_time || 0) - (b.create_time || 0))
  // 最后一个用户问题之后的才是这次的回答
  const lastUser = msgs.map((m: any) => m.author?.role).lastIndexOf('user')
  const turn = msgs.slice(lastUser + 1)
  const reply: any = [...turn].reverse().find((m: any) => m.author?.role === 'assistant' && m.content?.content_type === 'text' && (m.content.parts || []).join('').trim())
  // 搜到的全部网页
  const all: Source[] = []
  for (const m of turn as any[]) {
    for (const g of m.metadata?.search_result_groups || []) {
      for (const e of g.entries || []) if (e.url) all.push({ url: clean(e.url), title: e.title || '', site_name: g.domain, snippet: e.snippet || undefined, cited: false })
    }
  }
  // 回答里的引用：matched_text → 网页
  const refs: Record<string, string[]> = {}
  for (const r of reply?.metadata?.content_references || []) {
    if (r.type === 'grouped_webpages' || r.type === 'webpage') {
      const items = r.items || [r]
      refs[String(r.matched_text || '').replace(/[-]/g, '')] = items.map((x: any) => clean(x.url || '')).filter(Boolean)
      for (const x of items) if (x.url) all.push({ url: clean(x.url), title: x.title || '', site_name: x.attribution, cited: false })
    }
  }
  const sources = dedupe(all)
  sources.forEach((s, i) => (s.n = i + 1))
  const num = (u: string) => sources.find((s) => s.url === u)?.n
  let answer = String((reply?.content?.parts || []).join(''))
  answer = answer
    .replace(/cite([^]*)/g, (_, inner: string) => {
      const keys = inner.split('')
      const nums = new Set<number>()
      for (const k of keys) for (const u of refs['cite' + k] || refs[k] || []) num(u) && nums.add(num(u)!)
      // 一个标记对应几个网页时，refs 的 key 是整串
      for (const u of refs['cite' + keys.join('')] || []) num(u) && nums.add(num(u)!)
      return [...nums].map((n) => `[${n}]`).join('')
    })
    .replace(/entity([^]*)/g, (_, inner: string) => {
      try {
        const v = JSON.parse(inner)
        return Array.isArray(v) ? String(v[1] ?? v[0]) : String(v) // ["company","Shopify","可选的描述"]：第二项是名字
      } catch {
        return ''
      }
    })
    .replace(/[^]*/g, '') // 配图之类的去掉
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const cited = citedNumbers(answer)
  for (const s of sources) s.cited = cited.has(s.n!)
  const done = !!reply && reply.status === 'finished_successfully' && conv.current_node && reply.id === conv.mapping[conv.current_node]?.message?.id
  return { done, answer, sources, searches: [] as string[], search: sources.length > 0 }
}
