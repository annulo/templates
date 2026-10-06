import type { KeyRow } from '../lib/shuttle'
import { fmtNum } from '../lib/format'
import { Panel } from './ui'
import { tr } from '../lib/i18n'

/** 维度 Top N：平台分析页的表格样式，每行带一条占比细条 */
export default function BreakdownTable({ title, keyLabel, rows, empty, format }: { title: string; keyLabel: string; rows?: KeyRow[]; empty?: string; format?: (k: string) => string }) {
  const list = (rows ?? []).slice(0, 8)
  const max = Math.max(1, ...list.map((r) => r.pv_count))
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
                <th className="w-20 px-3 py-2 text-right font-medium">PV</th>
                <th className="w-20 px-3 py-2 text-right font-medium">UV</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const label = format ? format(r.key) : r.key
                return (
                  <tr key={r.key} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2">
                      <div className="truncate text-foreground" title={r.key}>
                        {label}
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.pv_count / max) * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtNum(r.pv_count)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{fmtNum(r.uv_count)}</td>
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
