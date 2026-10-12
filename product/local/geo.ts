import { profile, projectBrief, siteBase as base, siteDigest } from './_ai'
import { status } from './_creght'
import { L } from './_i18n'

// 要电脑的（浏览器、本机授权、密钥、外部接口）：手机上点了转给电脑上开着的 Shuttle 跑（设置 → 远程访问）
export const remote = ['check', 'brandQuestions']

// AI 搜索检测（本机函数，Shuttle 在用户电脑上直接跑，不经过助手）。拿问题逐条问 ChatGPT（联网搜索），按问题类型看三件事：
//
//   1. AI 怎么介绍你（intent=brand 的品牌问题）：买家已经知道你、在用 AI 横向对比时，AI 是怎么说的。
//      只记下事实（回答原文、引用的网址），不判断对错：什么是对的系统不知道，资料也可能过时，由用户看了自己判断；
//      用户标出说错的地方（geo_results.user_report）后，交给助手查出处、写修正建议。
//   2. AI 推荐了谁（其余问题）：回答引用了哪些站、有没有本站；页面上按网站汇总，再对照 GSC 排名和本站文章。
//   3. 可见度：只按第 2 类问题算（品牌问题必然提到你，不算）。
//
// 结果写进 geo_runs（一次检测一条）和 geo_results（每个问题一条）。
//
//   geo.check({ channel_id?, model? })            channel_id 不填 = 所有准备好问题的独立站（每周定时）；只问问题库里启用的，不自动加问题
//   geo.check({ channel_id, retry_run_id })       只重问那次检测里失败的问题，结果并进那次检测
//   geo.brandQuestions({ channel_id, preview?, keys? })  按公司资料和产品套常见问法补品牌问题（不用 AI；source=auto，已有的不重复）；preview 只列不写，keys 只加勾选的
//   geo.engines() / geo.saveEngine({ engine, enabled?, provider?, model? })   检测设置：用 Shuttle 设置 → 模型 里的哪个服务商、哪个模型（存 geo_engines）
//   geo.factsContext({ result_id })               用户标出 AI 说错的地方后，修正要的上下文（任务 tasks/geo-fix-facts.md）
//   geo.saveFix({ result_id, note })              存修正建议（geo_results.fix_note，页面上显示在错误下面）
//   geo.questionsContext({ channel_id })          生成推荐类问题要的上下文（任务 tasks/geo-questions.md）
//   geo.saveQuestions({ channel_id, questions })  把助手想好的问题去重写进问题库（status=active、source=agent）
//
//   页面：runLocal('geo.check', { channel_id })
//   命令行：annulo run geo.check --input '{"channel_id":"..."}'
//
// ChatGPT 用 Annulo 里用户选的服务商和模型联网搜索后回答（ctx.llm({ web_search: true })，能力版本 40；模板不存 key）：
// 接口服务商要支持 OpenAI Responses（OpenAI 官方、兼容的代理、creght 平台标了能联网搜索的模型），
// 也能用本机的 Codex / Claude Code（用它们自己的账号和搜索，一个问题一两分钟）。

type Input = { channel_id?: string; engine?: string; model?: string; retry_run_id?: string }
/** 一次检测的结论（geo_runs.summary，JSON）：页面上检测卡片显示它，跑完的提示也读它 */
type Summary = {
  asker: string
  brand_asked: number
  brand_cited: number
  questions: number
  cited: number
  mentioned: number
  visibility: number
  /** 上一次检测的可见度（没有推荐类问题、没测过是 null） */
  prev_visibility: number | null
  failed: { question_id: string; question: string; error: string }[]
  /** 和这个问题上一次的结果比：这次新引用了本站 / 这次没引用（上次引用了）/ 第一次问 */
  gained: string[]
  lost: string[]
  fresh: string[]
}

type Channel = { id: string; name: string; type: string; project_id?: string; site_id?: string; preview_url?: string }
type Question = { id: string; question: string; channel_id: string; status?: string; intent?: string; auto_key?: string }
/** 一次联网搜索：搜了什么（queries）、打开了哪个页面（url）、搜到的网址（sources） */
type Search = { type: string; queries: string[]; url?: string; sources: string[] }
type Answer = { answer: string; urls: string[]; tokens: number; searches?: Search[] }
/** geo_engines 的一行：一个引擎的设置 */
type EngineConf = { id?: string; engine: string; enabled?: boolean; provider?: string; model?: string }
type Via = { provider: string; label: string }
type Engine = {
  key: string
  name: string
  nameEn: string
  /** 默认模型（geo_engines 里没设时用） */
  model: (ctx: any) => string
  /** 选服务商时的提示：要哪种服务商 */
  hint: string
  hintEn: string
  ask: (via: Via, model: string, question: string, ctx: any) => Promise<Answer>
}

// 这些域名出现在引用里不算竞品：搜索引擎、百科、社媒、问答社区
const NOT_COMPETITOR = ['google.', 'bing.com', 'baidu.com', 'wikipedia.org', 'youtube.com', 'reddit.com', 'x.com', 'twitter.com', 'facebook.com', 'linkedin.com', 'zhihu.com', 'github.com', 'medium.com', 'quora.com', 'stackoverflow.com', 'baike.baidu.com', 'douyin.com', 'xiaohongshu.com', 'bilibili.com', 'toutiao.com', 'weixin.qq.com', 'sohu.com', '163.com']

// 本机函数里没有浏览器的 URL 对象，用正则取域名
const hostOf = (u: string) => (/^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(u)?.[1] ?? '').replace(/^www\./, '').toLowerCase()
const matches = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith('.' + d))
const splitTerms = (s?: string) => (s ?? '').split(/[,，、;；\n]/).map((x) => x.trim()).filter(Boolean)

/** 这个渠道站点的所有域名：预览域名 + 发布后的域名（自定义域名、系统域名） */
async function siteDomains(ch: Channel, ctx: any): Promise<string[]> {
  const out = new Set<string>()
  if (ch.preview_url) out.add(hostOf(ch.preview_url))
  if (ch.project_id && ch.site_id) {
    try {
      const st = await status(ctx, ch.project_id, ch.site_id)
      if (st?.system_domain) out.add(String(st.system_domain).toLowerCase())
      for (const d of st?.domains ?? []) if (d?.domain) out.add(String(d.domain).replace(/^www\./, '').toLowerCase())
    } catch (e: any) {
      ctx.log(L(ctx, '读不到站点的发布域名，只按预览域名判断：', "Couldn't read the site's published domains, checking against the preview domain only: ") + e.message)
    }
  }
  out.delete('')
  return [...out]
}

// 正常问，不加「只输出 JSON」之类的指令：要的是 AI 真实回答的样子
const ENGINES: Engine[] = [
  {
    key: 'openai',
    name: 'ChatGPT',
    nameEn: 'ChatGPT',
    model: () => 'gpt-5.5',
    hint: '选一个支持 OpenAI Responses 接口的服务商（OpenAI 官方，或兼容的代理），或者本机的 Codex；在 Annulo 的 设置 → 模型 里添加',
    hintEn: "pick a provider that supports the OpenAI Responses API (OpenAI itself or a compatible proxy), or the local Codex; add it in Annulo's Settings → Models",
    async ask(via, model, question, ctx) {
      // 正常问；有的接口不给引用注释，让它像 ChatGPT 网页版那样把来源写成链接，才判断得了引用了谁
      const r = await ctx.llm({
        provider: via.provider,
        model,
        web_search: true,
        system: 'You are ChatGPT, answering a user who is researching suppliers and products. When you use web search, cite each source inline as a Markdown link to the page you used.',
        prompt: question,
      })
      return { answer: r.text ?? '', urls: (r.sources ?? []).map((x: any) => x.url), tokens: r.tokens ?? 0, searches: r.searches ?? [] }
    },
  },
]

// ---- 品牌问题：按公司资料自动拼 ----

/** 品牌词（小写）：资料里的品牌词、公司名、网站名，3 个字符以上 */
function brandTerms(p: any, ch: Channel): string[] {
  return [...new Set([...splitTerms(p?.brand_terms), String(p?.name || '').trim(), (ch.name || '').trim()].filter((x) => x.length >= 3).map((x) => x.toLowerCase()))]
}

/** 品牌问题：标了 intent=brand，或者问题里带着品牌词 / 公司名（带品牌的问题必然提到你，看的是 AI 怎么介绍你，不算可见度） */
const isBrandQ = (q: Question, brands: string[]) => q.intent === 'brand' || brands.some((b) => q.question.toLowerCase().includes(b))

/** 买家会怎么称呼你：品牌词的第一个，没有用项目名称、网站名称 */
function brandOf(p: any, ch: Channel) {
  return splitTerms(p?.brand_terms)[0] || String(p?.name || '').trim() || ch.name
}

/** 问题用什么语言：外贸模板默认英文；重点市场只写了国内才用中文 */
function questionLang(p: any): 'en' | 'zh' {
  const m = String(p?.markets ?? '')
  if (!m) return 'en'
  return /中国|国内|大陆|China|mainland/i.test(m) && !/海外|欧|美|亚|非|中东|全球|global|world|US|EU|Europe|America|Asia|Africa|Middle East/i.test(m.replace(/中国|国内|大陆|China|mainland/gi, '')) ? 'zh' : 'en'
}

const activeProducts = (ctx: any): any[] => {
  try {
    return (ctx.db.query('products', { limit: 200 }).list as any[]).filter((x) => x.status !== 'hidden')
  } catch {
    return []
  }
}

/** 品牌问题的句式：key 用来去重（用户删了不会自动补回来，点「按资料补齐」才补） */
function brandTemplates(p: any, ch: Channel, products: any[]) {
  const b = brandOf(p, ch)
  const category = products.find((x) => x.category)?.category || splitTerms(p?.business)[0] || ''
  const zh = questionLang(p) === 'zh'
  const out: { key: string; question: string; keywords: string }[] = zh
    ? [
        { key: 'about', question: `${b}是一家什么样的公司？主要做哪些产品？`, keywords: `${b},公司介绍` },
        { key: 'products', question: `${b}一共有多少款产品或产品线？请分别列出来。`, keywords: `${b},产品` },
        { key: 'terms', question: `从${b}采购，起订量、交期、价格大概多少？有哪些认证？`, keywords: `${b},起订量,交期,认证` },
        { key: 'role', question: `${b}是工厂还是贸易商？在哪里？能做 OEM/ODM 定制吗？`, keywords: `${b},工厂,定制` },
        { key: 'website', question: `${b}的官网是哪个？`, keywords: `${b},官网` },
      ]
    : [
        { key: 'about', question: `What kind of company is ${b}, and what products does it make?`, keywords: `${b}, company` },
        { key: 'products', question: `How many products or product lines does ${b} offer? Please list them.`, keywords: `${b}, products` },
        { key: 'terms', question: `If I source from ${b}, what are the MOQ, lead time and price range, and which certifications do they have?`, keywords: `${b}, MOQ, lead time, certifications` },
        { key: 'role', question: `Is ${b} a manufacturer or a trading company? Where is it located, and does it offer OEM/ODM?`, keywords: `${b}, manufacturer, OEM` },
        { key: 'website', question: `What is the official website of ${b}?`, keywords: `${b}, website` },
      ]
  if (category)
    out.push(
      zh
        ? { key: 'compare', question: `${b}和其他${category}供应商比怎么样？优势和不足是什么？`, keywords: `${b},${category},对比` }
        : { key: 'compare', question: `How does ${b} compare with other ${category} suppliers? What are its strengths and weaknesses?`, keywords: `${b}, ${category}, comparison` },
    )
  for (const x of products.slice(0, 2))
    out.push(
      zh
        ? { key: `product:${x.id}`, question: `介绍一下${b}的${x.name}：规格、起订量和价格。`, keywords: `${b},${x.name}` }
        : { key: `product:${x.id}`, question: `Tell me about ${b}'s ${x.name}: specs, MOQ and price.`, keywords: `${b}, ${x.name}` },
    )
  return out
}

/** 补齐这个网站的品牌问题（source=auto、intent=brand），已有的 key 不重复 */
/** preview: true 只列出会加哪些、不写；keys 只加这几个（弹窗里勾选的），不传 = 全加 */
export function brandQuestions(input: { channel_id: string; preview?: boolean; keys?: string[] }, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  const p = profile(ctx)
  if (!p?.name && !p?.brand_terms) throw new Error(L(ctx, '还没填公司资料：先到「公司与产品」填公司名称和品牌词', 'No company profile yet: fill in the company name and brand terms under "Company & products" first'))
  const existing = ctx.db.query('geo_questions', { where: { channel_id: ch.id }, limit: 300 }).list as Question[]
  const keys = new Set(existing.map((q) => q.auto_key).filter(Boolean))
  const texts = new Set(existing.map((q) => q.question.trim()))
  const added: string[] = []
  const todo = brandTemplates(p, ch, activeProducts(ctx)).filter((t) => !keys.has(t.key) && !texts.has(t.question))
  if (input.preview) return { candidates: todo.map((t) => ({ key: t.key, question: t.question })), brand: brandOf(p, ch) }
  for (const t of todo) {
    if (input.keys && !input.keys.includes(t.key)) continue
    ctx.db.insert('geo_questions', { channel_id: ch.id, question: t.question, intent: 'brand', keywords: t.keywords, status: 'active', source: 'auto', auto_key: t.key })
    added.push(t.question)
  }
  return { added, brand: brandOf(p, ch) }
}

// ---- 公司资料 ----

/** 公司资料（定位 + 产品库 + 官网域名），给助手查 AI 说错的地方时参考：资料可能过时、产品可能没录全，以用户说的为准 */
function factSheet(ctx: any, domains: string[]) {
  const p = profile(ctx)
  const products = activeProducts(ctx)
  const list = products.slice(0, 60).map((x) => {
    const parts = [x.name, x.model && `型号 ${x.model}`, x.category && `分类 ${x.category}`, x.moq && `起订量 ${x.moq}`, x.lead_time && `交期 ${x.lead_time}`, x.price && `价格 ${x.price}`, x.certs && `认证 ${x.certs}`, x.url && `页面 ${x.url}`]
    return '- ' + parts.filter(Boolean).join('；')
  })
  return [
    projectBrief(p),
    `品牌词：${p?.brand_terms || p?.name || ''}`,
    `官网域名：${domains.join('、') || '（未知）'}`,
    `产品库里登记的在售产品 ${products.length} 款（用户登记的主推产品，网站上可能还有更多）${products.length > 60 ? '，下面列前 60 款' : ''}：`,
    ...(list.length ? list : ['（产品库是空的）']),
  ].join('\n')
}

// ---- 检测 ----

/** 这次是谁在答：本机 Claude Code 测的是 Claude，不是 ChatGPT，要说清楚 */
function askerOf(p: any, ctx: any): string {
  if (p?.kind === 'cli') return p.id === 'claude-code' ? L(ctx, 'Claude（本机 Claude Code）', 'Claude (local Claude Code)') : L(ctx, 'ChatGPT（本机 Codex）', 'ChatGPT (local Codex)')
  return p?.name ? `ChatGPT · ${p.name}` : 'ChatGPT'
}

export async function check(input: Input, ctx: any) {
  if (input?.channel_id) return checkOne(input, ctx)
  // 不指定渠道（每周定时就是这样调）：有启用问题的独立站逐个测，一个失败不影响别的
  const sites: Channel[] = (ctx.db.query('channels', { limit: 200 }).list as Channel[]).filter((c) => c.type === 'creght_site' || c.type === 'wordpress')
  const out: any[] = []
  for (const ch of sites) {
    if (!ctx.db.query('geo_questions', { where: { channel_id: ch.id, status: 'active' }, limit: 1 }).list.length) continue
    try {
      out.push({ channel_id: ch.id, name: ch.name, ...(await checkOne({ ...input, channel_id: ch.id }, ctx)) })
    } catch (e: any) {
      out.push({ channel_id: ch.id, name: ch.name, error: e.message })
    }
  }
  if (!out.length) return { channels: [], note: L(ctx, '没有准备好问题的独立站，没有可测的', 'No site has questions ready, so there is nothing to check') }
  if (out.every((o) => o.error)) throw new Error(out.map((o) => `${o.name}${L(ctx, '：', ': ')}${o.error}`).join(L(ctx, '；', '; ')))
  return { channels: out }
}

async function checkOne(input: Input, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  const confs = engineConfs(ctx)
  const providers = llmProviders(ctx)
  const engine = ENGINES[0]
  const r0 = resolveEngine(engine, { ...confs[engine.key], engine: engine.key, enabled: true }, providers, ctx)
  if (!r0.via) throw new Error(`${L(ctx, engine.name, engine.nameEn)}${L(ctx, '：', ': ')}${r0.reason}`)
  const via = r0.via

  const pv = providers.find((x) => x.id === via.provider)
  const asker = askerOf(pv, ctx)
  const brands = brandTerms(profile(ctx), ch)
  let questions: Question[]
  let run: any
  if (input.retry_run_id) {
    // 重试：只问那次失败的问题，结果并进那次检测
    run = ctx.db.get('geo_runs', input.retry_run_id)
    if (!run || run.channel_id !== ch.id) throw new Error(L(ctx, '找不到要重试的那次检测', "Couldn't find the check to retry"))
    const ids = new Set(parseSummary(run.summary)?.failed.map((f) => f.question_id) ?? [])
    questions = (ctx.db.query('geo_questions', { where: { channel_id: ch.id }, limit: 300 }).list as Question[]).filter((q) => ids.has(q.id))
    if (!questions.length) throw new Error(L(ctx, '那次检测没有失败的问题要重试', 'That check has no failed questions to retry'))
  } else {
    // 只问问题库里启用的；不替用户加问题（品牌问题由用户在页面上「添加常见品牌问题」确认后加）
    questions = ctx.db.query('geo_questions', { where: { channel_id: ch.id, status: 'active' }, limit: 100 }).list
    if (!questions.length) throw new Error(L(ctx, `渠道「${ch.name}」还没有启用的问题：先在页面上「添加常见品牌问题」或「生成问题」`, `Channel "${ch.name}" has no active questions: use "Add common brand questions" or "Generate questions" on the page first`))
  }
  const domains = await siteDomains(ch, ctx)
  // 品牌问题在前：最要紧的先出结果
  questions.sort((a, b) => Number(isBrandQ(b, brands)) - Number(isBrandQ(a, brands)))
  const model = input.model || modelFor(engine, confs[engine.key], pv, ctx)
  const meta = { engine: engine.key, model, provider: via.provider, provider_name: asker }
  if (run) ctx.db.update('geo_runs', run.id, { ...meta, finished_at: '', seen_at: '' })
  else run = ctx.db.insert('geo_runs', { channel_id: ch.id, ...meta, questions: questions.length, cited: 0, mentioned: 0, visibility: 0, started_at: new Date().toISOString() })

  let answered = 0
  const failed: Summary['failed'] = parseSummary(run.summary)?.failed.filter((f) => !questions.some((q) => q.id === f.question_id)) ?? []
  const total = questions.length
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const isBrand = isBrandQ(q, brands)
    // 进度带上 question_id、问题原文和现在在做什么（step）：页面上把正在问的那一行标出来，按钮下面显示完整的一句
    const say = (zh: string, en: string) =>
      ctx.progress({ done: i, total, question_id: q.id, question: q.question, step: L(ctx, zh, en), message: L(ctx, `第 ${i + 1}/${total} 个，${zh}：${q.question}`, `${i + 1}/${total}, ${en}: ${q.question}`) })
    say(`正在问 ${asker}`, `asking ${asker}`)
    let r: Answer
    try {
      r = await engine.ask(via, model, q.question, ctx)
    } catch (e: any) {
      failed.push({ question_id: q.id, question: q.question, error: e.message })
      if (/401/.test(e.message)) {
        // key 不对，后面也不用问了：剩下的记成同样的失败，改好后「重试失败的」一起重问
        for (const rest of questions.slice(i + 1)) failed.push({ question_id: rest.id, question: rest.question, error: e.message })
        break
      }
      continue
    }
    const uniq = [...new Set(r.urls)]
    const hits = uniq.filter((u) => matches(hostOf(u), domains))
    const isCited = hits.length > 0
    // 提到了但没给链接：正文里出现域名或品牌名。问题里本来就有的品牌词不算（AI 复述问题里的名字，不代表它知道你）
    const lower = r.answer.toLowerCase()
    const asked = q.question.toLowerCase()
    const isMentioned = !isCited && (domains.some((d) => lower.includes(d)) || brands.some((b) => !asked.includes(b) && lower.includes(b)))
    const competitors = [...new Set(uniq.map(hostOf).filter((h) => h && !matches(h, domains) && !NOT_COMPETITOR.some((n) => h.includes(n))))].slice(0, 5)
    const row: Record<string, unknown> = {
      channel_id: ch.id,
      run_id: run.id,
      question_id: q.id,
      question: q.question,
      kind: isBrand ? 'facts' : 'recommend',
      engine: engine.key,
      model,
      cited: isCited,
      mentioned: isMentioned,
      cited_urls: JSON.stringify(hits),
      competitor_domains: JSON.stringify(competitors),
      answer_excerpt: r.answer.slice(0, 800),
      // 完整回答和回答引用的全部网址：页面上「回答和引用」看
      answer: r.answer.slice(0, 20000),
      urls: JSON.stringify(uniq.slice(0, 100)),
      searches: JSON.stringify((r.searches ?? []).slice(0, 30)),
      tokens: r.tokens,
    }
    ctx.db.insert('geo_results', row)
    answered++
  }

  const sum = summarize(ctx, ch, run.id, asker, failed)
  const note = failed.length ? L(ctx, `${failed.length} 条没问成`, `${failed.length} failed`) : ''
  ctx.db.update('geo_runs', run.id, { questions: sum.questions, cited: sum.cited, mentioned: sum.mentioned, visibility: sum.visibility, fact_questions: sum.brand_asked, note, summary: JSON.stringify(sum), finished_at: new Date().toISOString(), seen_at: '' })
  if (!answered) throw new Error(L(ctx, '一个问题都没问成：', 'No question could be asked: ') + failed.map((f) => f.error).join('; ').slice(0, 600))
  ctx.progress({
    done: total,
    total,
    message: L(ctx, `检测完成：问了 ${sum.brand_asked} 个品牌问题；推荐类 ${sum.cited}/${sum.questions} 引用了本站`, `Done: asked ${sum.brand_asked} brand questions; ${sum.cited}/${sum.questions} recommendation answers cited your site`),
  })
  return { domains, run_id: run.id, model, summary: sum }
}

function parseSummary(s?: string): Summary | null {
  try {
    const v = JSON.parse(s || '')
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

/** 这次检测的结论：按这次检测里每个问题的结果算（重试并进来的也算），再和每个问题上一次的结果、上一次检测的可见度比 */
function summarize(ctx: any, ch: Channel, runId: string, asker: string, failed: Summary['failed']): Summary {
  // 重试过的问题这次检测里有两条结果：按时间倒序，取新的那条
  const rows = (ctx.db.query('geo_results', { where: { run_id: runId }, limit: 500 }).list as any[]).sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0))
  const byQ = new Map<string, any>()
  for (const r of rows) if (r.question_id && !byQ.has(r.question_id)) byQ.set(r.question_id, r)
  const s: Summary = { asker, brand_asked: 0, brand_cited: 0, questions: 0, cited: 0, mentioned: 0, visibility: 0, prev_visibility: null, failed, gained: [], lost: [], fresh: [] }
  for (const [qid, r] of byQ) {
    if (r.kind === 'facts') {
      s.brand_asked++
      if (r.cited) s.brand_cited++
    } else {
      // 可见度只算推荐类问题：品牌问题必然提到你
      s.questions++
      if (r.cited) s.cited++
      if (r.mentioned) s.mentioned++
    }
    const prev = (ctx.db.query('geo_results', { where: { question_id: qid }, limit: 20 }).list as any[])
      .filter((x) => x.run_id !== runId)
      .sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0))[0]
    if (!prev) s.fresh.push(qid)
    else if (!!prev.cited !== !!r.cited) (r.cited ? s.gained : s.lost).push(qid)
  }
  s.visibility = s.questions ? Math.round((s.cited / s.questions) * 100) : 0
  const prevRun = (ctx.db.query('geo_runs', { where: { channel_id: ch.id }, limit: 50 }).list as any[])
    .filter((x) => x.id !== runId && x.finished_at && (x.questions ?? 0) > 0)
    .sort((a, b) => (Date.parse(b.finished_at || '') || 0) - (Date.parse(a.finished_at || '') || 0))[0]
  if (prevRun) s.prev_visibility = prevRun.visibility ?? 0
  return s
}

// ---- 修正 AI 说错的地方（任务 tasks/geo-fix-facts.md） ----

/** 修正要的上下文：用户标出的说错的地方，AI 的回答和引用，公司资料（可能过时），站点内容 */
export async function factsContext(input: { result_id: string }, ctx: any) {
  const r = ctx.db.get('geo_results', input?.result_id)
  if (!r) throw new Error(L(ctx, '没有这条检测结果：', 'No such result: ') + input?.result_id)
  if (!String(r.user_report ?? '').trim()) throw new Error(L(ctx, '用户还没标出哪里说错了：先在页面上写清楚，再交给助手', "The user hasn't marked what's wrong yet: write it on the page first"))
  const ch: Channel | null = ctx.db.get('channels', r.channel_id)
  if (!ch) throw new Error(L(ctx, '这条结果的网站已经删掉了', "This result's site was deleted"))
  const parse = (s: string) => {
    try {
      return JSON.parse(s || '[]')
    } catch {
      return []
    }
  }
  const domains = await siteDomains(ch, ctx)
  ctx.progress({ message: L(ctx, `在读「${ch.name}」的网站…`, `Reading the "${ch.name}" site…`) })
  return {
    site: { id: ch.id, name: ch.name, domains, digest: (await siteDigest(await base(ch, ctx), ctx, 5)) || L(ctx, '（读不到）', '(unreadable)') },
    question: r.question,
    answer: r.answer || r.answer_excerpt || '',
    urls: parse(r.urls),
    report: r.user_report,
    facts: factSheet(ctx, domains),
  }
}

/** 存修正建议（Markdown），页面上显示在这条结果的错误下面 */
export function saveFix(input: { result_id: string; note: string }, ctx: any) {
  const r = ctx.db.get('geo_results', input?.result_id)
  if (!r) throw new Error(L(ctx, '没有这条检测结果：', 'No such result: ') + input?.result_id)
  const note = String(input?.note ?? '').trim()
  if (!note) throw new Error(L(ctx, '修正建议是空的', 'The fix note is empty'))
  ctx.db.update('geo_results', r.id, { fix_note: note.slice(0, 8000), fixed_at: new Date().toISOString() })
  return { ok: true }
}

// ---- 检测设置 ----

/** geo_engines 里各引擎的设置，按引擎 key */
function engineConfs(ctx: any): Record<string, EngineConf> {
  const out: Record<string, EngineConf> = {}
  for (const c of ctx.db.query('geo_engines', { limit: 50 }).list as EngineConf[]) if (c?.engine && !out[c.engine]) out[c.engine] = c
  return out
}

/** Annulo 设置 → 模型 里的服务商（不含 key）：接口服务商（kind: 'api'）和本机的 Claude Code / Codex（kind: 'cli'） */
const llmProviders = (ctx: any): any[] => (typeof ctx.llm?.providers === 'function' ? ctx.llm.providers() : [])

/**
 * 这个服务商能联网搜索的模型：creght 平台按它标的 web_search；本机 agent 都能（用它自己的搜索）。
 * 自己加的服务商不知道哪些能搜，返回 null（不限制，用户自己选）。给不能搜的模型发请求，接口照样 200 但一次也不搜，检测就没意义
 */
function searchModels(p: any): string[] | null {
  if (!p?.builtin && p?.kind !== 'cli') return null
  return (p.models ?? []).filter((m: any) => m.web_search).map((m: any) => m.model)
}

/** 引擎这次用的模型：设置里填的；没填用默认（creght 平台、本机 agent 用第一个能联网搜索的） */
function modelFor(e: Engine, conf: EngineConf | undefined, p: any, ctx: any) {
  return conf?.model?.trim() || searchModels(p)?.[0] || e.model(ctx)
}

/** 引擎这次怎么发请求；用不了时没有 via，reason 说为什么、去哪里解决 */
function resolveEngine(e: Engine, conf: EngineConf | undefined, providers: any[], ctx: any): { via?: Via; reason: string } {
  if (conf?.enabled === false) return { reason: L(ctx, '在检测设置里关掉了', 'turned off in check settings') }
  if (!conf?.provider) return { reason: L(ctx, '还没选服务商，到「检测设置」里选', 'no provider picked yet; choose one in check settings') }
  const p = providers.find((x) => x.id === conf.provider)
  if (!p) return { reason: L(ctx, `选的服务商在 Annulo 里找不到了，到「检测设置」重新选`, `the chosen provider is no longer in Annulo; pick another in check settings`) }
  if (!p.ready) return { reason: L(ctx, `服务商「${p.name}」现在用不了：${p.error || '在 设置 → 模型 里关掉了'}`, `provider "${p.name}" isn't usable: ${p.error || 'turned off in Settings → Models'}`) }
  const ok = searchModels(p)
  if (ok) {
    if (!ok.length) return { reason: L(ctx, `服务商「${p.name}」现在没有能联网搜索的模型，换一个服务商`, `provider "${p.name}" has no model that can search the web; pick another provider`) }
    const m = modelFor(e, conf, p, ctx)
    if (!ok.includes(m)) return { reason: L(ctx, `「${m}」不能联网搜索，到「检测设置」换成：${ok.join('、')}`, `"${m}" can't search the web; in check settings switch to: ${ok.join(', ')}`) }
  }
  return { via: { provider: p.id, label: p.name }, reason: '' }
}

/** 引擎的设置、能不能用，加上 Shuttle 里配好的服务商（选服务商用），页面「检测设置」用 */
export function engines(_: unknown, ctx: any) {
  const confs = engineConfs(ctx)
  const providers = llmProviders(ctx)
  return {
    // models：选模型的下拉框列出来的，search 是能不能联网搜索（creght 平台标了的；自己加的服务商不知道，是 null）；
    // default_model：这个服务商不填模型时用哪个
    providers: providers.map((p) => {
      const ok = searchModels(p)
      const models = (p.models ?? []).map((m: any) => ({ model: m.model, name: m.name || m.model, search: ok ? ok.includes(m.model) : null }))
      return { id: p.id, name: p.name, kind: p.kind || 'api', api: p.api, base_url: p.base_url, builtin: !!p.builtin, ready: !!p.ready, error: p.error || '', models, default_model: ok?.[0] || ENGINES[0].model(ctx) }
    }),
    engines: ENGINES.map((e) => {
      const c = confs[e.key]
      const r = resolveEngine(e, { ...c, engine: e.key, enabled: true }, providers, ctx)
      return {
        engine: e.key,
        name: L(ctx, e.name, e.nameEn),
        hint: L(ctx, e.hint, e.hintEn),
        enabled: true,
        provider: c?.provider ?? '',
        model: c?.model ?? '',
        default_model: modelFor(e, { engine: e.key }, providers.find((x) => x.id === c?.provider), ctx),
        legacy_key: '',
        ready: !!r.via,
        reason: r.reason,
      }
    }),
  }
}

/** 改引擎的设置：服务商（Shuttle 里的服务商 id，空 = 不选）、模型（空 = 默认） */
export function saveEngine(input: { engine: string; enabled?: boolean; provider?: string; model?: string }, ctx: any) {
  const e = ENGINES.find((x) => x.key === input?.engine)
  if (!e) throw new Error(L(ctx, `不认识的引擎 ${input?.engine}，可选：`, `Unknown engine ${input?.engine}; options: `) + ENGINES.map((x) => x.key).join(' / '))
  const patch: Record<string, unknown> = {}
  if (input.enabled !== undefined) patch.enabled = !!input.enabled
  if (input.model !== undefined) patch.model = String(input.model).trim()
  if (input.provider !== undefined) {
    const id = String(input.provider).trim()
    if (id && !llmProviders(ctx).some((p) => p.id === id)) throw new Error(L(ctx, `Annulo 里没有这个服务商：${id}`, `Annulo has no such provider: ${id}`))
    patch.provider = id
  }
  const c = engineConfs(ctx)[e.key]
  if (c?.id) ctx.db.update('geo_engines', c.id, patch)
  else ctx.db.insert('geo_engines', { engine: e.key, enabled: true, ...patch })
  return engines(null, ctx).engines.find((x) => x.engine === e.key)
}

export async function questionsContext(input: { channel_id: string }, ctx: any) {
  const ch = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  const project = profile(ctx)
  const existing = ctx.db.query('geo_questions', { where: { channel_id: ch.id }, limit: 200 }).list
  ctx.progress({ message: L(ctx, `在读「${ch.name}」的网站…`, `Reading the "${ch.name}" site…`) })
  const digest = await siteDigest(await base(ch, ctx), ctx, 5)
  return {
    project,
    brief: projectBrief(project),
    site: { id: ch.id, name: ch.name, digest: digest || L(ctx, '（读不到）', '(unreadable)') },
    existing: existing.map((q: any) => ({ question: q.question, intent: q.intent, status: q.status })),
  }
}

const INTENTS = ['commercial', 'comparison', 'informational', 'brand']

export function saveQuestions(input: { channel_id: string; questions: { question: string; intent?: string; keywords?: string }[] }, ctx: any) {
  const ch = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  const seen = new Set(ctx.db.query('geo_questions', { where: { channel_id: ch.id }, limit: 200 }).list.map((q: any) => String(q.question).trim()))
  const saved: string[] = []
  const skipped: string[] = []
  for (const q of input?.questions ?? []) {
    const question = String(q?.question ?? '').trim()
    if (!question) continue
    if (seen.has(question)) {
      skipped.push(question)
      continue
    }
    seen.add(question)
    const intent = INTENTS.includes(String(q?.intent)) ? String(q.intent) : 'informational'
    ctx.db.insert('geo_questions', { channel_id: ch.id, question, intent, keywords: String(q?.keywords ?? ''), status: 'active', source: 'agent' })
    saved.push(question)
  }
  if (!saved.length) throw new Error(L(ctx, '一个都没存：没有问题，或者都和已有的重复了', 'Nothing saved: no questions, or all duplicate existing ones'))
  return { saved, skipped }
}
