import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { Badge, Button, cx, type Tone } from './ui'
import { dbList, isSite, type Channel } from '../lib/shuttle'
import { isEn, tr } from '../lib/i18n'
import { aeoCheckText, aeoDimText, aeoOptions, scoreArticle, type AeoGrade, type AeoResult } from '../local/_aeo'
import { typeOf } from '../local/_types'

// AI 引用分（规则在 core/local/_aeo.ts，设计见仓库根目录 docs/ai-citation-score.md）：长文好不好被 AI 读懂、原样引用。
// 只在有独立站的项目里给长文显示（文章要发网站才有意义）；打开文章、编辑时按正文现算，不存表。

const GRADE_TONE: Record<AeoGrade, Tone> = { A: 'ok', B: 'ok', C: 'warn', D: 'bad', F: 'bad' }

/** 有独立站才显示：没有网站的模板（自媒体）、只做社媒的项目不显示 */
export const aiScoreOn = (channels: Channel[]) => channels.some(isSite)

// 公司资料、产品目录（品牌词、型号、自己的域名）：一个页面只读一次。没有这两张表的模板当空的
let optionsLoad: Promise<ReturnType<typeof aeoOptions>> | null = null
const anyList = dbList as unknown as (t: string) => Promise<any[]>
function useAeoOptions() {
  const [opts, setOpts] = useState<ReturnType<typeof aeoOptions>>({ terms: [], hosts: [] })
  useEffect(() => {
    optionsLoad ??= Promise.all([anyList('profile').catch(() => []), anyList('products').catch(() => [])]).then(([p, l]) => aeoOptions(p[0], l))
    let live = true
    void optionsLoad.then((o) => { if (live) setOpts(o) })
    return () => { live = false }
  }, [])
  return opts
}

type Source = { title?: string; summary?: string; body?: string }

export function useAiScore(a: Source): AeoResult | null {
  const opts = useAeoOptions()
  return useMemo(() => scoreArticle(a, opts), [a.title, a.summary, a.body, opts])
}

/** 交给 AI 改的说明：最弱的几段缺什么、整篇哪几项没过 */
function fixNote(r: AeoResult) {
  const en = isEn()
  const sep = en ? '; ' : '；'
  const paras = r.weakest.map((b) => tr('aeo.fix_para', { n: b.n, miss: b.miss.map((m) => aeoDimText(m, en)[0]).join(en ? ', ' : '、') }))
  const failed = r.checks.filter((c) => !c.ok).map((c) => aeoCheckText(c.key, en)[0])
  return [tr('aeo.fix_intro', { score: r.score, grade: r.grade }), paras.length ? tr('aeo.fix_paras', { list: paras.join(sep) }) : '', failed.length ? tr('aeo.fix_checks', { list: failed.join(en ? ', ' : '、') }) : '', tr('aeo.fix_rule')].filter(Boolean).join('\n')
}

/** 分数徽标：文章列表、发布弹窗用 */
export function AiScoreBadge({ r, className }: { r: AeoResult | null; className?: string }) {
  if (!r) return null
  return <Badge tone={GRADE_TONE[r.grade]} className={className}><span title={tr('aeo.title')}>{tr('aeo.badge', { grade: r.grade, score: r.score })}</span></Badge>
}

/** 列表一行里的等级：只给长文 */
export function AiScoreTag({ a }: { a: Source & { type?: string } }) {
  const r = useAiScore(a)
  return typeOf(a as never) === 'article' ? <AiScoreBadge r={r} /> : null
}

/** 文章页正文下面的一块：分数、没过的项、最弱的几段，一个「交给 AI 改」 */
export function AiScore({ a, onFix, disabled }: { a: Source; onFix?: (note: string) => void | Promise<void>; disabled?: boolean }) {
  const r = useAiScore(a)
  const [open, setOpen] = useState(false)
  if (!r) return null
  const en = isEn()
  const failed = r.checks.filter((c) => !c.ok)
  return <section className="rounded-lg border border-border px-4 py-3 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Sparkles className="size-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">{tr('aeo.title')}</span>
      <AiScoreBadge r={r} />
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">{failed.length || r.weakest.length ? tr('aeo.summary', { checks: failed.length, paras: r.weakest.length }) : tr('aeo.all_good')}</span>
      {(failed.length > 0 || r.weakest.length > 0) && <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary-text hover:underline">
        {open ? tr('aeo.hide') : tr('aeo.show')}<ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>}
    </div>
    {open && <div className="mt-3 space-y-4 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">{tr('aeo.hint')}</p>
      {failed.length > 0 && <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('aeo.failed')}</p>
        <ul className="space-y-1">{failed.map((c) => { const [name, rule] = aeoCheckText(c.key, en); return <li key={c.key}><span className="font-medium">{name}</span><span className="text-muted-foreground"> · {rule}{tr('aeo.now', { value: c.value })}</span></li> })}</ul>
      </div>}
      {r.weakest.length > 0 && <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('aeo.weakest')}</p>
        <ul className="space-y-2.5">{r.weakest.map((b) => <li key={b.n} className="rounded-md bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">{tr('aeo.para', { n: b.n })}{b.heading && ` · ${b.heading}`} · {b.score}</p>
          <p className="mt-1 line-clamp-2">{b.text}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{b.miss.map((m) => { const [name, rule] = aeoDimText(m, en); return <span key={m} title={rule} className="rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground">{name}</span> })}</div>
        </li>)}</ul>
      </div>}
      {onFix && <Button size="sm" variant="outline" needsShuttle disabled={disabled} onClick={() => onFix(fixNote(r))}><Sparkles />{tr('aeo.fix')}</Button>}
    </div>}
  </section>
}
