import { useCallback, useEffect, useRef, useState } from 'react'
import { runLocal } from './shuttle'

export type ChecklistAction = { kind: 'go'; view: string; params?: Record<string, string> } | { kind: 'run'; fn: string; input?: unknown } | { kind: 'task'; task: string; input?: unknown }
export type ChecklistItem = { key: string; title: string; why: string; minutes?: number; wizard?: boolean; screen?: string; summary?: string; done: boolean; skipped?: boolean; running?: boolean; count?: number; action: ChecklistAction; action_label: string; page?: { view: string; params?: Record<string, string> }; ask?: { task: string; input?: unknown } }
export type ChecklistData = { wizard?: { steps: ChecklistItem[]; current: string | null; closed: boolean }; setup: ChecklistItem[]; current: string | null; done: number; total: number; daily: ChecklistItem[]; setup_hidden?: boolean }

/** 侧边栏进度和总览共用一次读取，完成任务后一起刷新。 */
export function useChecklist(rev: number) {
  const [data, setData] = useState<ChecklistData | null>(null)
  const [error, setError] = useState('')
  // 同一时间只读一次：today.list 要查十几张表，在线项目一次几秒。正在读时再叫，就等这次读完再读一次（拿到这之后的改动），
  // 中间叫多少次都并成这一次。不并的话请求会叠起来，占满浏览器对本机的 6 个连接，Annulo 和页面别的请求都卡在 Pending
  const inflight = useRef<Promise<void> | null>(null)
  const again = useRef<Promise<void> | null>(null)
  const load = useCallback(function read(): Promise<void> {
    if (inflight.current) {
      again.current ??= inflight.current.then(() => {
        again.current = null
        return read()
      })
      return again.current
    }
    const p = runLocal<ChecklistData>('today.list', {}).then((value) => {
      setData(value)
      setError('')
    }).catch((e: Error) => setError(e.message)).finally(() => { inflight.current = null })
    inflight.current = p
    return p
  }, [])
  // 不在 Shuttle 里（手机）也读：today.list 有云端版本（lib/shuttle.ts runCloud）
  useEffect(() => { load() }, [rev, load])
  return { data, error, load, setData, setError }
}

export type ChecklistState = ReturnType<typeof useChecklist>
