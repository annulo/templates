import { useState } from 'react'
import { Languages, Loader2, RefreshCw } from 'lucide-react'
import { Button } from './ui'
import EditSiteButton from './EditSiteButton'
import { localeName } from './ArticleLanguages'
import { runLocal, type Channel } from '../lib/shuttle'
import { isEn, tr } from '../lib/i18n'

// 网站设置里的语言一栏（docs/multilingual.md）：creght 站点开了哪些语言（从站点页面读，不让用户填）。
// 没开多语言的，引导去 creght 编辑器里开（后台不改站点代码），开好回来点「重新读取」。

type WithLocales = Channel & { locales?: string; default_locale?: string; locales_read_at?: string; translations_review?: boolean }

const parse = (v?: string): string[] => {
  try {
    const l = JSON.parse(v || '[]')
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}

export default function SiteLanguages({ channel, onChanged }: { channel: Channel; onChanged: () => void }) {
  const ch = channel as WithLocales
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  if (ch.type !== 'creght_site') return null
  const locales = parse(ch.locales)
  const multi = locales.length > 1
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setErr('')
    try {
      await fn()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  const read = () => act('read', () => runLocal('languages.read', { channel_id: ch.id }))
  return (
    <div className="flex flex-col gap-2 text-sm md:flex-row md:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-semibold"><Languages className="size-4 text-muted-foreground" />{tr('langs.site_title')}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {!ch.locales_read_at
            ? tr('langs.site_unread')
            : multi
              ? tr('langs.site_multi', { langs: locales.map((l) => (l === ch.default_locale ? tr('langs.with_default', { lang: localeName(l) }) : localeName(l))).join(isEn() ? ', ' : '、') })
              : tr('langs.site_single')}
        </p>
        {multi && (
          <label className="mt-2 flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={!!ch.translations_review} disabled={!!busy} onChange={(e) => void act('review', () => runLocal('languages.setReview', { channel_id: ch.id, review: e.target.checked }))} />
            {tr('langs.review_only')}
          </label>
        )}
        {err && <p className="mt-1 text-xs text-destructive [overflow-wrap:anywhere]">{err}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-start gap-2">
        {!multi && ch.locales_read_at && <EditSiteButton channelId={ch.id} />}
        <Button size="sm" variant="outline" onClick={read} disabled={!!busy}>
          {busy === 'read' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {ch.locales_read_at ? tr('langs.reread') : tr('langs.read')}
        </Button>
      </div>
    </div>
  )
}
