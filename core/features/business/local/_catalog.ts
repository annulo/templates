// 产品目录的公共读法（文件名以 _ 开头：不作为可调用的函数，只给别的文件 import）。

/** 全部产品：按 id 翻完全表，产品再多也不丢（一次 query 最多 1000 条）。还没有产品表时是空的 */
export function allProducts(ctx: any): any[] {
  const out: any[] = []
  let cursor = ''
  try {
    do {
      const r = ctx.db.query('products', { limit: 1000, cursor })
      out.push(...r.list)
      cursor = r.next_cursor ?? ''
    } while (cursor)
  } catch {
    return []
  }
  return out
}
