// 做视频要的上下文（本机函数，Annulo 在用户电脑上执行，不经过模型）。视频由助手按任务 tasks/make-video.md 做，用什么工具、工程放哪由助手定；
// 做好的视频存进资料库（assets.add，带 article_id），文章页列出这篇的产物。
//
//   video.context({ doc_id })   照哪篇文档做：文档内容、要发的平台（标题、简介、话题上限，只发视频的平台在前）、我的定位

import { L } from './_i18n'
import { profile, projectBrief } from './_ai'
import { htmlText, platformsFor, typeOf } from './_types'
import { FIELDS } from '../plugins/social/local/_fields'

/** 用户有账号的、能发视频的平台（没有账号就是所有能发视频的）；只发视频的平台（抖音、YouTube、B 站）排前面：任务按排在前面的定横竖屏 */
function platformsOf(ctx: any) {
  let mine: string[] = []
  try { mine = [...new Set<string>(ctx.db.query('social_accounts', { limit: 200 }).list.map((c: any) => c.type))] } catch {}
  const all = platformsFor('video')
  const list = mine.filter((p) => all.includes(p)).length ? all.filter((p) => mine.includes(p)) : all
  return list.sort((x, y) => Number(FIELDS[y].video === 'only') - Number(FIELDS[x].video === 'only')).map((p) => {
    const f = FIELDS[p]
    return { platform: p, video: f.video, title_max: f.title === 'publish' ? f.titleMax : 0, body_max: f.bodyMax, tags_max: f.tags, ...(f.category ? { category: true } : {}) }
  })
}

export function context(input: { doc_id: string }, ctx: any) {
  const a = input?.doc_id ? ctx.db.get('articles', input.doc_id) : null
  if (!a) throw new Error(L(ctx, `没有这篇文章：${input?.doc_id}`, `No such article: ${input?.doc_id}`))
  const body = String(a.body ?? '')
  return {
    doc: { id: a.id, title: a.title ?? '', type: typeOf(a), summary: a.summary ?? '', text: (typeOf(a) === 'article' ? htmlText(body) : body).slice(0, 60000) },
    platforms: platformsOf(ctx),
    project: projectBrief(profile(ctx)),
  }
}
