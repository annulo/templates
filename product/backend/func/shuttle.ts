import type { TalizenFuncContext } from 'talizen/func-runtime'

// 手机、别的电脑上打开后台时，调到项目所有者电脑上的 Shuttle（平台的 ctx.shuttle，Shuttle 的 internal/relay）：
//   online：电脑在不在线、叫什么、这台电脑上这个项目哪些函数能被调（本机函数文件里 export const remote 的）——页面据此决定按钮能不能点；
//   call：把一次本机函数调用转给电脑跑，进度推回页面（流式调用时）。能不能执行由电脑上的 Shuttle 按 remote 声明把关。
// 页面不直接调它：lib/remote.ts 的 runCloud、computerStatus。

// 发布一次可能一两分钟：Func 默认几秒就超时，放到上限
export const config = { timeoutMs: 300000 }

export function online(_input: unknown, ctx: TalizenFuncContext) {
  ctx.member.require()
  return (ctx as any).shuttle.online()
}

export function call(req: { fn?: string; input?: unknown }, ctx: TalizenFuncContext) {
  ctx.member.require('owner') // 等于让手机触发电脑上的浏览器、密钥去做事：只给项目所有者
  // 文件.函数（插件的是 插件/文件.函数，比如 social/social.publish）；_shuttle.* 是 Shuttle 内置的助手函数（看对话、发消息、跑任务，见 lib/remote.ts remoteAI）
  if (typeof req?.fn !== 'string' || !/^(([a-z][a-z0-9]{1,19}\/)?[a-z0-9][a-z0-9_-]*|_shuttle)\.[A-Za-z_$][A-Za-z0-9_$]*$/.test(req.fn)) throw new Error('fn 要写成 文件.函数')
  return (ctx as any).shuttle.call(req.fn, req.input, { timeoutMs: 290000 })
}
