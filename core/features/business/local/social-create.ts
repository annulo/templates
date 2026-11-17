import { L } from './_i18n'
import { profile, projectBrief } from './_ai'
import { json, requireRow } from './_research'
import { forWriting } from './playbooks'
import { add as addAsset } from './assets'
import { fieldsFor } from '../plugins/social/local/_fields'
import { PLATFORMS } from '../plugins/social/local/_platforms'

// 新建社媒内容（三步：要做什么 → 方案 → 成片与发布，设计见 docs/social-create.md）。
// 一条社媒内容就是一个选题（topics，workspace=social），向导的状态都在选题 brief.social 里；做出来是一篇文章（视频 / 图文）+ 每个账号一条待审帖子。
//   social-create.save({ topic_id?, title?, social })   页面自动存（没有 topic_id 就新建选题）
//   social-create.readSite({ topic_id, url })          读网站：本机 Chrome 一屏一张截图（scripts/social-video.mjs）
//   social-create.context({ topic_id })                出方案（任务 tasks/social-plan.md）要的：要求、网站每屏的文字和截图、账号、风格卡、平台限制
//   social-create.savePlan({ topic_id, plan })         存方案（新的一版，记下对话），返回平台限制上的问题
//   social-create.pickPlan({ topic_id, version })      切回某一版方案
//   social-create.produce({ topic_id })                照确认的方案录视频 / 出图 → 文章 + 每个账号一条待审帖子

const text = (v: unknown) => String(v ?? '').trim()
const now = () => new Date().toISOString()
const ASPECTS = ['9:16', '3:4', '4:3', '16:9', '1:1'] as const
const MAX_PLANS = 8

type Shot = { start: number; end: number; screen?: number; y_from?: number; y_to?: number; caption?: string; note?: string; card?: { title: string; subtitle?: string } }
type Copy = { channel_id: string; type?: string; title?: string; body: string; tags?: string[]; cover_text?: string; category?: string }
type Plan = {
  version: number; created_at: string; chat_id?: string; title: string; summary?: string
  shots?: Shot[]; images?: { screen: number; title: string; subtitle?: string }[]
  cover?: { title: string; subtitle?: string; screen?: number; ratio?: string }
  rationale?: string[]; copies: Copy[]
}

function socialOf(topic: any) {
  const brief = json<any>(topic.brief, {})
  return { brief, social: (brief.social && typeof brief.social === 'object' ? brief.social : {}) as any }
}
function write(ctx: any, topic: any, social: any, patch: Record<string, unknown> = {}) {
  const { brief } = socialOf(topic)
  ctx.db.update('topics', topic.id, { ...patch, brief: JSON.stringify({ ...brief, social }) })
}

function needLocal(ctx: any) {
  if (!ctx.fs || !ctx.exec) throw new Error(L(ctx, 'Annulo 版本太老：请先更新 Annulo 再用这个功能', 'Annulo is too old for this. Update Annulo first.'))
  if (ctx.fs.kind === 's3') throw new Error(L(ctx, '录网站要在本机版 Annulo 上做', 'Recording a website needs the desktop Annulo'))
}

/** 这条内容的工作文件夹（截图、成片都放这里），返回相对工作目录的路径 */
function folderOf(ctx: any, topic: any, social: any): string {
  if (social.folder && ctx.fs.stat(social.folder)) return social.folder
  let host = ''
  try { host = new URL(text(social.source?.url || social.site?.url)).hostname.replace(/^www\./, '') } catch {}
  const name = (host || text(topic.title).slice(0, 16) || 'content').replace(/[\\/:*?"<>|#%\s，。、：；！？（）]+/g, '-').replace(/^-+|-+$/g, '')
  const path = `${L(ctx, '社媒内容', 'Social')}/${now().slice(0, 10)}-${name}-${String(topic.id).slice(-4)}`
  if (ctx.folders?.create) return ctx.folders.create(path).path
  ctx.fs.mkdir(path)
  return path
}
const abs = (ctx: any, rel: string) => `${String(ctx.fs.root).replace(/[\\/]+$/, '')}/${rel}`

async function runScript(ctx: any, cmd: string, folder: string, spec: any, timeout: number) {
  const specPath = `${folder}/.${cmd}.json`
  ctx.fs.write(specPath, JSON.stringify(spec))
  const r = await ctx.exec('node', ['scripts/social-video.mjs', cmd, abs(ctx, specPath)], { timeout })
  const line = String(r.stdout || '').trim().split('\n').pop() || ''
  let out: any = null
  try { out = JSON.parse(line) } catch {}
  if (!out) throw new Error(L(ctx, `录制工具没跑起来（要装 Node.js 22 以上）：${text(r.stderr).slice(-400)}`, `The recorder didn't run (needs Node.js 22+): ${text(r.stderr).slice(-400)}`))
  if (out.error) throw new Error(out.error)
  return out
}

/** 页面自动存：向导里改了什么就存什么（素材、要求、平台、形式、风格、补充要求），没有选题先建一个 */
export function save(input: { topic_id?: string; title?: string; social: any }, ctx: any) {
  const s = input?.social || {}
  const clean: any = {
    source: { kind: ['url', 'product', 'article', 'upload'].includes(s.source?.kind) ? s.source.kind : 'url', url: text(s.source?.url), product_id: text(s.source?.product_id), article_id: text(s.source?.article_id), files: Array.isArray(s.source?.files) ? s.source.files.map(String).slice(0, 20) : [] },
    request: text(s.request).slice(0, 2000),
    platforms: (Array.isArray(s.platforms) ? s.platforms : []).slice(0, 10).map((p: any) => ({ channel_id: text(p.channel_id), type: text(p.type), why: ['said', 'recommended', 'picked'].includes(p.why) ? p.why : 'picked' })).filter((p: any) => p.channel_id),
    format: {
      type: s.format?.type === 'post' ? 'post' : 'video',
      duration: Math.min(180, Math.max(5, Number(s.format?.duration) || 30)),
      aspect: ASPECTS.includes(s.format?.aspect) ? s.format.aspect : '4:3',
      media: ['record', 'upload', 'library'].includes(s.format?.media) ? s.format.media : 'record',
      subtitles: s.format?.subtitles !== false,
      music: text(s.format?.music),
      images: Math.min(18, Math.max(1, Number(s.format?.images) || 6)),
      extra_vertical: !!s.format?.extra_vertical,
    },
    style: ['playbook', 'none', 'reference'].includes(s.style) ? s.style : 'none',
    playbook_id: text(s.playbook_id),
    reference_url: text(s.reference_url),
    notes: text(s.notes).slice(0, 2000),
    skip: Array.isArray(s.skip) ? s.skip.map(Number).filter((n: number) => n > 0) : [],
  }
  for (const p of clean.platforms) requireRow(ctx, 'social_accounts', p.channel_id)
  const title = text(input.title) || clean.request.slice(0, 40) || L(ctx, '新的社媒内容', 'New social content')
  const fields = {
    title, workspace: 'social', content_type: clean.format.type,
    target_platform: clean.platforms[0]?.type || '', target_account_id: clean.platforms[0]?.channel_id || '',
    playbook_id: clean.style === 'playbook' ? clean.playbook_id : '',
  }
  if (!input.topic_id) {
    const brief = { language: L(ctx, 'zh', 'en'), channels: 'social', product_ids: clean.source.product_id ? [clean.source.product_id] : [], social: clean }
    const row = ctx.db.insert('topics', { ...fields, angle: clean.request, source: 'manual', status: 'idea', created_at: now(), brief: JSON.stringify(brief) })
    return { topic_id: row.id }
  }
  const topic = requireRow(ctx, 'topics', input.topic_id)
  const { social } = socialOf(topic)
  // 网站读到的、方案、成片这些由函数和助手写，页面存的时候留着
  write(ctx, topic, { ...social, ...clean }, { ...fields, angle: clean.request })
  return { topic_id: topic.id }
}

/** 读网站：本机 Chrome（无界面）打开网址，一屏一张截图，记下每屏的标题和文字 */
export async function readSite(input: { topic_id: string; url: string }, ctx: any) {
  needLocal(ctx)
  const topic = requireRow(ctx, 'topics', input?.topic_id)
  const url = text(input?.url)
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(L(ctx, '网址要以 http:// 或 https:// 开头', 'The URL must start with http:// or https://'))
  const { social } = socialOf(topic)
  const folder = folderOf(ctx, topic, social)
  ctx.progress?.({ message: L(ctx, '正在打开网站、一屏一屏截图…', 'Opening the site and capturing each screen…') })
  const out = await runScript(ctx, 'screens', folder, { url, out: abs(ctx, `${folder}/site`), width: 1440, height: 1080, max: 10 }, 180000)
  const root = String(ctx.fs.root).replace(/[\\/]+$/, '') + '/'
  const site = {
    url, title: text(out.title), description: text(out.description), page_height: out.page_height, width: out.width, height: out.height, read_at: now(),
    screens: (out.screens || []).map((s: any) => ({ n: s.n, y: s.y, file: String(s.file).replace(root, ''), heading: text(s.heading), text: text(s.text) })),
  }
  ctx.fs.write(`${folder}/site/text.txt`, text(out.text))
  const fresh = requireRow(ctx, 'topics', topic.id)
  write(ctx, fresh, { ...socialOf(fresh).social, folder, site, source: { ...(socialOf(fresh).social.source || {}), kind: 'url', url }, skip: [] })
  return { title: site.title, screens: site.screens.length }
}

function accountsOf(ctx: any, social: any) {
  return (social.platforms || []).map((p: any) => {
    const ch = ctx.db.get('social_accounts', p.channel_id)
    if (!ch) return null
    const f = fieldsFor(ch.type, social.format?.type === 'post' ? 'post' : 'video')
    return {
      channel_id: ch.id, type: ch.type, name: ch.name, profile: text(ch.profile), why: p.why,
      limits: f ? { title: f.title === 'publish' ? f.titleMax : 0, body: f.bodyMax, tags: f.tags, category: !!f.category, cover_ratio: f.coverRatio ? f.coverRatio.join(':') : '' } : null,
    }
  }).filter(Boolean)
}

/** 出方案要的：用户的要求和设置、网站每屏、账号和平台限制、风格卡、项目资料、上一版方案 */
export function context(input: { topic_id: string }, ctx: any) {
  const topic = requireRow(ctx, 'topics', input?.topic_id)
  const { social } = socialOf(topic)
  const skip = new Set<number>(social.skip || [])
  const product = social.source?.product_id ? ctx.db.get('products', social.source.product_id) : null
  const article = social.source?.article_id ? ctx.db.get('articles', social.source.article_id) : null
  return {
    topic: { id: topic.id, title: topic.title },
    request: social.request || '',
    format: social.format || {},
    notes: social.notes || '',
    source: social.source || {},
    site: social.site ? {
      url: social.site.url, title: social.site.title, description: social.site.description, page_height: social.site.page_height, viewport: { width: social.site.width, height: social.site.height },
      screens: (social.site.screens || []).filter((s: any) => !skip.has(s.n)).map((s: any) => ({ ...s, path: abs(ctx, s.file) })),
      full_text: social.folder ? abs(ctx, `${social.folder}/site/text.txt`) : '',
    } : null,
    product: product ? { id: product.id, name: product.name, summary: product.summary, audience: product.audience, features: text(product.features).slice(0, 2000), proof: text(product.proof).slice(0, 1000), url: product.url } : null,
    article: article ? { id: article.id, title: article.title, type: article.type, body: text(article.body).slice(0, 4000) } : null,
    accounts: accountsOf(ctx, social),
    playbook: social.style === 'playbook' ? forWriting(ctx, social.playbook_id) : null,
    reference_url: social.style === 'reference' ? social.reference_url || '' : '',
    project: projectBrief(profile(ctx)),
    plan: social.plan || null,
  }
}

/** 文案在平台限制上的问题（标题、正文字数、话题个数），存方案时返回给助手改 */
function copyProblems(ctx: any, social: any, copies: Copy[]) {
  const type = social.format?.type === 'post' ? 'post' : 'video'
  const out: string[] = []
  for (const a of accountsOf(ctx, social)) {
    const c = copies.find((x) => x.channel_id === a.channel_id)
    if (!c) { out.push(L(ctx, `${a.name}：缺这个账号的文案`, `${a.name}: missing copy for this account`)); continue }
    const f = fieldsFor(a.type, type)
    if (!f) continue
    const title = text(c.title), tags = (c.tags || []).map(String)
    if (f.title === 'publish' && !title) out.push(L(ctx, `${a.name}：要有标题`, `${a.name}: needs a title`))
    if (f.title === 'publish' && [...title].length > f.titleMax) out.push(L(ctx, `${a.name}：标题 ${[...title].length} 字，最多 ${f.titleMax}`, `${a.name}: title is ${[...title].length} chars, max ${f.titleMax}`))
    const len = f.len(text(c.body), tags)
    if (len > f.bodyMax) out.push(L(ctx, `${a.name}：正文 ${len}，最多 ${f.bodyMax}`, `${a.name}: body is ${len}, max ${f.bodyMax}`))
    if (tags.length > f.tags) out.push(L(ctx, `${a.name}：话题 ${tags.length} 个，最多 ${f.tags}`, `${a.name}: ${tags.length} tags, max ${f.tags}`))
  }
  return out
}

/** 存一版方案（任务 tasks/social-plan.md）：分镜或图、封面、为什么这样做、每个账号的文案；记下对话，用户在对话里提意见时再存新的一版 */
export function savePlan(input: { topic_id: string; plan: Partial<Plan> }, ctx: any) {
  const topic = requireRow(ctx, 'topics', input?.topic_id)
  const { social } = socialOf(topic)
  const p = input?.plan || {} as Partial<Plan>
  const video = social.format?.type !== 'post'
  const shots: Shot[] = (Array.isArray(p.shots) ? p.shots : []).slice(0, 30).map((s: any) => ({
    start: Number(s.start) || 0, end: Number(s.end) || 0, screen: Number(s.screen) || undefined,
    y_from: Number(s.y_from ?? 0), y_to: Number(s.y_to ?? s.y_from ?? 0),
    caption: text(s.caption).slice(0, 60), note: text(s.note).slice(0, 200),
    ...(s.card ? { card: { title: text(s.card.title).slice(0, 40), subtitle: text(s.card.subtitle).slice(0, 60) } } : {}),
  })).filter((s) => s.end > s.start)
  const images = (Array.isArray(p.images) ? p.images : []).slice(0, 18).map((x: any) => ({ screen: Number(x.screen) || 1, title: text(x.title).slice(0, 40), subtitle: text(x.subtitle).slice(0, 80) }))
  if (video && !shots.length) throw new Error(L(ctx, '视频方案要有分镜（shots）', 'A video plan needs shots'))
  if (!video && !images.length) throw new Error(L(ctx, '图文方案要有配图（images）', 'A post plan needs images'))
  const copies: Copy[] = (Array.isArray(p.copies) ? p.copies : []).map((c: any) => ({
    channel_id: text(c.channel_id), title: text(c.title), body: text(c.body), tags: (Array.isArray(c.tags) ? c.tags : []).map((t: any) => text(t).replace(/^#/, '')).filter(Boolean),
    cover_text: text(c.cover_text), category: text(c.category),
  })).filter((c) => c.channel_id)
  const plans: Plan[] = Array.isArray(social.plans) ? social.plans : []
  const version = Math.max(0, ...plans.map((x) => x.version || 0)) + 1
  const plan: Plan = {
    version, created_at: now(), chat_id: text(ctx.chat_id), title: text(p.title).slice(0, 80) || topic.title, summary: text(p.summary).slice(0, 400),
    ...(video ? { shots } : { images }),
    cover: p.cover ? { title: text(p.cover.title).slice(0, 30), subtitle: text(p.cover.subtitle).slice(0, 40), screen: Number(p.cover.screen) || 1, ratio: ASPECTS.includes(p.cover.ratio as any) ? p.cover.ratio : '3:4' } : undefined,
    rationale: (Array.isArray(p.rationale) ? p.rationale : []).map(text).filter(Boolean).slice(0, 8),
    copies,
  }
  write(ctx, topic, { ...social, plan, plans: [...plans, plan].slice(-MAX_PLANS), plan_chat_id: plan.chat_id || social.plan_chat_id || '' }, { title: plan.title, status: topic.status === 'done' ? 'done' : 'writing', ...(ctx.chat_id ? { chat_id: ctx.chat_id } : {}) })
  return { version, problems: copyProblems(ctx, social, copies), link: `/?view=social-content&create=${topic.id}` }
}

export function pickPlan(input: { topic_id: string; version: number }, ctx: any) {
  const topic = requireRow(ctx, 'topics', input?.topic_id)
  const { social } = socialOf(topic)
  const plan = (social.plans || []).find((x: Plan) => x.version === Number(input?.version))
  if (!plan) throw new Error(L(ctx, '没有这一版方案', 'No such plan version'))
  write(ctx, topic, { ...social, plan })
  return { version: plan.version }
}

// 画幅 → 浏览器窗口（CSS 像素）和放大倍数：成片 1440×1080、1080×1920… 竖的用手机版网页
const VIEWPORT: Record<string, { width: number; height: number; scale: number }> = {
  '4:3': { width: 1440, height: 1080, scale: 1 }, '16:9': { width: 1440, height: 810, scale: 1 }, '1:1': { width: 1080, height: 1080, scale: 1 },
  '3:4': { width: 810, height: 1080, scale: 4 / 3 }, '9:16': { width: 405, height: 720, scale: 8 / 3 },
}

/** 照确认的方案做出来：视频录网站（或图文出图）+ 封面，建一篇文章挂上，再给每个账号存一条待审帖子 */
export async function produce(input: { topic_id: string }, ctx: any) {
  needLocal(ctx)
  const topic = requireRow(ctx, 'topics', input?.topic_id)
  const { social } = socialOf(topic)
  const plan: Plan | undefined = social.plan
  if (!plan) throw new Error(L(ctx, '还没有方案：先让 AI 出方案并确认', 'No plan yet: have the AI draft one and confirm it first'))
  if (!social.site?.url) throw new Error(L(ctx, '还没读网站：回到第 1 步填网址', 'No website read yet: go back to step 1'))
  const folder = folderOf(ctx, topic, social)
  const video = social.format?.type !== 'post'
  const aspect = social.format?.aspect || '4:3'
  const vp = VIEWPORT[aspect] || VIEWPORT['4:3']
  const site = social.site
  const screenY = (n?: number) => site.screens?.find((s: any) => s.n === n)?.y ?? 0
  const sourceHeight = vp.width < 600 ? site.page_height : 0 // 竖屏用手机版网页：位置按页面高度换算
  const v = plan.version
  const files: { video?: string; cover?: string; images: string[] } = { images: [] }
  if (video) {
    ctx.progress?.({ message: L(ctx, '正在录网站、合成视频（30 秒的片子大概要 2 分钟）…', 'Recording the site and encoding the video (about 2 minutes for 30 seconds)…') })
    const shots = (plan.shots || []).map((s) => ({ ...s, y_from: s.y_from ?? screenY(s.screen), y_to: s.y_to ?? s.y_from ?? screenY(s.screen), caption: social.format?.subtitles === false ? '' : s.caption }))
    let music = ''
    if (social.format?.music) {
      const m = text(social.format.music)
      if (m.startsWith('local:') && ctx.fs.copy) { ctx.fs.copy(m, `${folder}/music${m.slice(m.lastIndexOf('.')) || '.mp3'}`); music = abs(ctx, `${folder}/music${m.slice(m.lastIndexOf('.')) || '.mp3'}`) }
    }
    await runScript(ctx, 'record', folder, { url: site.url, out: abs(ctx, folder), name: `video-v${v}.mp4`, ...vp, source_height: sourceHeight, fps: 25, shots, music }, 600000)
    files.video = `${folder}/video-v${v}.mp4`
  } else {
    ctx.progress?.({ message: L(ctx, '正在出图…', 'Rendering images…') })
    const imgs = plan.images || []
    for (let i = 0; i < imgs.length; i++) {
      ctx.progress?.({ done: i, total: imgs.length, message: L(ctx, `正在出第 ${i + 1} 张图…`, `Rendering image ${i + 1}…`) })
      const file = `${folder}/image-v${v}-${String(i + 1).padStart(2, '0')}.png`
      await runScript(ctx, 'cover', folder, { url: site.url, file: abs(ctx, file), ...vp, y: screenY(imgs[i].screen), title: imgs[i].title, subtitle: imgs[i].subtitle, source_height: sourceHeight }, 120000)
      files.images.push(file)
    }
  }
  if (plan.cover && video) {
    ctx.progress?.({ message: L(ctx, '正在出封面…', 'Rendering the cover…') })
    const cvp = VIEWPORT[plan.cover.ratio || '3:4'] || VIEWPORT['3:4']
    const file = `${folder}/cover-v${v}.png`
    await runScript(ctx, 'cover', folder, { url: site.url, file: abs(ctx, file), ...cvp, y: screenY(plan.cover.screen), title: plan.cover.title, subtitle: plan.cover.subtitle, source_height: cvp.width < 600 ? site.page_height : 0 }, 120000)
    files.cover = file
  }

  // 文章：一条内容一篇（视频 / 图文），各账号的版本是它的待审帖子
  const main = plan.copies[0] || { title: plan.title, body: plan.summary || '', tags: [] }
  const t = now()
  const fields = {
    title: text(main.title) || plan.title, type: video ? 'video' : 'post', body: text(main.body), summary: text(plan.summary), tags: JSON.stringify(main.tags || []),
    topic_id: topic.id, workspace: 'social', target_platform: topic.target_platform || '', target_account_id: topic.target_account_id || '',
    playbook_id: social.style === 'playbook' ? social.playbook_id || '' : '', draft: '', updated_at: t,
  }
  let article = social.produced?.article_id ? ctx.db.get('articles', social.produced.article_id) : null
  if (article) ctx.db.update('articles', article.id, { ...fields, unread: true })
  else article = ctx.db.insert('articles', { ...fields, status: 'draft', unread: true, created_at: t })
  const local = (rel: string) => ctx.fs.toLocal(rel)
  const note = L(ctx, `新建社媒内容 · 方案第 ${v} 版`, `New social content · plan v${v}`)
  if (files.video) addAsset({ files: [{ url: local(files.video), mime: 'video/mp4', name: `video-v${v}.mp4` }], article_id: article.id, note, use: true }, ctx)
  if (files.cover) addAsset({ files: [{ url: local(files.cover), mime: 'image/png', name: `cover-v${v}.png` }], article_id: article.id, note, use: 'cover' }, ctx)
  if (files.images.length) addAsset({ files: files.images.map((f, i) => ({ url: local(f), mime: 'image/png', name: `image-${i + 1}.png` })), article_id: article.id, note, use: true }, ctx)
  article = ctx.db.get('articles', article.id)

  // 每个账号存一条待审帖子（社媒插件的 save 校验平台规格）：已经有没发出去的那一版就改它
  const images = json<string[]>(article.images, [])
  const posts = []
  for (const a of accountsOf(ctx, social)) {
    const c = plan.copies.find((x) => x.channel_id === a.channel_id)
    const mod = PLATFORMS[a.type]
    if (!c || !mod?.save) { posts.push({ channel_id: a.channel_id, name: a.name, error: L(ctx, '这个账号没有文案或平台不支持', 'No copy for this account, or the platform is not supported') }); continue }
    const existing = ctx.db.query('social_posts', { where: { article_id: article.id, channel_id: a.channel_id }, limit: 20 }).list.find((p: any) => !['published', 'publishing', 'removed', 'rejected'].includes(p.status))
    try {
      const r = mod.save({
        article_id: article.id, article_title: article.title, images, channel_id: a.channel_id,
        title: text(c.title) || article.title, body: text(c.body), tags: c.tags || [],
        ...(video ? { video: article.video, video_cover: article.video_cover || '' } : { post_images: images }),
        ...(c.cover_text ? { cover_text: c.cover_text } : {}), ...(c.category ? { category: c.category } : {}),
        ...(existing ? { post_id: existing.id } : {}),
      }, ctx)
      posts.push({ channel_id: a.channel_id, name: a.name, post_id: r?.post_id || r?.id || existing?.id || '', problems: r?.problems || [] })
    } catch (e) {
      posts.push({ channel_id: a.channel_id, name: a.name, error: (e as Error).message })
    }
  }
  ctx.db.update('topics', topic.id, { article_id: article.id, status: 'done' })
  const fresh = requireRow(ctx, 'topics', topic.id)
  write(ctx, fresh, { ...socialOf(fresh).social, folder, produced: { article_id: article.id, version: v, at: now(), video: files.video || '', cover: files.cover || '', images: files.images, posts } })
  return { article_id: article.id, video: files.video, cover: files.cover, images: files.images, posts, link: `/?view=social-content&article=${article.id}` }
}
