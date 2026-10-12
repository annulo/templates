import { tr } from './i18n'

// 页面上发起的一次本机函数运行（runLocal 的 onStart 给的运行 id）：停止、把它的浏览器窗口调到前台。
// 窗口要能调出来，runLocal 要带 { browser: 'offscreen' }（无界面跑的没有窗口）。Annulo 能力版本 35 起有 show。

async function runAction(id: string, action: 'abort' | 'show') {
  const res = await fetch(`/_shuttle/api/local/runs/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: { 'X-Shuttle': '1' } })
  if (res.status === 404 && action === 'show') throw new Error(tr('article.pub_show_old'))
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
}

/** 停掉这次运行：这次打开的浏览器一起关掉 */
export const stopRun = (id: string) => runAction(id, 'abort')
/** 把这次运行正开着的浏览器窗口调到前台 */
export const showRun = (id: string) => runAction(id, 'show')
