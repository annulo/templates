// 豆包网页版（www.doubao.com）
// 来自 https://github.com/annulo/references 的 aichat/。验证于 2026-10-14。
//
// 怎么拿结果：不解析页面。回答走的接口 /chat/completion 是 SSE，每条前面有 event 名：
//   STREAM_CHUNK：补丁，patch_value.content_block 里是块。block_type 10025 的 search_query_result_block
//                 有这次搜的词 queries 和网页 results[{text_card:{title,url,index}}]；text_block 是一段回答
//   CHUNK_DELTA：{"text":"…"}，一段回答
//   回答正文 = 按顺序把 STREAM_CHUNK 里的 text_block 和 CHUNK_DELTA 接起来（只取一种会缺字）
//   SSE_REPLY_END：回答完了
// 页面打开时会给上一段对话补拉一次同一个接口（取推荐问题），要认出这次提问的那个：流里 FULL_MSG_NOTIFY 回显了问题
// 响应头没写字符集，老版本 Annulo 读到的是乱码，先 fixMojibake。
// 回答里没有 [n] 这种引用标记，豆包在正文里写「来源：xx《标题》」：网页的标题出现在回答里就算引用了（近似）。
// 没登录、在「豆包工作」（企业空间）里时打不开普通对话，见 MAINTAIN.md「豆包」一节。

import { type Answer, type Source, dedupe, fail, fixMojibake, responseMatching } from './_aichat_common'

export const DOUBAO = {
  id: 'doubao',
  name: '豆包',
  url: 'https://www.doubao.com/chat/',
  verified: '2026-10-14',
  ask,
}

const API = 'doubao.com/chat/completion'
const SEL = {
  input: '.tiptap.ProseMirror', // 输入框（contenteditable）
}

async function ask(b: any, question: string, opt: { timeout?: number; raw?: boolean } = {}): Promise<Answer> {
  b.listen(API)
  await b.goto(DOUBAO.url) // 新对话
  try {
    await b.waitFor(SEL.input, { timeout: 20000 })
  } catch {
    if (await loggedOut(b)) fail('login', '豆包没登录：到这个 Chrome 里登录 www.doubao.com')
    fail('changed', `豆包页面上找不到输入框（${SEL.input}）`)
  }
  if (await loggedOut(b)) fail('login', '豆包没登录：到这个 Chrome 里登录 www.doubao.com')
  if (String(await b.eval(() => document.title)).includes('豆包工作')) {
    fail('login', '豆包打开的是「豆包工作」（企业空间）：到这个 Chrome 里的豆包切到个人账号，或者换一个个人账号登录')
  }
  await b.type(SEL.input, question)
  await b.press('Enter')
  const t0 = Date.now()
  // 打开豆包时页面会给上一段对话补拉一次同一个接口：取流里回显了这次问题的那个
  const probe = question.slice(0, 20)
  let r: any
  try {
    r = await responseMatching(b, API, (x) => fixMojibake(x.text).includes(probe), opt.timeout || 180000)
  } catch {
    fail('timeout', '豆包等了太久还没回答完')
  }
  if (r.status === 429) fail('limited', '豆包限流了（HTTP 429），过一会儿再试')
  if (r.status !== 200) fail('changed', `豆包接口返回 HTTP ${r.status}`)
  const text = fixMojibake(r.text)
  const out = parse(text)
  if (/算力紧张|开通.{0,4}订阅|请稍后再试/.test(out.answer) && out.answer.length < 200) fail('limited', `豆包没回答：${out.answer.slice(0, 60)}`)
  if (!out.answer) fail('empty', `豆包没有返回回答。接口返回的开头：${String(text).slice(0, 300)}`)
  return { site: DOUBAO.id, ...out, ms: Date.now() - t0, url: String(await b.url()), ...(opt.raw ? { raw: text } : {}) }
}

async function loggedOut(b: any) {
  return !!(await b.eval(() =>
    [...document.querySelectorAll('button,[role=button],a')].some((e: any) => e.offsetParent && /^(登录|登 录|Log in|Sign in)$/.test((e.innerText || '').trim())),
  ))
}

/** 解析 SSE。导出给离线检查用 */
export function parse(text: string) {
  let answer = ''
  const searches: string[] = []
  const sources: Source[] = []
  let event = ''
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (!line.startsWith('data:')) continue
    let d: any
    try {
      d = JSON.parse(line.slice(5))
    } catch {
      continue
    }
    if (event === 'CHUNK_DELTA') answer += d.text || ''
    else if (event === 'STREAM_CHUNK') {
      for (const op of d.patch_op || []) {
        for (const blk of op.patch_value?.content_block || []) {
          const c = blk.content || {}
          if (c.text_block) answer += c.text_block.text || ''
          if (c.search_query_result_block) {
            const s = c.search_query_result_block
            for (const q of s.queries || []) searches.push(q)
            for (const x of s.results || []) {
              const card = x.text_card
              if (card?.url) sources.push({ n: card.index, url: card.url, title: card.title || '', site_name: card.sitename, cited: false })
            }
          }
        }
      }
    }
  }
  answer = answer.trim()
  // 没有引用标记：标题的主要部分（去掉「- 雨果网」这类后缀）出现在回答里就算引用了
  for (const s of sources) {
    const core = s.title.split(/\s*[-|_｜—]\s*/).sort((a, b) => b.length - a.length)[0] || ''
    s.cited = core.length >= 6 && answer.includes(core)
  }
  return { answer, sources: dedupe(sources), searches, search: searches.length > 0 }
}
