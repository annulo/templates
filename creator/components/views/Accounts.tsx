import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'talizen'
import { ArrowUpRight, ChevronDown, LogIn, Plus, RefreshCw, Stethoscope, TriangleAlert, Wrench } from 'lucide-react'
import { onRefresh, openSettings, runLocal } from '../../lib/annulo'
import type { Ctx } from '../../lib/ctx'
import { PLATFORM_IDS, platformLabel, type Account, type Platform } from '../../lib/social'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { PlatformBadge } from '../PlatformBadge'
import { RunButton } from '../RunButton'
import { TaskButton } from '../Task'

/** 社媒插件记的浏览器自动化健康：一个账号一类操作（自检、发布、删除、采集）一行 */
type Health = { id: string; channel_id: string; op: string; ok: boolean; kind?: string; step?: string; error?: string; dismissed_at?: string }

/** 账号与数据：添加、重新登录、采集、自检；平台改版导致流程失效时交给助手修（插件的任务 social/fix-platform） */
export default function Accounts({ ctx }: { ctx: Ctx }) {
  const t = useTranslations('accounts')
  const locale = useLocale()
  const [platform, setPlatform] = useState<Platform>('x')
  const [health, setHealth] = useState<Health[]>([])
  const [open, setOpen] = useState('')

  const loadHealth = useCallback(() => {
    if (ctx.plugin) runLocal<{ list: Health[] }>('social/social.health').then((r) => setHealth(r.list ?? [])).catch(() => {})
  }, [ctx.plugin])
  useEffect(() => {
    loadHealth()
    return onRefresh(loadHealth)
  }, [loadHealth])
  const reload = () => {
    ctx.reloadAccounts()
    loadHealth()
  }

  if (!ctx.plugin)
    return (
      <div className="max-w-2xl space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('noPlugin')}</p>
        <Button variant="outline" onClick={() => openSettings('backend')}>
          {t('openSettings')}
        </Button>
      </div>
    )

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('desc')}</p>
      </div>

      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-4">
        <span className="text-sm">{t('add')}</span>
        <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLATFORM_IDS.map((p) => (
              <SelectItem key={p} value={p}>
                <PlatformBadge type={p} className="size-5" /> {platformLabel(p, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RunButton fn="social/social.login" input={{ type: platform }} icon={Plus} variant="default" onDone={reload}>
          {t('login')}
        </RunButton>
        <p className="w-full text-xs text-muted-foreground">{t('loginHint')}</p>
      </section>

      <ul className="space-y-3">
        {ctx.accounts.length === 0 && <li className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{t('empty')}</li>}
        {ctx.accounts.map((a) => {
          const broken = health.filter((h) => h.channel_id === a.id && !h.ok && !h.dismissed_at)
          return (
            <li key={a.id} className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                {a.avatar ? <img src={a.avatar} alt="" className="size-9 rounded-full" /> : <PlatformBadge type={a.type} className="size-9 text-xs" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {a.name}
                    <span className="text-xs font-normal text-muted-foreground">
                      {platformLabel(a.type, locale)}
                      {a.handle ? ` · @${a.handle.replace(/^@/, '')}` : ''}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.login_status === 'expired' ? <span className="text-amber-600 dark:text-amber-400">{t('expired')}</span> : t('followers', { n: a.followers ?? 0 })}
                    {a.collected_at && ` · ${t('collectedAt', { at: new Date(a.collected_at).toLocaleString(locale) })}`}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <RunButton fn="social/social.collect" input={{ channel_id: a.id }} icon={RefreshCw} variant="ghost" onDone={reload}>
                    {t('collect')}
                  </RunButton>
                  <RunButton fn="social/social.probe" input={{ channel_id: a.id }} icon={Stethoscope} variant="ghost" onDone={reload}>
                    {t('probe')}
                  </RunButton>
                  <RunButton fn="social/social.openProfile" input={{ channel_id: a.id }} icon={ArrowUpRight} variant="ghost">
                    {t('openProfile')}
                  </RunButton>
                  <RunButton fn="social/social.login" input={{ channel_id: a.id }} icon={LogIn} variant={a.login_status === 'expired' ? 'default' : 'ghost'} onDone={reload}>
                    {t('relogin')}
                  </RunButton>
                </div>
              </div>

              {broken.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                  <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    {h.kind === 'expired' ? t('healthExpired') : t('healthBroken', { op: t(`op.${h.op}`), step: h.step ?? '' })} {h.error}
                  </span>
                  {h.kind !== 'expired' && (
                    <TaskButton task="social/fix-platform" input={{ channel_id: a.id }} match={(r) => r.input?.channel_id === a.id} onFinished={reload} icon={Wrench} variant="outline">
                      {t('fix')}
                    </TaskButton>
                  )}
                </div>
              ))}

              <button type="button" onClick={() => setOpen(open === a.id ? '' : a.id)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className={cn('size-3.5 transition-transform', open === a.id && 'rotate-180')} /> {t('stats')}
              </button>
              {open === a.id && <Stats account={a} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

type Summary = { published: number; pending: number; followers: number | null; followers_gain: number | null; totals: Record<string, number>; note: string; top: { id: string; title?: string; post_url?: string; views: number; likes: number; comments: number }[] }

/** 一个账号近 30 天的数据（插件的 social/stats.summary） */
function Stats({ account }: { account: Account }) {
  const t = useTranslations('accounts')
  const [s, setS] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    runLocal<Summary>('social/stats.summary', { channel_id: account.id, days: 30 })
      .then(setS)
      .catch((e) => setError((e as Error).message))
  }, [account.id])
  if (error) return <p className="text-xs text-destructive">{error}</p>
  if (!s) return <p className="text-xs text-muted-foreground">…</p>
  const cells: [string, number | string][] = [
    [t('s.published'), s.published],
    [t('s.followersGain'), s.followers_gain ?? '—'],
    [t('s.views'), s.totals.views ?? 0],
    [t('s.likes'), s.totals.likes ?? 0],
    [t('s.comments'), s.totals.comments ?? 0],
    [t('s.pending'), s.pending],
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {cells.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-muted/50 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{k}</div>
            <div className="text-base font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{s.note}</p>
      {s.top.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border text-xs">
          {s.top.slice(0, 10).map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{p.post_url ? <a href={p.post_url} target="_blank" rel="noreferrer" className="hover:underline">{p.title || p.id}</a> : p.title || p.id}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{t('row', { views: p.views, likes: p.likes, comments: p.comments })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
