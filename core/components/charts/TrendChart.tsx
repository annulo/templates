import { useEffect, useRef, useState } from 'react'
import { fmtDay, fmtDayLong, fmtNum } from '../../lib/format'
import { numLocale, tr } from '../../lib/i18n'

export type TrendSeries = { name: string; color: string; values: number[] }

/** 4 段刻度的上限：每段是 1/2/5×10ⁿ 的整数，刻度都是整齐的数 */
function niceMax(v: number) {
  if (v <= 0) return 4
  const raw = v / 4
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / p
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p)
  return step * 4
}

/**
 * 按天的折线趋势图（纯 SVG，不依赖图表库）。第一条序列带浅色面积，
 * 悬停显示十字线和当天各序列的值。宽度跟随容器。
 */
/** onPick 给了就能点：点图上某一天回调它的下标，picked 那一天画一条标记线 */
export default function TrendChart({ days, series, height = 260, label, onPick, picked }: { days: string[]; series: TrendSeries[]; height?: number; label?: string; onPick?: (i: number) => void; picked?: number | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  const padL = 36
  const padR = 8
  const padT = 10
  const padB = 26
  const innerW = Math.max(0, w - padL - padR)
  const innerH = height - padT - padB
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)))
  const n = days.length
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / max) * innerH
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 56))))

  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {w > 0 && n > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          aria-label={label ?? tr('ui.trend_label')}
          className={onPick ? 'cursor-pointer' : undefined}
          onClick={() => onPick && hover !== null && onPick(hover)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const i = Math.round(((e.clientX - r.left - padL) / Math.max(1, innerW)) * (n - 1))
            setHover(Math.min(n - 1, Math.max(0, i)))
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(max * t)} y2={y(max * t)} stroke="var(--border)" strokeDasharray={t ? '3 4' : undefined} />
              <text x={padL - 8} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">
                {fmtNum(Math.round(max * t))}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            // 均匀取标签，最后一天总是标出来（离前一个太近就让位）
            (i % labelEvery === 0 && !(i !== n - 1 && n - 1 - i < labelEvery / 2)) || i === n - 1 ? (
              <text key={d} x={x(i)} y={height - 8} textAnchor={i === n - 1 && n > 1 ? 'end' : i === 0 ? 'start' : 'middle'} fontSize="11" fill="var(--muted-foreground)">
                {fmtDay(d)}
              </text>
            ) : null,
          )}
          {series[0] && <path d={`${path(series[0].values)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={series[0].color} opacity={0.08} />}
          {series.map((s) => (
            <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {picked != null && picked >= 0 && picked < n && (
            <line x1={x(picked)} x2={x(picked)} y1={padT} y2={padT + innerH} stroke={series[0]?.color ?? 'var(--primary)'} strokeWidth={1.5} strokeDasharray="4 3" />
          )}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="var(--muted-foreground)" strokeOpacity={0.35} />
              {series.map((s) => (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color} stroke="var(--background)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
          style={x(hover) > w - 180 ? { right: w - x(hover) + 12 } : { left: x(hover) + 12 }}
        >
          <div className="mb-1 font-medium">{fmtDayLong(days[hover])}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-4 py-0.5">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="font-medium tabular-nums">{(s.values[hover] ?? 0).toLocaleString(numLocale())}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
