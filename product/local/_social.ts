// 社媒发布记录和增长计划的结合：只读 social_* 和 leads 表，算指标、归因、给检查点和周报的摘要。
// 设计见 docs/growth-plan.md「社媒发布记录」。文件名以 _ 开头：只给 plan.ts、backlinks.ts 这些文件 import。

const DAY = 86400_000
const p2 = (n: number) => String(n).padStart(2, '0')
const localDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const num = (v: unknown) => Number(v) || 0

/** 询盘来源对社媒平台：来源网址的域名、utm_source 里常见的写法（和社媒插件发布时加的 utm_source 对得上） */
const PLATFORMS: Record<string, { hosts: string[]; names: string[] }> = {
  x: { hosts: ['x.com', 't.co', 'twitter.com'], names: ['x', 'twitter'] },
  linkedin: { hosts: ['linkedin.com', 'lnkd.in'], names: ['linkedin'] },
  facebook: { hosts: ['facebook.com', 'fb.me', 'fb.com'], names: ['facebook', 'fb'] },
  instagram: { hosts: ['instagram.com'], names: ['instagram', 'ig'] },
  youtube: { hosts: ['youtube.com', 'youtu.be'], names: ['youtube', 'yt'] },
  xiaohongshu: { hosts: ['xiaohongshu.com', 'xhslink.com'], names: ['xiaohongshu', 'xhs'] },
  douyin: { hosts: ['douyin.com'], names: ['douyin'] },
  bilibili: { hosts: ['bilibili.com', 'b23.tv'], names: ['bilibili'] },
  zhihu: { hosts: ['zhihu.com'], names: ['zhihu'] },
}

const parse = (v: unknown): any => {
  try {
    return typeof v === 'string' ? JSON.parse(v || '{}') : v || {}
  } catch {
    return {}
  }
}
const hostOf = (u: unknown) => String(u ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]

/** 一条询盘是哪个社媒平台带来的：utm_source 优先，没有再看来源网址；不是社媒返回 ''。campaign 是社媒插件写进链接的计划项 id */
export function leadSocial(l: any): { platform: string; campaign: string } {
  const u = parse(l.utm)
  const src = String(u.source || u.utm_source || '').toLowerCase()
  const campaign = String(u.campaign || u.utm_campaign || '')
  for (const [p, d] of Object.entries(PLATFORMS)) if (src && (src === p || d.names.includes(src))) return { platform: p, campaign }
  const h = hostOf(l.referrer)
  if (h) for (const [p, d] of Object.entries(PLATFORMS)) if (d.hosts.some((x) => h === x || h.endsWith('.' + x))) return { platform: p, campaign }
  return { platform: '', campaign: '' }
}

type Gain = { views: number; likes: number; comments: number; collects: number; shares: number }
const zero = (): Gain => ({ views: 0, likes: 0, comments: 0, collects: 0, shares: 0 })
export const engagement = (g: Gain) => g.likes + g.comments + g.collects + g.shares

/**
 * 每篇帖子在 [from, 最后一次采集] 这段时间涨了多少：期末累计 − 期初前一天累计（social_post_daily 每篇每天一行的累计数）。
 * 期初前没有记录的：帖子是窗口里才发的，当时从 0 开始；窗口前就发了的，拿窗口里第一次采集当起点（不把存量算成增量）。
 */
export function postGains(posts: any[], daily: any[], from: string): Map<string, Gain> {
  const byPost = new Map<string, any[]>()
  for (const r of daily) {
    const a = byPost.get(r.post_id)
    if (a) a.push(r)
    else byPost.set(r.post_id, [r])
  }
  const out = new Map<string, Gain>()
  for (const p of posts) {
    const rows = (byPost.get(p.id) ?? []).sort((a, b) => String(a.date).localeCompare(String(b.date)))
    if (!rows.length) {
      // 没有每日快照（采集没记）：窗口里才发的帖子，帖子上最后一次采集的累计数就是它涨的
      if (String(p.published_at || '').slice(0, 10) >= from && p.metrics_at) out.set(p.id, { views: num(p.views), likes: num(p.likes), comments: num(p.comments), collects: num(p.collects), shares: num(p.shares) })
      continue
    }
    const end = rows[rows.length - 1]
    if (String(end.date).slice(0, 10) < from) continue // 窗口里没采集到
    const before = [...rows].reverse().find((r) => String(r.date).slice(0, 10) < from)
    const publishedIn = String(p.published_at || '').slice(0, 10) >= from
    const start = before ?? (publishedIn ? null : rows[0])
    const g = zero()
    for (const k of Object.keys(g) as (keyof Gain)[]) g[k] = Math.max(0, num(end[k]) - (start ? num(start[k]) : 0))
    out.set(p.id, g)
  }
  return out
}

/** 增长计划的三个社媒指标；没有社媒账号返回 null（模板不出这几个指标） */
export function socialMetrics(rows: { accounts: any[]; posts: any[]; daily: any[]; leads: any[] }, now = Date.now()) {
  if (!rows.accounts.length) return null
  const from = localDay(new Date(now - 27 * DAY))
  const pub = rows.posts.filter((p) => p.status === 'published')
  const gains = postGains(pub, rows.daily, from)
  let views = 0, eng = 0
  for (const g of gains.values()) { views += g.views; eng += engagement(g) }
  const leads = rows.leads.filter((l) => String(l.submitted_at || l.created_at).slice(0, 10) >= from && leadSocial(l).platform).length
  const active = new Set(pub.filter((p) => String(p.published_at || '').slice(0, 10) >= from).map((p) => p.channel_id)).size
  return {
    social_active_channels: active,
    // 一条数据都没采集到时给 null：没采过不等于没人看
    social_views_28d: rows.daily.length ? views : null,
    social_engagement_28d: rows.daily.length ? eng : null,
    social_leads_28d: leads,
  }
}

/** 检查点和周报用的社媒摘要：计划开始以来，按平台、按计划项、表现最好和最差的帖子，带来的询盘 */
export function socialDigest(rows: { accounts: any[]; posts: any[]; daily: any[]; leads: any[]; items: any[] }, since: string) {
  const acc = new Map(rows.accounts.map((a) => [a.id, a]))
  const platformOf = (p: any) => String(acc.get(p.channel_id)?.type || acc.get(p.channel_id)?.platform || '?')
  const pub = rows.posts.filter((p) => p.status === 'published' && String(p.published_at || '').slice(0, 10) >= since.slice(0, 10))
  const gains = postGains(pub, rows.daily, since.slice(0, 10))
  const leads = rows.leads.map((l) => ({ l, s: leadSocial(l) })).filter((x) => x.s.platform && String(x.l.submitted_at || x.l.created_at) >= since)
  const by: Record<string, any> = {}
  for (const p of pub) {
    const k = platformOf(p)
    const o = (by[k] ??= { platform: k, posts: 0, views: 0, engagement: 0, with_link: 0, leads: 0 })
    const g = gains.get(p.id)
    o.posts++
    if (g) { o.views += g.views; o.engagement += engagement(g) }
    if (/https?:\/\//.test(String(p.body || ''))) o.with_link++
  }
  for (const x of leads) (by[x.s.platform] ??= { platform: x.s.platform, posts: 0, views: 0, engagement: 0, with_link: 0, leads: 0 }).leads++
  const ranked = pub.map((p) => ({ p, g: gains.get(p.id) })).filter((x) => x.g).sort((a, b) => engagement(b.g!) - engagement(a.g!))
  const brief = (x: { p: any; g: Gain | undefined }) => ({ title: x.p.title, platform: platformOf(x.p), article_id: x.p.article_id || '', url: x.p.post_url || '', views: x.g?.views ?? 0, engagement: x.g ? engagement(x.g) : 0 })
  const itemTitle = new Map(rows.items.map((i) => [i.id, i.title]))
  const byItem: Record<string, any> = {}
  for (const p of pub) {
    if (!p.plan_item_id) continue
    const o = (byItem[p.plan_item_id] ??= { item: itemTitle.get(p.plan_item_id) || p.plan_item_id, posts: 0, views: 0, engagement: 0, leads: 0 })
    const g = gains.get(p.id)
    o.posts++
    if (g) { o.views += g.views; o.engagement += engagement(g) }
  }
  for (const x of leads) if (x.s.campaign && byItem[x.s.campaign]) byItem[x.s.campaign].leads++
  return {
    published: pub.length,
    by_platform: Object.values(by).sort((a, b) => b.engagement - a.engagement),
    by_plan_item: Object.values(byItem),
    best: ranked.slice(0, 3).map(brief),
    worst: ranked.length > 5 ? ranked.slice(-3).map(brief) : [],
    leads: leads.length,
    unattributed_posts: pub.filter((p) => !p.plan_item_id).length,
  }
}

/** 一个计划项名下的帖子（计划页展开看）：状态、链接、涨的数据 */
export function itemPosts(posts: any[], daily: any[], itemId: string) {
  const mine = posts.filter((p) => p.plan_item_id === itemId)
  const gains = postGains(mine.filter((p) => p.status === 'published'), daily, '0000-00-00')
  return mine.map((p) => ({ id: p.id, title: p.title, status: p.status, channel_id: p.channel_id, url: p.post_url || '', published_at: p.published_at || '', views: num(p.views), engagement: gains.get(p.id) ? engagement(gains.get(p.id)!) : num(p.likes) + num(p.comments) + num(p.collects) + num(p.shares) }))
}
