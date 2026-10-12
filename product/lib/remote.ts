// 后台不在 Shuttle 里打开（手机、别的电脑上的预览域名）时，本机函数在哪跑、按钮能不能点。
//
// 模板代码不用直接用这里：页面调本机函数一律 runLocal(fn, input, onEvent)（lib/shuttle.ts）或 <RunButton fn>、<Button fn>，
// 要在手机上也能用，就在函数文件里声明 export const cloud（云端跑，只用 ctx.db）或 export const remote（转给电脑跑）。
// 其余——走本机还是云端、转给电脑、进度、灰掉、报错——都在这里和 lib/useShuttle.ts。
//
// 这个文件不 import lib/shuttle.ts（lib/shuttle.ts 引它），免得循环引用。

import { invoke } from 'talizen/func'
import { isEn, tr } from './i18n'

/** 是否嵌在 Shuttle 里（能把事情交给右侧的运营助手） */
export function inShuttle() {
  if (typeof window === 'undefined') return false
  try {
    return window.parent !== window && window.parent.location.origin === window.location.origin
  } catch {
    return false
  }
}


export class ShuttleUnavailable extends Error {}

/**
 * 确定这里没有 Shuttle：不在 Shuttle 的 iframe 里、也不是从本机地址打开的（手机、别的电脑上的预览域名），
 * 或者已经碰到过一次不是 Shuttle 的回复。这时不再请求 /_shuttle/api（预览域名上每个都是白跑的 404），直接走站点 Func。
 */
export function shuttleMissing() {
  if (typeof window === 'undefined') return false
  if (shuttleOnline === false) return true
  return !inShuttle() && !/^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(window.location.hostname)
}

let shuttleOnline: boolean | undefined
/** runLocal 记下连没连上本机 Shuttle：碰到一次不是 Shuttle 的回复，之后就不再试 */
export const markShuttle = (online: boolean) => { shuttleOnline = online }

// ---- 没登录 ----
// 本机函数文件里 export const cloud = [...] 列出的函数，annulo push 时打包成站点 Func local/<文件>（Shuttle 的 internal/localfn/cloud.go），
// 手机上打开后台时 runLocal 改调它；没列的照旧抛 ShuttleUnavailable（要在电脑上的 Shuttle 里做）。
// 云端版本只给项目成员调：没登录抛 MemberLoginRequired，页面放一个去登录的入口（memberLoginURL）。

/** 不在 Shuttle 里、也没登录成项目成员：登录后手机上也能看 */
export class MemberLoginRequired extends ShuttleUnavailable {}

/** 站点上的成员登录（creght 平台账号），登录完回到现在这页 */
export const memberLoginURL = () => '/auth/member/login?redirect=' + encodeURIComponent(typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search)


/** 「要在电脑上的 Shuttle 里做」的那句报错：界面上显示成灰色说明，不当成出错（components/ui.tsx） */
export const isNeedsShuttle = (message: string) => message === tr('meta.err.not_from_shuttle') || message === tr('meta.err.no_shuttle') || message === tr('meta.err.computer_offline')

/** 调站点 Func：没登录成项目成员时抛 MemberLoginRequired */
export async function memberInvoke(key: string, input: unknown, opts?: { timeoutMS?: number; onEvent?: (e: { event: string; data: any }) => void }): Promise<unknown> {
  try {
    return await invoke(key, input, opts)
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (/member_login_required/.test(msg)) throw new MemberLoginRequired(tr('meta.err.member_login'))
    // remote 的函数转给电脑跑（ctx.shuttle.call），电脑上的 Shuttle 没开着
    if (/shuttle_offline/.test(msg)) throw new ShuttleUnavailable(tr('meta.err.computer_offline'))
    // 电脑上执行报的错：平台带了 shuttle_error 前缀，给用户只看原因，和在电脑上点按钮报的一样
    // 平台转出来的样子是「promise rejected: GoError: shuttle_error: <原因>」
    if (/shuttle_error:/.test(msg)) throw new Error(msg.replace(/^[\s\S]*?shuttle_error:\s*/, ''))
    throw e
  }
}

// ---- 不在 Shuttle 里：哪些本机函数能调 ----
// annulo push 生成清单 local/_manifest（Shuttle 的 internal/localfn/cloud.go）：本机函数文件里 export const cloud 的在云端跑，随时能调；
// export const remote 的（发布、采集）转给项目所有者电脑上开着的 Shuttle 跑（Shuttle 的 internal/relay），电脑在线才能调；别的要回电脑上的 Shuttle 里做。
// 按钮（RunButton fn、Button fn）按函数名查它（lib/useShuttle.ts useCanRun），按钮上不用另外标。

export type FnManifest = { cloud: string[]; remote: string[] }
let manifest: Promise<FnManifest | null> | null = null
/** 函数清单，查一次缓存起来；读不到（没登录、还没 annulo push 过）是 null */
export function fnManifest(): Promise<FnManifest | null> {
  if (!manifest) {
    manifest = memberInvoke('local/_manifest.get', {})
      .then((m: any) => ({ cloud: m?.cloud ?? [], remote: m?.remote ?? [] }))
      .catch(() => null)
  }
  return manifest
}

/** 电脑在不在线；remote 是电脑报上来的、这个项目里能转给它跑的函数（平台还没带这个字段时是 undefined，用清单里的兜底） */
export type ComputerStatus = { online: boolean; name?: string; remote?: string[] }
let computer: Promise<ComputerStatus> | null = null
/** 项目所有者的电脑上 Shuttle 开着没有（backend/func/shuttle.ts online）；查一次缓存起来，refresh 重新查 */
export function computerStatus(refresh = false): Promise<ComputerStatus> {
  if (!computer || refresh) {
    computer = memberInvoke('shuttle.online', {})
      .then((r: any) => ({ online: !!r?.online, name: r?.machines?.[0]?.name, remote: r?.machines?.[0]?.remote }))
      .catch(() => ({ online: false }))
  }
  return computer
}

/** 这些函数里哪些能转给电脑跑：电脑在线时，看它报上来的列表（没有就看清单 local/_manifest 的 remote） */
export function remoteFns(m: FnManifest | null, c: ComputerStatus | null): string[] {
  if (!c?.online) return []
  return c.remote ?? m?.remote ?? []
}

// 页面开着时电脑可能断开、也可能刚打开远程访问：有人在看就每 15 秒、页面回到前台时重新查，所有按钮共用一份
const watchers = new Set<(s: ComputerStatus) => void>()
let lastComputer: ComputerStatus | null = null
let watchTimer: ReturnType<typeof setInterval> | undefined
const recheck = () => computerStatus(true).then((s) => { lastComputer = s; watchers.forEach((w) => w(s)) })
const onVisible = () => { if (document.visibilityState === 'visible') void recheck() }
/** 订阅电脑在线状态，返回取消订阅 */
export function watchComputer(listener: (s: ComputerStatus) => void): () => void {
  watchers.add(listener)
  if (lastComputer) listener(lastComputer)
  if (watchers.size === 1) {
    void recheck()
    watchTimer = setInterval(recheck, 15_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
  }
  return () => {
    watchers.delete(listener)
    if (watchers.size) return
    clearInterval(watchTimer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
  }
}

export async function runCloud<T>(fn: string, input: unknown, unavailable: ShuttleUnavailable, onEvent?: (e: { type: 'progress'; data: any }) => void): Promise<T> {
  // 插件的函数（social/social.check）：云端站点 Func 名里的 / 换成 __（local/social__social.check）
  const [file, method] = fn.replace('/', '__').split('.')
  const m = await fnManifest()
  const locale = isEn() ? 'en' : 'zh'
  try {
    // 在云端跑的（cloud）：annulo push 生成的站点 Func local/<文件>
    if (m?.cloud.includes(fn)) return (await memberInvoke(`local/${file}.${method}`, { input, locale }, { timeoutMS: 60000 })) as T
    // 转给电脑跑的（remote）：模板的 backend/func/shuttle.ts call。平台把 Shuttle 的进度推成 progress 事件，交给同一个 onEvent，按钮上的进度和在电脑上一样
    if (remoteFns(m, await computerStatus()).includes(fn)) {
      const progress = onEvent && ((e: { event: string; data: any }) => { if (e.event === 'progress') onEvent({ type: 'progress', data: e.data }) })
      return (await memberInvoke('shuttle.call', { fn, input }, { timeoutMS: 295000, ...(progress ? { onEvent: progress } : {}) })) as T
    }
    throw unavailable
  } catch (e: any) {
    if (e === unavailable) throw e
    if (e instanceof MemberLoginRequired) throw e
    const msg = String(e?.message ?? e)
    // 这个函数没有云端版本（没列在 cloud 里，或者还没 annulo push）：和以前一样要回 Shuttle 里做
    if (/func not found|must define method|404/i.test(msg)) throw unavailable
    throw e instanceof Error ? e : new Error(msg)
  }
}

// ---- 手机上用电脑上的助手 ----
// 电脑上的 Shuttle 开着远程访问时，除了本机函数，还报几个内置函数（Shuttle 能力版本 22，它的 internal/server/remoteai.go）：
// _shuttle.chats 对话列表、_shuttle.chat 一段对话（已存的消息 + 正在跑的这一轮的快照，不推流，轮询它）、_shuttle.send 发消息、
// _shuttle.abort 停止、_shuttle.tasks 任务列表、_shuttle.task 跑任务。只对电脑上正在打开的那个项目开放。

/** 电脑报上来的函数里有它，就说明手机上能用助手 */
export const AI_SEND = '_shuttle.send'

/** 调电脑上的助手函数（经站点 Func shuttle.call） */
export function remoteAI<T>(fn: string, input?: unknown): Promise<T> {
  return memberInvoke('shuttle.call', { fn, input: input ?? {} }, { timeoutMS: 60000 }) as Promise<T>
}

/** 电脑在线、并且能把助手交给手机用 */
export const assistantOnline = (c: ComputerStatus | null) => !!c?.online && !!c.remote?.includes(AI_SEND)
