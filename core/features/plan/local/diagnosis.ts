// 分析网站（任务 tasks/site-diagnosis.md）：填完网址、确认资料后一次跑完网站检查、关键词、AI 搜索、竞品，最后起草并开始 90 天计划。
// 每一步的状态和结论存在 site_diagnosis，总览上的进度卡片（components/Diagnosis.tsx）读它。设计见 docs/growth-plan.md「分析网站」。
//
//   diagnosis.start({ channel_id? })          开一次分析：网站默认是向导里选的（没有就第一个）；已经在跑的直接返回它。返回 { id, channel_id, steps }
//   diagnosis.get({})                         最近一次分析：每一步的状态、结论（页面和任务都读它）
//   diagnosis.step({ id, step, status, summary?, error? })   任务报一步的进度：running / done / failed / skipped
//   diagnosis.audit({ id })                   第 1 步网站检查（本机函数自己跑完、记结论；最多抓 100 页，几分钟）
//   diagnosis.geoPrep({ id })                 第 3 步之前：一键开 AI 搜索检测（geo.autoEngine）、补两个品牌问题；开不了就把这一步记成跳过
//   diagnosis.geoRun({ id })                  第 3 步：问一遍问题库里的问题，记可见度（每个问题半分钟到一分半）
//   diagnosis.finish({ id })                  收尾：计划起草成功算 done，否则 failed
//   diagnosis.attach({ id, chat_id })         页面开了任务后记下是哪段对话（「看过程」打开它）
//   diagnosis.seen({ id })                    总览上看过结果了，进度卡片收起来
//   setupItem(ctx)                            起步清单里的「分析网站」这一项（外贸、产品运营的 local/_checklist.ts 用）

import { L } from './_i18n'
import { run as auditRun } from './audit'
import { autoEngine, brandQuestions, check as geoCheck } from './geo'
import type { Item } from './today'

export const cloud = ['get', 'seen', 'attach']
export const remote = ['start', 'audit', 'geoPrep', 'geoRun']

type Step = { key: string; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; summary?: string; error?: string; started_at?: string; finished_at?: string }
const SITE_TYPES = ['creght_site', 'wordpress', 'website']
const nowISO = () => new Date().toISOString()
const parse = <T,>(s: any, d: T): T => { try { return s ? JSON.parse(s) : d } catch { return d } }

declare const require: (path: string) => any
/** 这个模板有没有某个模块的本机函数（外贸有竞品，产品运营没有；拼出来的路径：没有这个文件的模板打包不报错） */
function hasFn(name: string): boolean {
  try {
    return !!require('./' + name + '.ts')
  } catch {
    return false
  }
}

function all(ctx: any, table: string): any[] {
  try {
    return ctx.db.query(table, { limit: 1000 }).list
  } catch {
    return []
  }
}

function row(ctx: any, id: string) {
  const r = ctx.db.get('site_diagnosis', id)
  if (!r) throw new Error(L(ctx, '没有这次分析：', 'No such analysis: ') + id)
  return r
}

function save(ctx: any, id: string, key: string, patch: Partial<Step>) {
  const r = row(ctx, id)
  const steps = parse<Step[]>(r.steps, []).map((s) => {
    if (s.key !== key) return s
    const next = { ...s, ...patch }
    if (patch.status === 'running') { next.started_at = nowISO(); next.error = '' }
    if (patch.status === 'done' || patch.status === 'failed' || patch.status === 'skipped') next.finished_at = nowISO()
    return next
  })
  if (!steps.some((s) => s.key === key)) throw new Error(L(ctx, `没有这一步：${key}`, `No such step: ${key}`))
  ctx.db.update('site_diagnosis', id, { steps: JSON.stringify(steps) })
  return steps
}

const view = (r: any) => r && { id: r.id, channel_id: r.channel_id, status: r.status, steps: parse<Step[]>(r.steps, []), chat_id: r.chat_id ?? '', seen: !!r.seen, started_at: r.started_at, finished_at: r.finished_at ?? '' }

export function get(_input: {}, ctx: any) {
  // 最近开始的；同一时刻开始的取后建的
  const r = all(ctx, 'site_diagnosis').map((x, i) => ({ x, i })).sort((a, b) => String(b.x.started_at).localeCompare(String(a.x.started_at)) || b.i - a.i)[0]?.x
  return { run: view(r) ?? null }
}

export function start(input: { channel_id?: string }, ctx: any) {
  const sites = all(ctx, 'channels').filter((c) => SITE_TYPES.includes(c.type))
  const picked = all(ctx, 'onboarding').find((o) => o.key === 'trade')?.channel_id
  const site = sites.find((c) => c.id === input?.channel_id) ?? sites.find((c) => c.id === picked) ?? sites[0]
  if (!site) throw new Error(L(ctx, '还没有网站：先在向导里填网址', 'No website yet: enter its URL in the setup wizard first'))
  // 已经在跑（两小时内开始的）：不重复开
  const cur = get({}, ctx).run
  if (cur && cur.status === 'running' && Date.now() - Date.parse(cur.started_at) < 2 * 3600_000) return cur
  const keys = ['audit', 'keywords', 'geo', ...(hasFn('competitors') ? ['competitors'] : []), 'plan']
  const r = ctx.db.insert('site_diagnosis', {
    channel_id: site.id, status: 'running', seen: false, started_at: nowISO(),
    steps: JSON.stringify(keys.map((key) => ({ key, status: 'pending' }))),
    ...(ctx.chat_id ? { chat_id: String(ctx.chat_id) } : {}),
  })
  return view(ctx.db.get('site_diagnosis', r?.id ?? r))
}

export function step(input: { id: string; step: string; status: Step['status']; summary?: string; error?: string }, ctx: any) {
  if (!['running', 'done', 'failed', 'skipped'].includes(input?.status)) throw new Error(L(ctx, 'status 只能是 running / done / failed / skipped', 'status must be running / done / failed / skipped'))
  const r = row(ctx, input.id)
  // 任务的对话：第一次报进度时记下来，页面「看过程」打开它
  if (ctx.chat_id && !r.chat_id) ctx.db.update('site_diagnosis', r.id, { chat_id: String(ctx.chat_id) })
  const steps = save(ctx, input.id, input.step, { status: input.status, summary: String(input.summary ?? ''), error: String(input.error ?? '') })
  return { steps }
}

export async function audit(input: { id: string }, ctx: any) {
  const r = row(ctx, input?.id)
  save(ctx, r.id, 'audit', { status: 'running' })
  try {
    const a: any = await auditRun({ channel_id: r.channel_id, max: 100 }, ctx)
    const summary = L(ctx, `查了 ${a.pages} 页，${a.score} 分；严重问题 ${a.issues?.high ?? 0} 个、一般 ${a.issues?.medium ?? 0} 个${a.top?.length ? `，最要紧的：${a.top.join('；')}` : ''}`,
      `Checked ${a.pages} pages, score ${a.score}; ${a.issues?.high ?? 0} serious and ${a.issues?.medium ?? 0} medium issues${a.top?.length ? `. Most urgent: ${a.top.join('; ')}` : ''}`)
    save(ctx, r.id, 'audit', { status: 'done', summary })
    return { ok: true, summary, result: a }
  } catch (e) {
    const error = (e as Error).message
    save(ctx, r.id, 'audit', { status: 'failed', error })
    return { ok: false, error }
  }
}

export function geoPrep(input: { id: string }, ctx: any) {
  const r = row(ctx, input?.id)
  save(ctx, r.id, 'geo', { status: 'running' })
  const eng = autoEngine({}, ctx)
  if (!eng.ready) {
    save(ctx, r.id, 'geo', { status: 'skipped', summary: eng.reason })
    return { ready: false, reason: eng.reason }
  }
  // 两个品牌问题：AI 怎么介绍你、官网是哪个（不算可见度，看 AI 说得对不对）
  let added = 0
  try { added = ((brandQuestions({ channel_id: r.channel_id, keys: ['about', 'website'] }, ctx) as any)?.added ?? []).length } catch { /* 还没填公司名：只问推荐类问题 */ }
  const active = all(ctx, 'geo_questions').filter((q) => q.channel_id === r.channel_id && q.status !== 'paused')
  return { ready: true, engine: eng.engine, provider: eng.provider, brand_added: added, questions: active.length, recommended: active.filter((q) => q.intent !== 'brand').length }
}

export async function geoRun(input: { id: string }, ctx: any) {
  const r = row(ctx, input?.id)
  try {
    await geoCheck({ channel_id: r.channel_id }, ctx)
    const last = all(ctx, 'geo_runs').filter((x) => x.channel_id === r.channel_id && x.finished_at).sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)))[0]
    const summary = last
      ? L(ctx, `问了 ${last.questions ?? 0} 个问题，AI 推荐时提到你的占 ${last.visibility ?? 0}%`, `Asked ${last.questions ?? 0} questions; AI mentioned you in ${last.visibility ?? 0}% of recommendation answers`)
      : L(ctx, '检测完了', 'Check finished')
    save(ctx, r.id, 'geo', { status: 'done', summary })
    return { ok: true, summary }
  } catch (e) {
    const error = (e as Error).message
    save(ctx, r.id, 'geo', { status: 'failed', error })
    return { ok: false, error }
  }
}

export function finish(input: { id: string }, ctx: any) {
  const r = row(ctx, input?.id)
  const steps = parse<Step[]>(r.steps, [])
  // 还标着在跑、没开始的步骤：任务没走到，记成跳过
  const fixed = steps.map((s) => (s.status === 'pending' || s.status === 'running' ? { ...s, status: 'skipped' as const, finished_at: nowISO() } : s))
  const planned = fixed.find((s) => s.key === 'plan')?.status === 'done'
  ctx.db.update('site_diagnosis', r.id, { steps: JSON.stringify(fixed), status: planned ? 'done' : 'failed', finished_at: nowISO() })
  return view(ctx.db.get('site_diagnosis', r.id))
}

export function attach(input: { id: string; chat_id: string }, ctx: any) {
  const r = row(ctx, input?.id)
  if (input?.chat_id) ctx.db.update('site_diagnosis', r.id, { chat_id: String(input.chat_id) })
  return { ok: true }
}

export function seen(input: { id: string }, ctx: any) {
  const r = row(ctx, input?.id)
  ctx.db.update('site_diagnosis', r.id, { seen: true })
  return { ok: true }
}

/**
 * 起步清单里的「分析网站」（起步只剩输入网址、确认资料和这一项；连谷歌、询盘接收、增长目标这些由分析排进计划第 1 周）。
 * 起草出计划（或者已经有计划）就算做完；在跑时显示第几步；没配模型时退回只做网站检查。
 */
export function setupItem(ctx: any): Item {
  const run = get({}, ctx).run
  const sites = all(ctx, 'channels').filter((c) => SITE_TYPES.includes(c.type))
  const planned = all(ctx, 'growth_plans').some((p) => p.status === 'active' || p.status === 'done') || (run?.status === 'done')
  let ready = true
  try { ready = ctx.agent.current().ready !== false } catch { /* 云端（手机上）没有 ctx.agent，按能跑算 */ }
  if (!ready) {
    const checked = all(ctx, 'audit_runs').length > 0
    return {
      key: 'analyze', title: L(ctx, '做一次网站检查', 'Run a site check'),
      why: L(ctx, '还没配好模型，先检查网站的技术和 SEO 问题；在 设置 → 模型 里配好以后，可以在增长计划里分析网站、生成 90 天计划。', 'No model is set up yet, so start with a technical and SEO check of your site. After adding a model in Settings → Models, analyze your site and build a 90-day plan from the growth plan page.'),
      minutes: 3, done: checked || planned,
      action: sites[0] ? { kind: 'run', fn: 'audit.run', input: { channel_id: sites[0].id } } : { kind: 'go', view: 'channels' },
      action_label: L(ctx, '检查网站', 'Check website'), page: { view: 'audit' },
    }
  }
  const running = run?.status === 'running'
  const n = run ? run.steps.filter((x: Step) => x.status !== 'pending' && x.status !== 'running').length : 0
  return {
    key: 'analyze',
    title: L(ctx, '分析网站，生成 90 天计划', 'Analyze your site and build a 90-day plan'),
    why: L(ctx, '一次跑完网站检查、关键词、AI 搜索检测和竞品，按结果排出 90 天要做的事：哪些你来做、哪些交给 AI。大约 15~20 分钟，在后台跑。', 'One pass over site checks, keywords, AI search and competitors, then a 90-day plan from the results: what you do and what AI does. About 15–20 minutes, in the background.'),
    minutes: 20, done: planned, running,
    summary: running ? L(ctx, `正在分析：第 ${n}/${run!.steps.length} 步，可以先去做别的`, `Analyzing: step ${n}/${run!.steps.length}. Feel free to do something else`) : run?.status === 'failed' ? L(ctx, '上次没跑完，可以再分析一次', "Last run didn't finish; you can analyze again") : undefined,
    action: { kind: 'task', task: 'site-diagnosis', input: {} },
    action_label: L(ctx, run ? '重新分析' : '开始分析', run ? 'Analyze again' : 'Start analysis'),
    page: { view: 'plan' },
  }
}
