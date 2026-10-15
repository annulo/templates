// 没保存的修改先存在这台电脑的浏览器里：退出、切页面、刷新、App 意外关掉都不丢，下次打开自动恢复（保存、取消后删掉）。
// base 是开始改时那条记录的 updated_at：恢复时比一下，那边在这期间被改过（AI 改了）就提醒用户保存会盖掉。

const key = (k: string) => `annulo.unsaved:${k}`

export type Unsaved<T> = { value: T; base: string; at: number }

export function readUnsaved<T>(k: string): Unsaved<T> | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(k)) || 'null')
    return v && typeof v === 'object' && 'value' in v ? v : null
  } catch {
    return null
  }
}

export function writeUnsaved<T>(k: string, value: T, base: string) {
  try { localStorage.setItem(key(k), JSON.stringify({ value, base, at: Date.now() })) } catch { /* 存不了（隐私模式、满了）就算了 */ }
}

export function clearUnsaved(k: string) {
  try { localStorage.removeItem(key(k)) } catch {}
}
