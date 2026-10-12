import { useCallback, useEffect, useState } from 'react'
import { runLocal, type Profile, type Channel, type CreghtSite } from './shuttle'
import type { CompanyDraft, Competitor, Onboarding } from '../local/_onboarding'

export type { Competitor }
export type OnboardingData = Omit<Onboarding, 'competitors' | 'candidates' | 'audit_result' | 'company_draft'> & {
  competitors: Competitor[]; candidates: Competitor[]
  company_draft: CompanyDraft | null
  audit_result: { score: number; pages: number; issues: { high: number; medium: number; low: number }; top: string[]; preview?: boolean; found?: { check: string; title: string; detail: string; pages: string[] }[] } | null
  profile: Profile; channel: Channel | null
}
export type SiteOption = CreghtSite & { preview_url: string }
export function useOnboarding(rev: number, poll = false) {
  const [data, setData] = useState<OnboardingData | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => runLocal<OnboardingData>('onboarding.get', {}).then((d) => { setData(d); setError('') }).catch((e: Error) => setError(e.message)), [])
  useEffect(() => { load() }, [load, rev])
  useEffect(() => { if (!poll) return; const timer = window.setInterval(load, 4000); return () => clearInterval(timer) }, [poll, load])
  return { data, setData, error, load }
}

/** 助手现在能不能跑（onboarding.ai）。打开时查一次，切回窗口时再查（用户可能刚去 设置 → 模型 配好）；check() 现查一次，读不到按能跑算 */
export function useAIReady() {
  const [ready, setReady] = useState(true)
  const [checking, setChecking] = useState(false)
  const check = useCallback(async () => {
    setChecking(true)
    try {
      const ok = await runLocal<{ ready: boolean }>('onboarding.ai', {}).then((r) => r.ready, () => true)
      setReady(ok)
      return ok
    } finally { setChecking(false) }
  }, [])
  useEffect(() => {
    void check()
    const again = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', again)
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again) }
  }, [check])
  return { ready, checking, check }
}
