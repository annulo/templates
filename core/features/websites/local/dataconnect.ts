// 总览页的「连接数据」卡片（components/DataConnect.tsx）：主网站的谷歌搜索后台（GSC）、谷歌分析（GA4）、AI 搜索检测连上没有，在一处连。
// Google 账号的授权由页面发起（Annulo 的连接，startOAuthConnection('google')），这里只管授权之后的关联。
//
//   dataconnect.status({ channel_id? })          主网站（向导里选的，没有就第一个网站）的连接状态：
//                                                gsc { property, synced_at, clicks, impressions }、ga4 { property }、geo { engines, last }
//   dataconnect.link({ channel_id?, gsc?, ga4? }) 关联 GSC、GA4：不给属性就按网站域名自动找；关联上 GSC 马上同步一次（有了数据，增长计划补基线）。
//                                                两个各自成败：{ gsc: { property } | { error }, ga4: 同样 }，已经关联的不动
//
// 授权没连时 gsc.properties 会报错，这里原样带回 error，页面按「没连 Google」显示。

import { L } from './_i18n'
import { onboarding } from './_onboarding'
import { link as gscLink, sync as gscSync } from './gsc'
import { link as ga4Link } from './ga4'

export const remote = ['link']

const SITE_TYPES = ['creght_site', 'wordpress', 'website']
type Channel = { id: string; type: string; name: string; preview_url?: string; live_url?: string; gsc_property?: string; gsc_link_disabled?: boolean; gsc_synced_at?: string; ga4_property?: string }

function mainSite(ctx: any, id?: string): Channel | null {
  const sites = (ctx.db.query('channels', { limit: 200 }).list as Channel[]).filter((c) => SITE_TYPES.includes(c.type))
  if (id) return sites.find((c) => c.id === id) ?? null
  const picked = onboarding(ctx).channel_id
  return sites.find((c) => c.id === picked) ?? sites[0] ?? null
}

const rows = (ctx: any, table: string, where: Record<string, unknown>) => {
  try {
    return ctx.db.query(table, { where, limit: 1000 }).list as any[]
  } catch {
    return [] // 表还没建（刚升级上来）
  }
}

export function status(input: { channel_id?: string }, ctx: any) {
  const site = mainSite(ctx, input?.channel_id)
  if (!site) return { site: null }
  const pages = rows(ctx, 'search_pages', { channel_id: site.id })
  const runs = rows(ctx, 'geo_runs', { channel_id: site.id }).filter((r) => r.finished_at).sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)))
  const engines = rows(ctx, 'geo_engines', {}).filter((e) => e.enabled === true || (e.enabled == null && e.engine === 'openai' && e.provider)).map((e) => e.engine)
  // 谷歌数据只有 creght 站点和只填了网址的网站能连 GSC（WordPress 走 GA4）
  const gscOk = site.type !== 'wordpress'
  return {
    site: { id: site.id, name: site.name, type: site.type, url: site.live_url || site.preview_url || '' },
    gsc: gscOk ? {
      property: site.gsc_link_disabled ? '' : site.gsc_property ?? '',
      synced_at: site.gsc_synced_at ?? '',
      clicks: pages.reduce((n, p) => n + (Number(p.clicks) || 0), 0),
      impressions: pages.reduce((n, p) => n + (Number(p.impressions) || 0), 0),
    } : null,
    ga4: { property: site.ga4_property ?? '' },
    geo: { engines, last: runs[0] ? { at: runs[0].finished_at, visibility: runs[0].visibility ?? null, questions: runs[0].questions ?? 0 } : null },
  }
}

type One = { property?: string; error?: string; skipped?: boolean }

export async function link(input: { channel_id?: string; gsc?: string; ga4?: string }, ctx: any) {
  const site = mainSite(ctx, input?.channel_id)
  if (!site) throw new Error(L(ctx, '还没有网站：先在向导里填网址', 'No website yet: enter its URL in the setup wizard first'))
  const out: { gsc: One; ga4: One } = { gsc: { skipped: true }, ga4: { skipped: true } }
  if (site.type !== 'wordpress' && (input?.gsc || !site.gsc_property || site.gsc_link_disabled)) {
    try {
      const r = await gscLink({ channel_id: site.id, property: input?.gsc || undefined }, ctx)
      out.gsc = { property: r.property }
    } catch (e) {
      out.gsc = { error: (e as Error).message }
    }
    if (out.gsc.property) {
      try {
        ctx.progress?.({ message: L(ctx, '在同步谷歌搜索数据…', 'Syncing Google Search data…') })
        await gscSync({ channel_id: site.id, manual: true }, ctx)
      } catch (e) {
        ctx.log?.(L(ctx, '关联上了，第一次同步失败：', 'Linked, but the first sync failed: ') + (e as Error).message)
      }
    }
  }
  if (input?.ga4 || !site.ga4_property) {
    try {
      const r = await ga4Link({ channel_id: site.id, property: input?.ga4 || undefined }, ctx)
      out.ga4 = { property: r.property }
    } catch (e) {
      out.ga4 = { error: (e as Error).message }
    }
  }
  return out
}
