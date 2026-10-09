import { useCallback, useEffect, useState } from 'react'
import { runLocal } from './shuttle'

export type ChecklistAction = { kind: 'go'; view: string; params?: Record<string, string> } | { kind: 'run'; fn: string; input?: unknown } | { kind: 'task'; task: string; input?: unknown }
export type ChecklistItem = { key: string; title: string; why: string; minutes?: number; wizard?: boolean; screen?: string; summary?: string; done: boolean; skipped?: boolean; running?: boolean; count?: number; action: ChecklistAction; action_label: string; ask?: { task: string; input?: unknown } }
export type ChecklistData = { wizard?: { steps: ChecklistItem[]; current: string | null; closed: boolean }; setup: ChecklistItem[]; current: string | null; done: number; total: number; daily: ChecklistItem[]; setup_hidden?: boolean }

/** 侧边栏进度和总览共用一次读取，完成任务后一起刷新。 */
export function useChecklist(rev: number) {
  const [data, setData] = useState<ChecklistData | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    return runLocal<ChecklistData>('today.list', {}).then((value) => {
      setData(value)
      setError('')
    }).catch((e: Error) => setError(e.message))
  }, [])
  // 不在 Shuttle 里（手机）也读：today.list 有云端版本（lib/shuttle.ts runCloud）
  useEffect(() => { load() }, [rev, load])
  return { data, error, load, setData, setError }
}

export type ChecklistState = ReturnType<typeof useChecklist>
