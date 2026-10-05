// 示例本机函数：在这台电脑上直接跑，不经过模型。页面按钮用 runLocal('notes.stats') 调，助手在命令行里用 shuttle run notes.stats。
export function stats(_input: unknown, ctx: any) {
  const all = ctx.db.query('notes', { limit: 1000 }).list as { done?: boolean }[]
  const done = all.filter((r) => r.done).length
  return { total: all.length, done, open: all.length - done }
}
