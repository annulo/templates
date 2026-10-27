// 网站的地址和内容（文件名以 _ 开头：只给别的文件 import）。模块里的 geo、gsc 和各模板的本机函数都用它；模板的 local/_ai.ts 转出这两个，老代码照旧从 _ai 引。

import { liveURL } from './_creght'

/** 渠道站点的访问地址：发布过就用正式域名（自定义域名优先），没发布过用预览地址 */
export async function siteBase(ch: { id?: string; project_id?: string; site_id?: string; preview_url?: string; live_url?: string }, ctx: any): Promise<string> {
  if (ch.project_id && ch.site_id) {
    try {
      const live = await liveURL(ctx, ch)
      if (live) return live
    } catch {
      // 读不到发布状态就用预览地址
    }
  }
  return (ch.preview_url ?? '').replace(/\/$/, '')
}

/** 读站点首页和几个站内页面的标题、描述、正文开头：给模型了解「这个站讲什么」用 */
export async function siteDigest(base: string, ctx: any, pages = 5): Promise<string> {
  if (!base) return ''
  const home = await fetch(base + '/').catch(() => null)
  if (!home?.ok) return ''
  const doc = ctx.html(await home.text())
  const host = /^https?:\/\/([^/]+)/.exec(base)?.[1] ?? ''
  const links = [...new Set(doc.find('a[href]').map((a: any) => {
    try {
      const u = new URL(a.attrs.href, base)
      return u.hostname === host && u.pathname !== '/' ? `${u.protocol}//${u.host}${u.pathname}` : ''
    } catch {
      return ''
    }
  }).filter(Boolean))].slice(0, pages) as string[]
  const one = (d: any, url: string) => `## ${url}\n标题：${d.find('title')[0]?.text ?? ''}\n描述：${d.find('meta[name="description" i]')[0]?.attrs.content ?? ''}\n正文：${d.text().slice(0, 600)}`
  const parts = [one(doc, base + '/')]
  const rs = await ctx.fetchAll(links)
  for (let i = 0; i < links.length; i++) {
    if (rs[i]?.ok) parts.push(one(ctx.html(await rs[i].text()), links[i]))
  }
  return parts.join('\n\n')
}
