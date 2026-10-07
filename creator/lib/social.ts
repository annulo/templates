import { useEffect, useState } from 'react'
import { runLocal, runTask, type Channel, type ChannelType, type SocialPost } from './shuttle'
import { tr } from './i18n'
import { CHANNELS } from './edition'

/** 字数：小红书一个字符算 1；X 中日韩文字和 emoji 算 2、链接算 23（和 local/_x_spec.ts 一致） */
const plainLen = (s: string) => [...(s ?? '')].length
function xLen(s: string) {
  let n = 0
  for (const ch of String(s ?? '').replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23))) {
    const cp = ch.codePointAt(0) ?? 0
    n += cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2
  }
  return n
}

export type MetricKey = 'views' | 'likes' | 'comments' | 'collects' | 'shares'

export type SocialPlatform = {
  label: string
  /** 一篇内容叫什么：笔记 / 推文 */
  noun: string
  /** 标题会不会发出去（X 没有标题，title 只在后台列表里显示） */
  title: boolean
  titleMax: number
  bodyMax: number
  tagsMax: number
  /** 最多几张配图（和 local/_xhs_spec.ts、_x_spec.ts 一致） */
  imagesMax: number
  /** 发出去的文字的字数（X 把话题算进去） */
  len: (body: string, tags: string[]) => number
  bodyHint: string
  /** 没配图时发布前生成文字封面 */
  cover: boolean
  metrics: { key: MetricKey; label: string }[]
  loginHint: string
  rateHint: string
  /** 从文章改写成这个平台的内容：交给助手的任务（tasks/<id>.md，写作要求用户能改） */
  task: string
  /** 账号的主页地址（卡片上「打开主页」）；缺账号信息时返回空 */
  profileUrl: (ch: Channel) => string
  /** 平台文件有自检（probe）：账号卡片上显示上次自检的结果和「自检」按钮 */
  probe?: boolean
  /** 视频：only 只发视频（YouTube、B 站、抖音），optional 图文和视频二选一（social_posts.video 有值就按视频发）；不写就是不能发视频 */
  video?: 'only' | 'optional'
}

/** 这条按视频发（平台只发视频，或者这条带了视频） */
export const isVideoPost = (pf: SocialPlatform | undefined, p: { video?: string }) => pf?.video === 'only' || (pf?.video === 'optional' && !!p.video)

// 显示用的文字都是 getter：按当前语言从 messages 的 meta.platform 取
const metric = (p: string, key: SocialPlatform['metrics'][number]['key']) => ({ key, get label() { return tr(`meta.platform.${p}.m_${key}`) } })

const ALL_SOCIAL: Partial<Record<ChannelType, SocialPlatform>> = {
  xiaohongshu: {
    get label() { return tr('meta.platform.xiaohongshu.label') },
    get noun() { return tr('meta.platform.xiaohongshu.noun') },
    task: 'social/write-xiaohongshu',
    video: 'optional',
    profileUrl: (ch) => (ch.platform_uid ? `https://www.xiaohongshu.com/user/profile/${ch.platform_uid}` : ''),
    title: true,
    titleMax: 20,
    bodyMax: 1000,
    tagsMax: 10,
    imagesMax: 18,
    len: (body) => plainLen(body),
    get bodyHint() { return tr('meta.platform.xiaohongshu.body_hint') },
    cover: true,
    metrics: [
      metric('xiaohongshu', 'views'),
      metric('xiaohongshu', 'likes'),
      metric('xiaohongshu', 'collects'),
      metric('xiaohongshu', 'comments'),
      metric('xiaohongshu', 'shares'),
    ],
    get loginHint() { return tr('meta.platform.xiaohongshu.login_hint') },
    get rateHint() { return tr('meta.platform.xiaohongshu.rate_hint') },
  },
  linkedin: {
    label: 'LinkedIn',
    get noun() { return tr('meta.platform.linkedin.noun') },
    task: 'social/write-linkedin',
    video: 'optional',
    probe: true,
    profileUrl: (ch) => (ch.handle ? `https://www.linkedin.com/in/${encodeURIComponent(ch.handle)}/` : ''),
    title: false,
    titleMax: 30,
    bodyMax: 3000,
    tagsMax: 5,
    imagesMax: 9,
    len: (body, tags) => [...[body.trim(), tags.map((t) => '#' + t).join(' ')].filter(Boolean).join('\n\n')].length,
    get bodyHint() { return tr('meta.platform.linkedin.body_hint') },
    cover: false,
    metrics: [
      metric('linkedin', 'views'),
      metric('linkedin', 'likes'),
      metric('linkedin', 'comments'),
      metric('linkedin', 'shares'),
    ],
    get loginHint() { return tr('meta.platform.linkedin.login_hint') },
    get rateHint() { return tr('meta.platform.linkedin.rate_hint') },
  },
  facebook: {
    label: 'Facebook',
    get noun() { return tr('meta.platform.facebook.noun') },
    task: 'social/write-facebook',
    video: 'optional',
    probe: true,
    // 个人主页 facebook.com/<handle 或 profile.php?id=uid>；公司主页 facebook.com/<page id>
    profileUrl: (ch) => (ch.handle ? `https://www.facebook.com/${ch.handle}` : ch.platform_uid ? `https://www.facebook.com/profile.php?id=${ch.platform_uid}` : ''),
    title: false,
    titleMax: 30,
    bodyMax: 5000,
    tagsMax: 5,
    imagesMax: 10,
    len: (body, tags) => [...[body.trim(), tags.map((t) => '#' + t).join(' ')].filter(Boolean).join('\n\n')].length,
    get bodyHint() { return tr('meta.platform.facebook.body_hint') },
    cover: false,
    metrics: [metric('facebook', 'views'), metric('facebook', 'likes'), metric('facebook', 'comments'), metric('facebook', 'shares')],
    get loginHint() { return tr('meta.platform.facebook.login_hint') },
    get rateHint() { return tr('meta.platform.facebook.rate_hint') },
  },
  instagram: {
    label: 'Instagram',
    get noun() { return tr('meta.platform.instagram.noun') },
    task: 'social/write-instagram',
    video: 'optional',
    probe: true,
    profileUrl: (ch) => (ch.handle ? `https://www.instagram.com/${ch.handle}/` : ''),
    title: false,
    titleMax: 30,
    bodyMax: 2200,
    tagsMax: 30,
    imagesMax: 10,
    len: (body, tags) => [...[body.trim(), tags.map((t) => '#' + t).join(' ')].filter(Boolean).join('\n\n')].length,
    get bodyHint() { return tr('meta.platform.instagram.body_hint') },
    // Instagram 必须有图：文章没图时发布前用 cover_text 生成文字封面（和小红书一样）
    cover: true,
    metrics: [metric('instagram', 'views'), metric('instagram', 'likes'), metric('instagram', 'comments'), metric('instagram', 'collects')],
    get loginHint() { return tr('meta.platform.instagram.login_hint') },
    get rateHint() { return tr('meta.platform.instagram.rate_hint') },
  },
  youtube: {
    label: 'YouTube',
    get noun() { return tr('meta.platform.youtube.noun') },
    task: 'social/write-youtube',
    video: 'only',
    probe: true,
    profileUrl: (ch) => (ch.handle ? `https://www.youtube.com/${ch.handle.startsWith('@') ? ch.handle : '@' + ch.handle}` : ch.platform_uid ? `https://www.youtube.com/channel/${ch.platform_uid}` : ''),
    // YouTube 的标题会发出去（视频标题），正文是视频描述；视频从素材库选
    title: true,
    titleMax: 100,
    bodyMax: 5000,
    tagsMax: 15,
    imagesMax: 0,
    len: (body) => [...body].length,
    get bodyHint() { return tr('meta.platform.youtube.body_hint') },
    cover: false,
    metrics: [metric('youtube', 'views'), metric('youtube', 'likes'), metric('youtube', 'comments')],
    get loginHint() { return tr('meta.platform.youtube.login_hint') },
    get rateHint() { return tr('meta.platform.youtube.rate_hint') },
  },
  bilibili: {
    label: 'B 站',
    get noun() { return tr('meta.platform.bilibili.noun') },
    task: 'social/write-bilibili',
    video: 'only',
    probe: true,
    profileUrl: (ch) => (ch.platform_uid ? `https://space.bilibili.com/${ch.platform_uid}` : ''),
    // 标题会发出去（视频标题），正文是简介；视频从素材库选或者上传本机视频（和 local/_bilibili_spec.ts 一致）
    title: true,
    titleMax: 80,
    bodyMax: 2000,
    tagsMax: 10,
    imagesMax: 0,
    len: (body) => [...body].length,
    get bodyHint() { return tr('meta.platform.bilibili.body_hint') },
    cover: false,
    metrics: [metric('bilibili', 'views'), metric('bilibili', 'likes'), metric('bilibili', 'comments'), metric('bilibili', 'collects'), metric('bilibili', 'shares')],
    get loginHint() { return tr('meta.platform.bilibili.login_hint') },
    get rateHint() { return tr('meta.platform.bilibili.rate_hint') },
  },
  zhihu: {
    get label() { return tr('meta.platform.zhihu.label') },
    get noun() { return tr('meta.platform.zhihu.noun') },
    task: 'social/write-zhihu',
    probe: true,
    profileUrl: (ch) => (ch.handle ? `https://www.zhihu.com/people/${ch.handle}` : ''),
    // 知乎专栏文章：标题会发出去，正文是 Markdown 常用写法，单独一行的 ![](地址) 是插在那里的图（和 local/_zhihu_spec.ts 一致）
    title: true,
    titleMax: 100,
    bodyMax: 20000,
    tagsMax: 3,
    imagesMax: 20,
    len: (body) => plainLen(body),
    get bodyHint() { return tr('meta.platform.zhihu.body_hint') },
    cover: false,
    metrics: [metric('zhihu', 'views'), metric('zhihu', 'likes'), metric('zhihu', 'comments'), metric('zhihu', 'collects')],
    get loginHint() { return tr('meta.platform.zhihu.login_hint') },
    get rateHint() { return tr('meta.platform.zhihu.rate_hint') },
  },
  douyin: {
    get label() { return tr('meta.platform.douyin.label') },
    get noun() { return tr('meta.platform.douyin.noun') },
    task: 'social/write-douyin',
    video: 'only',
    probe: true,
    profileUrl: (ch) => (ch.platform_uid ? `https://www.douyin.com/user/${ch.platform_uid}` : ''),
    // 标题会发出去（作品标题），正文是作品简介，话题接在简介后面；视频从素材库选或者上传本机视频（和 local/_douyin_spec.ts 一致）
    title: true,
    titleMax: 30,
    bodyMax: 1000,
    tagsMax: 5,
    imagesMax: 0,
    len: (body, tags) => [...[body.trim(), tags.map((t) => '#' + t).join(' ')].filter(Boolean).join('\n')].length,
    get bodyHint() { return tr('meta.platform.douyin.body_hint') },
    cover: false,
    metrics: [metric('douyin', 'views'), metric('douyin', 'likes'), metric('douyin', 'comments'), metric('douyin', 'collects'), metric('douyin', 'shares')],
    get loginHint() { return tr('meta.platform.douyin.login_hint') },
    get rateHint() { return tr('meta.platform.douyin.rate_hint') },
  },
  x: {
    label: 'X',
    task: 'social/write-x',
    video: 'optional',
    probe: true,
    profileUrl: (ch) => (ch.handle ? `https://x.com/${ch.handle}` : ''),
    get noun() { return tr('meta.platform.x.noun') },
    title: false,
    titleMax: 20,
    bodyMax: 280,
    tagsMax: 3,
    imagesMax: 4,
    len: (body, tags) => xLen([body.trim(), tags.map((t) => '#' + t).join(' ')].filter(Boolean).join('\n\n')),
    get bodyHint() { return tr('meta.platform.x.body_hint') },
    cover: false,
    metrics: [
      metric('x', 'views'),
      metric('x', 'likes'),
      metric('x', 'comments'),
      metric('x', 'shares'),
      metric('x', 'collects'),
    ],
    get loginHint() { return tr('meta.platform.x.login_hint') },
    get rateHint() { return tr('meta.platform.x.rate_hint') },
  },
}

/** 这个行业模板启用的社媒平台（lib/edition.ts 的 CHANNELS） */
export const SOCIAL: Partial<Record<ChannelType, SocialPlatform>> = Object.fromEntries(Object.entries(ALL_SOCIAL).filter(([t]) => CHANNELS.includes(t as ChannelType)))

export const isSocial = (c?: Pick<Channel, 'type'>) => !!c && !!SOCIAL[c.type]
export const platformOf = (c?: Pick<Channel, 'type'>) => (c ? SOCIAL[c.type] : undefined)
export const socialTypes = Object.keys(SOCIAL) as ChannelType[]

/** 后台列表里显示的标题：X 的 title 是运营自己看的，没有就取正文开头 */
export const postTitle = (p: SocialPost) => p.title || [...(p.body ?? '')].slice(0, 30).join('')

/** 各平台写作任务的 id */
export const SOCIAL_TASKS = Object.values(SOCIAL).map((p) => p!.task)

/**
 * 把一篇文章改写成勾选账号上的内容：按平台分组，每个平台开一段对话交给助手（社媒插件的任务 social/write-<平台>），过程看得见。
 * 文章的内容由 local/content.ts 的 socialSource 给（插件不读模板的表，任务参数 source 告诉助手跑哪个函数取）。
 * 返回开的对话 id；某个平台开不了（比如正在写同样的）就抛出它的报错。
 */
export async function writeSocial(articleId: string, channelIds: string[], channels: Channel[]) {
  const groups = new Map<string, string[]>()
  for (const id of channelIds) {
    const task = SOCIAL[channels.find((c) => c.id === id)?.type as ChannelType]?.task
    if (task) groups.set(task, [...(groups.get(task) ?? []), id])
  }
  const chats: string[] = []
  const errors: string[] = []
  for (const [task, ids] of groups) {
    try {
      chats.push((await runTask(task, { source: { fn: 'content.socialSource', id: articleId }, channel_ids: ids })).chat_id)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  if (errors.length) throw new Error(errors.join('；'))
  return chats
}

/** 登录态不在这里的账号：{ [channel_id]: 那台电脑的名字 } */
export type Elsewhere = Record<string, string>
let elsewhereOnce: { key: string; p: Promise<Elsewhere> } | null = null
/** 哪些账号的登录态不在这里（social.elsewhereAll，按本机浏览器 profile 认）：账号的登录记录变了就重新读，几个地方同时用只读一次 */
export function useElsewhere(channels: Channel[]): Elsewhere {
  const key = channels.map((c) => `${c.id}:${c.browser_profile ?? ''}:${c.browser_profile_id ?? ''}:${c.browser_machine ?? ''}`).join(',')
  const [m, setM] = useState<Elsewhere>({})
  useEffect(() => {
    if (elsewhereOnce?.key !== key) elsewhereOnce = { key, p: runLocal<Elsewhere>('social/social.elsewhereAll', {}).catch(() => ({})) }
    let live = true
    elsewhereOnce.p.then((v) => live && setM(v ?? {}))
    return () => { live = false }
  }, [key])
  return m
}

/** 账号的登录态在别的电脑上：返回那台电脑的名字，否则 '' */
export function loggedInElsewhere(ch: Channel, m: Elsewhere): string {
  return m[ch.id] ?? ''
}
