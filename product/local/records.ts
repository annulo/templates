// 手动改业务表的一条记录：助手在对话里要改的、又没有现成本机函数的，用它（annulo run records.patch …），
// 不用 creght 命令行，离线项目、在线项目一样能用。有业务函数的（content.update、profile.save……）优先用业务函数，它们会顺手做校验和关联。
//
//   annulo run records.create --input '{"table":"assets","data":{…}}'
//   annulo run records.patch  --input '{"table":"topics","id":"…","data":{"status":"dropped"}}'
//   annulo run records.remove --input '{"table":"topics","id":"…"}'

export const cloud = ['create', 'patch', 'remove']

function table(input: { table?: string }) {
  const t = String(input?.table ?? '')
  if (!/^[a-z][a-z0-9_]*$/.test(t)) throw new Error('table 要写表的 key（tables/<表>.json 的文件名，插件的表带前缀，如 social_posts）')
  return t
}

export function create(input: { table: string; data: Record<string, any> }, ctx: any) {
  const t = table(input)
  const { id: _id, ...data } = input.data ?? {}
  return ctx.db.insert(t, { created_at: new Date().toISOString(), ...data })
}

// 顶层浅合并：data 里给了的字段覆盖，值是 null 的删掉；id、created_at 不改。返回改后的整行。
export function patch(input: { table: string; id: string; data: Record<string, any> }, ctx: any) {
  const t = table(input)
  const row = ctx.db.get(t, String(input.id ?? ''))
  if (!row) throw new Error(`${t} 里没有 id 为 ${input.id} 的记录`)
  const next: Record<string, any> = { ...row }
  for (const [k, v] of Object.entries(input.data ?? {})) {
    if (k === 'id' || k === 'created_at') continue
    next[k] = v // null 照样传下去：本机的 update 按 null 删字段
  }
  if ('updated_at' in row) next.updated_at = new Date().toISOString()
  delete next.id
  // 传整行：站点 Func 的 update 是整行替换，本机的是合并，两边结果一样
  ctx.db.update(t, String(input.id), next)
  return ctx.db.get(t, String(input.id))
}

export function remove(input: { table: string; id: string }, ctx: any) {
  const t = table(input)
  ctx.db.delete(t, String(input.id ?? ''))
  return { ok: true }
}
