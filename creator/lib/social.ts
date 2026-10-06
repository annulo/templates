// 社媒插件（github.com/annulo/plugins 的 social，装在 plugins/social/）在页面上用到的：平台信息、帖子、账号。
// 插件不带页面，这里和 components/views/ 是这个模板自己接它的方式：要换样子直接改。说明见 plugins/social/PLUGIN.md。
import { db, tasks, type Row } from './annulo'

export type Platform = 'x' | 'linkedin' | 'facebook' | 'instagram' | 'youtube' | 'xiaohongshu' | 'douyin' | 'bilibili'

type Meta = {
  label: { zh: string; en: string }
  /** 徽标上的字和颜色 */
  mark: string
  color: string
  /** 写作任务：插件的 social/write-<平台> */
  task: string
  /** 只发视频 */
  videoOnly?: boolean
}

export const PLATFORMS: Record<Platform, Meta> = {
  x: { label: { zh: 'X', en: 'X' }, mark: 'X', color: '#111827', task: 'social/write-x' },
  linkedin: { label: { zh: 'LinkedIn', en: 'LinkedIn' }, mark: 'in', color: '#0a66c2', task: 'social/write-linkedin' },
  facebook: { label: { zh: 'Facebook', en: 'Facebook' }, mark: 'f', color: '#1877f2', task: 'social/write-facebook' },
  instagram: { label: { zh: 'Instagram', en: 'Instagram' }, mark: 'IG', color: '#d62976', task: 'social/write-instagram' },
  youtube: { label: { zh: 'YouTube', en: 'YouTube' }, mark: '▶', color: '#ff0000', task: 'social/write-youtube', videoOnly: true },
  xiaohongshu: { label: { zh: '小红书', en: 'Xiaohongshu' }, mark: '红', color: '#ff2442', task: 'social/write-xiaohongshu' },
  douyin: { label: { zh: '抖音', en: 'Douyin' }, mark: '抖', color: '#111827', task: 'social/write-douyin', videoOnly: true },
  bilibili: { label: { zh: 'B 站', en: 'Bilibili' }, mark: 'B', color: '#00a1d6', task: 'social/write-bilibili', videoOnly: true },
}
export const PLATFORM_IDS = Object.keys(PLATFORMS) as Platform[]
export const WRITE_TASKS = PLATFORM_IDS.map((p) => PLATFORMS[p].task)

export const platformLabel = (p: string, locale: string) => PLATFORMS[p as Platform]?.label[locale === 'en' ? 'en' : 'zh'] ?? p

/** 社媒账号（插件的 social_accounts 表） */
export type Account = Row & {
  type: Platform
  name: string
  handle?: string
  avatar?: string
  profile?: string
  login_status?: 'ok' | 'expired' | ''
  followers?: number
  collected_at?: string
}

/** 帖子（插件的 social_posts 表）：channel_id 是账号，article_id 是出自哪篇稿件 */
export type Post = Row & {
  channel_id: string
  article_id?: string
  title?: string
  body?: string
  tags?: string
  images?: string
  video?: string
  status: 'draft' | 'pending_review' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'rejected' | 'removed'
  scheduled_at?: string
  published_at?: string
  post_url?: string
  error?: string
  views?: number
  likes?: number
  comments?: number
  shares?: number
}

/** 账号列表；社媒插件没装（读不到它的表）时 plugin 是 false */
export async function loadAccounts(): Promise<{ accounts: Account[]; plugin: boolean }> {
  try {
    return { accounts: await db.list<Account>('social_accounts'), plugin: true }
  } catch {
    return { accounts: [], plugin: false }
  }
}

/** 一篇稿件的各平台版本 */
export const postsOf = (draftId: string) => db.list<Post>('social_posts').then((l) => l.filter((p) => p.article_id === draftId))

/**
 * 把一篇稿件交给助手改写成勾选账号上的帖子：按平台分组，每个平台开一段对话（插件的任务 social/write-<平台>）。
 * 稿件内容由本机函数 drafts.source 给（插件不读模板的表）。返回开的对话 id。
 */
export async function writePosts(draftId: string, accounts: Account[]) {
  const groups = new Map<string, string[]>()
  for (const a of accounts) {
    const task = PLATFORMS[a.type]?.task
    if (task) groups.set(task, [...(groups.get(task) ?? []), a.id])
  }
  const chats: string[] = []
  const errors: string[] = []
  for (const [task, ids] of groups) {
    try {
      chats.push((await tasks.run(task, { source: { fn: 'drafts.source', id: draftId }, channel_ids: ids })).chat_id)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  if (errors.length) throw new Error(errors.join('；'))
  return chats
}
