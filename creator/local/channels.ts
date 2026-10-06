// 账号和数据（本机函数）：自媒体工作台只有社媒账号，账号在社媒插件的 social_accounts 表（外贸模板的 channels.ts 去掉了网站）。
//
//   channels.remove({ id })               删掉一个账号
//   channels.stats({ days })              各账号近 days 天的汇总：social 是社媒（社媒插件的 social/stats.summary：粉丝和互动），读失败的在 failed；
//                                         list、no_stats 留着和外贸模板同一个返回结构（这里总是空）
//
// 页面用 lib/shuttle.ts 里的封装（removeChannel / channelStats）。

import { L } from './_i18n'
// 社媒的数据由社媒插件算（github.com/annulo/plugins 的 social，装在 plugins/social/）：和社媒页显示的是同一份
import { summary as socialSummary } from '../plugins/social/local/stats'

// 手机上打开后台（不在 Annulo 里）时也能用：annulo push 会把它打包成站点 Func，只能用 ctx.db、ctx.locale
export const cloud = ['stats']
// 要电脑的：手机上点了转给电脑上开着的 Annulo 跑（设置 → 远程访问）
export const remote = ['remove']

type Channel = { id: string; type: string; name: string }

export function remove(input: { id: string }, ctx: any) {
  if (!input?.id) throw new Error(L(ctx, '缺 id', 'Missing id'))
  ctx.db.delete('social_accounts', input.id)
  return { ok: true }
}

/** 社媒账号（社媒插件的表）；插件还没装时是空的 */
function socialAccounts(ctx: any): Channel[] {
  try {
    return ctx.db.query('social_accounts', { limit: 1000 }).list
  } catch {
    return []
  }
}

export async function stats(input: { days?: number }, ctx: any) {
  const days = input?.days ?? 30
  // 读失败的不填 0（填了会被当成「没有数据」），列在 failed
  const social = []
  const failed = []
  for (const c of socialAccounts(ctx)) {
    try {
      const { top, ...s } = socialSummary({ channel_id: c.id, days }, ctx)
      social.push({ id: c.id, name: c.name, type: c.type, ...s, top: top.slice(0, 3).map((p) => ({ title: p.title, views: p.views, gain: p.gain })) })
    } catch (e: any) {
      failed.push({ id: c.id, name: c.name, type: c.type, error: e.message })
    }
  }
  return { list: [], social, no_stats: [], failed }
}
