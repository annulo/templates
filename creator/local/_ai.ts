// 本机函数共用的工具（文件名以 _ 开头：不作为可调用的函数，只给别的文件 import）。

import { L } from './_i18n'
import { liveURL } from './_creght'

/** 调一次模型，要它按 JSON 回答，解析出来。模型偶尔会包一层 ```json 或者前后带话，这里都兼容 */
export async function askJSON<T = any>(ctx: any, system: string, prompt: string): Promise<T> {
  const text: string = await ctx.llm({ system: system + '\n\n只输出 JSON，不要任何解释，不要 Markdown 代码块。', prompt })
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]
  const raw = (fenced ?? text).trim()
  const start = raw.search(/[[{]/)
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error(L(ctx, '模型没有按要求返回结构化结果，再试一次', 'The model did not return a structured result — try again'))
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new Error(L(ctx, '模型返回的结果解析不了，再试一次', "Couldn't parse the model's result — try again"))
  }
}

export type Profile = { id?: string; name: string; positioning?: string; business?: string; profile?: string; advantages?: string; cooperation?: string; customer_types?: string; markets?: string; buyer_concerns?: string; tone?: string; keywords?: string; avoid?: string; brand_terms?: string; company_role?: string; audience?: string; created_at?: string }

// 网站运营（core/features/websites）用的两个：网站地址、读网站讲什么

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


/** 我的定位：profile 表那一行（多行时取最早建的），还没填返回 { name: '' } */
export function profile(ctx: any): Profile {
  let list: any[] = []
  try {
    list = ctx.db.query('profile', { limit: 20 }).list ?? []
  } catch {
    // 表还没建时当作没填
  }
  const at = (p: any) => Date.parse(p?.created_at || '') || 0
  const p = [...list].sort((a, b) => at(a) - at(b))[0]
  return p ? withLegacyProfile(p) : { name: '' }
}

/** 旧版自媒体模板（v0.3）的定位字段换成现在的：新字段空着才用旧的，用户在页面上保存一次就写成新字段 */
const LEGACY_PROFILE: [string, string][] = [['about', 'profile'], ['audience', 'customer_types'], ['pillars', 'business'], ['voice', 'tone']]
function withLegacyProfile<T extends Record<string, any>>(p: T): T {
  const out: Record<string, any> = { ...p }
  for (const [from, to] of LEGACY_PROFILE) if (!out[to] && typeof out[from] === 'string' && out[from].trim()) out[to] = out[from]
  return out as T
}


/** 定位写成给模型看的一段话 */
export function projectBrief(p: any): string {
  const lines = [`名字：${p?.name ?? ''}`]
  for (const [key, label] of [
    ['positioning', '一句话定位'], ['business', '主要写什么'], ['profile', '关于我'], ['advantages', '专长和经历'],
    ['cooperation', '能提供什么'], ['customer_types', '写给谁'], ['markets', '平台和语言'], ['buyer_concerns', '读者关心的问题'],
    ['tone', '风格'], ['keywords', '常写的话题'], ['avoid', '不写什么'],
  ]) if (p?.[key]) lines.push(`${label}：${p[key]}`)
  if (lines.length === 1) lines.push('（还没填定位）')
  return lines.join('\n')
}
