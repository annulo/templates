import { L } from './_i18n'

// 社媒账号搬到社媒插件（github.com/annulo/plugins 的 social）：插件出来之前，社媒账号和网站一起存在 channels 表里。
// 插件的账号在 social_accounts 表；帖子、每天的数据（social_posts、social_daily、social_post_daily）表名没变，只是 channel_id 要换成新账号的 id。
//
//   social_migrate.status()   还有几个社媒账号留在 channels 里（页面据此显示「迁移」）
//   social_migrate.run()      搬过去：建 social_accounts、改帖子和每天数据的 channel_id、删掉 channels 里的旧行
//
// 中途失败了再跑一次就行：已经搬过的账号按平台和账号 id 认出来，不会建两份。
// 浏览器登录态跟着 browser_profile 走，不用重新登录。平台健康记录（以前的 platform_health）不搬：下次发布、采集会重新记。

const SOCIAL = ['xiaohongshu', 'douyin', 'x', 'linkedin', 'facebook', 'instagram', 'youtube', 'bilibili']
// social_accounts 的字段（插件的 tables/accounts.json）
const FIELDS = ['type', 'name', 'platform_uid', 'handle', 'avatar', 'profile', 'login_status', 'last_checked_at', 'followers', 'collected_at', 'metric_totals', 'browser_profile', 'browser_profile_id', 'browser_machine', 'browser_machine_name', 'spare_profiles', 'fb_kind', 'page_id', 'created_at']

function legacy(ctx: any): any[] {
  return ctx.db.query('channels', { limit: 1000 }).list.filter((c: any) => SOCIAL.includes(c.type))
}

export function status(_input: {}, ctx: any) {
  return { legacy: legacy(ctx).length }
}

/** 同一个账号：平台一样，平台上的账号 id 一样（没有就看浏览器 profile 和名字） */
const keyOf = (c: any) => [c.type, c.platform_uid || '', c.platform_uid ? '' : c.browser_profile || '', c.platform_uid ? '' : c.name || ''].join('|')

export function run(_input: {}, ctx: any) {
  const old = legacy(ctx)
  if (!old.length) return { accounts: 0, rows: 0 }
  let accounts: any[]
  try {
    accounts = ctx.db.query('social_accounts', { limit: 1000 }).list
  } catch {
    throw new Error(L(ctx, '还没装社媒插件：到 设置 → 项目 → 插件 里装上 social，再来迁移', "The social plugin isn't installed: install social in Settings → Project → Plugins, then migrate"))
  }
  const byKey = new Map(accounts.map((a: any) => [keyOf(a), a.id]))
  const ids: Record<string, string> = {} // 旧的渠道 id → 新的账号 id
  for (const ch of old) {
    let id = byKey.get(keyOf(ch))
    if (!id) {
      const row: any = {}
      for (const k of FIELDS) if (ch[k] !== undefined && ch[k] !== null) row[k] = ch[k]
      id = ctx.db.insert('social_accounts', row).id
      byKey.set(keyOf(ch), id)
    }
    ids[ch.id] = id as string
  }

  // 帖子、每天的数据：channel_id 换成新账号的 id
  let rows = 0
  const tables = ['social_posts', 'social_daily', 'social_post_daily']
  for (const [n, [from, to]] of Object.entries(ids).entries()) {
    ctx.progress({ done: n, total: old.length, message: L(ctx, '搬帖子和每天的数据…', 'Moving posts and daily data…') })
    for (const table of tables) {
      for (;;) {
        const list = ctx.db.query(table, { where: { channel_id: from }, limit: 500 }).list
        for (const r of list) ctx.db.update(table, r.id, { channel_id: to })
        rows += list.length
        if (list.length < 500) break
      }
    }
  }
  // 都搬完了才删旧的：中途失败时旧行还在，再跑一次接着搬
  for (const ch of old) ctx.db.delete('channels', ch.id)
  return { accounts: old.length, rows }
}
