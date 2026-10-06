import type { TalizenFuncContext } from 'talizen/func-runtime'

// 表还没建（刚复制出来的后台、直接打开模板预览）时当作空表，页面显示空状态而不是报错
function query(ctx: TalizenFuncContext, table: string, opts: any) {
  try {
    return ctx.db.query(table, opts)
  } catch (e) {
    if (/table not found/i.test(String((e as Error)?.message ?? e))) return { list: [] }
    throw e
  }
}

// 读写运营后台的业务表：不在 Shuttle 里打开后台（手机、别的电脑）时页面用它；在 Shuttle 里走本机。
// 只给这个 creght 项目的成员读（ctx.member.require()，没登录 401 member_login_required，页面带去 /auth/member/login）。
// 只开放运营用的这几张表。

const TABLES = ['profile', 'topics', 'articles', 'assets', 'reports', 'checklist', 'social_posts', 'social_accounts', 'social_daily', 'social_post_daily', 'social_health']

export function list(input: { table?: string; limit?: number }, ctx: TalizenFuncContext) {
  ctx.member.require()
  const table = String(input?.table ?? '')
  if (!TABLES.includes(table)) throw new Error('不支持的表：' + table)
  const limit = Math.min(Math.max(Number(input?.limit) || 500, 1), 1000)
  const res = query(ctx, table, { limit })
  const list = (res?.list ?? []).map((r: any) => ({ ...r, id: String(r.id) }))
  // 新的在前（没有 created_at 的排后面）
  list.sort((a: any, b: any) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  return { list }
}

// 写表：不在 Shuttle 里（手机）时页面的 dbCreate / dbPatch / dbDelete 走这里（lib/shuttle.ts），和 Shuttle 的写表接口一样：
// 新建不收 id；更新是顶层浅合并（值传 null 删字段），不改 id、created_at，返回更新后的整行。发布这类要电脑做的仍然走本机函数。

function writable(ctx: TalizenFuncContext, table: unknown): string {
  ctx.member.require()
  const t = String(table ?? '')
  if (!TABLES.includes(t)) throw new Error('不支持的表：' + t)
  return t
}

export function create(input: { table?: string; data?: Record<string, unknown> }, ctx: TalizenFuncContext) {
  const table = writable(ctx, input?.table)
  const { id: _id, ...data } = input?.data ?? {}
  const row: any = ctx.db.insert(table, data)
  return { ...row, id: String(row.id) }
}

export function update(input: { table?: string; id?: string; patch?: Record<string, unknown> }, ctx: TalizenFuncContext) {
  const table = writable(ctx, input?.table)
  const id = String(input?.id ?? '')
  if (!id) throw new Error('缺 id')
  const { id: _id, created_at: _c, ...patch } = input?.patch ?? {}
  ctx.db.update(table, id, patch)
  const row: any = ctx.db.get(table, id)
  return row ? { ...row, id: String(row.id) } : null
}

export function remove(input: { table?: string; id?: string }, ctx: TalizenFuncContext) {
  const table = writable(ctx, input?.table)
  const id = String(input?.id ?? '')
  if (!id) throw new Error('缺 id')
  ctx.db.delete(table, id)
  return { ok: true }
}
