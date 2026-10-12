import { useEffect, useState } from 'react'
import { dbList, dbPatch, runLocal } from './shuttle'
import { tr } from './i18n'
import { showRun, stopRun } from './runs'

// 发布在后台排队跑：发布弹窗把要发的账号放进来就关掉，这里一条条发（同一时间只发一条：都要用本机浏览器），
// 每条正在做哪一步（社媒插件发布时报的进度：打开浏览器、上传图片、点发布……）、成没成都记在这里。
// 队列是页面里的一份（模块级），切到别的页面照样跑、照样显示；刷新页面会丢掉还没开始的：那几条留在发布记录里是「待发布」，点「立即发布」再发。
// 发布记录（ArticlePublish 的 PublishRecords）和右下角的进度（PublishProgress）都读它。

export type PublishJob = {
  key: string
  article_id: string
  article_title: string
  channel_id: string
  channel_name: string
  /** social_posts 的 id（社媒）；网站没有 */
  post_id?: string
  /** Facebook API：只核对上次结果，或用户已确认原帖未发布。 */
  check_only?: true
  confirm_unpublished?: true
  /** 网站的发布脚本（<publisher>.publish）；社媒没有 */
  publisher?: string
  state: 'queued' | 'running' | 'ok' | 'error'
  /** 正在跑的这次本机函数的运行 id：停止、在前台看用 */
  run_id?: string
  /** 用户点了停止 */
  stopped?: boolean
  /** 用户点了打开看，但这次运行还没开始：开始了就显示 */
  want_show?: boolean
  /** 正在做哪一步（插件报的进度） */
  step?: string
  error?: string
}

let jobs: PublishJob[] = []
let running = false
const listeners = new Set<() => void>()
const emit = () => {
  jobs = [...jobs]
  listeners.forEach((f) => f())
}
const patch = (key: string, p: Partial<PublishJob>) => {
  jobs = jobs.map((j) => (j.key === key ? { ...j, ...p } : j))
  emit()
}

/** 放进队列（同一条已经在排队或在发就跳过），马上开始发 */
export function enqueue(items: Omit<PublishJob, 'key' | 'state'>[]) {
  for (const it of items) {
    const key = it.post_id || `${it.article_id}:${it.channel_id}`
    if (jobs.some((j) => j.key === key && (j.state === 'queued' || j.state === 'running'))) continue
    jobs = [...jobs.filter((j) => j.key !== key), { ...it, key, state: 'queued' }]
  }
  emit()
  void work()
}

async function work() {
  if (running) return
  running = true
  try {
    for (let next = jobs.find((j) => j.state === 'queued'); next; next = jobs.find((j) => j.state === 'queued')) {
      const j = next
      patch(j.key, { state: 'running', step: '' })
      try {
        const onEvent = (e: { type: string; data: any }) => { if (e.type === 'progress' && e.data?.message) patch(j.key, { step: String(e.data.message) }) }
        // 浏览器用屏幕外的真窗口：用户点「在前台看」时能调出来（无界面的没有窗口）
        const opts = { browser: 'offscreen' as const, onStart: (id: string) => {
          patch(j.key, { run_id: id })
          if (jobs.find((x) => x.key === j.key)?.want_show) void showRun(id).catch(() => {})
        } }
        if (j.publisher) await runLocal(`${j.publisher}.publish`, { article_id: j.article_id }, onEvent, opts)
        else await runLocal('social/social.publish', { post_id: j.post_id, ...(j.check_only ? { check_only: true } : {}), ...(j.confirm_unpublished ? { confirm_unpublished: true } : {}) }, onEvent, opts)
        patch(j.key, { state: 'ok', step: '', run_id: undefined })
      } catch (e) {
        const stopped = jobs.find((x) => x.key === j.key)?.stopped
        patch(j.key, { state: 'error', step: '', run_id: undefined, error: stopped ? tr('article.pub_stopped') : (e as Error).message })
      }
      // 发布记录、列表跟着刷新（social_posts / publications 变了）
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('db:changed', { detail: { table: j.publisher ? 'publications' : 'social_posts' } }))
    }
  } finally {
    running = false
  }
}

/**
 * 停止一条：还在排队的直接拿掉；正在发的停掉那次运行（这次打开的浏览器一起关掉，平台上已经点了发布的可能已经发出去，
 * 发布记录里会看到），在发的那条记成「已停止」
 */
export async function stop(key: string) {
  const j = jobs.find((x) => x.key === key)
  if (!j) return
  if (j.state === 'queued') { jobs = jobs.filter((x) => x.key !== key); emit(); return }
  if (j.state !== 'running') return
  patch(key, { stopped: true })
  if (j.run_id) await stopRun(j.run_id)
  // 插件发之前把这条记成「发布中」，中途停了不会改回来：还是「发布中」的改成失败，发布记录里能重发
  if (j.post_id) {
    const p = (await dbList('social_posts').catch(() => [])).find((x) => x.id === j.post_id)
    if (p?.status === 'publishing') await dbPatch('social_posts', p.id, { status: 'failed', error: tr('article.pub_stopped') }).catch(() => {})
  }
}

/** 把正在发的那条的浏览器窗口调到前台，看它在做什么（窗口是屏幕外的真窗口，见 work） */
export async function reveal(key: string) {
  const j = jobs.find((x) => x.key === key)
  if (!j) return
  // 还没开始跑：记下来，开始了就显示（浏览器还没打开时 Annulo 也会等它打开再显示）
  if (!j.run_id) { patch(key, { want_show: true }); return }
  await showRun(j.run_id)
}

/** 收起已经发完的（右下角「知道了」） */
export function clearFinished() {
  jobs = jobs.filter((j) => j.state === 'queued' || j.state === 'running')
  emit()
}

export function usePublishQueue(): PublishJob[] {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick((x) => x + 1)
    listeners.add(f)
    return () => { listeners.delete(f) }
  }, [])
  return jobs
}
