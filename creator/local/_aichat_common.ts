// aichat 共用的东西：结果的格式、错误码、解析流式接口的小工具。
// 来自 https://github.com/annulo/references 的 aichat/。改了这里，各网站的文件都用得到。

/** 一次提问的结果。各网站尽量填全，拿不到的留空 */
export type Answer = {
  site: string // 网站 id：deepseek、doubao…
  answer: string // 回答正文（Markdown），引用标记统一成 [1] [2]
  sources: Source[] // 网页搜索的结果，按网站给的顺序
  searches: string[] // 网站这次搜了哪些词
  search: boolean // 这次有没有联网搜索
  ms: number // 从发出问题到回答完用了多久
  url: string // 这段对话的地址，方便人回去看
  raw?: string // ask 传 raw: true 时：接口的原始流（排查用）
}

export type Source = {
  n?: number // 网站给的编号，回答里的 [n] 对应它
  url: string
  title: string
  site_name?: string
  snippet?: string
  cited: boolean // 回答里引用了它
}

/**
 * 出错时 throw 的 Error 带 code，调用方据此决定怎么办：
 * - login：没登录或者登录过期，提醒用户到那个 Chrome 里登录，不要重试；
 * - limited：网站限流、繁忙、要付费，过一会儿再试；
 * - timeout：等太久没回答完；
 * - changed：页面或接口和这份代码对不上了（网站改版），照 MAINTAIN.md 排查；
 * - empty：问出去了但没拿到回答。
 */
export type ErrorCode = 'login' | 'limited' | 'timeout' | 'changed' | 'empty'

export function fail(code: ErrorCode, message: string): never {
  const e: any = new Error(`[${code}] ${message}`)
  e.code = code
  throw e
}

/**
 * 等接口里满足 match 的那个响应：同一个接口页面上可能还有别的请求（比如豆包打开时会给上一段对话补拉一次），
 * 拿到的第一个不一定是这次提问的。b.responses 每次返回到目前为止抓到的全部，没有就多等一条。超时 throw。
 */
export async function responseMatching(b: any, api: string, match: (r: any) => boolean, timeout: number): Promise<any> {
  const deadline = Date.now() + timeout
  let min = 1
  for (;;) {
    const left = deadline - Date.now()
    if (left <= 0) throw new Error('timeout')
    const list: any[] = await b.responses(api, { min, timeout: left })
    const hit = list.find(match)
    if (hit) return hit
    min = list.length + 1
  }
}

/** 流式接口（SSE）的文本 → 每条 data 的 JSON，解析不了的跳过 */
export function sseData(text: string): any[] {
  const out: any[] = []
  for (const line of String(text || '').split('\n')) {
    if (!line.startsWith('data:')) continue
    const raw = line.slice(5).trim()
    if (!raw || raw === '[DONE]') continue
    try {
      out.push(JSON.parse(raw))
    } catch {}
  }
  return out
}

// Windows-1252 里 0x80~0x9F 对应的字符（别的字节和 Latin-1 一样，码点就是字节值）
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

/**
 * 修乱码：响应头没写字符集时（比如豆包的流），Chrome 把 UTF-8 按 Windows-1252 解码，中文变成「å¹´æœ‰」。
 * 新版 Annulo 的 b.responses 已经修了；这里兜底给老版本。整段能编回字节、而且是合法 UTF-8 才改，否则原样返回。
 */
export function fixMojibake(text: string): string {
  const s = String(text || '')
  if (!/[\u0080-\u00ff]/.test(s)) return s
  const bytes: number[] = []
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c < 0x100) bytes.push(c)
    else if (CP1252[ch] != null) bytes.push(CP1252[ch])
    else return s // 有 Windows-1252 里没有的字符：不是这种乱码
  }
  try {
    return decodeURIComponent(bytes.map((b) => '%' + b.toString(16).padStart(2, '0')).join(''))
  } catch {
    return s // 不是合法的 UTF-8
  }
}

/** 回答里引用了哪些编号：[1]、[citation:1]、【1】 都算 */
export function citedNumbers(answer: string): Set<number> {
  const set = new Set<number>()
  const re = /\[(?:citation:)?(\d+)\]|【(\d+)】/g
  let m: RegExpExecArray | null
  while ((m = re.exec(answer))) set.add(Number(m[1] || m[2]))
  return set
}

/**
 * 从一段文本里依次取出完整的 JSON 对象（按花括号配对，跳过字符串里的括号）。
 * 给不是一行一条的流用：比如 Kimi 的 Connect 流，每条前面是 5 个字节的二进制头，读成文本后长度字节是乱码，按长度切不了。
 */
export function jsonObjects(text: string): any[] {
  const out: any[] = []
  const s = String(text || '')
  let i = 0
  while (i < s.length) {
    if (s[i] !== '{') {
      i++
      continue
    }
    let depth = 0
    let j = i
    let inStr = false
    let esc = false
    for (; j < s.length; j++) {
      const c = s[j]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
      } else if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) break
    }
    try {
      out.push(JSON.parse(s.slice(i, j + 1)))
      i = j + 1
    } catch {
      i++ // 帧头的长度字节恰好是 { 时会从假的括号开始配对：往后挪一个字符重试
    }
  }
  return out
}

/** 网址去掉 #片段 再比较，同一个网页只留一条 */
export function dedupe(list: Source[]): Source[] {
  const seen = new Set<string>()
  return list.filter((s) => {
    const key = s.url.replace(/#.*$/, '')
    if (!s.url || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
