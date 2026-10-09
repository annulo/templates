// 运营后台的数据：业务表、本机函数、任务都经本机 Annulo；在线项目在手机上打开时，读写表改走站点 Func（backend/func/db.ts）。
//
// 以后平台提供「站点所有者读取平台数据」的 Func 能力后，只改这个文件，页面不用动。

import { tr } from './i18n'
import { ShuttleUnavailable, MemberLoginRequired, memberLoginURL, isNeedsShuttle, shuttleMissing, inShuttle, fnManifest, computerStatus, watchComputer, type FnManifest, type ComputerStatus, markShuttle, memberInvoke, runCloud, remoteAI } from './remote'
import { uploadAsset } from 'talizen/assets'
export { ShuttleUnavailable, MemberLoginRequired, memberLoginURL, isNeedsShuttle, shuttleMissing, inShuttle, fnManifest, computerStatus, watchComputer, assistantOnline, type FnManifest, type ComputerStatus } from './remote'

/** 渠道类型。creght_site、wordpress 是网站；其余是社媒。 */
export type ChannelType = 'creght_site' | 'wordpress' | 'xiaohongshu' | 'douyin' | 'x' | 'wechat_mp' | 'linkedin' | 'facebook' | 'instagram' | 'youtube' | 'bilibili' | 'zhihu'

export type Channel = {
  id: string
  type: ChannelType
  name: string
  /** 独立站：站点所在的 creght 项目和站点 */
  project_id?: string
  site_id?: string
  /** 独立站的访问地址；creght 站点是预览地址，WordPress 是站点地址 */
  preview_url?: string
  /** WordPress：登录用户名、应用密码存在哪个本机密钥（密码本身不进表） */
  wp_user?: string
  wp_secret?: string
  /** 独立站：文章发布脚本（local/pub_<网站 id>.ts）和发布设置的状态；只有 ready 的网站能发文章，配置由助手做（tasks/setup-publish.md） */
  publisher?: string
  publish_status?: 'ready' | 'broken' | ''
  publish_note?: string
  profile?: string
  login_status?: string
  /** 社媒：头像、粉丝数、本机浏览器 profile、上次检查登录 / 采集的时间 */
  avatar?: string
  /** X：@ 后面的用户名；LinkedIn：主页地址 /in/ 后面那段 */
  handle?: string
  /** 社媒平台上的账号 id（小红书的用户 id） */
  platform_uid?: string
  followers?: number
  browser_profile?: string
  /** 社媒：在哪台电脑上登录的（登录态只在那台电脑上；社媒插件的 social/social.ts） */
  browser_profile_id?: string
  browser_machine?: string
  browser_machine_name?: string
  last_checked_at?: string
  collected_at?: string
  /** 网站：关联的 GA4 属性（properties/123，ga4.link） */
  ga4_property?: string
  /** 独立站：关联的 Search Console 属性（sc-domain:… 或 https://…/） */
  gsc_property?: string
  /** 用户已解除关联：暂停自动匹配和同步，重新关联时恢复 */
  gsc_link_disabled?: boolean
  gsc_synced_at?: string
  /** 询盘同步：上次读到的最后一条表单提交（local/leads.ts 回写） */
  leads_cursor?: string
  leads_synced_at?: string
  created_at?: string
}

export type KeyRow = { key: string; pv_count: number; uv_count: number; ip_count: number }

export type ChannelStats = { pv_count: number; uv_count: number; ip_count: number }

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (shuttleMissing()) throw new ShuttleUnavailable(tr('meta.err.not_from_shuttle'))
  let res: Response
  try {
    res = await fetch('/_shuttle/api/' + path, {
      method: init?.method ?? 'GET',
      headers: { 'X-Shuttle': '1', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ShuttleUnavailable(tr('meta.err.no_shuttle'))
  }
  // 只认 Shuttle 的回复（每个接口都带 x-shuttle 头）。编辑器、预览域名会用页面或别的
  // 内容兜底返回 200，不能当成数据。
  if (!res.headers.get('x-shuttle')) {
    markShuttle(false)
    throw new ShuttleUnavailable(tr('meta.err.not_from_shuttle'))
  }
  markShuttle(true)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || tr('meta.err.req_failed', { status: res.status }))
  return body as T
}


/** 社媒平台：账号在社媒插件的 social_accounts 表里（github.com/annulo/plugins 的 social），网站在 channels 表里 */
export const SOCIAL_TYPES: ChannelType[] = ['xiaohongshu', 'douyin', 'x', 'linkedin', 'facebook', 'instagram', 'youtube', 'bilibili', 'zhihu']

/**
 * 已添加的账号：社媒插件的 social_accounts 表（自媒体工作台没有网站，外贸模板这里还合并了 channels 表里的网站）。
 * plugin：社媒插件装了没有（没装时读不到 social_accounts 表）。
 */
export async function listChannels(): Promise<{ list: Channel[]; legacy: Channel[]; plugin: boolean }> {
  try {
    return { list: await dbList('social_accounts'), legacy: [], plugin: true }
  } catch {
    return { list: [], legacy: [], plugin: false }
  }
}

// 渠道增删、访问数据都是本机函数（local/channels.ts），用用户自己的 creght 登录读平台，需要 Shuttle

/** 每个渠道近 days 天的访问汇总，按渠道 id 索引（社媒渠道暂为 0） */
export const channelStats = (days: number) =>
  runLocal<{ list: (ChannelStats & { id: string })[] }>('channels.stats', { days }).then((r) => Object.fromEntries(r.list.map((c) => [c.id, c])) as Record<string, ChannelStats>)

export const removeChannel = (id: string) => runLocal<{ ok: boolean }>('channels.remove', { id })

// ---- 请求外部接口 ----

export type ProxyResponse = {
  ok: boolean
  status: number
  status_text: string
  /** 跟随跳转后的最终地址 */
  url: string
  headers: Record<string, string>
  /** 文本内容（HTML、JSON、纯文本）；二进制内容在 body_base64 */
  body?: string
  body_base64?: string
  /** 超过 5MB 被截断 */
  truncated?: boolean
}

/**
 * 请求外部接口（google.com、第三方 API…）。浏览器直接 fetch 外站会被跨域拦截，
 * 这里交给本机 Shuttle 用用户自己的网络去请求，再把结果带回来。
 *
 * 只在从 Shuttle 打开后台时可用，其余情况抛 ShuttleUnavailable。
 * 不能访问本机和内网地址；不要把密钥写进页面代码（需要密钥的请求放进 Func，从 process.env 读）。
 *
 *   const r = await shuttleFetch('https://www.google.com/')
 *   r.status, r.headers['content-type'], r.body
 *   const j = JSON.parse((await shuttleFetch('https://api.example.com/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 1 }) })).body ?? '{}')
 */
export const shuttleFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  api<ProxyResponse>('fetch', { method: 'POST', body: { url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ?? '' } })

/**
 * 外站图片地址换成本机代理地址：小红书这类图床有防盗链，页面里直接 <img src> 会 403，
 * 交给 Shuttle 不带 Referer 去取（缓存 7 天）。只在 Shuttle 里打开时有效，其余情况原样返回。
 *
 *   <img src={shuttleImage(post.cover)} />
 */
export function shuttleImage(url?: string) {
  if (!url || !/^https?:\/\//.test(url) || !inShuttle()) return url ?? ''
  // 离线项目上传到本机的文件（http://127.0.0.1:端口/_shuttle/uploaded/…）：同一个 Annulo 直接给，不走代理（代理不访问本机地址）
  const local = url.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/_shuttle\/uploaded\/[^?#]+)$/)
  if (local) return local[1]
  return '/_shuttle/img?url=' + encodeURIComponent(url)
}

// ---- 本机函数 ----
// 运营后台项目 local/*.ts 里的函数，由本机 Shuttle 直接执行（不经过模型）：调外部 API、批量检测这类
// 确定性的活放这里，按钮一按几秒跑完。函数能用 ctx.db / fetch / ctx.secrets / ctx.mcp（creght 的数据走它，见 local/_creght.ts）/ ctx.llm。

export type LocalProgress = { done?: number; total?: number; message?: string }
export type LocalEvent = { type: 'progress'; data: LocalProgress } | { type: 'log'; data: { level: string; message: string } }

/**
 * 执行本机函数，比如 runLocal('geo.check', { channel_id })。过程中的进度交给 onEvent；
 * 返回函数的返回值，函数抛错时 reject（message 就是函数里 throw 的那句）。
 * 页面关掉函数也会跑完（结果在表里）；不在 Shuttle 里打开时抛 ShuttleUnavailable。
 */
/**
 * runLocal 的可选项（Annulo 能力版本 35 起认 browser）：
 * browser: 'offscreen' 这次打开的浏览器用屏幕外的真窗口（不用无界面的），能用 POST local/runs/<id>/show 调到前台看（后台发布用）；
 * onStart 拿到这次运行的 id：POST local/runs/<id>/abort 停止（停了这次打开的浏览器也一起关掉）
 */
export type RunLocalOptions = { browser?: 'offscreen'; onStart?: (runId: string) => void }

export async function runLocal<T = unknown>(fn: string, input: unknown, onEvent?: (e: LocalEvent) => void, opts?: RunLocalOptions): Promise<T> {
  if (shuttleMissing()) return runCloud<T>(fn, input, new ShuttleUnavailable(tr('meta.err.not_from_shuttle')), onEvent)
  let res: Response
  try {
    res = await fetch('/_shuttle/api/local/run', { method: 'POST', headers: { 'X-Shuttle': '1', 'content-type': 'application/json' }, body: JSON.stringify({ fn, input, ...(opts?.browser ? { browser: opts.browser } : {}) }) })
  } catch {
    markShuttle(false)
    return runCloud<T>(fn, input, new ShuttleUnavailable(tr('meta.err.no_shuttle')), onEvent)
  }
  if (!res.headers.get('x-shuttle')) {
    markShuttle(false)
    return runCloud<T>(fn, input, new ShuttleUnavailable(tr('meta.err.not_from_shuttle')), onEvent)
  }
  markShuttle(true)
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || tr('meta.err.req_failed', { status: res.status }))
  }
  const runId = res.headers.get('x-annulo-run') || res.headers.get('x-shuttle-run')
  if (runId) opts?.onStart?.(runId)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).replace(/^data: /, '')
      buf = buf.slice(i + 2)
      let ev: { type: string; data: any }
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      if (ev.type === 'result') return ev.data?.value as T
      if (ev.type === 'error') throw new Error(ev.data?.message || tr('meta.err.run_failed'))
      if (ev.type === 'progress' || ev.type === 'log') onEvent?.(ev as LocalEvent)
    }
  }
  throw new Error(tr('meta.err.run_disconnected'))
}

// ---- 业务表 ----
// 读写：在 Shuttle 里走本机，不在（手机）时走站点 Func backend/func/db.ts（只给项目成员）。

/** 项目资料：这个业务的定位，profile 表只有一行 */
export type Profile = {
  id?: string
  name: string
  /** 一句话定位 */
  positioning?: string
  /** 主要写什么 */
  business?: string
  /** 关于我：经历、背景 */
  profile?: string
  /** 专长和可核实的经历 */
  advantages?: string
  /** 能提供什么：课程、咨询、作品 */
  cooperation?: string
  /** 写给谁 */
  customer_types?: string
  /** 平台和语言 */
  markets?: string
  /** 读者最关心的问题 */
  buyer_concerns?: string
  tone?: string
  keywords?: string
  /** 不写什么 */
  avoid?: string
  created_at?: string
}

export type ResearchSource = { id: string; kind: 'article' | 'social' | 'product' | 'text' | 'file'; title: string; url?: string; content?: string; file_name?: string; status: 'pending' | 'ready' | 'failed'; error?: string; version: number; collected_at?: string; created_at?: string }
export type ResearchFinding = { id: string; source_id: string; source_version: number; title: string; kind: 'buyer_question' | 'opportunity' | 'product_clue' | 'format' | 'competitor_report'; fact?: string; quote?: string; interpretation?: string; suggestion?: string; source_snapshot?: string; created_at?: string }
export type WritingBrief = { audience?: string; buyer_question?: string; product_ids?: string[]; outline?: string; language?: string; channels?: string; cta?: string; gaps?: string }
export type FindingEvidence = { finding_id: string; title: string; kind: string; fact?: string; quote?: string; interpretation?: string; suggestion?: string; source: { id: string; title: string; kind: string; url?: string; file_name?: string; collected_at?: string; version: number } }
export type ContentEvidence = { captured_at: string; brief: WritingBrief; findings: FindingEvidence[]; products: Product[] }
export type ContentReference = { id: string; kind: 'finding' | 'generation'; target_type: 'topic' | 'article'; target_id: string; finding_id?: string; snapshot: string; created_at?: string }

export type TopicStatus = 'idea' | 'writing' | 'done' | 'dropped'
export type Topic = {
  id: string
  title: string
  angle?: string
  keywords?: string
  /** manual / agent / search / geo / research */
  source?: string
  status: TopicStatus
  brief?: string
  article_id?: string
  /** 来自搜索（source=search，gsc.sync 加的）：搜索词、近 28 天曝光、平均排名 */
  search_query?: string
  search_impressions?: number
  search_position?: number
  created_at?: string
}

export type ArticleStatus = 'draft' | 'pending_review' | 'published' | 'rejected'
/** 文章类型：article 长文（富文本，图在正文里）、post 图文笔记（纯文字 + 一组配图）、video 视频。空的是老数据，按 article 看（lib/articleTypes.ts） */
export type ArticleType = 'article' | 'post' | 'video'
export type Article = {
  id: string
  type?: ArticleType
  channel_id?: string
  topic_id?: string
  title: string
  summary?: string
  body?: string
  video?: string
  keywords?: string
  /** 话题，JSON 数组字符串，不带 # */
  tags?: string
  /** 图文笔记的配图，JSON 数组字符串 */
  images?: string
  cover_text?: string
  category?: string
  /** 改写自哪篇文章 */
  source_id?: string
  /** 新文章：AI 写好还没打开看过 */
  unread?: boolean
  // 从外部文档导入的来源（JSON，core/local/docsync.ts）
  source_doc?: string
  status: ArticleStatus
  evidence_id?: string
  evidence_snapshot?: string
  review_note?: string
  url?: string
  created_at?: string
  updated_at?: string
  published_at?: string
}

/** 网站的发布记录（publications 表，有网站的模板才有）。共用的内容中心（core/）按它显示网站，这个模板没有网站时表不存在、读出来是空的 */
export type Publication = { id: string; article_id: string; channel_id: string; status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed'; scheduled_at?: string; title?: string; summary?: string; body?: string; video?: string; keywords?: string; slug?: string; cms_id?: string; url?: string; error?: string; published_at?: string; updated_at?: string }
/** 网站渠道（creght 站点、WordPress）；这个模板没有网站，永远是 false */
export const isSite = (c?: Pick<Channel, 'type'>) => !!c && (c.type === 'creght_site' || c.type === 'wordpress')

/** 改写预设（rewrite_presets 表）：改成哪种类型 + 改写要求 */
export type RewritePreset = { id: string; type: ArticleType; prompt: string; created_at?: string; updated_at?: string }

/** 产品目录（products 表） */
export type Product = {
  id: string
  name: string
  model?: string
  category?: string
  summary?: string
  specs?: string
  moq?: string
  price?: string
  lead_time?: string
  certs?: string
  /** 图片地址的 JSON 数组 */
  images?: string
  url?: string
  keywords?: string
  status?: 'active' | 'hidden'
  source?: 'manual' | 'site'
  created_at?: string
  updated_at?: string
}

// ---- 社媒笔记（小红书）----

/** 社媒账号每天一行的合计（social_daily）：采集时更新当天那行，数字都是累计值 */
export type SocialDaily = {
  id: string
  channel_id: string
  date: string
  followers?: number
  posts?: number
  views?: number
  likes?: number
  comments?: number
  collects?: number
  shares?: number
  updated_at?: string
}

export type SocialPostStatus = 'draft' | 'pending_review' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'rejected' | 'removed'
export type SocialPost = {
  /** YouTube：要上传的视频（素材库里 kind=video 的地址） */
  video?: string
  id: string
  channel_id: string
  article_id?: string
  title: string
  body: string
  /** JSON 数组字符串，不带 # */
  tags?: string
  category?: string
  /** 配图 URL，JSON 数组字符串；为空时发布前按 cover_text 生成文字封面 */
  images?: string
  cover_text?: string
  status: SocialPostStatus
  review_note?: string
  /** status 是 removed 时：从平台上删除的时间 */
  removed_at?: string
  scheduled_at?: string
  published_at?: string
  post_id?: string
  post_url?: string
  error?: string
  /** shuttle：后台写的；platform：采集时发现的、在平台上直接发的 */
  source?: string
  views?: number
  likes?: number
  comments?: number
  collects?: number
  shares?: number
  metrics_at?: string
  created_at?: string
  updated_at?: string
  /** 每天的互动快照 JSON：{ 日期: [浏览, 点赞, 评论, 收藏, 分享] }，最近 120 天 */
  history?: string
}

// ---- 素材库 ----

export type AssetKind = 'image' | 'video' | 'text'
export type Asset = {
  id: string
  /** 公开地址（图片、视频）；文字素材可以为空 */
  url?: string
  kind: AssetKind
  name?: string
  /** 文字素材的内容 */
  text?: string
  /** 标签，JSON 数组字符串 */
  tags?: string
  /** url / manual / upload / agent / platform */
  source?: string
  created_at?: string
}

// ---- 运营周报 ----

export type ReportHighlight = { label: string; value: string; delta?: string }
/** link：点 action 去哪。view + params 去某个页面；setup 是起步配置的一项（today.list 的 key） */
export type ReportSuggestion = { title: string; why?: string; action?: string; link?: { view?: string; params?: Record<string, string>; setup?: string } }
export type Report = {
  id: string
  period_start: string
  period_end: string
  title: string
  summary?: string
  /** 正文 Markdown */
  body?: string
  /** JSON 数组字符串：ReportHighlight[] */
  highlights?: string
  /** JSON 数组字符串：ReportSuggestion[] */
  suggestions?: string
  chat_id?: string
  created_at?: string
}

// ---- 定时任务（项目的 schedules/<id>.json）----

export type ScheduleRun = { started_at: string; ms: number; ok: boolean; error?: string; result?: string; chat_id?: string }
export type Schedule = { id: string; fn?: string; prompt?: string; task?: string; name: string; disabled: boolean; running: boolean; next_at?: string; last?: ScheduleRun }

/** 定时任务和上次运行的结果 */
export const listSchedules = () => api<{ list: Schedule[]; error: string }>('local/schedules').then((r) => r.list)

/** 立刻跑一次某个定时任务（后台跑，用 listSchedules 看 running） */
export const runSchedule = (id: string) => api<{ list: Schedule[] }>(`local/schedules/${encodeURIComponent(id)}/run`, { method: 'POST', body: {} }).then((r) => r.list)

// ---- 项目的任务（tasks/<id>.md，Shuttle 能力版本 7；「怎么写」文件是 8）----
// 写周报、写文章这类长流程：按钮开一段对话交给助手，过程在右侧对话里看得见。任务文件是系统流程；
// 「怎么写」单独一个文件：模板默认 prompts/<id>.md，用户在页面上改了存到 user/prompts/<id>.md（模板不写 user/，升级不冲突）。

export type TaskRun = { task: string; chat_id: string; input?: any; started_at: string; scheduled?: boolean; ms?: number; ok: boolean; error?: string; result?: string }
export type Task = {
  id: string
  name: string
  description?: string
  file: string
  body: string
  /** 生效的「怎么写」：用户改过的优先，否则模板默认；两份都没有时 prompt_file 为空（系统任务，没有给用户改的写法） */
  prompt: string
  prompt_file?: string
  /** 用的是用户改过的（能恢复默认） */
  prompt_custom?: boolean
  prompt_has_default?: boolean
  running: TaskRun[]
  last?: TaskRun
}

// 不在 Shuttle 里（手机）：任务、交给助手经远程访问转给电脑上的助手（lib/remote.ts remoteAI）；手机上看不到也改不了任务说明和写法
const remoteTask = (t: Partial<Task> & { id: string; name: string }): Task => ({ file: '', body: '', prompt: '', running: [], ...t })
export const listTasks = () =>
  shuttleMissing()
    ? remoteAI<{ list: Task[] }>('_shuttle.tasks').then((r) => (r.list ?? []).map(remoteTask))
    : api<{ list: Task[] }>('local/tasks').then((r) => r.list)
export const getTask = (id: string) =>
  shuttleMissing()
    ? listTasks().then((l) => l.find((t) => t.id === id) ?? remoteTask({ id, name: id }))
    : api<Task>(`local/tasks/${encodeURIComponent(id)}`)
/** 改任务说明的正文（在项目的 git 里提交一次，能回滚） */
export const saveTask = (id: string, body: string) => api<Task>(`local/tasks/${encodeURIComponent(id)}`, { method: 'PUT', body: { body } })
/** 存用户改的「怎么写」（user/prompts/<id>.md，在项目的 git 里提交一次） */
export const savePrompt = (id: string, prompt: string) => api<Task>(`local/tasks/${encodeURIComponent(id)}`, { method: 'PUT', body: { prompt } })
/** 删掉用户改的「怎么写」，回到模板默认 */
export const resetPrompt = (id: string) => api<Task>(`local/tasks/${encodeURIComponent(id)}`, { method: 'PUT', body: { reset_prompt: true } })
/** 开一段对话把任务交给助手（后台跑），马上返回对话 id；同样的参数正在跑会报错 */
export async function runTask(id: string, input?: unknown): Promise<{ chat_id: string; task: Task }> {
  if (!shuttleMissing()) return api<{ chat_id: string; task: Task }>(`local/tasks/${encodeURIComponent(id)}/run`, { method: 'POST', body: { input: input ?? null } })
  const r = await remoteAI<{ chat_id: string }>('_shuttle.task', { id, input: input ?? null })
  return { chat_id: r.chat_id, task: await getTask(id) }
}

/**
 * 打开某段对话（看任务的过程）：在 Shuttle 里是右侧的对话；手机上是后台的「助手」页（components/views/Assistant.tsx）。
 * 都不行时返回 false
 */
export function openChat(chatId: string) {
  if (inShuttle()) {
    window.parent.postMessage({ type: 'shuttle:open-chat', chat_id: chatId }, window.location.origin)
    return true
  }
  if (typeof window === 'undefined' || !shuttleMissing()) return false
  const url = new URL(window.location.href)
  url.search = new URLSearchParams({ view: 'assistant', chat: chatId }).toString()
  window.history.pushState(null, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
  return true
}

export type ChatSummary = { id: string; title: string; updated_at: number; messages: number; status?: '' | 'running' | 'asking' }
/** 一段对话（手机上）：from 之后的消息、正在跑的这一轮的快照 live、状态 */
export type RemoteChat = { id: string; title: string; total: number; from: number; messages: any[]; live?: any; status?: '' | 'running' | 'asking' }
export const remoteChats = () => remoteAI<{ list: ChatSummary[] }>('_shuttle.chats').then((r) => r.list ?? [])
export const remoteChat = (chatId: string, from = 0) => remoteAI<RemoteChat>('_shuttle.chat', { chat_id: chatId, from })
export const remoteSend = (text: string, chatId?: string) => remoteAI<{ chat_id: string; steered?: boolean }>('_shuttle.send', { text, chat_id: chatId ?? '' })
export const remoteAbort = (chatId: string) => remoteAI<{ ok: boolean }>('_shuttle.abort', { chat_id: chatId })

// ---- 上传文件、本机密钥（Shuttle 能力版本 5）----

export type Uploaded = { url: string; path?: string; size: number; content_type: string; existed?: boolean }

/** 单个文件最多 200 MB（Shuttle 读进内存再传给 creght） */
export const MAX_UPLOAD = 200 << 20

/**
 * 上传文件拿公开地址：传到运营后台所在站点的 creght 素材，社媒、站点 CMS 都能用。
 * existed：同样内容之前传过，平台直接复用了那个地址。
 */
export async function uploadFile(file: File): Promise<Uploaded> {
  if (file.size > MAX_UPLOAD) throw new Error(tr('meta.err.too_big', { name: file.name }))
  if (!file.size) throw new Error(tr('meta.err.empty_file', { name: file.name }))
  // 不在 Shuttle 里（手机、别的电脑）：文件就在这台设备上，浏览器直接传到站点的 creght 素材，不经过电脑
  if (shuttleMissing()) {
    const r = await uploadAsset(file)
    return { url: r.url, size: r.size, content_type: r.mimeType }
  }
  const form = new FormData()
  form.append('file', file, file.name)
  let res: Response
  try {
    res = await fetch('/_shuttle/api/local/upload', { method: 'POST', headers: { 'X-Shuttle': '1' }, body: form })
  } catch {
    throw new ShuttleUnavailable(tr('meta.err.no_shuttle'))
  }
  if (!res.headers.get('x-shuttle')) throw new ShuttleUnavailable(tr('meta.err.upload_offline'))
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || tr('meta.err.upload_failed', { status: res.status }))
  return body as Uploaded
}

export type LocalFile = { ref: string; url: string; name: string; filename: string; size: number; content_type: string }

/** 本机文件单个最多 8 GB（Shuttle 能力版本 12 起） */
export const MAX_LOCAL_FILE = 8 * 1024 ** 3

/**
 * 把文件存在这台电脑上、不传云端（Shuttle 的 local/files）：社媒视频这类只给本机浏览器发布用的大文件走它，
 * 返回的 ref（local:<name>）存进表，本机函数的 b.upload 直接认；url 给页面预览。onProgress 是 0~1。
 */
export function uploadLocalFile(file: File, onProgress?: (p: number) => void): Promise<LocalFile> {
  if (file.size > MAX_LOCAL_FILE) return Promise.reject(new Error(tr('meta.err.too_big_local', { name: file.name })))
  if (!file.size) return Promise.reject(new Error(tr('meta.err.empty_file', { name: file.name })))
  // 不在 Shuttle 里（手机、别的电脑）：文件在这台设备上，没法「存在电脑上」，改传到 creght 素材、存网址。
  // 电脑上发布时 b.upload 认网址（边下边传）；单个最多 MAX_UPLOAD，更大的视频要在电脑上传
  if (shuttleMissing()) {
    if (file.size > MAX_UPLOAD) return Promise.reject(new Error(tr('meta.err.too_big_remote', { name: file.name })))
    return uploadAsset(file).then((r) => {
      onProgress?.(1)
      return { ref: r.url, url: r.url, name: r.fileName, filename: r.fileName, size: r.size, content_type: r.mimeType }
    })
  }
  return new Promise((resolve, reject) => {
    // 要上传进度，用 XMLHttpRequest（fetch 拿不到）
    const x = new XMLHttpRequest()
    x.open('POST', '/_shuttle/api/local/files')
    x.setRequestHeader('X-Shuttle', '1')
    x.setRequestHeader('X-Filename', encodeURIComponent(file.name))
    if (file.type) x.setRequestHeader('Content-Type', file.type)
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    x.onerror = () => reject(new ShuttleUnavailable(tr('meta.err.no_shuttle')))
    x.onload = () => {
      if (!x.getResponseHeader('x-shuttle')) return reject(new ShuttleUnavailable(tr('meta.err.upload_offline')))
      let body: any = {}
      try {
        body = JSON.parse(x.responseText)
      } catch {}
      if (x.status < 200 || x.status >= 300) return reject(new Error(body.error || tr('meta.err.upload_failed', { status: x.status })))
      resolve(body as LocalFile)
    }
    x.send(file)
  })
}

/** 视频地址给页面播放：本机文件（local:<name>）换成 Shuttle 的预览地址，网址原样 */
export function videoSrc(v?: string) {
  if (!v) return ''
  return v.startsWith('local:') ? '/_shuttle/files/' + v.slice(6) : v
}

/** 写一个本机密钥（比如用户在弹窗里填的应用密码）：只能写，读不回来。表里只存密钥名 */
export const setSecret = (name: string, value: string) => api<{ ok: boolean }>('local/secrets', { method: 'PUT', body: { name, value } })

/** 这几个密钥配了没有（不返回值） */
export const secretsSet = (names: string[]) =>
  api<{ set: Record<string, boolean> }>(`local/secrets?names=${encodeURIComponent(names.join(','))}`).then((r) => r.set)

type Tables = {
  reports: Report
  assets: Asset
  social_posts: SocialPost
  social_daily: SocialDaily
  profile: Profile
  topics: Topic
  articles: Article
  rewrite_presets: RewritePreset
  publications: Publication
  social_accounts: Channel
  social_health: PlatformHealth
}

/** 社媒账号的浏览器自动化最近一次成没成（社媒插件写，表 social_health）：一个账号一类操作一行 */
export type PlatformHealth = {
  id: string
  channel_id: string
  platform: string
  op: 'probe' | 'publish' | 'remove' | 'collect'
  ok: boolean
  kind?: '' | 'broken' | 'expired'
  step?: string
  error?: string
  snapshot?: string
  steps?: string
  fails?: number
  checked_at?: string
  last_ok_at?: string
  post_id?: string
  dismissed_at?: string
}

/** 读业务表：从 Shuttle 打开时走 Shuttle（数据最新、带平台记录的时间），否则走站点 Func */
/**
 * 按真实时间从新到旧排（finished_at，没有就 created_at）。表接口是按字符串排的，时间里时区写法不同
 * （+08:00 和 Z 混着）时顺序会错，取「最新一次」之前都先过一遍这个。
 */
export function newestFirst<T extends { finished_at?: string; created_at?: string }>(list: T[]): T[] {
  const at = (x: T) => Date.parse(x.finished_at || x.created_at || '') || 0
  return [...list].sort((a, b) => at(b) - at(a))
}

export async function dbList<T extends keyof Tables>(table: T): Promise<Tables[T][]> {
  try {
    const r = await api<{ list: Tables[T][] }>(`db/${table}`)
    return r.list
  } catch (e) {
    if (!(e instanceof ShuttleUnavailable)) throw e
  }
  // 调研原文和内部写作依据只通过本机接口读取，不加入公开 Func 的兜底。
  if (['research_sources', 'research_findings', 'content_references'].includes(table)) throw new ShuttleUnavailable(tr('meta.err.no_shuttle'))
  const r = (await memberInvoke('db.list', { table })) as { list: Tables[T][] }
  return r.list
}

/** 项目资料（profile 表的那一行；多行时取最早建的），还没填返回 null */
export async function loadProfile(): Promise<Profile | null> {
  let list: Profile[]
  try {
    list = await dbList('profile')
  } catch (e) {
    // 表刚声明、还没建好时当作没填
    if (/没有这张表|table not found/i.test((e as Error).message)) return null
    throw e
  }
  if (!list.length) return null
  const at = (p: Profile) => Date.parse(p.created_at || '') || 0
  return withLegacyProfile([...list].sort((a, b) => at(a) - at(b))[0])
}

/** 旧版自媒体模板（v0.3）的定位字段换成现在的：新字段空着才用旧的，用户在页面上保存一次就写成新字段 */
const LEGACY_PROFILE: [string, string][] = [['about', 'profile'], ['audience', 'customer_types'], ['pillars', 'business'], ['voice', 'tone']]
export function withLegacyProfile<T extends Record<string, any>>(p: T): T {
  const out: Record<string, any> = { ...p }
  for (const [from, to] of LEGACY_PROFILE) if (!out[to] && typeof out[from] === 'string' && out[from].trim()) out[to] = out[from]
  return out as T
}

// 写表：在 Shuttle 里走本机；不在（手机）时走站点 Func db.create / update / remove（backend/func/db.ts，只给项目成员）。
// 改内容、标状态这类只改表的操作手机上也能做；发布、采集这类要电脑的还是本机函数。
async function orFunc<T>(local: () => Promise<T>, key: string, input: unknown): Promise<T> {
  try {
    return await local()
  } catch (e) {
    if (!(e instanceof ShuttleUnavailable)) throw e
    return (await memberInvoke(key, input)) as T
  }
}

// 页面里写了表就发 db:changed（detail.table 是表名），别处跟着重拉：比如左侧导航「内容中心」的待审数量
function changed<R>(table: keyof Tables, p: Promise<R>): Promise<R> {
  return p.then((r) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('db:changed', { detail: { table } }))
    return r
  })
}

export const dbCreate = <T extends keyof Tables>(table: T, data: Partial<Tables[T]>) =>
  changed(table, orFunc(() => api<Tables[T]>(`db/${table}`, { method: 'POST', body: data }), 'db.create', { table, data }))

export const dbPatch = <T extends keyof Tables>(table: T, id: string, patch: Partial<Tables[T]>) =>
  changed(table, orFunc(() => api<Tables[T]>(`db/${table}?id=${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }), 'db.update', { table, id, patch }))

export const dbDelete = (table: keyof Tables, id: string) =>
  changed(table, orFunc(() => api<{ ok: boolean }>(`db/${table}?id=${encodeURIComponent(id)}`, { method: 'DELETE' }), 'db.remove', { table, id }))

// ---- 交给运营助手 ----

/** 打开 Shuttle 外壳的设置或用量（外壳以弹窗盖在后台上）。不在 Shuttle 里时返回 false */
export function openShuttle(view: 'settings' | 'usage', section?: string) {
  if (!inShuttle()) return false
  window.parent.postMessage({ type: 'shuttle:navigate', view, hash: section ? '#' + section : '' }, window.location.origin)
  return true
}

/** 打开 Shuttle 外壳的设置页（比如 openShuttleSettings('secrets') 去填密钥） */
export function openShuttleSettings(section: 'secrets' | 'llm' | 'mcp' | 'skills' | 'backend' | 'connections' | 'schedules') {
  return openShuttle('settings', section)
}

/**
 * 「交给助手」：新开一段对话把这句话交给助手（后台跑，Shuttle 能力版本 8），返回对话 id。
 * 不塞进用户当前的对话；页面拿到 id 后在右侧打开它（openChat），用 runningChats 看跑完没有。
 */
export const askInNewChat = (text: string, title?: string) =>
  shuttleMissing() ? remoteSend(text) : api<{ chat_id: string }>('local/ask', { method: 'POST', body: { text, title } })

/** 正在跑（或在等用户回答问卷）的对话 id */
export const runningChats = (): Promise<Record<string, string>> =>
  shuttleMissing()
    ? remoteChats().then((l) => Object.fromEntries(l.filter((c) => c.status).map((c) => [c.id, c.status as string])))
    : api<{ chats: Record<string, string> }>('agent/running').then((r) => r.chats ?? {})
