// 页面调 App 本机接口的封装（/_shuttle/api/…，新名字 /_annulo/api/… 也一样）。只在 App 里打开时能用。

const API = '/_shuttle/api/'
const HEADERS = { 'X-Shuttle': '1' }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { ...HEADERS, 'content-type': 'application/json', ...init.headers } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export type Row = { id: string; created_at?: string; updated_at?: string }

/** 业务表（tables/<表>.json 里声明的，和装了的插件的表，比如 social_accounts）才能读写 */
export const db = {
  list: <T = Record<string, unknown>>(table: string) => call<{ list: (T & Row)[] }>(`db/${table}`).then((r) => r.list ?? []),
  create: <T = Record<string, unknown>>(table: string, row: Record<string, unknown>) => call<T & Row>(`db/${table}`, { method: 'POST', body: JSON.stringify(row) }),
  update: (table: string, id: string, patch: Record<string, unknown>) => call(`db/${table}?id=${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (table: string, id: string) => call(`db/${table}?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export type Progress = { done?: number; total?: number; message?: string }

/** 跑本机函数（local/<文件>.ts 的 <函数>；插件的写成 <插件>/<文件>.<函数>，比如 social/social.publish），返回它的结果；onProgress 收进度 */
export async function runLocal<T = unknown>(fn: string, input: unknown = {}, onProgress?: (p: Progress) => void): Promise<T> {
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

// ---- 任务（tasks/<id>.md）：要 AI 想、要写的活，开一段对话交给右侧的助手，过程看得见 ----

export type TaskRun = { task: string; chat_id: string; input?: any; started_at: string; ok?: boolean; error?: string }
export type Task = {
  id: string
  name: string
  description?: string
  /** 「怎么写」：用户改过的（user/prompts/<id>.md）优先，否则是模板默认的（prompts/<id>.md） */
  prompt: string
  prompt_file?: string
  prompt_custom?: boolean
  prompt_has_default?: boolean
  running: TaskRun[]
  last?: TaskRun
}

const taskPath = (id: string) => `local/tasks/${encodeURIComponent(id)}`
export const tasks = {
  list: () => call<{ list: Task[] }>('local/tasks').then((r) => r.list ?? []),
  get: (id: string) => call<Task>(taskPath(id)),
  run: (id: string, input?: unknown) => call<{ chat_id: string; task: Task }>(`${taskPath(id)}/run`, { method: 'POST', body: JSON.stringify({ input: input ?? null }) }),
  savePrompt: (id: string, prompt: string) => call<Task>(taskPath(id), { method: 'PUT', body: JSON.stringify({ prompt }) }),
  resetPrompt: (id: string) => call<Task>(taskPath(id), { method: 'PUT', body: JSON.stringify({ reset_prompt: true }) }),
}

/** 交给右侧的助手一句话：新开一段对话在后台跑，返回对话 id */
export const ask = (text: string) => call<{ chat_id: string }>('local/ask', { method: 'POST', body: JSON.stringify({ text }) })

/** 在右侧打开一段对话 */
export const openChat = (chat_id: string) => window.parent.postMessage({ type: 'shuttle:open-chat', chat_id }, location.origin)

/** 打开 App 的设置（比如 'backend'：设置 → 项目，装插件在那里） */
export const openSettings = (section: string) => window.parent.postMessage({ type: 'shuttle:navigate', view: 'settings', hash: '#' + section }, location.origin)

/** 助手改了表（或别处改了数据）时外壳会通知页面刷新：订阅它，返回取消订阅 */
export function onRefresh(fn: () => void) {
  const on = (e: MessageEvent) => e.origin === location.origin && ['shuttle:refresh', 'annulo:refresh'].includes(e.data?.type) && fn()
  addEventListener('message', on)
  return () => removeEventListener('message', on)
}
