// 网站的文章发布设置（本机函数）。字段映射全在助手写的发布脚本 local/pub_<网站 id>.ts 里（见 local/_publish.ts），
// 这里只记「这个网站能不能发」：助手按任务 tasks/setup-publish.md 写好脚本、试发确认后调 ready；没 ready 的网站页面上不让发，只引导去让助手配置。
//
//   publishing.ready({ channel_id, publisher, note, collection? })
//                                                        配好了：publisher 是脚本文件名（pub_<网站 id>），note 是给用户看的一句说明，
//                                                        collection 是 creght 站点上文章所在的 CMS 集合（写文章时读已有文章学写法）
//   publishing.reset({ channel_id, reason? })            标成要重新配置（网站的 CMS 改了、脚本坏了）
//   publishing.publishScheduled({ id })                  定时任务：一条到点的网站排期（publications 的 id），跑那个网站的发布脚本
//   publishing.remove({ id })                            把发到网站的那篇从网站上删掉（publications 的 id），再删这条发布记录：
//                                                        发布脚本导出了 remove 就用它；没有的话 creght 站点按记录里的集合和内容 id 删，别的网站报错让用户去后台删

import { L } from './_i18n'
import { deleteContent } from './_creght'

const SITE_TYPES = ['creght_site', 'wordpress']

export function ready(input: { channel_id: string; publisher: string; note: string; collection?: string }, ctx: any) {
  const ch = ctx.db.get('channels', input?.channel_id)
  if (!ch || !SITE_TYPES.includes(ch.type)) throw new Error(L(ctx, 'channel_id 要是一个网站（creght 站点或 WordPress）', 'channel_id must be a site (creght or WordPress)'))
  const publisher = String(input.publisher ?? '').trim()
  if (!/^pub_[A-Za-z0-9_]+$/.test(publisher)) throw new Error(L(ctx, 'publisher 要写发布脚本的文件名，比如 pub_12（对应 local/pub_12.ts）', 'publisher must be the script file name, e.g. pub_12 (local/pub_12.ts)'))
  if (!String(input.note ?? '').trim()) throw new Error(L(ctx, 'note 要写一句给用户看的说明：发到哪个集合、字段怎么对应、文章地址', 'note must briefly tell the user where articles go and how fields map'))
  ctx.db.update('channels', ch.id, {
    publisher,
    publish_status: 'ready',
    publish_note: String(input.note).trim(),
    publish_checked_at: new Date().toISOString(),
    ...(input.collection ? { article_collection: String(input.collection) } : {}),
  })
  return { channel: ch.name, publisher }
}

export function reset(input: { channel_id: string; reason?: string }, ctx: any) {
  const ch = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个网站：', 'No such site: ') + input?.channel_id)
  ctx.db.update('channels', ch.id, { publish_status: 'broken', publish_note: String(input?.reason ?? '').trim() || ch.publish_note || '', publish_checked_at: new Date().toISOString() })
  return { channel: ch.name }
}

declare const require: (path: string) => any

/**
 * 发一条到点的网站排期（定时任务 schedules/publishing.publishScheduled.json 调用：Annulo 按 publications.scheduled_at 到点逐条调它）。
 * 发布脚本 local/pub_<网站 id>.ts 按 channels.publisher 找（打包时把所有 pub_*.ts 带上）。
 * publishTo 开始发时清掉 scheduled_at，失败记在发布记录上；这里只处理脚本都跑不起来的情况。
 */
export async function publishScheduled(input: { id: string }, ctx: any) {
  const p = ctx.db.get('publications', input?.id)
  if (!p?.scheduled_at || p.status === 'publishing') return { skipped: L(ctx, '已经不在排期里', 'No longer scheduled') }
  const fail = (error: string) => {
    // 发过的还是 published（这次是更新没做成），没发过的记失败
    ctx.db.update('publications', p.id, { status: p.status === 'published' ? 'published' : 'failed', scheduled_at: '', error, updated_at: new Date().toISOString() })
    throw new Error(error)
  }
  const ch = ctx.db.get('channels', p.channel_id)
  if (!ch) return fail(L(ctx, '这个网站已经不在了', 'This site no longer exists'))
  if (ch.publish_status !== 'ready' || !/^pub_[A-Za-z0-9_]+$/.test(ch.publisher ?? '')) return fail(L(ctx, '这个网站的发布还没配好（或要重新配置），到点没发出去', "This site's publishing isn't set up (or needs fixing), so it wasn't published on time"))
  let script: any
  try {
    script = require('./pub_' + ch.publisher.slice(4) + '.ts')
  } catch {
    return fail(L(ctx, `找不到发布脚本 local/${ch.publisher}.ts，让助手重新配置发布`, `Publish script local/${ch.publisher}.ts is missing; have the assistant set up publishing again`))
  }
  return await script.publish({ article_id: p.article_id }, ctx)
}

export async function remove(input: { id: string }, ctx: any) {
  const p = ctx.db.get('publications', input?.id)
  if (!p) throw new Error(L(ctx, '没有这条发布记录：', 'No such publish record: ') + input?.id)
  if (p.status === 'publishing') throw new Error(L(ctx, '这篇正在发，等它发完再删', 'This is being published; wait for it to finish'))
  const ch = ctx.db.get('channels', p.channel_id)
  // 发出去过（网站上有这篇）才去网站上删；没发成的、排期还没到的只删记录
  if (p.cms_id) {
    let script: any = null
    try {
      if (ch?.publisher) script = require('./pub_' + ch.publisher.slice(4) + '.ts')
    } catch {
      // 脚本没了：下面按网站类型删
    }
    if (typeof script?.remove === 'function') await script.remove({ article_id: p.article_id, cms_id: p.cms_id, collection: p.cms_collection, slug: p.slug }, ctx)
    else if (ch?.type === 'creght_site' && ch.project_id && p.cms_collection) await deleteContent(ctx, ch.project_id, p.cms_collection, p.cms_id)
    else throw new Error(L(ctx, `「${ch?.name ?? ''}」还不能从这里删除：到网站后台删掉这篇，再点「只删记录」`, `"${ch?.name ?? ''}" can't be deleted from here yet: delete the post in the site's admin, then choose "Remove record only"`))
  }
  ctx.db.delete('publications', p.id)
  // 文章上记的网站地址就是这篇的：一起清掉（发社媒时带的链接不再指向删掉的页面）
  const a = ctx.db.get('articles', p.article_id)
  if (a && p.url && a.url === p.url) ctx.db.update('articles', a.id, { url: '' })
  return { removed: true, channel: ch?.name ?? '' }
}
