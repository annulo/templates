// 我的定位（本机函数）：页面的表单和向导存它。
//
//   profile.get({})                    现在的定位（profile 表那一行）
//   profile.context({ channel_id?, url? })   现在的定位 + 网站内容（不给 channel_id 就读全部网站）；网站运营的共用代码用
//   profile.save({ positioning?, business?, ... })   写进 profile 表那一行（没有就建），只改给了的字段（给空字符串是清空）

import { L } from './_i18n'
import { profile, siteBase, siteDigest } from './_ai'

export const cloud = ['get', 'save']

const SITE_TYPES = ['creght_site', 'wordpress']

export async function context(input: { channel_id?: string; url?: string }, ctx: any) {
  const p = profile(ctx)
  const url = input?.url ? new URL(input.url) : null
  if (url && !['http:', 'https:'].includes(url.protocol)) throw new Error(L(ctx, '请输入 HTTP 或 HTTPS 网站地址', 'Enter an HTTP or HTTPS website URL'))
  const chs: any[] = url ? [{ name: url.hostname, preview_url: url.href.replace(/\/$/, '') }] : input?.channel_id
    ? [ctx.db.get('channels', input.channel_id)].filter(Boolean)
    : ctx.db.query('channels', { limit: 200 }).list.filter((c: any) => SITE_TYPES.includes(c.type))
  if (!chs.length) throw new Error(L(ctx, '还没有网站：先在「账号」里添加一个', 'No website yet: add one under Accounts first'))
  const sites = []
  for (const [i, ch] of chs.slice(0, 8).entries()) {
    ctx.progress({ done: i, total: Math.min(chs.length, 8), message: L(ctx, `在读「${ch.name}」的网站…`, `Reading the "${ch.name}" site…`) })
    let digest = ''
    try {
      digest = await siteDigest(await siteBase(ch, ctx), ctx, chs.length > 1 ? 4 : 6)
    } catch {
      // 某个站打不开不影响读别的
    }
    sites.push({ id: ch.id, name: ch.name, digest: digest || L(ctx, '（读不到，可能还没发布或打不开）', '(unreadable — maybe unpublished or down)') })
  }
  return { current: p, sites }
}

export function get(_input: {}, ctx: any) {
  return profile(ctx)
}

const FIELDS = ['name', 'positioning', 'business', 'profile', 'advantages', 'cooperation', 'customer_types', 'markets', 'buyer_concerns', 'tone', 'keywords', 'avoid', 'brand_terms'] as const

export function save(input: Partial<Record<(typeof FIELDS)[number], string>>, ctx: any) {
  const patch: Record<string, string> = {}
  for (const k of FIELDS) if (typeof input?.[k] === 'string') patch[k] = input[k]!.trim()
  if (!Object.keys(patch).length) throw new Error(L(ctx, '没有要存的字段', 'Nothing to save'))
  const p = profile(ctx)
  if (p.id) return ctx.db.update('profile', p.id, patch)
  return ctx.db.insert('profile', { name: '', ...patch, created_at: new Date().toISOString() })
}
