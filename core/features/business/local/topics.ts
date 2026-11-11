// 选题的取数和存表（本机函数，外贸和产品运营共用的 business 模块）。出选题本身交给助手按任务 tasks/suggest-topics.md 做（过程在对话里看得见、要求用户可改），
// 这里只管给它上下文、把它想好的选题去重存进 topics。
//
//   topics.context({ workspace?, channel_id?, question_ids?, competitor_page_ids?, source_ids?, playbook_id? })
//       项目资料、已有选题、网站上和后台已有的文章、站点内容；带 channel_id 时再给 GEO 里没被引用的问题（question_ids 指定就只给这几个）；
//       competitor_page_ids 给这几个竞品新页面（竞品模块），source_ids 给这几条灵感来源（灵感库模块），playbook_id 给那张风格卡；
//       有运营主题模块（产品运营）时合并它的上下文（用户场景、增长机会、运营主题、账号策略…）；自媒体选题带已发内容的表现（performance）
//   topics.save({ ideas: [{ title, angle, keywords, question_ids?, source_ids?, origins? }], source?, workspace?, question_ids?, source_ids?, origins?, playbook_id? })
//       带 playbook_id 的选题记下这张卡，写的时候照它写。去掉和已有选题重复的，写进 topics（status=idea），返回存了哪些。
//       每个选题记下出处（origins）和出它的对话（chat_id），从 AI 搜索出的（source=geo）必须说清回答的是哪几个问题；标题重复的不另建，把出处并进已有的那个（linked）。
//       网站文章的选题还和网站上、后台已有的文章、别的选题比（local/_overlap.ts）：换个说法的同一个主题、同一个主关键词也不存，列在 similar
//       出处的设计见 annulo templates 仓库的 docs/content-origins.md

import { L } from './_i18n'
import { profile, projectBrief, siteBase, siteDigest } from './_ai'
import { checkOrigins, mergeOrigins, questionOrigins, uncitedQuestions } from './_origins'
import { originsJson, type Origin } from '../lib/origins'
import { platformWorkspace } from '../lib/contentWorkspace'
import { allProducts } from './_catalog'
import { existingFor, overlap, siteFor, type Existing } from './_overlap'
import { forWriting } from './playbooks'
import { ranking } from './content-workspace'

declare const require: (path: string) => any

/** 只有部分模板有的模块（拼出来的路径：没有这个文件的模板打包时不报错）：运营主题 campaigns.ts、灵感库 inspiration.ts */
function optional(name: string): any {
  try {
    return require('./' + name + '.ts')
  } catch {
    return null
  }
}

type Topic = { id: string; title: string; status?: string; origins?: string; workspace?: string; target_platform?: string; source?: string }
type Idea = { title: string; angle?: string; keywords?: string; question_ids?: string[]; source_ids?: string[]; origins?: Origin[] }
/** topics.save 收的 source：AI 搜索、竞品分析里出的照记；带灵感来源的记 inspiration；其余是助手出的 */
const SOURCES = ['geo', 'competitor']

function productsOf(ctx: any) {
  return allProducts(ctx)
    .filter((p: any) => p.status !== 'hidden')
    .map((p: any) => ({ name: p.name, summary: p.summary, keywords: p.keywords }))
}

/** 灵感来源（灵感库模块）：选进来时的快照 */
function sourcesOf(ctx: any, ids: string[]) {
  if (!ids.length) return []
  const inspiration = optional('inspiration')
  if (!inspiration) throw new Error(L(ctx, '这个项目没有灵感库', 'This project has no inspiration library'))
  return ids.map((id) => inspiration.sourceSnapshot(ctx, id))
}

export async function context(input: { workspace?: string; channel_id?: string; question_ids?: string[]; competitor_page_ids?: string[]; source_ids?: string[]; playbook_id?: string }, ctx: any) {
  const project = profile(ctx)
  const workspace = input?.workspace || (input?.channel_id ? 'website' : '')
  const existing: Topic[] = ctx.db.query('topics', { limit: 500 }).list
  const site = input?.channel_id ? ctx.db.get('channels', input.channel_id) : ctx.db.query('channels', { where: { type: 'creght_site' }, limit: 1 }).list[0]
  if (input?.channel_id && !site) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input.channel_id)
  ctx.progress({ message: L(ctx, '在读项目和站点内容…', 'Reading the project and site…') })
  const digest = site ? await siteDigest(await siteBase(site, ctx), ctx, 4) : ''
  let out: Record<string, unknown> = {
    project,
    brief: projectBrief(project),
    existing: existing.map((t) => ({ title: t.title, status: t.status })),
    // 网站上和后台已有的文章：出的选题别和它们是同一个主题
    existing_posts: (await existingFor(ctx, site)).filter((e) => e.source !== 'topic').slice(0, 200).map((e) => e.title),
    products: productsOf(ctx),
    site: site ? { id: site.id, name: site.name, digest: digest || L(ctx, '（读不到）', '(unreadable)') } : null,
    workspace,
    channel_id: input?.channel_id || '',
    sources: sourcesOf(ctx, [...new Set<string>(input?.source_ids || [])]),
  }
  // 运营主题模块（产品运营）：用户场景、增长机会、运营主题、账号策略…；产品用它给的完整事实
  const campaigns = optional('campaigns')
  if (campaigns?.context) out = { ...out, ...campaigns.context({}, ctx) }
  // 自媒体选题参考已发内容的表现：哪些主题、形式、切入点数据好，哪些差（读不到社媒数据就没有这项）
  if (workspace !== 'website') {
    try {
      const performance = ranking({}, ctx)
      if (performance?.published) out.performance = performance
    } catch {}
  }
  if (input?.channel_id) out.geo_questions = uncitedQuestions(ctx, site.id, input.question_ids)
  if (input?.competitor_page_ids?.length) out.competitor_pages = competitorPages(ctx, input.competitor_page_ids)
  if (input?.playbook_id) {
    const playbook = forWriting(ctx, input.playbook_id)
    if (!playbook) throw new Error(L(ctx, '没有这张风格卡', 'No such playbook'))
    out.playbook = playbook
  }
  return out
}

/** 用户在竞品监控里勾的几个新页面：标题、描述、类型、是哪家；已经转成选题的标上 topic_id */
function competitorPages(ctx: any, ids: string[]) {
  return [...new Set(ids)].slice(0, 50).map((id) => {
    const p = ctx.db.get('competitor_pages', id)
    if (!p) throw new Error(L(ctx, '没有这条竞品新页面：', 'No such competitor page: ') + id)
    const c = ctx.db.get('competitors', p.competitor_id)
    return { id: p.id, url: p.url, kind: p.kind, title: p.title ?? '', description: p.description ?? '', competitor: c ? { id: c.id, name: c.name } : null, topic_id: p.topic_id ?? '' }
  })
}

export async function save(input: { ideas: Idea[]; source?: string; workspace?: string; question_ids?: string[]; source_ids?: string[]; origins?: Origin[]; playbook_id?: string }, ctx: any) {
  const playbook = input?.playbook_id ? forWriting(ctx, input.playbook_id) : null
  if (input?.playbook_id && !playbook) throw new Error(L(ctx, '没有这张风格卡', 'No such playbook'))
  const sourceIds = [...new Set<string>([...(input?.source_ids || []), ...(input?.ideas || []).flatMap((x) => x?.source_ids || [])])]
  const snapshots = new Map(sourcesOf(ctx, sourceIds).map((s: any, i) => [sourceIds[i], s]))
  const source = sourceIds.length ? 'inspiration' : SOURCES.includes(String(input?.source)) ? String(input.source) : 'agent'
  // 在网站文章 / 社媒内容里出的选题记下归属；AI 搜索推荐、竞品来的总是网站
  const workspace = SOURCES.includes(source) ? 'website' : ['website', 'social'].includes(String(input?.workspace)) ? String(input.workspace) : ''
  const shared = [...questionOrigins(ctx, input?.question_ids), ...checkOrigins(ctx, input?.origins), ...(playbook ? [{ type: 'playbook', id: playbook.id, label: playbook.name }] : [])]
  const existing: Topic[] = ctx.db.query('topics', { limit: 1000 }).list
  // 标题一样（不分大小写）算重复；只和同一个工作区（或者还没归属）的比：同一个题目网站写一篇、社媒发一条是正常的
  const workspaceOf = (t: Topic) => t.workspace || platformWorkspace(t.target_platform) || (['search', 'geo', 'competitor'].includes(t.source || '') ? 'website' : '')
  const key = (title: string) => title.trim().toLowerCase()
  const byTitle = new Map(existing.filter((t) => !workspace || !workspaceOf(t) || workspaceOf(t) === workspace).map((t) => [key(t.title), t]))
  const chat_id = String(ctx.chat_id ?? '')
  const saved: string[] = []
  const skipped: string[] = []
  const linked: string[] = []
  // 社媒的选题不比：同一个主题在社媒上换平台、换场景发是正常的
  const posts: Existing[] = workspace === 'social' ? [] : await existingFor(ctx, siteFor(ctx))
  const similar: { title: string; to: string; reason: string }[] = []
  const topic_ids: string[] = []
  const inspiration = sourceIds.length ? optional('inspiration') : null
  for (const x of input?.ideas ?? []) {
    const title = String(x?.title ?? '').trim()
    if (!title) continue
    const ids = [...new Set([...(input?.source_ids || []), ...(x?.source_ids || [])])]
    const origins: Origin[] = [...shared, ...questionOrigins(ctx, x?.question_ids), ...checkOrigins(ctx, x?.origins),
      ...ids.map((id) => ({ type: 'inspiration_source', id, label: snapshots.get(id)?.title || '' }))]
    if (source === 'geo' && !origins.some((o) => o.type === 'geo_question')) throw new Error(L(ctx, `「${title}」没写回答的是哪几个 AI 搜索问题：每个选题带上 question_ids`, `"${title}" doesn't say which AI search questions it answers: give each idea question_ids`))
    const old = byTitle.get(key(title))
    if (old) {
      if (mergeOrigins(ctx, old, origins)) linked.push(title)
      else skipped.push(title)
      continue
    }
    const o = workspace === 'social' ? null : overlap(title, x?.keywords, posts)
    if (o?.verdict === 'duplicate') {
      // 重的是一个还没写的选题：这次的出处（AI 搜索的问题、竞品）并进那个选题，和标题一样时一个做法
      const same = o.similar.find((m) => m.reason !== 'related')!
      const old = same.source === 'topic' && same.id ? existing.find((t) => t.id === same.id) : null
      if (old && mergeOrigins(ctx, old, origins)) linked.push(title)
      else similar.push({ title, to: same.title, reason: same.reason })
      continue
    }
    const row = ctx.db.insert('topics', {
      title, angle: String(x?.angle ?? '').trim(), keywords: String(x?.keywords ?? '').trim(), source, status: 'idea',
      ...(origins.length ? { origins: originsJson(origins) } : {}), ...(chat_id ? { chat_id } : {}), ...(playbook ? { playbook_id: playbook.id } : {}), created_at: new Date().toISOString(),
      ...(workspace ? { workspace, content_type: workspace === 'website' ? 'article' : 'post', ...(workspace === 'website' ? { target_platform: 'website' } : {}) } : {}),
    })
    byTitle.set(key(title), row)
    // 从灵感来源出的：记一条引用（灵感库里能看到它被用在哪）
    for (const id of ids) inspiration?.link({ source_id: id, target_type: 'topic', target_id: row.id }, ctx)
    // 从竞品新页面出的：那几条标成已转选题、看过（竞品监控里显示「已转选题」）
    for (const o of origins) if (o.type === 'competitor_page' && ctx.db.get('competitor_pages', o.id)) ctx.db.update('competitor_pages', o.id, { topic_id: row.id, seen: true })
    posts.push({ id: row.id, title, keywords: row.keywords, source: 'topic' })
    topic_ids.push(row.id)
    saved.push(title)
  }
  if (!saved.length && !linked.length) throw new Error(L(ctx, `一个都没存：没有标题，或者都和已有的选题、文章重复了${similar.length ? `（${similar.map((x) => `「${x.title}」≈「${x.to}」`).join('；')}）` : ''}`, `Nothing saved: no titles, or all duplicate existing topics or articles${similar.length ? ` (${similar.map((x) => `"${x.title}" ≈ "${x.to}"`).join('; ')})` : ''}`))
  return { saved, skipped, linked, similar, topic_ids }
}
