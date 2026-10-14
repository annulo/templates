import { getLocale, getTranslations, useTranslations } from 'talizen'

// 界面文案在 /messages/{zh,en}.json。组件里用 useT(命名空间)；格式化函数这类不在组件里的地方用 tr()。
// 当前语言由平台决定：Shuttle 外壳切语言时写 cookie CREGHT_LOCALE，英文页面的地址带 /en 前缀。

/** 当前是不是英文界面 */
export const isEn = () => getLocale().locale === 'en'

/** 数字、日期格式化用的 locale */
export const numLocale = () => (isEn() ? 'en-US' : 'zh-CN')

/** 不在组件里时取文案（格式化函数、常量表） */
export const tr = (key: string, vars?: Record<string, unknown>) => getTranslations()(key, vars)

/**
 * 组件里取文案：t 取字符串（点路径、{var} 插值）；list 按下标一项项取数组，
 * 取到 key 原样返回（缺失）为止。对象数组给出字段名：list('x.items', ['title', 'desc'])。
 */
export function useT(ns?: string) {
  const base = useTranslations(ns)
  const t = (key: string, vars?: Record<string, unknown>) => base(key, vars as any)
  function list(path: string): string[]
  function list<T extends Record<string, string>>(path: string, fields: (keyof T & string)[]): T[]
  function list(path: string, fields?: string[]) {
    const out: unknown[] = []
    const missing = (v: string, key: string) => v === key || v.endsWith(key)
    for (let i = 0; i < 100; i++) {
      const key = `${path}.${i}`
      if (!fields) {
        const v = t(key)
        if (missing(v, key)) break
        out.push(v)
        continue
      }
      const probe = `${key}.${fields[0]}`
      if (missing(t(probe), probe)) break
      const item: Record<string, string> = {}
      for (const f of fields) item[f] = t(`${key}.${f}`)
      out.push(item)
    }
    return out
  }
  return { t, list }
}
