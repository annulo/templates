// DeepSeek 网页版（chat.deepseek.com）
// 来自 https://github.com/annulo/references 的 aichat/。验证于 2026-10-14。
//
// 怎么拿结果：不解析页面。回答走的接口 /api/v0/chat/completion 是流式的（SSE），里面一条条是增量补丁：
//   开头一条 {"v":{"response":{… "search_enabled", "fragments":[{"type":"SEARCH","queries":[{query}…]}]}}} —— 搜了哪些词
//   {"p":"response/fragments/-1/results","v":[{url,title,snippet,cite_index,site_name}…]} —— 搜到的网页
//   {"p":"response","o":"BATCH","v":[{"p":"fragments","o":"APPEND","v":[{"type":"RESPONSE","content":"…"}]}]} —— 回答开始
//   {"p":"response/fragments/-1/content","o":"APPEND","v":"…"}，之后省略 p 的 {"v":"…"} —— 回答一段段追加
//   {"p":"response/status","o":"SET","v":"FINISHED"} —— 回答完了
// 回答里的引用写成 [citation:N]，N 对应网页的 cite_index。
// 改版时先看 MAINTAIN.md「DeepSeek」一节。

import { type Answer, type Source, citedNumbers, dedupe, fail, responseMatching, sseData } from './_aichat_common'

export const DEEPSEEK = {
  id: 'deepseek',
  name: 'DeepSeek',
  url: 'https://chat.deepseek.com/',
  verified: '2026-10-14',
  ask,
}

const API = '/api/v0/chat/completion'
const SEL = {
  input: 'textarea', // 输入框
}

async function ask(b: any, question: string, opt: { timeout?: number; raw?: boolean } = {}): Promise<Answer> {
  b.listen(API)
  await b.goto(DEEPSEEK.url) // 首页就是新对话
  try {
    await b.waitFor(SEL.input, { timeout: 20000 })
  } catch {
    if (String(await b.url()).includes('/sign_in')) fail('login', 'DeepSeek 没登录：到这个 Chrome 里登录 chat.deepseek.com')
    fail('changed', `DeepSeek 页面上找不到输入框（${SEL.input}）`)
  }
  await b.type(SEL.input, question)
  await b.press('Enter')
  const t0 = Date.now()
  // 页面上同一个接口可能还有别的请求：取有回答片段的那个
  let r: any
  try {
    r = await responseMatching(b, API, (x) => x.text.includes('"RESPONSE"') || x.status !== 200, opt.timeout || 180000)
  } catch {
    fail('timeout', 'DeepSeek 等了太久还没回答完')
  }
  if (r.status === 429) fail('limited', 'DeepSeek 限流了（HTTP 429），过一会儿再试')
  if (r.status !== 200) fail('changed', `DeepSeek 接口返回 HTTP ${r.status}`)
  const out = parse(r.text)
  if (!out.answer) {
    const page = String(await b.text('body')).slice(-500)
    if (/繁忙|稍后再试|busy|try again later/i.test(page)) fail('limited', 'DeepSeek 服务器繁忙，过一会儿再试')
    fail('empty', `DeepSeek 没有返回回答。接口返回的开头：${String(r.text).slice(0, 300)}`)
  }
  return { site: DEEPSEEK.id, ...out, ms: Date.now() - t0, url: String(await b.url()), ...(opt.raw ? { raw: r.text } : {}) }
}

/** 解析 SSE 补丁流。导出给 test 用：存一份真实的流，改版时对着改 */
export function parse(text: string) {
  let answer = ''
  let search = false
  const searches: string[] = []
  const sources: Source[] = []
  let path = '' // 省略 p 的补丁接着上一条的路径
  let current = '' // 正在追加的片段类型：RESPONSE 是回答，THINK 是深度思考的过程（不算进回答）
  const addResults = (list: any[]) => {
    for (const x of list || []) sources.push({ n: x.cite_index, url: x.url, title: x.title || '', site_name: x.site_name, snippet: x.snippet, cited: false })
  }
  const addFragments = (list: any[]) => {
    for (const f of list || []) {
      if (f.type === 'SEARCH') {
        for (const q of f.queries || []) if (q.query) searches.push(q.query)
        addResults(f.results)
      }
      if (f.type === 'RESPONSE') answer += f.content || ''
      current = f.type
    }
  }
  for (const d of sseData(text)) {
    if (d.p) path = d.p
    if (!d.p && d.v && typeof d.v === 'object' && d.v.response) {
      // 第一条：整个 response
      search = !!d.v.response.search_enabled
      addFragments(d.v.response.fragments)
      continue
    }
    if (path === 'response/fragments/-1/results' && Array.isArray(d.v)) addResults(d.v)
    else if (path === 'response' && d.o === 'BATCH') {
      for (const x of d.v || []) {
        if (x.p === 'fragments' && x.o === 'APPEND') {
          addFragments(x.v)
          path = 'response/fragments/-1/content' // 接下来省略 p 的字符串是这个新片段的内容
        }
      }
    } else if (path === 'response/fragments/-1/content' && typeof d.v === 'string' && current === 'RESPONSE') answer += d.v
  }
  answer = answer.replace(/\[citation:(\d+)\]/g, '[$1]').trim()
  const cited = citedNumbers(answer)
  for (const s of sources) s.cited = s.n != null && cited.has(s.n)
  return { answer, sources: dedupe(sources), searches, search: search || searches.length > 0 }
}
