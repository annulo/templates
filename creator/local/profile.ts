// 我的定位（本机函数）：页面的表单和向导存它。
//
//   profile.get({})                    现在的定位（profile 表那一行）
//   profile.save({ positioning?, business?, ... })   写进 profile 表那一行（没有就建），只改给了的字段（给空字符串是清空）

import { L } from './_i18n'
import { profile } from './_ai'

export const cloud = ['get', 'save']

export function get(_input: {}, ctx: any) {
  return profile(ctx)
}

const FIELDS = ['name', 'positioning', 'business', 'profile', 'advantages', 'cooperation', 'customer_types', 'markets', 'buyer_concerns', 'tone', 'keywords', 'avoid'] as const

export function save(input: Partial<Record<(typeof FIELDS)[number], string>>, ctx: any) {
  const patch: Record<string, string> = {}
  for (const k of FIELDS) if (typeof input?.[k] === 'string') patch[k] = input[k]!.trim()
  if (!Object.keys(patch).length) throw new Error(L(ctx, '没有要存的字段', 'Nothing to save'))
  const p = profile(ctx)
  if (p.id) return ctx.db.update('profile', p.id, patch)
  return ctx.db.insert('profile', { name: '', ...patch, created_at: new Date().toISOString() })
}
