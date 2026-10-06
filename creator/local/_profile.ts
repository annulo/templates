// 账号定位（profile 表只有一行）。文件名以 _ 开头：只给别的文件 import。

export type Profile = { id?: string; name?: string; about?: string; audience?: string; pillars?: string; voice?: string; avoid?: string }

export function profile(ctx: any): Profile {
  return ctx.db.query('profile', { limit: 1 }).list[0] ?? {}
}

/** 给 AI 看的一段定位说明；没填的项不写 */
export function brief(p: Profile): string {
  const rows: [string, string | undefined][] = [
    ['名字', p.name],
    ['我是谁', p.about],
    ['写给谁', p.audience],
    ['主要写什么', p.pillars],
    ['风格', p.voice],
    ['不写什么', p.avoid],
  ]
  return rows
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `${k}：${v!.trim()}`)
    .join('\n')
}
