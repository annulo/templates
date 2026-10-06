// 总览的任务清单（本机函数）：按业务表里的数据算出「现在该做什么」，一步一步带用户把业务运营起来。
// 全是确定的规则，不调模型：秒开、每次结果一样。每一项带一个动作（去哪个页面 / 跑哪个本机函数 / 交给助手的哪个任务）。
//
//   today.list({})                  起步任务（一次性，按顺序）+ 今天要做的（每天按数据算）
//   today.skip({ key })             跳过一个起步任务（排到最后，不再挡着下一步）
//   today.unskip({ key })
//   today.dismiss({ key, value })   忽略一条今天要做的；value 是当时的数量，数量变多了会再出现
//
// 跳过、忽略记在 checklist 表（一项一行：key、status、value）。
// 起步任务有哪些、怎么说，是行业文件 local/_checklist.ts（各行业模板各一份）；这里是共用的清单引擎。

import { L } from './_i18n'
import { setupSteps } from './_checklist'

// 手机上打开后台（不在 Shuttle 里）时这几个也能用：annulo push 会把它们打包成站点 Func，只能用 ctx.db、ctx.mcp('creght', …)、ctx.locale
export const cloud = ['list', 'skip', 'unskip', 'dismiss', 'openWizard', 'closeWizard']

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
  /** 今天要做的：涉及几条（询盘数、待审数…） */
  count?: number
  action: Action
  action_label: string
  /** 「交给助手」：交给助手的任务（tasks/<task>.md，新开一段对话跑）；没有就不显示这个按钮 */
  ask?: { task: string; input?: unknown }
}

type State = { id: string; key: string; status: 'skipped' | 'dismissed'; value?: number }

const DAY = 86400_000

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

function states(ctx: any): State[] {
  return all(ctx, 'checklist') as State[]
}

/** 今天要做的：按数据算，没有就不出现 */
function dailyItems(ctx: any): Item[] {
  const now = Date.now()
  const out: Item[] = []
  const add = (it: Omit<Item, 'done'>) => it.count !== 0 && out.push({ ...it, done: false })

  // 待审核的是各渠道版本（文章不审核）：点了打开最新那一版所在的内容和版本
  const pendingPosts = all(ctx, 'social_posts').filter((p) => p.status === 'pending_review' && p.article_id).sort((x, y) => String(y.updated_at ?? '').localeCompare(String(x.updated_at ?? '')))
  const posts = pendingPosts.length
  add({
    key: 'd_posts',
    count: posts,
    title: L(ctx, `${posts} 条社媒内容等你审核`, `${posts} social posts to review`),
    why: L(ctx, '审核通过后可以马上发，也可以排期。', 'Approve to post now or schedule.'),
    action: { kind: 'go', view: 'content', params: pendingPosts[0] ? { article: pendingPosts[0].article_id, version: pendingPosts[0].id } : { tab: 'articles' } },
    action_label: L(ctx, '去审核', 'Review'),
  })

  // 每周总结：有过总结、最近一期超过 7 天
  const last = all(ctx, 'reports')
    .map((r) => Date.parse(r.period_end || '') || 0)
    .sort((a, b) => b - a)[0]
  if (last && now - last > 7 * DAY)
    add({
      key: 'd_weekly',
      title: L(ctx, '这周的总结还没写', "This week's summary isn't written yet"),
      why: L(ctx, '每周看一次整体变化，决定下周重点。', 'Review the week and decide next priorities.'),
      action: { kind: 'task', task: 'weekly-report' },
      action_label: L(ctx, '现在写', 'Write now'),
    })
  return out
}

export function list(_input: {}, ctx: any) {
  const st = states(ctx)
  const skipped = new Set(st.filter((s) => s.status === 'skipped').map((s) => s.key))
  const setup = setupSteps(ctx, { all, has }).map((s) => ({ ...s, skipped: !s.done && skipped.has(s.key) }))
  // 当前这一步：第一个没做完、没跳过的；都跳过了就是第一个没做完的
  const current = (setup.find((s) => !s.done && !s.skipped) ?? setup.find((s) => !s.done))?.key ?? null
  const dismissed = new Map(st.filter((s) => s.status === 'dismissed').map((s) => [s.key, s.value ?? 0]))
  const daily = dailyItems(ctx).filter((d) => !(dismissed.has(d.key) && (d.count ?? 1) <= (dismissed.get(d.key) ?? 0)))
  const steps = setup.filter((s) => s.wizard)
  const wizard = { steps, current: steps.find((s) => !s.done && !s.skipped)?.key ?? null, closed: st.some((s) => s.key === 'wizard' && s.status === 'dismissed') }
  return { wizard, setup, current, done: setup.filter((s) => s.done).length, total: setup.length, daily }
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
