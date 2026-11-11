import { L } from './_i18n'

// Apollo.io 的 REST 接口（用户自己的 API Key：设置 → 密钥 里的 APOLLO_API_KEY）。只在这个文件里调，Apollo 改接口时只改这里。
// 文档：https://docs.apollo.io/reference/people-api-search 、 https://docs.apollo.io/reference/people-enrichment
// 找人用 People API Search（不花积分，但不给邮箱）；要邮箱再对选中的人做 People Enrichment（每人花积分）。

const BASE = 'https://api.apollo.io/api/v1'

export type ApolloFilters = {
  person_titles?: string[]
  person_seniorities?: string[]
  person_locations?: string[]
  organization_locations?: string[]
  organization_num_employees_ranges?: string[]
  q_organization_keyword_tags?: string[]
  q_keywords?: string
}

export type ApolloPerson = {
  id: string
  name: string
  title: string
  seniority: string
  linkedin_url: string
  country: string
  city: string
  company: string
  company_domain: string
  company_size: string
  industry: string
  email?: string
  email_status?: string
  phone?: string
  raw: any
}

export function apolloKey(ctx: any): string {
  return ctx.secrets?.get('APOLLO_API_KEY') || ''
}

export function apolloHow(ctx: any): string {
  return L(ctx, '到 Apollo（app.apollo.io → Settings → Integrations → API）建一个 API Key，填到 Annulo 的 设置 → 密钥，名字写 APOLLO_API_KEY。找人不花积分，取邮箱每人花 1 个积分。', 'Create an API key in Apollo (app.apollo.io → Settings → Integrations → API) and add it under Annulo Settings → Secrets as APOLLO_API_KEY. Searching is free; revealing an email costs 1 credit per person.')
}

async function call(ctx: any, path: string, body: unknown): Promise<any> {
  const key = apolloKey(ctx)
  if (!key) throw new Error(apolloHow(ctx))
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json', 'cache-control': 'no-cache' }, body: JSON.stringify(body) })
  const data: any = await r.json().catch(() => ({}))
  if (r.status === 401 || r.status === 403) throw new Error(L(ctx, `Apollo 拒绝了这个 API Key（${r.status}）：检查密钥对不对、套餐有没有开放 API`, `Apollo rejected the API key (${r.status}): check the key and whether your plan includes API access`))
  if (r.status === 429) throw new Error(L(ctx, 'Apollo 限流了，过一会儿再试', 'Apollo rate limit reached; try again later'))
  if (!r.ok) throw Object.assign(new Error(L(ctx, 'Apollo 出错：', 'Apollo error: ') + (data?.error || data?.message || `HTTP ${r.status}`)), { status: r.status })
  return data
}

/** 一条 Apollo 的人整理成我们的字段（接口版本不同，字段名有出入，都兼容） */
export function toPerson(p: any): ApolloPerson {
  const org = p?.organization ?? p?.account ?? {}
  const name = p?.name || [p?.first_name, p?.last_name ?? p?.last_name_obfuscated].filter(Boolean).join(' ')
  return {
    id: String(p?.id ?? ''),
    name: String(name ?? '').trim(),
    title: String(p?.title ?? p?.headline ?? ''),
    seniority: String(p?.seniority ?? ''),
    linkedin_url: String(p?.linkedin_url ?? ''),
    country: String(p?.country ?? org?.country ?? ''),
    city: String(p?.city ?? ''),
    company: String(org?.name ?? p?.organization_name ?? ''),
    company_domain: String(org?.primary_domain ?? org?.website_url ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''),
    company_size: String(org?.estimated_num_employees ?? org?.employee_count ?? ''),
    industry: String(org?.industry ?? ''),
    email: p?.email && !/email_not_unlocked/.test(p.email) ? String(p.email) : undefined,
    email_status: p?.email_status ? String(p.email_status) : undefined,
    phone: p?.phone_numbers?.[0]?.sanitized_number ? String(p.phone_numbers[0].sanitized_number) : undefined,
    raw: p,
  }
}

/** 按条件找人，一页最多 100；新接口（api_search）不在时退回老的 mixed_people/search */
export async function searchPeople(ctx: any, filters: ApolloFilters, page: number, perPage = 100): Promise<{ people: ApolloPerson[]; total: number }> {
  const body = { ...filters, page, per_page: Math.min(Math.max(perPage, 1), 100) }
  let data: any
  try {
    data = await call(ctx, '/mixed_people/api_search', body)
  } catch (e: any) {
    if (e?.status !== 404) throw e
    data = await call(ctx, '/mixed_people/search', body)
  }
  const list = [...(data?.people ?? []), ...(data?.contacts ?? [])]
  return { people: list.map(toPerson).filter((p) => p.id && p.name), total: Number(data?.pagination?.total_entries ?? data?.total_entries ?? list.length) }
}

/** 取一个人的邮箱（花积分） */
export async function enrichPerson(ctx: any, id: string): Promise<ApolloPerson | null> {
  const data = await call(ctx, '/people/match', { id, reveal_personal_emails: false })
  return data?.person ? toPerson(data.person) : null
}
