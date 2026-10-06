// 自媒体起步：填定位 → 连上一个社媒账号 → 写第一篇内容 → 发出第一条（这是外贸模板「行业文件」的自媒体版，清单引擎在 today.ts）。
// 顺序就是推荐的做事顺序；done 从数据里判断，用户不用手动打勾。前两步在起步向导里做（wizard: true）。

import { L } from './_i18n'
import type { Item } from './today'

type Helpers = { all: (ctx: any, table: string) => any[]; has: (ctx: any, table: string) => boolean }

export function setupSteps(ctx: any, { all }: Helpers): Item[] {
  const profile = all(ctx, 'profile')[0] ?? {}
  const accounts = all(ctx, 'social_accounts')
  const posts = all(ctx, 'social_posts')
  return [
    {
      key: 'profile', wizard: true, screen: 'profile',
      title: L(ctx, '填写你的定位', 'Describe your account'),
      why: L(ctx, '写什么、写给谁、什么风格：之后出选题、写文章、改写成各平台的帖子，AI 都照这里来。', 'What you write, who for, and how you sound: AI follows this for ideas, drafts and posts.'),
      minutes: 2, done: !!(profile.business?.trim() && profile.customer_types?.trim()),
      action: { kind: 'go', view: 'company' }, action_label: L(ctx, '填写定位', 'Fill in'),
    },
    {
      key: 'account', wizard: true,
      title: L(ctx, '连上一个社媒账号', 'Connect a social account'),
      why: L(ctx, '用这台电脑的浏览器登录（X、小红书、LinkedIn……），之后发帖、采集数据都用它。登录状态只留在这台电脑上。', "Log in with this computer's browser (X, Xiaohongshu, LinkedIn…); posting and data collection use it. The login stays on this computer."),
      minutes: 2, done: accounts.length > 0,
      action: { kind: 'go', view: 'channels' }, action_label: L(ctx, '添加账号', 'Add account'),
    },
    {
      key: 'article',
      title: L(ctx, '写第一篇内容', 'Write your first piece'),
      why: L(ctx, '让 AI 按定位出几个选题，挑一个写成文章；草稿存下就算完成。', 'Let AI suggest topics from your profile and turn one into a draft; saving the draft completes this step.'),
      minutes: 5, done: all(ctx, 'articles').length > 0,
      action: { kind: 'go', view: 'content', params: { tab: 'topics' } }, action_label: L(ctx, '去写', 'Start writing'),
    },
    {
      key: 'first-post',
      title: L(ctx, '发出第一条帖子', 'Publish your first post'),
      why: L(ctx, '在内容详情里给账号生成一版，审核后发布或排期。', 'In the content detail, generate a version for an account, review it, then publish or schedule.'),
      minutes: 3, done: posts.some((p: any) => p.status === 'published' || p.status === 'scheduled'),
      action: { kind: 'go', view: 'content', params: { tab: 'articles' } }, action_label: L(ctx, '去发布', 'Publish'),
    },
  ]
}
