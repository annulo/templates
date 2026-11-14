import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BarChart3, Check, Link2, Loader2, Search, Sparkles } from 'lucide-react'
import Select from './Select'
import { Button, cx } from './ui'
import { listOAuthConnections, runLocal, startOAuthConnection } from '../lib/shuttle'
import { fmtNum } from '../lib/format'
import { tr } from '../lib/i18n'
import { useCanRun } from '../lib/useShuttle'
import type { Ctx } from './views/types'

type Status = {
  site: { id: string; name: string; type: string; url: string } | null
  gsc?: { property: string; synced_at: string; clicks: number; impressions: number } | null
  ga4?: { property: string }
  geo?: { engines: string[]; last: { at: string; visibility: number | null; questions: number } | null }
}
type One = { property?: string; error?: string; skipped?: boolean }
type Picks = { gsc: { value: string; label: string }[] | null; ga4: { value: string; label: string }[] | null }

/**
 * 总览页的「连接数据」（local/dataconnect.ts）：主网站的谷歌搜索后台（GSC）、谷歌分析（GA4）、AI 搜索检测在这一处连，不用去各个页面找。
 * 连 Google 直接在这里发起授权（Annulo 的连接），授权回来自动按域名关联 GSC、GA4，GSC 马上同步一次；按域名找不到的给下拉手动选。
 * 都连好了收成一行。没有网站（还没走完向导）时不显示。
 */
export default function DataConnect({ ctx }: { ctx: Ctx }) {
  const [st, setSt] = useState<Status | null>(null)
  const [google, setGoogle] = useState<boolean | null>(null) // null = 读不到（不在 Annulo 里）
  const [busy, setBusy] = useState<'' | 'google' | 'link' | 'geo'>('')
  const [errs, setErrs] = useState<{ gsc?: string; ga4?: string; geo?: string; google?: string }>({})
  const [picks, setPicks] = useState<Picks>({ gsc: null, ga4: null })
  const [open, setOpen] = useState(false)
  const tried = useRef(false) // 这次打开页面自动关联过没有：只试一次，失败了给手动选，不每次刷新都去读 Google
  const canRun = useCanRun('dataconnect.link')

  const load = useCallback(async () => {
    const s = await runLocal<Status>('dataconnect.status', {}).catch(() => null)
    setSt(s)
    const g = await listOAuthConnections().then((l) => l.find((c) => c.key === 'google')).catch(() => undefined)
    const ok = g === undefined ? null : !!g.accounts.some((a) => !a.needs_reconnect)
    setGoogle(ok)
    return { s, ok }
  }, [])

  const link = useCallback(async (pick?: { gsc?: string; ga4?: string }) => {
    setBusy('link')
    try {
      const r = await runLocal<{ gsc: One; ga4: One }>('dataconnect.link', pick ?? {})
      setErrs((e) => ({ ...e, gsc: r.gsc.error, ga4: r.ga4.error }))
      // 自动找不到：列出能选的属性
      if (r.gsc.error && !picks.gsc) runLocal<{ list: { siteUrl: string }[] }>('gsc.properties', {}).then((p) => setPicks((x) => ({ ...x, gsc: p.list.map((v) => ({ value: v.siteUrl, label: v.siteUrl.replace(/^sc-domain:/, '') })) }))).catch(() => {})
      if (r.ga4.error && !picks.ga4) runLocal<{ list: { property: string; name: string; urls: string[] }[] }>('ga4.properties', {}).then((p) => setPicks((x) => ({ ...x, ga4: p.list.map((v) => ({ value: v.property, label: v.name, sub: v.urls.join(', ') })) }))).catch(() => {})
      await load()
      if (!r.gsc.error && !r.gsc.skipped) ctx.reloadChannels()
    } catch (e) {
      setErrs((x) => ({ ...x, gsc: (e as Error).message }))
    } finally {
      setBusy('')
    }
  }, [load, picks, ctx])

  useEffect(() => {
    load().then(({ s, ok }) => {
      // 已经连了 Google、还有没关联的：自动关联一次
      if (!ok || tried.current || !s?.site) return
      if ((s.gsc && !s.gsc.property) || !s.ga4?.property) {
        tried.current = true
        link()
      }
    })
  }, [ctx.rev]) // eslint-disable-line react-hooks/exhaustive-deps

  const connectGoogle = async () => {
    setBusy('google')
    setErrs((e) => ({ ...e, google: '' }))
    try {
      const { auth_url } = await startOAuthConnection('google')
      window.open(auth_url, '_blank', 'noopener,noreferrer')
      // 等用户在浏览器里授权完：最多等 5 分钟，连上了就自动关联
      const until = Date.now() + 5 * 60_000
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 2000))
        const g = await listOAuthConnections().then((l) => l.find((c) => c.key === 'google')).catch(() => undefined)
        if (g?.accounts.some((a) => !a.needs_reconnect)) {
          setGoogle(true)
          tried.current = true
          setBusy('')
          await link()
          return
        }
      }
      setErrs((e) => ({ ...e, google: tr('connect.google_timeout') }))
    } catch (e) {
      setErrs((x) => ({ ...x, google: (e as Error).message }))
    } finally {
      setBusy((b) => (b === 'google' ? '' : b))
    }
  }

  const enableGeo = async () => {
    setBusy('geo')
    try {
      const r = await runLocal<{ ready: boolean; reason: string }>('geo.autoEngine', {})
      setErrs((e) => ({ ...e, geo: r.ready ? '' : r.reason }))
      await load()
    } catch (e) {
      setErrs((x) => ({ ...x, geo: (e as Error).message }))
    } finally {
      setBusy('')
    }
  }

  if (!st?.site) return null
  const gscDone = !st.gsc || !!st.gsc.property
  const ga4Done = !!st.ga4?.property
  const geoDone = !!st.geo?.engines.length
  const allDone = google !== false && gscDone && ga4Done && geoDone

  // 都连好了：收成一行，点开看每一项
  if (allDone && !open)
    return (
      <button id="data-connect" type="button" onClick={() => setOpen(true)} className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-left text-xs text-muted-foreground hover:bg-accent">
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        <span className="font-medium text-foreground">{tr('connect.all_done')}</span>
        <span className="truncate">{[st.gsc && 'Search Console', 'GA4', tr('connect.geo')].filter(Boolean).join(' · ')}</span>
      </button>
    )

  const disabled = !canRun || !!busy
  return (
    <div id="data-connect" className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{tr('connect.title')}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{tr('connect.desc', { site: st.site.name })}</p>
        </div>
        {allDone && <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{tr('connect.collapse')}</Button>}
      </div>
      <div className="divide-y divide-border">
        <Row icon={<Link2 className="size-4" />} title={tr('connect.google')} done={google === true}
          detail={google === null ? tr('connect.google_offline') : google ? tr('connect.google_on') : tr('connect.google_off')} error={errs.google}
          action={google === false && (
            <Button size="sm" disabled={disabled} onClick={connectGoogle}>
              {busy === 'google' ? <Loader2 className="animate-spin" /> : null}{busy === 'google' ? tr('connect.google_waiting') : tr('connect.google_btn')}
            </Button>
          )} />
        {st.gsc && (
          <Row icon={<Search className="size-4" />} title="Search Console" done={gscDone}
            detail={gscDone ? (st.gsc.synced_at ? tr('connect.gsc_numbers', { clicks: fmtNum(st.gsc.clicks), impressions: fmtNum(st.gsc.impressions) }) : tr('connect.linked', { name: st.gsc.property.replace(/^sc-domain:/, '') })) : tr('connect.gsc_off')}
            error={!gscDone ? errs.gsc : undefined}
            action={!gscDone && google && <Picker options={picks.gsc} busy={busy === 'link'} disabled={disabled} onAuto={() => link()} onPick={(v) => link({ gsc: v })} />} />
        )}
        <Row icon={<BarChart3 className="size-4" />} title="Google Analytics 4" done={ga4Done}
          detail={ga4Done ? tr('connect.linked', { name: st.ga4!.property }) : tr('connect.ga4_off')}
          error={!ga4Done ? errs.ga4 : undefined}
          action={!ga4Done && google && <Picker options={picks.ga4} busy={busy === 'link'} disabled={disabled} onAuto={() => link()} onPick={(v) => link({ ga4: v })} />} />
        <Row icon={<Sparkles className="size-4" />} title={tr('connect.geo')} done={geoDone}
          detail={!geoDone ? tr('connect.geo_off') : st.geo?.last ? tr('connect.geo_last', { n: st.geo.last.visibility ?? 0 }) : tr('connect.geo_on')}
          error={errs.geo}
          action={!geoDone ? (
            <Button size="sm" variant="outline" disabled={disabled} onClick={enableGeo}>{busy === 'geo' && <Loader2 className="animate-spin" />}{tr('connect.geo_btn')}</Button>
          ) : !st.geo?.last ? (
            <Button size="sm" variant="ghost" onClick={() => ctx.go('geo')}>{tr('connect.geo_go')}</Button>
          ) : null} />
      </div>
    </div>
  )
}

function Row({ icon, title, done, detail, error, action }: { icon: ReactNode; title: string; done: boolean; detail: string; error?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg', done ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>{done ? <Check className="size-4" /> : icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{detail}</p>
        {error && <p className="mt-0.5 text-xs leading-relaxed text-destructive">{error}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

/** 按域名自动找；找不到时（options 有了）给下拉手动选 */
function Picker({ options, busy, disabled, onAuto, onPick }: { options: { value: string; label: string; sub?: string }[] | null; busy: boolean; disabled: boolean; onAuto: () => void; onPick: (v: string) => void }) {
  const [v, setV] = useState('')
  if (!options?.length)
    return <Button size="sm" variant="outline" disabled={disabled} onClick={onAuto}>{busy && <Loader2 className="animate-spin" />}{tr('connect.auto')}</Button>
  return (
    <>
      <Select value={v || options[0].value} onChange={setV} options={options} ariaLabel={tr('connect.pick')} title={tr('connect.pick')} className="max-w-56" />
      <Button size="sm" disabled={disabled} onClick={() => onPick(v || options[0].value)}>{busy && <Loader2 className="animate-spin" />}{tr('connect.link')}</Button>
    </>
  )
}
