// 复制自 annulo/references@cad4424 serp/
// 在 Google 上搜一个词，拿前 10 条自然结果（网址、域名、标题、摘要、网站类型）。
// 来自 https://github.com/annulo/references 的 serp/（怎么用见 README.md，坏了怎么修见 MAINTAIN.md）。
//
//   annulo run serp.search --input '{"q":"led grow light manufacturer","gl":"us","hl":"en"}'
//   annulo run serp.test                       搜一个固定的词，看取不取得到结果
//
// 默认用用户自己的 Chrome（profile: '@user'，要装 Annulo 插件）：用户的网络能上 Google，用户自己的浏览器也不容易被当成机器人。
// 一次查很多词用 searchMany：同一个窗口，每查一个歇几秒，碰到验证码就停下，返回已经查到的。

import { kindOf } from './_serp_common'
import { GOOGLE, searchGoogle } from './_serp_google'

export type Serp = { query: string; url: string; results: { position: number; url: string; domain: string; kind: string; title: string; snippet?: string }[]; ads: number }

const withKind = (r: Awaited<ReturnType<typeof searchGoogle>>): Serp => ({ ...r, results: r.results.map((x) => ({ ...x, kind: kindOf(x.domain) })) })

/** 查一个词。出错 throw 的 Error 带 code（captcha / consent / changed，见 _serp_common.ts） */
export async function search(input: { q: string; hl?: string; gl?: string; profile?: string; show?: boolean }, ctx: any): Promise<Serp> {
  if (!input?.q?.trim()) throw new Error('q 不能为空')
  const b = await ctx.browser.open({ profile: input.profile || '@user', url: 'https://www.google.com/', show: !!input.show })
  try {
    return withKind(await searchGoogle(b, input.q.trim(), { ...input, sleep: ctx.sleep }))
  } finally {
    await b.close()
  }
}

/**
 * 一个窗口里依次查几个词，每个之间歇 gap_ms（默认 6~10 秒随机）。
 * 碰到 captcha / consent 就停，已经查到的照样返回，stopped 是停下的原因；单个词的 changed 记在 errors 里接着查。
 * onEach 每查完一个调一次（存结果、报进度用）。
 */
export async function searchMany(
  input: { queries: string[]; hl?: string; gl?: string; profile?: string; show?: boolean; gap_ms?: number },
  ctx: any,
  onEach?: (q: string, r: Serp | null, err?: any) => void | Promise<void>,
) {
  const list = (input?.queries ?? []).map((q) => String(q).trim()).filter(Boolean)
  const out: Serp[] = []
  const errors: { query: string; message: string }[] = []
  let stopped = ''
  if (!list.length) return { results: out, errors, stopped }
  const b = await ctx.browser.open({ profile: input.profile || '@user', url: 'https://www.google.com/', show: !!input.show })
  try {
    for (let i = 0; i < list.length; i++) {
      if (i) await ctx.sleep(input.gap_ms ?? 6000 + Math.floor(Math.random() * 4000))
      try {
        const r = withKind(await searchGoogle(b, list[i], { ...input, sleep: ctx.sleep }))
        out.push(r)
        await onEach?.(list[i], r)
      } catch (e: any) {
        await onEach?.(list[i], null, e)
        if (e?.code === 'captcha' || e?.code === 'consent') {
          stopped = e.message
          break
        }
        errors.push({ query: list[i], message: e?.message ?? String(e) })
      }
    }
  } finally {
    await b.close()
  }
  return { results: out, errors, stopped }
}

/** 支持哪些搜索引擎，最近一次验证可用的日期 */
export async function engines() {
  return [{ id: GOOGLE.id, verified: GOOGLE.verified }]
}

/** 自测：搜一个固定的词，检查取到了 10 条左右的自然结果、有网址和标题 */
export async function test(input: { profile?: string; show?: boolean } = {}, ctx: any) {
  const t0 = Date.now()
  try {
    const r = await search({ q: 'shopify alternatives', hl: 'en', gl: 'us', profile: input?.profile, show: input?.show }, ctx)
    const problems: string[] = []
    if (r.results.length < 5) problems.push(`只取到 ${r.results.length} 条自然结果`)
    if (r.results.some((x) => !x.url || !x.title)) problems.push('有结果缺网址或标题')
    return { ok: !problems.length, problems, ms: Date.now() - t0, results: r.results.map((x) => `${x.position}. ${x.domain} [${x.kind}] ${x.title}`) }
  } catch (e: any) {
    return { ok: false, code: e?.code || '', problems: [e?.message ?? String(e)], ms: Date.now() - t0 }
  }
}
