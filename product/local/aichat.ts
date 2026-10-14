// 复制自 annulo/references@d107894 aichat/（外贸模板的 AI 搜索检测用它问网页版的 AI，见 docs/ai-search.md）
// 在 AI 网页（ChatGPT、DeepSeek、豆包、Kimi、元宝…）上提问，拿回答、引用的网页、搜索词。
// 来自 https://github.com/annulo/references 的 aichat/（怎么用见 README.md，坏了怎么修见 MAINTAIN.md）。
//
//   annulo run aichat.ask --input '{"site":"deepseek","question":"有哪些好用的外贸建站工具？"}'
//   annulo run aichat.test                       每个网站问一个固定问题，看拿不拿得到回答、引用、搜索词
//
// 默认用用户自己的 Chrome（profile: '@user'，要装 Annulo 插件），用的是用户在那里登好的账号。

import { type Answer, fail } from './_aichat_common'
import { CHATGPT } from './_aichat_chatgpt'
import { DEEPSEEK } from './_aichat_deepseek'
import { DOUBAO } from './_aichat_doubao'
import { KIMI } from './_aichat_kimi'
import { YUANBAO } from './_aichat_yuanbao'

const SITES: any[] = [CHATGPT, DEEPSEEK, DOUBAO, KIMI, YUANBAO]

/** 支持哪些网站，每个最近一次验证可用的日期 */
export async function sites() {
  return SITES.map((s) => ({ id: s.id, name: s.name, url: s.url, verified: s.verified }))
}

/**
 * 问一个问题。出错时 throw 的 Error 带 code（login / limited / timeout / changed / empty，见 _aichat_common.ts），
 * 本机函数里调用时 catch 了按 code 处理；annulo run 时错误信息开头是 [code]。
 */
export async function ask(input: { site: string; question: string; profile?: string; timeout?: number; show?: boolean; raw?: boolean }, ctx: any): Promise<Answer> {
  const site = SITES.find((s) => s.id === input?.site)
  if (!site) fail('changed', `不支持的网站：${input?.site}（支持：${SITES.map((s) => s.id).join('、')}）`)
  if (!input.question?.trim()) throw new Error('question 不能为空')
  const b = await ctx.browser.open({ profile: input.profile || '@user', url: site.url, show: !!input.show })
  try {
    // raw: true 时结果里带上接口的原始流（排查改版用，见 MAINTAIN.md）
    return await site.ask(b, input.question.trim(), { timeout: input.timeout, raw: input.raw })
  } finally {
    await b.close()
  }
}

/**
 * 自测：每个网站（或者 input.site 指定的那个）问一个固定问题，检查拿到了回答、搜索词、引用。
 * 改了某个网站的代码、或者怀疑网站改版了，跑这个。
 */
export async function test(input: { site?: string; profile?: string } = {}, ctx: any) {
  const list = input?.site ? SITES.filter((s) => s.id === input.site) : SITES
  const out: any[] = []
  for (const s of list) {
    const t0 = Date.now()
    try {
      const r = await ask({ site: s.id, question: '2026 年有哪些好用的外贸独立站建站工具？推荐三个，说明理由并给出来源。', profile: input?.profile }, ctx)
      const problems: string[] = []
      if (r.answer.length < 50) problems.push('回答太短')
      if (!r.search) problems.push('没有联网搜索（网站上的联网搜索开关可能关了）')
      if (r.search && s.queries !== false && !r.searches.length) problems.push('联网搜索了但没拿到搜索词')
      if (r.search && !r.sources.length) problems.push('联网搜索了但没拿到网页')
      if (r.sources.length && !r.sources.some((x) => x.cited)) problems.push('拿到了网页，但回答里没对上引用编号')
      out.push({
        site: s.id,
        ok: problems.length === 0,
        problems,
        ms: Date.now() - t0,
        answer: r.answer.slice(0, 120),
        searches: r.searches,
        sources: r.sources.length,
        cited: r.sources.filter((x) => x.cited).length,
      })
    } catch (e: any) {
      out.push({ site: s.id, ok: false, code: e.code || '', problems: [e.message], ms: Date.now() - t0 })
    }
  }
  return out
}
