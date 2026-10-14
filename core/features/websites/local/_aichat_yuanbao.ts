// 腾讯元宝网页版（yuanbao.tencent.com）
// 来自 https://github.com/annulo/references 的 aichat/。验证于 2026-10-14。
//
// 怎么拿结果：不解析页面。回答走的接口 /api/chat/<对话 id> 是 SSE，每行 data: 一个 JSON（夹着几行不是 JSON 的，比如 [DONE]，跳过）：
//   {"type":"searchGuid","docs":[{index,title,url,web_site_name,quote}…]} —— 参考的网页，index 对应回答里的 [citation:N]
//   {"type":"text","msg":"…"} —— 一段回答（type 是 think 之类的不是回答）
//   {"type":"meta",…,"stopReason":"stop"} —— 回答完了
// 流里没有搜索词：searches 是空的。
// 回答里夹着 [](@mark_underline=N)（页面画下划线用的），去掉。
// 响应头没写字符集，老版本 Annulo 读到的是乱码，先 fixMojibake。

import { type Answer, type Source, citedNumbers, dedupe, fail, fixMojibake, responseMatching, sseData } from './_aichat_common'

export const YUANBAO = {
  id: 'yuanbao',
  name: '腾讯元宝',
  url: 'https://yuanbao.tencent.com/chat',
  verified: '2026-10-14',
  queries: false, // 拿不到搜索词
  ask,
}

const API = 'yuanbao.tencent.com/api/chat/'
const SEL = {
  input: '.ql-editor', // 输入框（Quill 编辑器）
}

async function ask(b: any, question: string, opt: { timeout?: number; raw?: boolean } = {}): Promise<Answer> {
  b.listen(API)
  await b.goto(YUANBAO.url) // 新对话
  try {
    await b.waitFor(SEL.input, { timeout: 20000 })
  } catch {
    fail('changed', `元宝页面上找不到输入框（${SEL.input}）`)
  }
  // 没登录时输入框上写着「请登录后输入内容」
  const placeholder = String(await b.eval(() => document.querySelector('.ql-editor')?.getAttribute('data-placeholder') || ''))
  if (placeholder.includes('登录')) fail('login', '元宝没登录：到这个 Chrome 里登录 yuanbao.tencent.com')
  await b.type(SEL.input, question)
  await b.press('Enter')
  const t0 = Date.now()
  // 页面上同一个接口可能还有别的请求：取有回答正文的那个
  let r: any
  try {
    r = await responseMatching(b, API, (x) => /"type":\s*"text"/.test(x.text) || x.status !== 200, opt.timeout || 180000)
  } catch {
    fail('timeout', '元宝等了太久还没回答完')
  }
  if (r.status === 429) fail('limited', '元宝限流了（HTTP 429），过一会儿再试')
  if (r.status !== 200) fail('changed', `元宝接口返回 HTTP ${r.status}`)
  const text = fixMojibake(r.text)
  const out = parse(text)
  if (!out.answer) fail('empty', `元宝没有返回回答。接口返回的开头：${String(text).slice(0, 300)}`)
  return { site: YUANBAO.id, ...out, ms: Date.now() - t0, url: String(await b.url()), ...(opt.raw ? { raw: text } : {}) }
}

/** 解析 SSE。导出给离线检查用 */
export function parse(text: string) {
  let answer = ''
  const sources: Source[] = []
  for (const d of sseData(text)) {
    if (!d || typeof d !== 'object') continue
    if (d.type === 'text') answer += d.msg || ''
    else if (d.type === 'searchGuid') {
      for (const doc of d.docs || []) {
        if (doc.url) sources.push({ n: doc.index, url: doc.url, title: doc.title || '', site_name: doc.web_site_name, snippet: doc.quote, cited: false })
      }
    }
  }
  answer = answer
    .replace(/\[\]\(@mark_underline=\d+\)/g, '')
    .replace(/\[citation:(\d+)\]/g, '[$1]')
    .trim()
  const cited = citedNumbers(answer)
  for (const s of sources) s.cited = s.n != null && cited.has(s.n)
  return { answer, sources: dedupe(sources), searches: [] as string[], search: sources.length > 0 }
}
