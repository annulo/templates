import { profile, projectBrief, siteBase as base, siteDigest } from './_ai'
import { status } from './_creght'
import { L } from './_i18n'
import { ask as aichatAsk, sites as aichatSites } from './aichat'

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
//   geo.askContext({ result_id })                 用户就一条回答问助手（为什么没引用、怎么优化、说错了…）要的上下文（任务 tasks/geo-ask.md）；老名字 factsContext
//   geo.saveFix({ result_id, note })              存助手的分析或修正建议（geo_results.fix_note，页面上显示在这条回答下面）
//   geo.questionsContext({ channel_id })          生成推荐类问题要的上下文（任务 tasks/geo-questions.md）
//   geo.saveQuestions({ channel_id, questions })  把助手想好的问题去重写进问题库（status=active、source=agent）
//
//   页面：runLocal('geo.check', { channel_id })
//   命令行：annulo run geo.check --input '{"channel_id":"..."}'
//
// 引擎（ENGINES）分两种，每个在「检测设置」里单独打开，默认一个都不开（让用户选一个自己的买家在用的）：
//   - 接口：ChatGPT 用 Annulo 里用户选的服务商和模型联网搜索后回答（ctx.llm({ web_search: true })，能力版本 40；模板不存 key），
//     接口服务商要支持 OpenAI Responses，也能用本机的 Codex / Claude Code；
//   - 网页版：ChatGPT、DeepSeek、豆包、Kimi、元宝的网页，在用户自己的 Chrome 里问（aichat.ts，复制自 annulo/references；
//     ctx.browser.open({ profile: '@user' })，能力版本 41，要装 Annulo 浏览器插件），是买家在网页上真实看到的回答。
// 一次检测：打开的引擎同时问（每个引擎在自己的窗口里按顺序问），每个引擎记一条 geo_runs，同一次检测的几条 batch_id 一样。
//
//   geo.testEngine({ engine })                    网页版引擎：在页面上打开它时问一句试试（第一次会弹 Chrome 的授权窗口），存测试结果

type Input = { channel_id?: string; engine?: string; model?: string; retry_run_id?: string; engines?: string[] }
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

type Channel = { id: string; name: string; type: string; project_id?: string; site_id?: string; preview_url?: string; live_url?: string }
type Question = { id: string; question: string; channel_id: string; status?: string; intent?: string; auto_key?: string }
/** 一次联网搜索：搜了什么（queries）、打开了哪个页面（url）、搜到的网址（sources） */
type Search = { type: string; queries: string[]; url?: string; sources: string[] }
type Answer = { answer: string; urls: string[]; tokens: number; searches?: Search[] }
/** geo_engines 的一行：一个引擎的设置，加上网页版最近一次「试一下」的结果 */
type EngineConf = { id?: string; engine: string; enabled?: boolean; provider?: string; model?: string; tested_at?: string; test_error?: string; test_profile?: string }
type Via = { provider: string; label: string }
type Engine = {
  key: string
  name: string
  nameEn: string
  /** api：用 Annulo 里配的服务商调接口；web：在用户自己的 Chrome 里问网页版（aichat） */
  kind: 'api' | 'web'
  /** web：aichat 的网站 id */
  site?: string
  /** 引擎卡片上的一句话：谁在用、要准备什么 */
  desc: string
  descEn: string
  /** 默认模型（geo_engines 里没设时用）；网页版没有 */
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
  if (ch.live_url) out.add(hostOf(ch.live_url))
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
    name: 'ChatGPT（接口）',
    nameEn: 'ChatGPT (API)',
    kind: 'api',
    desc: '用你在 Annulo 里配的模型（OpenAI 兼容的服务商、creght 平台或本机 Codex）联网搜索后回答。不用开浏览器，但和买家在 chatgpt.com 上看到的不完全一样',
    descEn: 'Uses a model you set up in Annulo (an OpenAI-compatible provider, the creght platform or the local Codex) with web search. No browser needed, but not exactly what buyers see on chatgpt.com',
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
  web('chatgpt', 'ChatGPT 网页版', 'ChatGPT (web)', '海外买家用得最多。在你的 Chrome 里打开 chatgpt.com 问（临时对话，不进你的历史记录），要先在 Chrome 里登录 ChatGPT', 'What most overseas buyers use. Asks on chatgpt.com in your Chrome (temporary chat, kept out of your history); sign in to ChatGPT in Chrome first'),
  web('deepseek', 'DeepSeek', 'DeepSeek', '国内买家常用。在你的 Chrome 里问 chat.deepseek.com，要先登录，并打开网页上的「智能搜索」', 'Popular with buyers in China. Asks chat.deepseek.com in your Chrome; sign in and turn on its web search first'),
  web('doubao', '豆包', 'Doubao', '国内用户最多的 AI。在你的 Chrome 里问 doubao.com，要用个人账号登录（「豆包工作」企业空间不行）', 'The most used AI in China. Asks doubao.com in your Chrome; sign in with a personal account (not the Doubao Work space)'),
  web('kimi', 'Kimi', 'Kimi', '在你的 Chrome 里问 kimi.com，要先登录。默认带深度思考，一个问题一分钟左右', 'Asks kimi.com in your Chrome; sign in first. It thinks deeply by default, about a minute per question'),
  web('yuanbao', '腾讯元宝', 'Yuanbao', '微信生态里的 AI。在你的 Chrome 里问 yuanbao.tencent.com，要先登录', 'Tencent’s AI, inside the WeChat world. Asks yuanbao.tencent.com in your Chrome; sign in first'),
]

/**
 * 网页版引擎：在用户自己的 Chrome 里问（aichat）。回答里的 [n] 换成可以点的上标链接，引用的网页记进 urls，搜到的全部网页和搜索词记进 searches。
 * 网页版没有 token 数；它这一段对话的地址记在 searches 第一步的 url 上，方便回去看
 */
function web(site: string, name: string, nameEn: string, desc: string, descEn: string): Engine {
  return {
    key: site,
    name,
    nameEn,
    kind: 'web',
    site,
    desc,
    descEn,
    model: () => '',
    hint: '',
    hintEn: '',
    async ask(_via, _model, question, ctx) {
      const r = await aichatAsk({ site, question }, ctx)
      const byN = new Map(r.sources.filter((x: any) => x.n != null).map((x: any) => [x.n, x.url]))
      // [n] 换成上标数字的链接（看起来像脚注；页面的 Markdown 不认 [[n]](url) 这种写法）
      const sup = (n: string) => n.replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])
      const answer = r.answer.replace(/\[(\d+)\]/g, (m: string, n: string) => (byN.get(Number(n)) ? `[${sup(n)}](${byN.get(Number(n))})` : m))
        // 挨着的两个引用中间加个窄空格：不然 ¹ 和 ¹² 连成 ¹¹²
        .replace(/\)(?=\[[⁰¹²³⁴⁵⁶⁷⁸⁹]+\]\()/g, ')\u2009')
      const cited = r.sources.filter((x: any) => x.cited).map((x: any) => x.url)
      return {
        answer,
        urls: cited,
        tokens: 0,
        searches: [{ type: 'search', queries: r.searches, url: r.url, sources: r.sources.map((x: any) => x.url) }],
      }
    },
  }
}

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

/** 一次检测里一个引擎正在问哪个问题：页面把对应的格子标「正在问」 */
type Asking = { engine: string; question_id: string; question: string; step: string; done: number; total: number }

async function checkOne(input: Input, ctx: any) {
  const ch: Channel | null = ctx.db.get('channels', input?.channel_id)
  if (!ch) throw new Error(L(ctx, '没有这个渠道：', 'No such channel: ') + input?.channel_id)
  const confs = engineConfs(ctx)
  const providers = llmProviders(ctx)
  const brands = brandTerms(profile(ctx), ch)
  await loadWebUrls(ctx) // 网页版：判断网站在哪个 Chrome 用户里允许过，记进「谁在答」

  // 这次问哪些引擎：重试是那次检测的那一个；指定了就是指定的；否则是「检测设置」里打开的
  let retryRun: any = null
  let picked: Engine[]
  if (input.retry_run_id) {
    retryRun = ctx.db.get('geo_runs', input.retry_run_id)
    if (!retryRun || retryRun.channel_id !== ch.id) throw new Error(L(ctx, '找不到要重试的那次检测', "Couldn't find the check to retry"))
    picked = ENGINES.filter((e) => e.key === (retryRun.engine || 'openai'))
  } else {
    const want = input.engines?.length ? input.engines : input.engine ? [input.engine] : null
    picked = ENGINES.filter((e) => (want ? want.includes(e.key) : isEnabled(e, confs[e.key], ctx)))
  }
  if (!picked.length) throw new Error(L(ctx, '还没打开要检测的 AI：到「检测设置」里打开至少一个', 'No AI is turned on for checks yet: turn on at least one in check settings'))
  const ready: { e: Engine; via: Via; model: string; asker: string }[] = []
  const skipped: string[] = []
  for (const e of picked) {
    const r = resolve(e, confs[e.key], providers, ctx)
    if (!r.via) {
      skipped.push(`${L(ctx, e.name, e.nameEn)}${L(ctx, '：', ': ')}${r.reason}`)
      continue
    }
    const pv = providers.find((x) => x.id === r.via!.provider)
    ready.push({ e, via: r.via, model: e.kind === 'web' ? '' : input.model || modelFor(e, confs[e.key], pv, ctx), asker: e.kind === 'web' ? L(ctx, e.name, e.nameEn) : askerOf(pv, ctx) })
  }
  if (!ready.length) throw new Error(skipped.join(L(ctx, '；', '; ')))

  let questions: Question[]
  if (retryRun) {
    // 重试：只问那次失败的问题，结果并进那次检测
    const ids = new Set(parseSummary(retryRun.summary)?.failed.map((f) => f.question_id) ?? [])
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

  // 几个引擎同时问，进度合起来报：done / total 是所有引擎加起来的，asking 是每个引擎正在问的（页面标格子）；
  // question_id / question / step 是第一个还在问的（老页面只认这几个）
  const batch = retryRun?.batch_id || `b${Date.now().toString(36)}`
  const asking = new Map<string, Asking>()
  const total = questions.length * ready.length
  const report = () => {
    const list = [...asking.values()]
    const done = list.reduce((n, a) => n + a.done, 0)
    const cur = list.find((a) => a.question_id)
    ctx.progress({
      done,
      total,
      asking: list.filter((a) => a.question_id).map(({ engine, question_id, question, step, done, total }) => ({ engine, question_id, question, step, done, total })),
      question_id: cur?.question_id ?? '',
      question: cur?.question ?? '',
      step: cur?.step ?? '',
      message: list.map((a) => `${a.step || L(ctx, '问完了', 'done')}${a.question ? L(ctx, '：', ': ') + a.question : ''}`).join(L(ctx, '；', '; ')),
    })
  }
  const outs = await Promise.all(
    ready.map(async (x) => {
      try {
        return await askAll(ch, x, questions, domains, brands, batch, retryRun?.engine === x.e.key || (retryRun && !retryRun.engine) ? retryRun : null, asking, report, ctx)
      } catch (e: any) {
        return { engine: x.e.key, error: e.message as string }
      }
    }),
  )
  const ok = outs.filter((o): o is Exclude<typeof o, { error: string }> => !('error' in o && o.error))
  if (!ok.length) throw new Error(outs.map((o: any) => o.error).join(L(ctx, '；', '; ')).slice(0, 800))
  const sums = ok.map((o: any) => o.summary as Summary)
  ctx.progress({
    done: total,
    total,
    message: L(ctx, `检测完成：问了 ${ready.length} 个 AI`, `Done: asked ${ready.length} AIs`) + (skipped.length ? L(ctx, `（${skipped.length} 个没问成：${skipped.join('；')}）`, ` (${skipped.length} skipped: ${skipped.join('; ')})`) : ''),
  })
  return { domains, batch_id: batch, run_id: ok[0].run_id, runs: outs, skipped, summary: sums[0] }
}

/** 一个引擎把问题按顺序问一遍，记一条 geo_runs（重试时并进那一条） */
async function askAll(
  ch: Channel,
  x: { e: Engine; via: Via; model: string; asker: string },
  questions: Question[],
  domains: string[],
  brands: string[],
  batch: string,
  retryRun: any,
  asking: Map<string, Asking>,
  report: () => void,
  ctx: any,
) {
  const { e: engine, via, model, asker } = x
  const meta = { engine: engine.key, model, provider: via.provider, provider_name: engine.kind === 'web' ? `${asker} · ${via.label}` : asker, batch_id: batch }
  let run = retryRun
  if (run) ctx.db.update('geo_runs', run.id, { ...meta, finished_at: '', seen_at: '' })
  else run = ctx.db.insert('geo_runs', { channel_id: ch.id, ...meta, questions: questions.length, cited: 0, mentioned: 0, visibility: 0, started_at: new Date().toISOString() })

  let answered = 0
  const failed: Summary['failed'] = parseSummary(run.summary)?.failed.filter((f) => !questions.some((q) => q.id === f.question_id)) ?? []
  const total = questions.length
  const name = L(ctx, engine.name, engine.nameEn)
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const isBrand = isBrandQ(q, brands)
    asking.set(engine.key, { engine: engine.key, question_id: q.id, question: q.question, step: L(ctx, `正在问 ${name}`, `asking ${name}`), done: i, total })
    report()
    let r: Answer
    try {
      r = await engine.ask(via, model, q.question, ctx)
    } catch (e: any) {
      failed.push({ question_id: q.id, question: q.question, error: e.message })
      // key 不对、没登录：后面也不用问了，剩下的记成同样的失败，改好后「重试失败的」一起重问
      if (/401/.test(e.message) || e.code === 'login' || /^\[login\]/.test(e.message)) {
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
    const askedLower = q.question.toLowerCase()
    const isMentioned = !isCited && (domains.some((d) => lower.includes(d)) || brands.some((b) => !askedLower.includes(b) && lower.includes(b)))
    const competitors = [...new Set(uniq.map(hostOf).filter((h) => h && !matches(h, domains) && !NOT_COMPETITOR.some((n) => h.includes(n))))].slice(0, 5)
    ctx.db.insert('geo_results', {
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
    })
    answered++
  }
  asking.set(engine.key, { engine: engine.key, question_id: '', question: '', step: '', done: total, total })
  report()

  const sum = summarize(ctx, ch, run.id, asker, failed, engine.key)
  const note = failed.length ? L(ctx, `${failed.length} 条没问成`, `${failed.length} failed`) : ''
  ctx.db.update('geo_runs', run.id, { questions: sum.questions, cited: sum.cited, mentioned: sum.mentioned, visibility: sum.visibility, fact_questions: sum.brand_asked, note, summary: JSON.stringify(sum), finished_at: new Date().toISOString(), seen_at: '' })
  if (!answered) throw new Error(`${name}${L(ctx, '：一个问题都没问成：', ': no question could be asked: ')}${failed.map((f) => f.error).join('; ').slice(0, 400)}`)
  return { engine: engine.key, run_id: run.id, model, summary: sum }
}

function parseSummary(s?: string): Summary | null {
  try {
    const v = JSON.parse(s || '')
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

/** 这次检测的结论：按这次检测里每个问题的结果算（重试并进来的也算），再和这个引擎上每个问题上一次的结果、上一次检测的可见度比 */
function summarize(ctx: any, ch: Channel, runId: string, asker: string, failed: Summary['failed'], engine: string): Summary {
  // 老数据没有 engine：那时测的是 Perplexity（和页面的 engineOf 一样）
  const sameEngine = (x: any) => (x.engine || 'perplexity') === engine
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
      .filter((x) => x.run_id !== runId && sameEngine(x))
      .sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0))[0]
    if (!prev) s.fresh.push(qid)
    else if (!!prev.cited !== !!r.cited) (r.cited ? s.gained : s.lost).push(qid)
  }
  s.visibility = s.questions ? Math.round((s.cited / s.questions) * 100) : 0
  const prevRun = (ctx.db.query('geo_runs', { where: { channel_id: ch.id }, limit: 50 }).list as any[])
    .filter((x) => x.id !== runId && x.finished_at && (x.questions ?? 0) > 0 && sameEngine(x))
    .sort((a, b) => (Date.parse(b.finished_at || '') || 0) - (Date.parse(a.finished_at || '') || 0))[0]
  if (prevRun) s.prev_visibility = prevRun.visibility ?? 0
  return s
}

// ---- 就一条回答问助手（任务 tasks/geo-ask.md） ----

/**
 * 用户就某个 AI 的一条回答问助手（为什么没引用我们、怎么优化、这里说错了……）要的上下文：
 * 这家 AI 的回答、引用、搜了什么，同一个问题别的 AI 怎么答的（对比用），用户标过的说错（有的话），公司资料（可能过时），站点内容
 */
export async function askContext(input: { result_id: string }, ctx: any) {
  const r = ctx.db.get('geo_results', input?.result_id)
  if (!r) throw new Error(L(ctx, '没有这条检测结果：', 'No such result: ') + input?.result_id)
  const ch: Channel | null = ctx.db.get('channels', r.channel_id)
  if (!ch) throw new Error(L(ctx, '这条结果的网站已经删掉了', "This result's site was deleted"))
  const parse = (s: string) => {
    try {
      return JSON.parse(s || '[]')
    } catch {
      return []
    }
  }
  const nameOf = (k?: string) => {
    const e = ENGINES.find((x) => x.key === (k || 'openai'))
    return e ? L(ctx, e.name, e.nameEn) : k || ''
  }
  // 同一个问题在别的 AI 上最新的回答（每个 AI 一条）
  const others: any[] = []
  const seen = new Set([r.engine || ''])
  const rows = (ctx.db.query('geo_results', { where: { question_id: r.question_id }, limit: 100 }).list as any[]).sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0))
  for (const x of rows) {
    if (seen.has(x.engine || '')) continue
    seen.add(x.engine || '')
    others.push({ engine: nameOf(x.engine), cited: !!x.cited, mentioned: !!x.mentioned, answer: String(x.answer || x.answer_excerpt || '').slice(0, 3000), urls: parse(x.urls).slice(0, 20) })
  }
  const domains = await siteDomains(ch, ctx)
  ctx.progress({ message: L(ctx, `在读「${ch.name}」的网站…`, `Reading the "${ch.name}" site…`) })
  return {
    site: { id: ch.id, name: ch.name, domains, digest: (await siteDigest(await base(ch, ctx), ctx, 5)) || L(ctx, '（读不到）', '(unreadable)') },
    engine: nameOf(r.engine),
    kind: r.kind || '',
    question: r.question,
    answer: r.answer || r.answer_excerpt || '',
    cited: !!r.cited,
    mentioned: !!r.mentioned,
    urls: parse(r.urls),
    searches: parse(r.searches),
    report: r.user_report || '',
    others,
    facts: factSheet(ctx, domains),
  }
}

/** 老名字：以前只有「说错了 → 查原因」一种（任务 geo-fix-facts） */
export const factsContext = askContext

/** 存助手对这条回答的分析或修正建议（Markdown），页面上显示在这条回答下面 */
export function saveFix(input: { result_id: string; note: string }, ctx: any) {
  const r = ctx.db.get('geo_results', input?.result_id)
  if (!r) throw new Error(L(ctx, '没有这条检测结果：', 'No such result: ') + input?.result_id)
  const note = String(input?.note ?? '').trim()
  if (!note) throw new Error(L(ctx, '要存的内容是空的', 'The note is empty'))
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

/**
 * 这个引擎在检测里开着没有：「检测设置」里打开的。默认一个都不开（让用户挑自己的买家在用的 AI）；
 * 老项目以前只有 ChatGPT 接口一个、没有开关，选过服务商的当作开着，升级后不会突然不测了
 */
function isEnabled(e: Engine, conf: EngineConf | undefined, _ctx: any): boolean {
  if (conf?.enabled === true) return true
  if (conf?.enabled === false) return false
  return e.key === 'openai' && !!conf?.provider
}

/** 引擎这次怎么问；用不了时没有 via，reason 说为什么、去哪里解决 */
function resolve(e: Engine, conf: EngineConf | undefined, providers: any[], ctx: any): { via?: Via; reason: string } {
  return e.kind === 'web' ? resolveWeb(e, ctx) : resolveEngine(e, conf, providers, ctx)
}

/** 用户的 Chrome 里连着的 Annulo 插件（能力版本 41 才有 ctx.browser.user）；null = 这个版本的 Annulo 没有 */
function chromeProfiles(ctx: any): any[] | null {
  if (typeof ctx.browser?.user !== 'function') return null
  try {
    return ctx.browser.user().profiles ?? []
  } catch {
    return []
  }
}

/** 网页版引擎的地址（aichat 的网站列表，loadWebUrls 读进来） */
let WEB_URLS: Record<string, string> = {}
const siteHost = (site?: string) => hostOf(WEB_URLS[site ?? ''] ?? '')

/** aichat 里每个网站的地址（判断这个网站在哪个 Chrome 里允许过） */
async function loadWebUrls(ctx: any) {
  if (Object.keys(WEB_URLS).length) return
  try {
    WEB_URLS = Object.fromEntries((await aichatSites()).map((x: any) => [x.id, x.url]))
  } catch {}
}

/** 网页版：Annulo 够新、Chrome 连上了就能问；granted 是这个网站在哪个 Chrome 里允许过（没允许过的，第一次在页面上问时会弹窗问用户） */
function resolveWeb(e: Engine, ctx: any): { via?: Via; reason: string; granted?: string } {
  const profiles = chromeProfiles(ctx)
  if (profiles === null) return { reason: L(ctx, '要新版 Annulo（能操作你自己的 Chrome）：先更新 Annulo', 'needs a newer Annulo that can work in your own Chrome: update Annulo first') }
  if (!profiles.length) return { reason: L(ctx, '没连上你的 Chrome：在 Chrome 里装 Annulo 插件并打开 Chrome（Annulo 设置 → 浏览器）', "your Chrome isn't connected: install the Annulo extension in Chrome and keep Chrome open (Annulo Settings → Browser)") }
  const host = siteHost(e.site)
  const p = profiles.find((x: any) => (x.sites ?? []).some((pat: string) => host && pat.includes(host)))
  const who = p ? p.name || p.email || 'Chrome' : ''
  return { via: { provider: '@user', label: who ? `Chrome · ${who}` : 'Chrome' }, reason: '', granted: who }
}

/** 接口引擎怎么发请求；用不了时没有 via，reason 说为什么、去哪里解决 */
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

/** 引擎的设置、能不能用，加上 Annulo 里配好的服务商（选服务商用），页面的引擎卡片和「检测设置」用 */
export async function engines(_: unknown, ctx: any) {
  const confs = engineConfs(ctx)
  const providers = llmProviders(ctx)
  await loadWebUrls(ctx)
  const profiles = chromeProfiles(ctx)
  return {
    // models：选模型的下拉框列出来的，search 是能不能联网搜索（creght 平台标了的；自己加的服务商不知道，是 null）；
    // default_model：这个服务商不填模型时用哪个
    providers: providers.map((p) => {
      const ok = searchModels(p)
      const models = (p.models ?? []).map((m: any) => ({ model: m.model, name: m.name || m.model, search: ok ? ok.includes(m.model) : null }))
      return { id: p.id, name: p.name, kind: p.kind || 'api', api: p.api, base_url: p.base_url, builtin: !!p.builtin, ready: !!p.ready, error: p.error || '', models, default_model: ok?.[0] || ENGINES[0].model(ctx) }
    }),
    // 用户的 Chrome：null = Annulo 太老（没有这个能力），[] = 没连上
    chrome: profiles === null ? null : profiles.map((p: any) => ({ id: p.id, name: p.name || '', email: p.email || '' })),
    engines: ENGINES.map((e) => {
      const c = confs[e.key]
      const r: { via?: Via; reason: string; granted?: string } = e.kind === 'web' ? resolveWeb(e, ctx) : resolveEngine(e, { ...c, engine: e.key, enabled: true }, providers, ctx)
      return {
        engine: e.key,
        kind: e.kind,
        name: L(ctx, e.name, e.nameEn),
        desc: L(ctx, e.desc, e.descEn),
        hint: L(ctx, e.hint, e.hintEn),
        url: e.kind === 'web' ? WEB_URLS[e.site!] ?? '' : '',
        enabled: isEnabled(e, c, ctx),
        provider: c?.provider ?? '',
        model: c?.model ?? '',
        default_model: e.kind === 'web' ? '' : modelFor(e, { engine: e.key }, providers.find((x) => x.id === c?.provider), ctx),
        legacy_key: '',
        ready: !!r.via,
        reason: r.reason,
        // 网页版：这个网站在哪个 Chrome 里允许过；最近一次「试一下」的结果
        granted: r.granted ?? '',
        tested_at: c?.tested_at ?? '',
        test_error: c?.test_error ?? '',
        test_profile: c?.test_profile ?? '',
      }
    }),
  }
}

/** 改引擎的设置：开关；接口引擎还有服务商（Annulo 里的服务商 id，空 = 不选）、模型（空 = 默认） */
export async function saveEngine(input: { engine: string; enabled?: boolean; provider?: string; model?: string }, ctx: any) {
  const e = ENGINES.find((x) => x.key === input?.engine)
  if (!e) throw new Error(L(ctx, `不认识的引擎 ${input?.engine}，可选：`, `Unknown engine ${input?.engine}; options: `) + ENGINES.map((x) => x.key).join(' / '))
  const patch: Record<string, unknown> = {}
  if (input.enabled !== undefined) patch.enabled = !!input.enabled
  if (e.kind === 'api') {
    if (input.model !== undefined) patch.model = String(input.model).trim()
    if (input.provider !== undefined) {
      const id = String(input.provider).trim()
      if (id && !llmProviders(ctx).some((p) => p.id === id)) throw new Error(L(ctx, `Annulo 里没有这个服务商：${id}`, `Annulo has no such provider: ${id}`))
      patch.provider = id
    }
  }
  saveConf(e.key, patch, ctx)
  return (await engines(null, ctx)).engines.find((x) => x.engine === e.key)
}

function saveConf(engine: string, patch: Record<string, unknown>, ctx: any) {
  const c = engineConfs(ctx)[engine]
  if (c?.id) ctx.db.update('geo_engines', c.id, patch)
  else ctx.db.insert('geo_engines', { engine, ...patch })
}

/**
 * 网页版引擎问一句试试：在页面上打开它的时候调。第一次会在 Chrome 里弹授权窗口（只有页面上点的运行弹得出来），
 * 也看得出没装插件、没登录。结果存进 geo_engines，引擎卡片上显示
 */
export async function testEngine(input: { engine: string }, ctx: any) {
  const e = ENGINES.find((x) => x.key === input?.engine)
  if (!e || e.kind !== 'web') throw new Error(L(ctx, `只有网页版的 AI 要试：${input?.engine}`, `Only web AIs need a test: ${input?.engine}`))
  await loadWebUrls(ctx)
  const r = resolveWeb(e, ctx)
  if (!r.via) {
    saveConf(e.key, { tested_at: new Date().toISOString(), test_error: r.reason, test_profile: '' }, ctx)
    return { ok: false, error: r.reason }
  }
  ctx.progress({ message: L(ctx, `正在用你的 Chrome 问 ${e.name}…`, `Asking ${e.nameEn} in your Chrome…`) })
  const t0 = Date.now()
  try {
    await aichatAsk({ site: e.site!, question: L(ctx, '你好，用一句话介绍一下你自己。', 'Hi, introduce yourself in one sentence.') }, ctx)
  } catch (err: any) {
    saveConf(e.key, { tested_at: new Date().toISOString(), test_error: err.message, test_profile: '' }, ctx)
    return { ok: false, error: err.message, code: err.code || '' }
  }
  const who = resolveWeb(e, ctx).granted || ''
  saveConf(e.key, { tested_at: new Date().toISOString(), test_error: '', test_profile: who }, ctx)
  return { ok: true, ms: Date.now() - t0, profile: who }
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
