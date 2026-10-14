import { numLocale, tr } from './i18n'

/** 大数字缩写：中文 1.2万，英文 12.3K */
export const fmtNum = (n: number) =>
  n >= 10000 ? new Intl.NumberFormat(numLocale(), { notation: 'compact', maximumFractionDigits: n >= 100000 ? 0 : 1 }).format(n) : n.toLocaleString(numLocale())

/** 千分位：1,234 */
export const fmtInt = (n?: number) => (n ?? 0).toLocaleString(numLocale())

/** 平台返回的 day 是 "20260924"，显示成 "9/24" */
export const fmtDay = (day: string) => (day.length === 8 ? `${Number(day.slice(4, 6))}/${Number(day.slice(6, 8))}` : day)

/** 完整日期，悬停提示用："9月24日 周三" / "Wed, Sep 24" */
export function fmtDayLong(day: string) {
  if (day.length !== 8) return day
  const d = new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00`)
  const w = tr(`common.weekdays.${d.getDay()}`)
  const mon = d.toLocaleDateString('en-US', { month: 'short' })
  return tr('common.day_long', { m: d.getMonth() + 1, d: d.getDate(), w, mon })
}

export const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).host : ''
  } catch {
    return ''
  }
}
