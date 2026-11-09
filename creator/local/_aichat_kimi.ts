// Kimi 网页版（www.kimi.com）
// 来自 https://github.com/annulo/references 的 aichat/。验证于 2026-10-14。
//
// 怎么拿结果：不解析页面。回答走的接口 /apiv2/kimi.gateway.chat.v1.ChatService/Chat 是 Connect 协议的流：
// 每条 5 个字节的二进制头 + 一段 JSON，读成文本后用 jsonObjects 一个个取出来。每条有 op（set / append）和 mask（改哪个字段）：
//   mask "chat.lastRequest"：这次的选项，tools 里有 TOOL_TYPE_SEARCH 就是开了联网搜索
//   mask 含 "block.tool.args"、tool.toolCallId 以 web_search 开头：args 是 {"queries":[…]}，搜了哪些词
//   mask "message.refs.searchChunks"：搜到的网页 [{id, base:{title,url,siteName}}]，id 对应回答里的引用编号
//   mask "block.text" / "block.text.content"：回答正文，先 set 再一段段 append（block.think 是思考过程，不算回答）
// 改版时先看 MAINTAIN.md「Kimi」一节。

import { type Answer, type Source, citedNumbers, dedupe, fail, jsonObjects, responseMatching } from './_aichat_common'

export const KIMI = {
  id: 'kimi',
  name: 'Kimi',
  url: 'https://www.kimi.com/',
  verified: '2026-10-14',
  ask,
}

const API = 'kimi.gateway.chat.v1.ChatService/Chat'
const SEL = {
  input: '.chat-input-editor', // 输入框（contenteditable）
}

async function ask(b: any, question: string, opt: { timeout?: number; raw?: boolean } = {}): Promise<Answer> {
  b.listen(API)
  await b.goto(KIMI.url) // 首页就是新对话
  try {
    await b.waitFor(SEL.input, { timeout: 20000 })
  } catch {
    fail('changed', `Kimi 页面上找不到输入框（${SEL.input}）`)
  }
  if (await loggedOut(b)) fail('login', 'Kimi 没登录：到这个 Chrome 里登录 www.kimi.com')
  await b.type(SEL.input, question)
  await b.press('Enter')
  const t0 = Date.now()
  // 页面上同一个接口可能还有别的请求：取有回答正文的那个
  let r: any
  try {
    r = await responseMatching(b, API, (x) => x.text.includes('block.text') || x.status !== 200, opt.timeout || 240000) // 默认开着深度思考，慢
  } catch {
    if (await loggedOut(b)) fail('login', 'Kimi 没登录：到这个 Chrome 里登录 www.kimi.com')
    fail('timeout', 'Kimi 等了太久还没回答完')
  }
  if (r.status === 429) fail('limited', 'Kimi 限流了（HTTP 429），过一会儿再试')
  if (r.status !== 200) fail('changed', `Kimi 接口返回 HTTP ${r.status}`)
  const out = parse(r.text)
  if (!out.answer) fail('empty', `Kimi 没有返回回答。接口返回的开头：${String(r.text).slice(0, 300)}`)
  return { site: KIMI.id, ...out, ms: Date.now() - t0, url: String(await b.url()), ...(opt.raw ? { raw: r.text } : {}) }
}

/** 没登录时页面上有「登录」按钮 */
async function loggedOut(b: any) {
  return !!(await b.eval(() =>
    [...document.querySelectorAll('button,[role=button],a')].some((e: any) => e.offsetParent && /^(登录|登 录|Log in|Sign in)$/.test((e.innerText || '').trim())),
  ))
}

/** 解析 Connect 流。导出给排查用：存一份真实的流，改版时对着改 */
export function parse(text: string) {
  let answer = ''
  let search = false
  const searches: string[] = []
  // 每次搜索（web_search:1、web_search:2…）的网页各一组，按 message.refs.searchChunks 追加的顺序
  const groups: Source[][] = []
  for (const o of jsonObjects(text)) {
    const mask = String(o.mask || '')
    if (mask === 'chat.lastRequest') {
      search = (o.chat?.lastRequest?.tools || []).some((t: any) => t.type === 'TOOL_TYPE_SEARCH')
    } else if (mask.includes('block.tool.args') && o.op === 'set') {
      const tool = o.block?.tool || {}
      if (String(tool.toolCallId || '').startsWith('web_search')) {
        try {
          for (const q of JSON.parse(tool.args).queries || []) searches.push(q)
        } catch {}
      }
    } else if (mask === 'message.refs.searchChunks') {
      groups.push(
        (o.message?.refs?.searchChunks || []).map((c: any) => ({ url: c.base?.url || '', title: c.base?.title || '', site_name: c.base?.siteName, snippet: c.base?.snippet, cited: false })),
      )
    } else if (mask === 'block.text' || mask === 'block.text.content') {
      answer += o.block?.text?.content || ''
    }
  }
  // 编号：所有组摊平去重后从 1 开始
  const sources = dedupe(([] as Source[]).concat(...groups))
  sources.forEach((s, i) => (s.n = i + 1))
  const numberOf = (url: string) => sources.find((s) => s.url.replace(/#.*$/, '') === url.replace(/#.*$/, ''))?.n
  // 引用：<REF>cite✦tools://web_search:K#N:~:text=原文片段</REF> 是第 K 次搜索的第 N 个网页，换成 [n]
  answer = answer
    .replace(/<REF>[^<]*?web_search:(\d+)#(\d+)[^<]*<\/REF>/g, (_, k, n) => {
      const hit = groups[Number(k) - 1]?.[Number(n) - 1]
      const num = hit && numberOf(hit.url)
      return num ? `[${num}]` : ''
    })
    .replace(/<REF>[^<]*<\/REF>/g, '') // 认不出的引用（别的工具）去掉
    .trim()
  const cited = citedNumbers(answer)
  for (const s of sources) s.cited = cited.has(s.n!)
  return { answer, sources, searches, search: search || searches.length > 0 }
}
