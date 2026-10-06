import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { ChevronLeft, ChevronRight, FileText, GripVertical, RotateCw } from 'lucide-react'
import { Badge, Button, Notice, PageHeader, Segmented, Skeleton, cx, type Tone } from '../ui'
import { dbList, dbPatch, type Article, type Channel, type SocialPost, type SocialPostStatus } from '../../lib/shuttle'
import { CHANNEL_TYPES } from '../../lib/channels'
import { postTitle } from '../../lib/social'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

type Mode = 'week' | 'month'
type Item = {
  key: string
  at: Date
  title: string
  label: string
  tone: Tone
  channel?: Channel
  /** 社媒：已排期 / 已通过的能拖动改时间 */
  post?: SocialPost
  article?: Article
  faded?: boolean
}

const postStatus = (k: SocialPostStatus, tone: Tone) => ({ get label() { return tr(`calendar.st_${k}`) }, tone })
const POST_STATUS: Partial<Record<SocialPostStatus, { label: string; tone: Tone }>> = {
  approved: postStatus('approved', 'primary'),
  scheduled: postStatus('scheduled', 'primary'),
  publishing: postStatus('publishing', 'warn'),
  published: postStatus('published', 'ok'),
  failed: postStatus('failed', 'bad'),
  removed: postStatus('removed', 'default'),
}
const CHIP: Record<Tone, string> = {
  default: 'border-l-border',
  primary: 'border-l-primary',
  ok: 'border-l-emerald-500',
  warn: 'border-l-amber-500',
  bad: 'border-l-destructive bg-destructive/5',
}
// 周一开头；显示名按当前语言
const week = (i: number) => tr(`calendar.week.${i}`)
const WEEK_IDX = [0, 1, 2, 3, 4, 5, 6]
const mon = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
const DRAGGABLE: SocialPostStatus[] = ['scheduled', 'approved']

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseDay = (s?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
/** 周一开始 */
const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const time = (s?: string) => {
  const t = Date.parse(s ?? '')
  return isNaN(t) ? null : new Date(t)
}

function postItem(p: SocialPost, channels: Channel[]): Item | null {
  const st = POST_STATUS[p.status]
  if (!st) return null // 待审核、已退回不上日历
  const at = time(p.status === 'published' || p.status === 'removed' ? p.published_at : p.scheduled_at) ?? (p.status === 'failed' ? time(p.updated_at) : null)
  if (!at) return null
  return { key: 'p:' + p.id, at, title: postTitle(p), label: st.label, tone: st.tone, channel: channels.find((c) => c.id === p.channel_id), post: p, faded: p.status === 'removed' }
}

/** 排期日历：社媒笔记 / 推文（排期、发布、失败）和发到网站的文章按天排开；已排期的社媒能拖到别的时间 */
export default function Calendar({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const mode: Mode = params.cal === 'month' ? 'month' : 'week'
  const today = new Date()
  const anchor = parseDay(params.d) ?? new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const [posts, setPosts] = useState<SocialPost[] | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragId, setDragId] = useState('')
  const [over, setOver] = useState('')

  const load = useCallback(() => {
    dbList('social_posts')
      .then(setPosts)
      .catch((e) => setError(e.message))
    dbList('articles')
      .then(setArticles)
      .catch(() => {})
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])

  const items = useMemo(() => {
    const out: Item[] = []
    for (const p of posts ?? []) {
      const it = postItem(p, ctx.channels)
      if (it) out.push(it)
    }
    for (const a of articles) {
      const at = a.status === 'published' ? time(a.published_at) : null
      if (at) out.push({ key: 'a:' + a.id, at, title: a.title, label: tr('calendar.article'), tone: 'ok', channel: ctx.channels.find((c) => c.id === a.channel_id), article: a })
    }
    return out.sort((x, y) => x.at.getTime() - y.at.getTime())
  }, [posts, articles, ctx.channels])
  const byDay = useMemo(() => {
    const m: Record<string, Item[]> = {}
    for (const it of items) (m[dayKey(it.at)] ??= []).push(it)
    return m
  }, [items])
  // 审核通过、还没排期的：放在上面，拖到某一天就排上
  const unscheduled = useMemo(() => (posts ?? []).filter((p) => p.status === 'approved' && !p.scheduled_at), [posts])

  const days = useMemo(() => {
    if (mode === 'week') {
      const s = weekStart(anchor)
      return Array.from({ length: 7 }, (_, i) => addDays(s, i))
    }
    const s = weekStart(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    const n = Math.ceil(((end.getTime() - s.getTime()) / 86400_000 + 1) / 7) * 7
    return Array.from({ length: n }, (_, i) => addDays(s, i))
  }, [mode, anchor.getTime()])

  const shift = (n: number) => {
    const d = mode === 'week' ? addDays(anchor, n * 7) : new Date(anchor.getFullYear(), anchor.getMonth() + n, 1)
    setParam('d', dayKey(d))
  }
  const title =
    mode === 'week'
      ? (() => {
          const a = days[0]
          const b = days[6]
          return a.getMonth() === b.getMonth()
            ? tr('calendar.range_same_month', { y: a.getFullYear(), m: a.getMonth() + 1, mon: mon(a), d1: a.getDate(), d2: b.getDate() })
            : tr('calendar.range', { m1: a.getMonth() + 1, mon1: mon(a), d1: a.getDate(), m2: b.getMonth() + 1, mon2: mon(b), d2: b.getDate() })
        })()
      : tr('calendar.month', { y: anchor.getFullYear(), m: anchor.getMonth() + 1, mon: mon(anchor) })

  // 属于某篇文章的帖子在内容页的版本里编辑；从平台采回来、不属于文章的在社交媒体页看
  const openPost = (p: SocialPost) => p.article_id ? ctx.go('content', { article: p.article_id, version: p.id }) : ctx.go('social', { post: p.id })
  const open = (it: Item) => {
    if (it.article) ctx.go('content', { article: it.article.id })
    else if (it.post) openPost(it.post)
  }

  const dragged = (posts ?? []).find((p) => p.id === dragId)
  /** 放到哪天：保留原来的几点几分（没排过期的用 10:00）；落在过去就不让放，今天已经过了的点顺延到下一个整点 */
  const targetTime = (day: Date, p: SocialPost) => {
    const old = time(p.scheduled_at)
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old ? old.getHours() : 10, old ? old.getMinutes() : 0)
    const now = new Date()
    if (t.getTime() > now.getTime() + 60_000) return t
    if (dayKey(day) !== dayKey(now)) return null
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0)
    return dayKey(next) === dayKey(now) ? next : null
  }
  const canDrop = (day: Date) => !!dragged && !!targetTime(day, dragged)
  const drop = async (day: Date) => {
    const p = dragged
    setDragId('')
    setOver('')
    if (!p) return
    const t = targetTime(day, p)
    if (!t) {
      setNotice(tr('calendar.no_past'))
      return
    }
    if (p.scheduled_at && Math.abs(Date.parse(p.scheduled_at) - t.getTime()) < 60_000) return
    const patch = { status: 'scheduled' as const, scheduled_at: t.toISOString(), error: null as unknown as string, updated_at: new Date().toISOString() }
    setPosts((ps) => ps?.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) ?? ps)
    setError('')
    setNotice(tr('calendar.moved', { title: postTitle(p), m: t.getMonth() + 1, mon: mon(t), d: t.getDate(), hm: hm(t) }))
    try {
      await dbPatch('social_posts', p.id, patch)
    } catch (e) {
      setError((e as Error).message)
      setNotice('')
    }
    load()
  }
  const dragProps = (p?: SocialPost) =>
    p && DRAGGABLE.includes(p.status)
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.setData('text/plain', p.id)
            e.dataTransfer.effectAllowed = 'move'
            setDragId(p.id)
            setNotice('')
          },
          onDragEnd: () => {
            setDragId('')
            setOver('')
          },
        }
      : {}
  const dropProps = (day: Date) => ({
    onDragOver: (e: DragEvent) => {
      if (!canDrop(day)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (over !== dayKey(day)) setOver(dayKey(day))
    },
    onDragLeave: () => over === dayKey(day) && setOver(''),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      drop(day)
    },
  })

  const Chip = ({ it, compact }: { it: Item; compact?: boolean }) => {
    const Icon = it.article ? FileText : it.channel ? CHANNEL_TYPES[it.channel.type]?.icon : undefined
    const drag = dragProps(it.post)
    return (
      <button
        type="button"
        onClick={() => open(it)}
        {...drag}
        title={`${hm(it.at)} ${it.label} · ${it.channel?.name ?? ''}\n${it.title}${drag.draggable ? '\n' + tr('calendar.drag_hint') : ''}`}
        className={cx(
          'group flex w-full min-w-0 cursor-pointer items-start gap-1.5 rounded-md border border-l-[3px] border-border bg-background px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent',
          CHIP[it.tone],
          it.faded && 'opacity-50',
          drag.draggable && 'cursor-grab active:cursor-grabbing',
          dragId && it.post?.id === dragId && 'opacity-40',
        )}
      >
        {Icon && <Icon size={12} className="mt-0.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
            {hm(it.at)}
            {!compact && <span className={cx(it.tone === 'bad' && 'font-semibold text-destructive')}>{it.label}</span>}
          </span>
          <span className={cx('block truncate', compact ? 'text-[11px]' : 'font-medium')}>{it.title}</span>
        </span>
      </button>
    )
  }

  const todayKey = dayKey(today)
  const month = anchor.getMonth()
  const loading = posts === null

  return (
    <div className="space-y-5">
      <PageHeader
        title={tr('calendar.title')}
        desc={tr('calendar.desc')}
        actions={
          <Button variant="ghost" size="sm" onClick={load} className="text-muted-foreground">
            <RotateCw /> {tr('common.refresh')}
          </Button>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => shift(-1)} aria-label={mode === 'week' ? tr('calendar.prev_week') : tr('calendar.prev_month')}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => shift(1)} aria-label={mode === 'week' ? tr('calendar.next_week') : tr('calendar.next_month')}>
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setParam('d', '')}>
            {tr('calendar.today')}
          </Button>
        </div>
        <div className="min-w-0 flex-1 text-sm font-semibold">{title}</div>
        <Segmented<Mode>
          value={mode}
          onChange={(v) => setParam('cal', v === 'week' ? '' : v)}
          options={[
            { value: 'week', label: tr('calendar.mode_week') },
            { value: 'month', label: tr('calendar.mode_month') },
          ]}
        />
      </div>

      {unscheduled.length > 0 && (
        <div className="rounded-xl border border-dashed border-border bg-background p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <GripVertical className="size-3.5" />
            {tr('calendar.unscheduled', { n: unscheduled.length })}
          </div>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((p) => {
              const ch = ctx.channels.find((c) => c.id === p.channel_id)
              const Icon = ch ? CHANNEL_TYPES[ch.type]?.icon : undefined
              return (
                <button
                  key={p.id}
                  type="button"
                  {...dragProps(p)}
                  onClick={() => openPost(p)}
                  className={cx('flex max-w-64 cursor-grab items-center gap-1.5 rounded-md border border-l-[3px] border-border border-l-primary bg-background px-2 py-1 text-xs hover:bg-accent active:cursor-grabbing', dragId === p.id && 'opacity-40')}
                  title={`${ch?.name ?? ''}\n${postTitle(p)}`}
                >
                  {Icon && <Icon size={12} className="shrink-0 text-muted-foreground" />}
                  <span className="truncate">{postTitle(p)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : mode === 'week' ? (
        // 手机上一天一行，宽屏七列
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const k = dayKey(d)
            const list = byDay[k] ?? []
            return (
              <div
                key={k}
                {...dropProps(d)}
                className={cx(
                  'flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-background p-2 md:min-h-64',
                  k === todayKey && 'border-primary/40',
                  over === k && 'bg-primary/5 ring-2 ring-primary/40',
                  dragId && !canDrop(d) && 'opacity-50',
                )}
              >
                <div className={cx('flex items-baseline gap-1.5 px-0.5 text-xs', k === todayKey ? 'font-semibold text-primary-text' : 'text-muted-foreground')}>
                  <span>{tr('calendar.weekday', { w: week((d.getDay() + 6) % 7) })}</span>
                  <span className="tabular-nums">
                    {d.getMonth() + 1}/{d.getDate()}
                  </span>
                  {list.length > 0 && <span className="ml-auto md:hidden">{tr('calendar.count', { n: list.length })}</span>}
                </div>
                {list.map((it) => (
                  <Chip key={it.key} it={it} />
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="grid grid-cols-7 border-b border-border text-center text-[11px] text-muted-foreground">
            {WEEK_IDX.map((i) => (
              <div key={i} className="py-1.5">
                {week(i)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const k = dayKey(d)
              const list = byDay[k] ?? []
              const failed = list.some((it) => it.tone === 'bad')
              return (
                <div
                  key={k}
                  {...dropProps(d)}
                  className={cx(
                    'flex min-h-16 min-w-0 flex-col gap-1 border-r border-b border-border p-1 [&:nth-child(7n)]:border-r-0 md:min-h-28',
                    d.getMonth() !== month && 'bg-muted/40',
                    over === k && 'bg-primary/5 ring-2 ring-primary/40 ring-inset',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setParam('d', k)
                      setParam('cal', '')
                    }}
                    title={tr('calendar.see_week')}
                    className={cx('cursor-pointer self-start rounded px-1 text-[11px] tabular-nums hover:bg-accent', k === todayKey ? 'bg-primary font-semibold text-primary-foreground hover:bg-primary/90' : d.getMonth() !== month ? 'text-muted-foreground/60' : 'text-muted-foreground')}
                  >
                    {d.getDate()}
                  </button>
                  {/* 手机上格子太窄：只标条数，失败标红，点日期看那一周 */}
                  {list.length > 0 && (
                    <span className="md:hidden">
                      <Badge tone={failed ? 'bad' : 'primary'} className="px-1">
                        {list.length}
                      </Badge>
                    </span>
                  )}
                  <div className="hidden space-y-1 md:block">
                    {list.slice(0, 3).map((it) => (
                      <Chip key={it.key} it={it} compact />
                    ))}
                    {list.length > 3 && (
                      <button
                        type="button"
                        onClick={() => {
                          setParam('d', k)
                          setParam('cal', '')
                        }}
                        className="w-full cursor-pointer px-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {tr('calendar.more', { n: list.length - 3 })}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!loading && !items.length && !unscheduled.length && <Notice>{tr('calendar.empty')}</Notice>}
    </div>
  )
}
