import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'talizen'
import { FileText, Lightbulb, Share2, UserRound } from 'lucide-react'
import { db, onRefresh } from '../lib/annulo'
import { loadAccounts, type Account } from '../lib/social'
import type { Ctx, View } from '../lib/ctx'
import { cn } from '../lib/utils'
import Profile from '../components/views/Profile'
import Ideas from '../components/views/Ideas'
import Drafts from '../components/views/Drafts'
import Accounts from '../components/views/Accounts'

const VIEWS: { id: View; icon: typeof FileText }[] = [
  { id: 'drafts', icon: FileText },
  { id: 'ideas', icon: Lightbulb },
  { id: 'accounts', icon: Share2 },
  { id: 'profile', icon: UserRound },
]

// 当前视图和参数放在地址的查询参数里（?view=drafts&draft=<id>）：刷新、助手改完代码后页面重载都还在原处
const readParams = () => new URLSearchParams(typeof location === 'undefined' ? '' : location.search)

export default function Studio() {
  const t = useTranslations('nav')
  const [params, setParams] = useState(readParams)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [plugin, setPlugin] = useState(true)
  const [hasProfile, setHasProfile] = useState(true)
  const [inApp, setInApp] = useState(true)

  const reloadAccounts = useCallback(() => {
    loadAccounts().then((r) => {
      setAccounts(r.accounts)
      setPlugin(r.plugin)
    })
  }, [])
  const reloadProfile = useCallback(() => {
    db.list('profile')
      .then((l) => setHasProfile(l.length > 0))
      .catch(() => setInApp(false))
  }, [])
  useEffect(() => {
    setParams(readParams())
    reloadAccounts()
    reloadProfile()
    const off = onRefresh(() => {
      reloadAccounts()
      reloadProfile()
    })
    const pop = () => setParams(readParams())
    addEventListener('popstate', pop)
    return () => {
      off()
      removeEventListener('popstate', pop)
    }
  }, [reloadAccounts, reloadProfile])

  const go = (view: View, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ view, ...extra })
    history.pushState(null, '', '?' + p.toString())
    setParams(p)
  }
  const view = (VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'drafts') as View
  const ctx: Ctx = { accounts, plugin, reloadAccounts, hasProfile, go, params }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-6">
          <h1 className="text-base font-semibold tracking-tight">{t('title')}</h1>
          <nav className="flex flex-wrap gap-1">
            {VIEWS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-current={view === id ? 'page' : undefined}
                className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors', view === id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}
              >
                <Icon className="size-4" />
                {t(id)}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        {!inApp ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{t('notInApp')}</p>
        ) : view === 'ideas' ? (
          <Ideas ctx={ctx} />
        ) : view === 'accounts' ? (
          <Accounts ctx={ctx} />
        ) : view === 'profile' ? (
          <Profile onSaved={reloadProfile} />
        ) : (
          <Drafts ctx={ctx} />
        )}
      </main>
    </div>
  )
}
