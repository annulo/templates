// 总览的任务清单（本机函数）：按业务表里的数据算出「现在该做什么」，一步一步带用户把业务运营起来。
// 全是确定的规则，不调模型：秒开、每次结果一样。每一项带一个动作（去哪个页面 / 跑哪个本机函数 / 交给助手的哪个任务）。
//
//   today.list({})                  起步任务（一次性，按顺序）+ 今天要做的（每天按数据算）
//   today.skip({ key })             跳过一个起步任务（排到最后，不再挡着下一步）
//   today.unskip({ key })
//   today.dismiss({ key, value })   忽略一条今天要做的；value 是当时的数量，数量变多了会再出现
//   today.setupPanel({ open })      总览上的起步清单展开 / 收起（起步没做完时默认展开，用户收起后记住）
//
// 跳过、忽略记在 checklist 表（一项一行：key、status、value）。
// 起步任务和今天要做的有哪些、怎么说，是行业文件 local/_checklist.ts（setupSteps、dailyItems，各行业模板各一份）；这里是共用的清单引擎（外贸和产品运营的 business 模块）。

import { L } from './_i18n'
import { setupSteps, dailyItems } from './_checklist'

// 手机上打开后台（不在 Shuttle 里）时这几个也能用：annulo push 会把它们打包成站点 Func，只能用 ctx.db、ctx.mcp('creght', …)、ctx.locale
export const cloud = ['list', 'skip', 'unskip', 'dismiss', 'openWizard', 'closeWizard', 'setupPanel']

export type Action = { kind: 'go'; view: string; params?: Record<string, string> } | { kind: 'run'; fn: string; input?: unknown } | { kind: 'task'; task: string; input?: unknown }

export type Item = {
  key: string
  title: string
  /** 为什么要做（一句话） */
  why: string
  /** 大概要几分钟 */
  minutes?: number
  wizard?: boolean
  screen?: string
  summary?: string
  done: boolean
  skipped?: boolean
  /** 正在后台做（比如开始运营时自动跑的网站检查）：清单上显示进行中，不显示按钮 */
  running?: boolean
  /** 今天要做的：涉及几条（询盘数、待审数…） */
  count?: number
  action: Action
  action_label: string
  /** 做完以后结果在哪个页面：已完成的行点了去这里；没有就去 go 动作的页面 */
  page?: { view: string; params?: Record<string, string> }
  /** 「交给助手」：交给助手的任务（tasks/<task>.md，新开一段对话跑）；没有就不显示这个按钮 */
  ask?: { task: string; input?: unknown }
}

type State = { id: string; key: string; status: 'skipped' | 'dismissed'; value?: number }

const all = (ctx: any, table: string): any[] => {
  try {
    return ctx.db.query(table, { limit: 1000 }).list
  } catch {
    return [] // 表还没建（老项目）：当作没有数据
  }
}
const has = (ctx: any, table: string) => {
  try {
    return ctx.db.query(table, { limit: 1 }).list.length > 0
  } catch {
    return false
  }
}

declare const require: (path: string) => any

/** 90 天增长计划（plan 模块，有就用）：检查点到了、这周还没做完的计划项排在「今天要做的」最前面 */
function planItems(ctx: any): Item[] {
  let week: any
  try {
    week = require('./pl' + 'an.ts').thisWeek({}, ctx) // 拼出来的路径：没有这个模块的模板打包不报错
  } catch {
    return []
  }
  const out: Item[] = []
  if (week.checkpoint_due)
    out.push({
      key: 'plan-checkpoint-' + week.checkpoint_due, done: false,
      title: L(ctx, `增长计划到 Day ${week.checkpoint_due} 检查点了`, `Growth plan: day ${week.checkpoint_due} checkpoint is due`),
      why: L(ctx, '对着开始时的数据看效果，排好下一阶段', 'Compare with the baseline and plan the next phase'),
      action: { kind: 'go', view: 'plan' }, action_label: L(ctx, '去检查', 'Review'),
      ask: { task: 'plan-checkpoint', input: { day: week.checkpoint_due } },
    })
  for (const it of week.items ?? [])
    out.push({
      key: 'plan-item-' + it.id, done: false,
      title: it.title, why: it.why || L(ctx, `增长计划第 ${it.week} 周`, `Growth plan, week ${it.week}`),
      action: it.action ?? { kind: 'go', view: 'plan' }, action_label: L(ctx, '去做', 'Do it'),
      page: { view: 'plan' },
    })
  return out
}

function states(ctx: any): State[] {
  return all(ctx, 'checklist') as State[]
}

export function list(_input: {}, ctx: any) {
  const st = states(ctx)
  const skipped = new Set(st.filter((s) => s.status === 'skipped').map((s) => s.key))
  const setup = setupSteps(ctx, { all, has }).map((s) => ({ ...s, skipped: !s.done && skipped.has(s.key) }))
  // 当前这一步：第一个没做完、没跳过的；都跳过了就是第一个没做完的
  // 正在后台做的（running）不挡着下一步
  const current = (setup.find((s) => !s.done && !s.skipped && !s.running) ?? setup.find((s) => !s.done))?.key ?? null
  const dismissed = new Map(st.filter((s) => s.status === 'dismissed').map((s) => [s.key, s.value ?? 0]))
  const daily = [...planItems(ctx), ...dailyItems(ctx, { all, has })].filter((d) => !(dismissed.has(d.key) && (d.count ?? 1) <= (dismissed.get(d.key) ?? 0)))
  const steps = setup.filter((s) => s.wizard)
  const wizard = { steps, current: steps.find((s) => !s.done && !s.skipped)?.key ?? null, closed: st.some((s) => s.key === 'wizard' && s.status === 'dismissed') }
  // 产品运营以前收起时记的是 hidden
  const setup_hidden = st.some((s) => s.key === 'setup-panel' && (s.status === 'dismissed' || (s.status as string) === 'hidden'))
  return { wizard, setup, current, done: setup.filter((s) => s.done).length, total: setup.length, daily, setup_hidden }
}

function upsert(ctx: any, key: string, patch: Partial<State> | null) {
  const old = states(ctx).find((s) => s.key === key)
  if (!patch) {
    if (old) ctx.db.delete('checklist', old.id)
    return
  }
  if (old) ctx.db.update('checklist', old.id, { ...patch, updated_at: new Date().toISOString() })
  else ctx.db.insert('checklist', { key, ...patch, updated_at: new Date().toISOString() })
}

export function skip(input: { key: string }, ctx: any) {
  if (!input?.key) throw new Error(L(ctx, '缺 key', 'Missing key'))
  upsert(ctx, input.key, { status: 'skipped' })
  return list({}, ctx)
}

export function unskip(input: { key: string }, ctx: any) {
  upsert(ctx, input?.key, null)
  return list({}, ctx)
}

export function dismiss(input: { key: string; value?: number }, ctx: any) {
  if (!input?.key) throw new Error(L(ctx, '缺 key', 'Missing key'))
  upsert(ctx, input.key, { status: 'dismissed', value: input.value ?? 1 })
  return list({}, ctx)
}

/** 关闭只记在清单里，不保存向导进度。 */
export function closeWizard(_input: {}, ctx: any) {
  upsert(ctx, 'wizard', { status: 'dismissed' })
  return list({}, ctx)
}

export function openWizard(_input: {}, ctx: any) {
  upsert(ctx, 'wizard', null)
  return list({}, ctx)
}

export function setupPanel(input: { open: boolean }, ctx: any) {
  upsert(ctx, 'setup-panel', input?.open ? null : { status: 'dismissed' })
  return list({}, ctx)
}
