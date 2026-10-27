import type { KeyRow } from '../lib/shuttle'
import { fmtNum } from '../lib/format'
import { ArrowUpRight } from 'lucide-react'
import { Panel } from './ui'
import { tr } from '../lib/i18n'

/** 一列数字：表头、取值、列宽（默认 w-20，表头字长的加宽）。第一列是主数字（加粗，占比细条按它算），其余是灰色的辅助数字 */
export type BreakdownColumn<R> = { label: string; value: (r: R) => number; width?: string }

const PV_UV: BreakdownColumn<KeyRow>[] = [
  { label: 'PV', value: (r) => r.pv_count },
  { label: 'UV', value: (r) => r.uv_count },
]

/** 维度 Top N：平台分析页的表格样式，每行带一条占比细条。默认列是平台统计的 PV / UV，GA4 这类别的口径传 columns；href 给了地址的行点了在新标签打开（受访页面） */
export default function BreakdownTable<R extends { key: string } = KeyRow>({ title, keyLabel, rows, empty, format, columns, href }: { title: string; keyLabel: string; rows?: R[]; empty?: string; format?: (k: string) => string; columns?: BreakdownColumn<R>[]; href?: (k: string) => string }) {
  const cols = columns ?? (PV_UV as unknown as BreakdownColumn<R>[])
  const list = (rows ?? []).slice(0, 8)
  const main = cols[0]
  const max = Math.max(1, ...list.map((r) => main.value(r)))
  return (
    <Panel title={title}>
      {list.length === 0 ? (
        <div className="flex h-[140px] items-center justify-center text-sm text-muted-foreground">{empty ?? tr('ui.no_data')}</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{keyLabel}</th>
                {cols.map((c) => (
                  <th key={c.label} className={`${c.width ?? 'w-20'} px-3 py-2 text-right font-medium`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const label = format ? format(r.key) : r.key
                const link = href?.(r.key)
                return (
                  <tr key={r.key} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2">
                      {link ? (
                        <a href={link} target="_blank" rel="noreferrer" title={link} className="group flex min-w-0 items-center gap-1 text-foreground hover:text-primary-text">
                          <span className="truncate">{label}</span>
                          <ArrowUpRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                        </a>
                      ) : (
                        <div className="truncate text-foreground" title={r.key}>
                          {label}
                        </div>
                      )}
                      <div className="mt-1 h-1 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${(main.value(r) / max) * 100}%` }} />
                      </div>
                    </td>
                    {cols.map((c, i) => (
                      <td key={c.label} className={i === 0 ? 'px-3 py-2 text-right font-medium tabular-nums' : 'px-3 py-2 text-right text-muted-foreground tabular-nums'}>{fmtNum(c.value(r))}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
