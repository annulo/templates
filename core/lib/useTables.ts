import { useEffect, useRef } from 'react'

/**
 * 这几张表变了就重读：听 window 的 db:changed（detail.table）。Annulo 每次写表（助手、本机函数、定时任务、别的页面）都会推一个
 * （能力版本 44），页面自己写表时 lib/shuttle.ts 也发。短时间里连着来的合成一次（delay 毫秒）。
 * rev 是老的「助手改了数据」信号（外壳的 shuttle:refresh）：变了也重读，和 db:changed 合在一起，不会读两遍。
 */
export function useTables(tables: string[], reload: () => void, rev?: number, delay = 200) {
  const fn = useRef(reload)
  fn.current = reload
  const timer = useRef(0)
  const kick = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => fn.current(), delay)
  }
  const key = tables.join(',')
  useEffect(() => {
    const names = key.split(',')
    const on = (e: Event) => {
      const t = (e as CustomEvent<{ table?: string }>).detail?.table
      if (!t || names.includes(t)) kick()
    }
    window.addEventListener('db:changed', on)
    return () => {
      window.removeEventListener('db:changed', on)
      window.clearTimeout(timer.current)
    }
  }, [key])
  const seen = useRef(rev)
  useEffect(() => {
    if (rev === seen.current) return
    seen.current = rev
    kick()
  }, [rev])
}
