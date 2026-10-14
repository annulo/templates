import { useEffect, useState } from 'react'
import { assistantOnline, fnManifest, inShuttle, remoteFns, shuttleMissing, watchComputer, type ComputerStatus, type FnManifest } from './remote'

/**
 * 这个本机函数（文件.函数）在这里能不能调：在 Shuttle 里都能；不在的话看函数清单（lib/shuttle.ts fnManifest）——
 * cloud 的能，remote 的电脑在线、并且电脑报上来能调才能，别的不能。挂载后才判断（服务端渲染时是 false，和首屏一致）。
 */
export function useCanRun(fn?: string) {
  const all = useCanRunAll(fn ? [fn] : [])
  return !!fn && !!all[fn]
}

/** 一次判断多个函数（一行一个网站、一个账号的列表用）：{ 函数名: 能不能调 } */
export function useCanRunAll(fns: string[]): Record<string, boolean> {
  const key = fns.join(',')
  const [ok, setOk] = useState<Record<string, boolean>>({})
  useEffect(() => {
    const list = key ? key.split(',') : []
    if (!list.length) return
    if (!shuttleMissing()) { setOk(Object.fromEntries(list.map((f) => [f, true]))); return }
    let alive = true
    let m: FnManifest | null = null
    let c: ComputerStatus | null = null
    const apply = () => {
      if (!alive) return
      const remote = remoteFns(m, c)
      setOk(Object.fromEntries(list.map((f) => [f, !!m?.cloud.includes(f) || remote.includes(f)])))
    }
    fnManifest().then((x) => { m = x; apply() })
    const stop = watchComputer((s) => { c = s; apply() })
    return () => { alive = false; stop() }
  }, [key])
  return ok
}

/**
 * 页面是不是嵌在 Shuttle 里——渲染时用它，不要直接调 inShuttle()。
 * 服务端渲染时 inShuttle() 总是 false、浏览器里是 true，直接用会让首屏和服务端对不上：
 * 多渲染一块会报 hydration 错误（React #418），只差属性的话按钮会一直停在服务端的禁用状态。
 * 这里先和服务端一样返回 false，挂载后再变成真实值。事件处理、useEffect 里照常用 inShuttle()。
 */
export function useInShuttle() {
  const [ok, setOk] = useState(false)
  useEffect(() => setOk(inShuttle()), [])
  return ok
}

/**
 * 这里能不能把活交给助手（TaskButton、AskButton、手机上的「助手」页）：在 Shuttle 里都能；
 * 不在的话（手机）要电脑在线、开着远程访问，电脑上的 Shuttle 够新（报上来的函数里有 _shuttle.send）。和 useInShuttle 一样挂载后才判断。
 */
export function useAssistant() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    if (!shuttleMissing()) { setOk(true); return }
    return watchComputer((c) => setOk(assistantOnline(c)))
  }, [])
  return ok
}
