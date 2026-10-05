// 页面调 App 本机接口的封装（/_shuttle/api/…，新名字 /_annulo/api/… 也一样）。只在 App 里打开时能用。

const API = '/_shuttle/api/'
const HEADERS = { 'X-Shuttle': '1' }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { ...HEADERS, 'content-type': 'application/json', ...init.headers } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

/** 业务表（tables/<表>.json 里声明的才能读写） */
export const db = {
  list: <T = Record<string, unknown>>(table: string) => call<{ list: (T & { id: string; created_at?: string })[] }>(`db/${table}`).then((r) => r.list ?? []),
  create: (table: string, row: Record<string, unknown>) => call<{ id: string }>(`db/${table}`, { method: 'POST', body: JSON.stringify(row) }),
  update: (table: string, id: string, patch: Record<string, unknown>) => call(`db/${table}?id=${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (table: string, id: string) => call(`db/${table}?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

/** 跑本机函数（local/<文件>.ts 的 <函数>），返回它的结果；onProgress 收进度 */
export async function runLocal<T = unknown>(fn: string, input: unknown = {}, onProgress?: (p: { done?: number; total?: number; message?: string }) => void): Promise<T> {
  const res = await fetch(API + 'local/run', { method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' }, body: JSON.stringify({ fn, input }) })
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).replace(/^data: /, '')
      buf = buf.slice(i + 2)
      const ev = JSON.parse(line)
      if (ev.type === 'progress') onProgress?.(ev.data)
      if (ev.type === 'result') return ev.data?.value as T
      if (ev.type === 'error') throw new Error(typeof ev.data === 'string' ? ev.data : ev.data?.message)
    }
  }
  throw new Error('本机函数没有返回结果')
}

/** 交给右侧的助手：新开一段对话在后台跑，返回对话 id */
export const ask = (text: string) => call<{ chat_id: string }>('local/ask', { method: 'POST', body: JSON.stringify({ text }) })

/** 在右侧打开一段对话 */
export const openChat = (chat_id: string) => window.parent.postMessage({ type: 'shuttle:open-chat', chat_id }, location.origin)
