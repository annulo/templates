import { L } from './_i18n'
import { unpublished } from './_types'

// 只读写业务表：手机上也能算、能看、能标做完
export const cloud = ['scan', 'list', 'mark', 'markSeen']

// 增长雷达：每周把各处的数据汇总成一份「这周最值得做的事」，每条带依据和下一步（参考 TradeMax「增长雷达」，docs/growth-radar.md）。
//
// 全是确定的规则，不调模型：每条机会来自一个已有的信号（内容下滑、谷歌排名的机会页、有人搜没页面的词、竞品新页面、AI 推荐了别家、
// 网站严重问题、询盘没处理、改动后变差、写好没发、数据没接上），按影响打分排序。要 AI 分析和排计划，交给每周总结。
//
//   growth.scan({})                         重算（定时任务每周一次；页面上「重新算」）
//   growth.list({})                         当前的机会，按分数排；做完、不用管的排在后面
//   growth.mark({ id, status })             status：done 做完了 / dismissed 不用管 / 空 撤销
//   growth.markSeen({ ids? })               去掉「新」标识
//
// 同一件事每周算出来是同一个 key：标了做完的，下一周信号还在就再出现；不用管的，数量变多了才再出现。信号没了就删掉。

type Action = { kind: 'go'; view: string; params?: Record<string, string> } | { kind: 'task'; task: string; input?: unknown }
type Priority = 'high' | 'medium' | 'low'
export type Item = {
  key: string; kind: string; area: 'site' | 'content' | 'customers' | 'setup'; priority: Priority; score: number
  title: string; why: string; next: string; action: Action; value: number
}
type Row = Omit<Item, 'action'> & { id: string; action: string; status?: string; status_value?: number; status_week?: string; seen?: boolean; first_seen?: string; scanned_at?: string }

const DAY = 86400_000
const nowISO = () => new Date().toISOString()
// 千分位自己加：本机函数的运行时把 toLocaleString('en-US') 的参数当成进制，会抛 RangeError
const num = (x: number) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const pathOf = (u: string) => {
  try {
    return decodeURIComponent(new URL(u).pathname) || '/'
  } catch {
    return u
  }
}
const parse = <T,>(v: unknown, d: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : ((v as T) ?? d)
  } catch {
    return d
  }
}
const all = (ctx: any, table: string): any[] => {
  try {
    return ctx.db.query(table, { limit: 2000 }).list
  } catch {
    return [] // 表还没建（老项目、没开这个功能）
  }
}

/** 这周周一（UTC）的日期：标了做完的，到下一周再看 */
export function weekOf(ms = Date.now()): string {
  const d = new Date(ms)
  const day = (d.getUTCDay() + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10)
}

const BASE: Record<Priority, number> = { high: 300, medium: 200, low: 100 }
const score = (p: Priority, weight: number) => BASE[p] + Math.min(99, Math.round(weight))

/** 按各表的数据算出机会（纯函数，只读 ctx.db） */
export function signals(ctx: any, now = Date.now()): Item[] {
  const out: Item[] = []
  const add = (it: Omit<Item, 'score'> & { weight?: number }) => {
    const { weight = 0, ...rest } = it
    out.push({ ...rest, score: score(it.priority, weight) })
  }
  const sites = all(ctx, 'channels').filter((c) => ['creght_site', 'wordpress', 'website'].includes(c.type))
  const siteName = (id: string) => sites.find((c) => c.id === id)?.name ?? ''

  // 询盘：高意向的新询盘没处理、联系后 3 天没进展
  const leads = all(ctx, 'leads').filter((l) => l.is_real !== false && l.status !== 'spam')
  const hot = leads.filter((l) => l.status === 'new' && l.intent === 'high')
  if (hot.length)
    add({
      key: 'leads_high', kind: 'leads_high', area: 'customers', priority: 'high', value: hot.length, weight: 50 + hot.length * 5,
      title: L(ctx, `${hot.length} 条高意向询盘还没处理`, `${hot.length} high-intent inquiries not handled yet`),
      why: L(ctx, `最早的一条是 ${(hot.map((l) => l.created_at || l.submitted_at || '').sort()[0] || '').slice(0, 10)} 进来的。买家常常同时问几家，回得越快越容易拿下。`, `The oldest came in on ${(hot.map((l) => l.created_at || l.submitted_at || '').sort()[0] || '').slice(0, 10)}. Buyers ask several suppliers at once; fast replies win.`),
      next: L(ctx, '先做客户背调，再按背调写回复', 'Research the buyer, then reply using the research'),
      action: { kind: 'go', view: 'leads', params: { filter: 'high' } },
    })
  const stale = leads.filter((l) => ['contacted', 'quoted', 'negotiating'].includes(l.status) && Date.parse(l.updated_at || l.created_at || '') < now - 3 * DAY)
  if (stale.length)
    add({
      key: 'leads_stale', kind: 'leads_stale', area: 'customers', priority: stale.some((l) => l.status !== 'contacted') ? 'high' : 'medium', value: stale.length, weight: 30 + stale.length * 3,
      title: L(ctx, `${stale.length} 条商机联系后 3 天没进展`, `${stale.length} deals with no progress for 3 days`),
      why: L(ctx, `其中已报价、谈判中的 ${stale.filter((l) => l.status !== 'contacted').length} 条。隔几天跟进一次能把单子拉回来。`, `${stale.filter((l) => l.status !== 'contacted').length} of them are quoted or negotiating. A follow-up every few days wins deals back.`),
      next: L(ctx, '在看板上逐条跟进，记一条跟进记录', 'Follow up on the board and log each follow-up'),
      action: { kind: 'go', view: 'leads', params: { mode: 'board' } },
    })

  // 内容下滑（decay.scan 写的）：一页一条，少掉的点击越多越靠前
  for (const d of all(ctx, 'content_decay').filter((d) => d.status !== 'dismissed').sort((a, b) => b.lost_clicks - a.lost_clicks).slice(0, 5)) {
    const cause = d.cause === 'rank'
      ? L(ctx, `排名从 ${d.peak_position} 掉到 ${d.position}`, `rank fell from ${d.peak_position} to ${d.position}`)
      : d.cause === 'ctr'
        ? L(ctx, `排名没怎么变，点击率从 ${(d.peak_ctr * 100).toFixed(1)}% 降到 ${(d.ctr * 100).toFixed(1)}%`, `rank held but CTR fell from ${(d.peak_ctr * 100).toFixed(1)}% to ${(d.ctr * 100).toFixed(1)}%`)
        : L(ctx, `曝光从 ${num(d.peak_impressions)} 降到 ${num(d.impressions)}`, `impressions fell from ${num(d.peak_impressions)} to ${num(d.impressions)}`)
    add({
      key: 'decay:' + d.page, kind: 'decay', area: 'site', priority: d.lost_clicks >= 30 ? 'high' : 'medium', value: d.lost_clicks, weight: d.lost_clicks,
      title: L(ctx, `${pathOf(d.page)} 的谷歌点击从 ${d.peak_clicks} 掉到 ${d.clicks}`, `Google clicks on ${pathOf(d.page)} fell from ${d.peak_clicks} to ${d.clicks}`),
      why: L(ctx, `和 ${d.peak_start} 起的 28 天比，${cause}。`, `Compared with the 28 days from ${d.peak_start}, ${cause}.`),
      next: d.cause === 'ctr' ? L(ctx, '改标题和描述', 'Rewrite the title and description') : d.cause === 'demand' ? L(ctx, '看是不是季节性；不是就按丢掉的搜索词补内容', 'Check whether it is seasonal; if not, cover the lost queries') : L(ctx, '让 AI 写刷新内容的要点，再改页面', 'Have AI outline a refresh, then update the page'),
      action: { kind: 'go', view: 'search', params: { tab: 'decay', channel: d.channel_id } },
    })
  }

  // 谷歌排名的机会页（gsc.sync 算的）：还没动过的，各取曝光最高的 3 个
  const pages = all(ctx, 'search_pages').filter((p) => !p.status)
  const imp = (p: any) => p.nb_impressions ?? p.impressions ?? 0
  for (const [opp, kind] of [['low_ctr', 'low_ctr'], ['striking_distance', 'striking']] as const)
    for (const p of pages.filter((p) => p.opportunity === opp).sort((a, b) => imp(b) - imp(a)).slice(0, 3))
      add({
        key: kind + ':' + p.page, kind, area: 'site', priority: 'medium', value: imp(p), weight: imp(p) / 50,
        title: kind === 'low_ctr'
          ? L(ctx, `${pathOf(p.page)} 曝光 ${num(imp(p))}，点击率偏低`, `${pathOf(p.page)}: ${num(imp(p))} impressions but a low CTR`)
          : L(ctx, `${pathOf(p.page)} 平均排第 ${(p.nb_position ?? p.position ?? 0).toFixed(1)}，差一点上首页`, `${pathOf(p.page)} ranks ${(p.nb_position ?? p.position ?? 0).toFixed(1)} on average, close to page one`),
        why: kind === 'low_ctr'
          ? L(ctx, `近 28 天点击率 ${((p.nb_ctr ?? p.ctr ?? 0) * 100).toFixed(1)}%，同样排名一般能到 ${((p.expected_ctr ?? 0) * 100).toFixed(1)}%。`, `CTR ${((p.nb_ctr ?? p.ctr ?? 0) * 100).toFixed(1)}% over 28 days; pages at this rank usually get ${((p.expected_ctr ?? 0) * 100).toFixed(1)}%.`)
          : L(ctx, '已经有人在搜，把搜这些词的人想知道的答全，最容易多拿到点击。', 'People already search for this; answering what they want is the fastest way to more clicks.'),
        next: kind === 'low_ctr' ? L(ctx, '让 AI 改写标题和描述', 'Have AI rewrite the title and description') : L(ctx, '让 AI 写补内容的要点', 'Have AI outline what to add'),
        action: { kind: 'go', view: 'search', params: { channel: p.channel_id } },
      })

  // 有人搜、站内没有排得上的页面的词（gsc.sync 加进选题的）
  const gaps = all(ctx, 'topics').filter((t) => t.source === 'search' && t.status === 'idea').sort((a, b) => (b.search_impressions ?? 0) - (a.search_impressions ?? 0))
  if (gaps.length)
    add({
      key: 'search_gap', kind: 'search_gap', area: 'content', priority: 'medium', value: gaps.length, weight: (gaps[0].search_impressions ?? 0) / 50,
      title: L(ctx, `${gaps.length} 个搜索词有人搜、站内还没有页面`, `${gaps.length} search terms people use with no page of yours`),
      why: L(ctx, `曝光最高的是「${gaps[0].search_query || gaps[0].title}」（近 28 天 ${num(gaps[0].search_impressions ?? 0)} 次）。`, `The biggest is "${gaps[0].search_query || gaps[0].title}" (${num(gaps[0].search_impressions ?? 0)} impressions in 28 days).`),
      next: L(ctx, '挑一两个写成文章', 'Turn one or two into articles'),
      action: { kind: 'go', view: 'website-content', params: { topic: gaps[0].id } },
    })

  // 关键词快赢：筛过的词里本站已经排在 4~30 位的（keywords.refresh 按 GSC 分桶，设计见 core 网站模块的 docs/keywords.md）
  const wins = all(ctx, 'keywords').filter((k) => k.bucket === 'quick_win' && (k.status === 'idea' || k.status === 'targeting')).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  if (wins.length)
    add({
      key: 'keyword_quick_win', kind: 'keyword_quick_win', area: 'content', priority: 'medium', value: wins.length, weight: (wins[0].gsc_impressions ?? 0) / 50,
      title: L(ctx, `${wins.length} 个关键词已经排在 Google 4~30 位`, `${wins.length} keywords already rank 4–30 on Google`),
      why: L(ctx, `「${wins[0].keyword}」排第 ${wins[0].gsc_position} 位、近 28 天曝光 ${num(wins[0].gsc_impressions ?? 0)} 次，给排着的页面补内容最快见效。`, `"${wins[0].keyword}" is at position ${wins[0].gsc_position} with ${num(wins[0].gsc_impressions ?? 0)} impressions in 28 days; strengthening that page is the fastest win.`),
      next: L(ctx, '在关键词机会里给页面写补内容要点', 'Draft a content brief for the page under Keyword opportunities'),
      action: { kind: 'go', view: 'search', params: { tab: 'keywords', ...(wins[0].channel_id ? { channel: wins[0].channel_id } : {}) } },
    })

  // 关键词新机会：查过 Google 结果页、前 10 里论坛 / 社媒 / B2B 平台多（keywords.bucket=open），还没转成选题的
  const opens = all(ctx, 'keywords').filter((k) => k.bucket === 'open' && k.status === 'idea' && !k.topic_id).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  if (opens.length)
    add({
      key: 'keyword_open', kind: 'keyword_open', area: 'content', priority: 'medium', value: opens.length, weight: opens.length * 5,
      title: L(ctx, `${opens.length} 个关键词的 Google 前 10 有弱位置，还没写`, `${opens.length} keywords have weak spots in Google's top 10 and no content yet`),
      why: L(ctx, `比如「${opens[0].keyword}」：前 10 里有 ${opens[0].serp_weak ?? 0} 个是论坛、社媒或 B2B 平台的页面，Google 还没找到像样的专门页面，认真写一篇有机会排上去。`, `For example "${opens[0].keyword}": ${opens[0].serp_weak ?? 0} of the top 10 are forum, social or B2B listing pages, so Google has no solid dedicated page yet — a thorough one can rank.`),
      next: L(ctx, '在关键词的「新机会」里按主题转成选题', 'Turn them into topics under Keywords → Open'),
      action: { kind: 'go', view: 'search', params: { tab: 'keywords', ...(opens[0].channel_id ? { channel: opens[0].channel_id } : {}) } },
    })

  // 竞品在排、我们不在的词：查 Google 结果页时在盯的竞品在前 10、本站不在，还没转成选题（和 core 的 _keywords.ts rivalOnly 同一个口径）
  const rivals = all(ctx, 'keywords').filter((k) => k.serp_at && k.serp_competitors && k.status === 'idea' && !k.topic_id && !k.serp_position && !(k.gsc_position && k.gsc_position <= 10))
  if (rivals.length)
    add({
      key: 'keyword_competitor', kind: 'keyword_competitor', area: 'content', priority: 'medium', value: rivals.length, weight: rivals.length * 8,
      title: L(ctx, `${rivals.length} 个关键词竞品排在 Google 前 10，我们没有`, `${rivals.length} keywords where competitors are in Google's top 10 and you aren't`),
      why: L(ctx, `比如「${rivals[0].keyword}」：${String(rivals[0].serp_competitors).split(',').join('、')} 排在前 10。竞品已经证明这个词有人搜、能排上去。`, `For example "${rivals[0].keyword}": ${String(rivals[0].serp_competitors).split(',').join(', ')} rank in the top 10. Competitors have proven it is searched and winnable.`),
      next: L(ctx, '在关键词的「竞品在排」里按主题转成选题', 'Turn them into topics under Keywords → Competitors rank'),
      action: { kind: 'go', view: 'search', params: { tab: 'keywords', ...(rivals[0].channel_id ? { channel: rivals[0].channel_id } : {}) } },
    })

  // 竞品近 7 天新上的页面，还没转成选题的
  const comps = all(ctx, 'competitors')
  const fresh = all(ctx, 'competitor_pages').filter((p) => p.is_new && !p.topic_id && Date.parse(p.first_seen || '') > now - 7 * DAY)
  if (fresh.length) {
    const by = new Map<string, number>()
    for (const p of fresh) by.set(p.competitor_id, (by.get(p.competitor_id) ?? 0) + 1)
    const top = [...by].sort((a, b) => b[1] - a[1])[0]
    const products = fresh.filter((p) => p.kind === 'product').length
    add({
      key: 'competitor', kind: 'competitor', area: 'content', priority: products ? 'medium' : 'low', value: fresh.length, weight: fresh.length,
      title: L(ctx, `竞品这周新上了 ${fresh.length} 个页面`, `Competitors published ${fresh.length} new pages this week`),
      why: L(ctx, `${comps.find((c) => c.id === top[0])?.name ?? ''} 最多（${top[1]} 个）${products ? `，其中产品页 ${products} 个` : ''}。看看他们在推什么，值得跟的转成选题。`, `Most from ${comps.find((c) => c.id === top[0])?.name ?? ''} (${top[1]})${products ? `, including ${products} product pages` : ''}. See what they push and turn the relevant ones into topics.`),
      next: L(ctx, '在竞品监控里看新发现，转成选题', 'Review new discoveries and turn them into topics'),
      action: { kind: 'go', view: 'competitors' },
    })
  }

  // 还没有在盯的竞品：交给 AI 推荐；推荐了还没确认的：去看
  const watching = comps.filter((c) => c.status !== 'suggested' && c.status !== 'rejected')
  const suggested = comps.filter((c) => c.status === 'suggested')
  if (suggested.length)
    add({
      key: 'competitor_suggested', kind: 'competitor', area: 'content', priority: 'medium', value: suggested.length, weight: suggested.length,
      title: L(ctx, `AI 推荐了 ${suggested.length} 家竞品，等你确认`, `AI suggested ${suggested.length} competitors for you to confirm`),
      why: L(ctx, `比如 ${suggested.slice(0, 3).map((c) => c.name).join('、')}。确认了才会每天读它们的网站。`, `For example ${suggested.slice(0, 3).map((c) => c.name).join(', ')}. Their sites are only read once you confirm.`),
      next: L(ctx, '对的加进监控，不对的点「不要」', 'Add the right ones to monitoring, skip the rest'),
      action: { kind: 'go', view: 'competitors' },
    })
  else if (!watching.length && sites.length)
    add({
      key: 'setup_competitors', kind: 'setup', area: 'setup', priority: 'low', value: 1, weight: 15,
      title: L(ctx, '还没有在盯的竞品', 'No competitors monitored yet'),
      why: L(ctx, '盯住几家同行，才知道他们新上了什么产品、在写什么，哪些值得跟。', 'Watching a few peers shows what products and content they launch and what is worth answering.'),
      next: L(ctx, '让 AI 按你的产品和市场推荐几家', 'Have AI suggest a few based on your products and markets'),
      action: { kind: 'task', task: 'competitor-suggest', input: {} },
    })

  // AI 搜索：每个网站最近一次检测里，推荐类问题没引用我们、引用了别家的；可见度比上一次掉了
  const runs = all(ctx, 'geo_runs').filter((r) => r.finished_at).sort((a, b) => Date.parse(b.finished_at) - Date.parse(a.finished_at))
  const results = all(ctx, 'geo_results')
  for (const site of sites) {
    const mine = runs.filter((r) => r.channel_id === site.id)
    if (!mine.length) continue
    const batch = mine[0].batch_id
    const latest = batch ? mine.filter((r) => r.batch_id === batch) : [mine[0]]
    const ids = new Set(latest.map((r) => r.id))
    const lost = results.filter((r) => ids.has(r.run_id) && (r.kind ?? 'recommend') === 'recommend' && !r.cited && parse<string[]>(r.competitor_domains, []).length)
    const questions = new Set(lost.map((r) => r.question_id || r.question))
    if (questions.size)
      add({
        key: 'geo_gap:' + site.id, kind: 'geo_gap', area: 'content', priority: 'medium', value: questions.size, weight: questions.size * 4,
        title: L(ctx, `${questions.size} 个买家问题 AI 推荐了别家、没提到你`, `On ${questions.size} buyer questions AI recommends others, not you`),
        why: L(ctx, `${siteName(site.id)} 最近一次 AI 搜索检测（${String(mine[0].finished_at).slice(0, 10)}）。比如「${lost[0].question}」。`, `${siteName(site.id)}, latest AI search check (${String(mine[0].finished_at).slice(0, 10)}). For example: "${lost[0].question}".`),
        next: L(ctx, '看 AI 引用了谁，写一篇能回答这个问题的内容', 'See whom AI cites and write content that answers the question'),
        action: { kind: 'go', view: 'geo', params: { channel: site.id } },
      })
    const prev = mine.find((r) => (batch ? r.batch_id !== batch : r.id !== mine[0].id) && r.engine === mine[0].engine)
    if (prev && typeof prev.visibility === 'number' && typeof mine[0].visibility === 'number' && prev.visibility - mine[0].visibility >= 10)
      add({
        key: 'geo_drop:' + site.id, kind: 'geo_drop', area: 'site', priority: 'medium', value: prev.visibility - mine[0].visibility, weight: prev.visibility - mine[0].visibility,
        title: L(ctx, `AI 搜索可见度从 ${prev.visibility} 降到 ${mine[0].visibility}`, `AI search visibility fell from ${prev.visibility} to ${mine[0].visibility}`),
        why: L(ctx, `${siteName(site.id)}，${mine[0].provider_name || mine[0].engine}，和上一次检测比。`, `${siteName(site.id)}, ${mine[0].provider_name || mine[0].engine}, compared with the previous check.`),
        next: L(ctx, '看哪些问题不再引用你', 'See which questions stopped citing you'),
        action: { kind: 'go', view: 'geo', params: { channel: site.id } },
      })
  }

  // 网站严重问题
  const issues = all(ctx, 'site_issues').filter((i) => i.status === 'open' && i.severity === 'high')
  if (issues.length)
    add({
      key: 'audit', kind: 'audit', area: 'site', priority: 'high', value: issues.length, weight: issues.length * 5,
      title: L(ctx, `网站有 ${issues.length} 个严重问题没修`, `${issues.length} serious site issues not fixed`),
      why: L(ctx, `比如「${issues[0].title}」。这类问题会影响谷歌收录或客户下单。`, `For example: "${issues[0].title}". These hurt indexing or conversions.`),
      next: L(ctx, '交给助手修，改动先进预览', 'Let the assistant fix them; changes go to the preview first'),
      action: { kind: 'go', view: 'audit' },
    })

  // 改动复查结果变差的（最近 14 天出的结论）
  const worse = all(ctx, 'site_changes').filter((c) => c.status === 'reviewed' && c.verdict === 'worse' && Date.parse(c.reviewed_at || '') > now - 14 * DAY)
  if (worse.length)
    add({
      key: 'change_worse', kind: 'change_worse', area: 'site', priority: 'medium', value: worse.length, weight: worse.length * 5,
      title: L(ctx, `${worse.length} 个改动上线后数据变差了`, `${worse.length} changes did worse after going live`),
      why: L(ctx, `比如「${worse[0].title}」${worse[0].summary ? '：' + worse[0].summary : ''}`, `For example: "${worse[0].title}"${worse[0].summary ? ': ' + worse[0].summary : ''}`),
      next: L(ctx, '看前后对比，决定改回去还是再调', 'Compare before and after, then revert or adjust'),
      action: { kind: 'go', view: 'search', params: { tab: 'review' } },
    })

  // 写好了还没发的
  const waiting = unpublished(all(ctx, 'articles'), [...all(ctx, 'social_posts'), ...all(ctx, 'publications')])
  if (waiting.length)
    add({
      key: 'unpublished', kind: 'unpublished', area: 'content', priority: 'low', value: waiting.length, weight: waiting.length * 3,
      title: L(ctx, `${waiting.length} 篇内容写好了还没发`, `${waiting.length} pieces written but not published`),
      why: L(ctx, '写好不发不会带来访问。看一眼没问题就发出去，社媒也可以排期。', "Unpublished content brings no traffic. Give it a look and publish, or schedule social posts."),
      next: L(ctx, '去发布', 'Publish them'),
      action: { kind: 'go', view: 'content', params: { article: waiting[0].id } },
    })

  // 数据没接上：这些都算不出来
  const gsc = sites.filter((c) => c.type === 'creght_site' || c.type === 'website')
  if (gsc.length && !gsc.some((c) => c.gsc_property && !c.gsc_link_disabled))
    add({
      key: 'setup_gsc', kind: 'setup', area: 'setup', priority: 'low', value: 1, weight: 20,
      title: L(ctx, '还没连上 Google Search Console', 'Google Search Console is not connected'),
      why: L(ctx, '连上以后才能找出流量下滑的页面、差一点上首页的页面和有人搜没页面的词。', 'Without it there is no way to find declining pages, near-page-one pages or unmet searches.'),
      next: L(ctx, '去「谷歌排名」关联', 'Link it on the Google rankings page'),
      action: { kind: 'go', view: 'search' },
    })
  if (sites.length && !runs.some((r) => Date.parse(r.finished_at) > now - 30 * DAY))
    add({
      key: 'setup_geo', kind: 'setup', area: 'setup', priority: 'low', value: 1, weight: 10,
      title: runs.length ? L(ctx, 'AI 搜索推荐超过 30 天没检测了', 'No AI search check in over 30 days') : L(ctx, '还没检测过 AI 搜索推荐', 'AI search has never been checked'),
      why: L(ctx, '买家越来越多直接问 ChatGPT 找供应商，检测一次才知道 AI 推荐不推荐你。', 'More buyers ask ChatGPT for suppliers; a check shows whether AI recommends you.'),
      next: L(ctx, '去检测一次', 'Run a check'),
      action: { kind: 'go', view: 'geo' },
    })

  return out.sort((a, b) => b.score - a.score)
}

export function scan(_input: {}, ctx: any) {
  const items = signals(ctx)
  const existing: Row[] = all(ctx, 'growth_items')
  const byKey = new Map(existing.map((r) => [r.key, r]))
  const week = weekOf()
  const at = nowISO()
  const keep = new Set<string>()
  let added = 0
  for (const it of items) {
    keep.add(it.key)
    const old = byKey.get(it.key)
    const body: Record<string, unknown> = { ...it, action: JSON.stringify(it.action), scanned_at: at }
    if (!old) {
      ctx.db.insert('growth_items', { ...body, status: '', seen: false, first_seen: at })
      added++
      continue
    }
    // 做完的到了下一周、不用管的数量变多了：再出现，标成新的
    const back = (old.status === 'done' && old.status_week !== week) || (old.status === 'dismissed' && it.value > (old.status_value ?? 0))
    if (back) Object.assign(body, { status: '', status_value: 0, status_week: '', seen: false })
    ctx.db.update('growth_items', old.id, body)
  }
  for (const old of existing) if (!keep.has(old.key)) ctx.db.delete('growth_items', old.id)
  return { items: items.length, new: added, high: items.filter((i) => i.priority === 'high').length }
}

export function list(_input: {}, ctx: any) {
  const rows: Row[] = all(ctx, 'growth_items')
  const rank = (r: Row) => (r.status ? 0 : 1000) + (r.score ?? 0)
  const scanned_at = rows.map((r) => r.scanned_at ?? '').sort().pop() ?? ''
  return { scanned_at, items: rows.sort((a, b) => rank(b) - rank(a)).map((r) => ({ ...r, action: parse<Action | null>(r.action, null) })) }
}

export function mark(input: { id: string; status: '' | 'done' | 'dismissed' }, ctx: any) {
  const r: Row | null = ctx.db.get('growth_items', input?.id)
  if (!r) throw new Error(L(ctx, '找不到这条机会，可能已经重新算过了', 'Item not found; it may have been recalculated'))
  const status = input.status === 'done' || input.status === 'dismissed' ? input.status : ''
  ctx.db.update('growth_items', r.id, { status, status_value: status ? r.value : 0, status_week: status ? weekOf() : '', seen: true })
  return { ok: true }
}

export function markSeen(input: { ids?: string[] }, ctx: any) {
  const ids = input?.ids?.length ? new Set(input.ids) : null
  let n = 0
  for (const r of all(ctx, 'growth_items') as Row[]) if (!r.seen && (!ids || ids.has(r.id))) (ctx.db.update('growth_items', r.id, { seen: true }), n++)
  return { marked: n }
}
