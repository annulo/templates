import { useEffect, useState } from 'react'
import { Check, Loader } from 'lucide-react'
import { Button, Field, Notice, PageHeader, Panel, inputCls } from '../ui'
import { runLocal, type Profile } from '../../lib/shuttle'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

/** 我的定位：四组字段共用 profile 表的一行（外贸模板的「公司资料」表单，字段换成自媒体的） */
export default function ProjectSettings({ ctx, embedded = false }: { ctx: Ctx; embedded?: boolean }) {
  const [f, setF] = useState<Profile>(ctx.profile)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setF(ctx.profile), [ctx.profile])
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false)
    setF({ ...f, [k]: e.target.value })
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await runLocal('profile.save', {
        name: f.name.trim() || ctx.profile.name,
        positioning: f.positioning ?? '', business: f.business ?? '', profile: f.profile ?? '', advantages: f.advantages ?? '',
        cooperation: f.cooperation ?? '', customer_types: f.customer_types ?? '', markets: f.markets ?? '', buyer_concerns: f.buyer_concerns ?? '',
        tone: f.tone ?? '', keywords: f.keywords ?? '', avoid: f.avoid ?? '',
      })
      setSaved(true)
      ctx.reloadProfile()
      ctx.checklist.load()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const area = (k: keyof Profile, ph: string) => <textarea value={(f[k] as string) ?? ''} onChange={set(k)} rows={2} className={`${inputCls} min-h-16 py-2`} placeholder={tr(ph)} />
  const line = (k: keyof Profile, ph: string) => <input value={(f[k] as string) ?? ''} onChange={set(k)} className={`${inputCls} h-9`} placeholder={tr(ph)} />
  return (
    <div className="space-y-6">
      {/* 嵌在「我的定位」页里时页面已经有标题，不再重复一个 */}
      {!embedded && <PageHeader title={tr('settings.title')} desc={tr('settings.desc')} />}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="max-w-3xl space-y-4">
        <Panel title={tr('settings.overview')} className="space-y-4">
          <Field label={tr('settings.name')}>{line('name', 'settings.name_ph')}</Field>
          <Field label={tr('settings.positioning')}>{line('positioning', 'settings.positioning_ph')}</Field>
          <Field label={tr('settings.business')}>{area('business', 'settings.business_ph')}</Field>
          <Field label={tr('settings.about')} hint={tr('settings.about_hint')}>{area('profile', 'settings.about_ph')}</Field>
        </Panel>
        <Panel title={tr('settings.strengths')} className="space-y-4">
          <Field label={tr('settings.advantages')}>{area('advantages', 'settings.advantages_ph')}</Field>
          <Field label={tr('settings.cooperation')}>{area('cooperation', 'settings.cooperation_ph')}</Field>
        </Panel>
        <Panel title={tr('settings.customers')} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr('settings.customer_types')}>{line('customer_types', 'settings.customer_types_ph')}</Field>
            <Field label={tr('settings.markets')}>{line('markets', 'settings.markets_ph')}</Field>
          </div>
          <Field label={tr('settings.buyer_concerns')}>{area('buyer_concerns', 'settings.buyer_concerns_ph')}</Field>
        </Panel>
        <Panel title={tr('settings.brand_content')} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr('settings.tone')}>{line('tone', 'settings.tone_ph')}</Field>
            <Field label={tr('settings.keywords')} hint={tr('settings.comma')}>{line('keywords', 'settings.keywords_ph')}</Field>
          </div>
          <Field label={tr('settings.avoid')}>{area('avoid', 'settings.avoid_ph')}</Field>
        </Panel>
      </div>
      {/* 保存钉在视口底部：表单长，改了上面的字段不用滚到底。-bottom-4 和 -mx 抵掉滚动区（pages/Index.tsx）的内边距，左右铺满、下面不漏 */}
      <div className="sticky -bottom-4 z-20 -mx-4 -mb-4 flex items-center gap-3 border-t border-border bg-background px-4 py-3 md:-mx-6 md:px-6">
        <Button fn="profile.save" successLabel={tr('ui.saved')} onClick={save} disabled={busy}>
          {busy ? <Loader className="animate-spin" /> : saved ? <Check /> : null}
          {saved ? tr('settings.saved') : tr('common.save')}
        </Button>
      </div>
    </div>
  )
}
