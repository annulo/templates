import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { runLocal, type Profile } from '../../lib/shuttle'
import { tr } from '../../lib/i18n'
import type { WizardScreen } from './types'
import { Button, Field, Notice, inputCls } from '../ui'
import Select from '../Select'

// 起步向导的「填写定位」：照外贸模板确认简报那一屏的样子（主要的几项在前，读者用标签选，其余收在「更多」里），字段换成自媒体的
const keys = ['name', 'positioning', 'business', 'customer_types', 'tone', 'keywords', 'profile', 'avoid'] as const
type Key = (typeof keys)[number]
type Draft = Record<Key, string>
const split = (value: string) => value.split(/[,，、;；\n]+/).map((part) => part.trim()).filter(Boolean)
const readerKinds = ['workers', 'students', 'parents', 'founders', 'developers', 'creators', 'small_business'] as const

const CreatorProfile: WizardScreen = ({ ctx, onFinish, onBusyChange }) => {
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(keys.map((k) => [k, (ctx.profile[k as keyof Profile] as string) ?? ''])) as Draft)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const touched = useRef(new Set<Key>())
  useEffect(() => {
    setDraft((prev) => Object.fromEntries(keys.map((k) => [k, touched.current.has(k) ? prev[k] : ((ctx.profile[k as keyof Profile] as string) ?? '')])) as Draft)
  }, [ctx.profile])

  const set = (key: Key, value: string) => {
    touched.current.add(key)
    setDraft((previous) => ({ ...previous, [key]: value }))
  }
  const readers = split(draft.customer_types)
  const addReader = (value: string) => {
    const name = value.trim()
    if (name && !readers.includes(name)) set('customer_types', [...readers, name].join('、'))
    setCustom('')
  }
  const save = async () => {
    if (busy) return
    if (!draft.business.trim() || !readers.length) { setError(tr('onboarding.required_brief')); return }
    setBusy(true); onBusyChange?.(true); setError('')
    try {
      // 改过的字段，加上预填出来、还没存进表的（旧版定位换过来的）都存一次
      const patch = Object.fromEntries(keys.filter((key) => touched.current.has(key) || draft[key].trim()).map((key) => [key, key === 'customer_types' ? readers.join('、') : draft[key].trim()]))
      await runLocal('profile.save', patch)
      await runLocal('today.unskip', { key: 'profile' })
      ctx.reloadProfile()
      await onFinish()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false); onBusyChange?.(false) }
  }

  return <form id="creator-profile" className="space-y-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
    <Field label={tr('onboarding.business_label')} hint={tr('onboarding.business_hint')}>
      <textarea rows={2} value={draft.business} onChange={(e) => set('business', e.target.value)} placeholder={tr('onboarding.business_example')} className={`${inputCls} min-h-20 resize-y py-2 leading-relaxed`} />
    </Field>
    <Field label={tr('onboarding.audience_label')} hint={tr('onboarding.audience_hint')}>
      <div className="space-y-2">
        {!!readers.length && <div className="flex flex-wrap gap-1.5">{readers.map((name) => <span key={name} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs">{name}<button type="button" aria-label={`${tr('onboarding.remove_customer')} ${name}`} onClick={() => set('customer_types', readers.filter((part) => part !== name).join('、'))} className="rounded-full p-0.5 hover:bg-accent"><X className="size-3" /></button></span>)}</div>}
        <Select value="" onChange={addReader} options={readerKinds.map((key) => ({ value: tr(`onboarding.reader_${key}`), label: tr(`onboarding.reader_${key}`) })).filter((option) => !readers.includes(option.value))} placeholder={tr('onboarding.choose_customer')} ariaLabel={tr('onboarding.choose_customer')} />
        <div className="flex gap-2"><input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addReader(custom) } }} placeholder={tr('onboarding.custom_customer')} className={inputCls} /><Button type="button" variant="outline" disabled={!custom.trim()} onClick={() => addReader(custom)}>{tr('onboarding.add_customer')}</Button></div>
      </div>
    </Field>
    <Field label={tr('settings.tone')} hint={tr('onboarding.tone_hint')}>
      <input value={draft.tone} onChange={(e) => set('tone', e.target.value)} placeholder={tr('settings.tone_ph')} className={inputCls} />
    </Field>
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">{tr('onboarding.more_details')}</summary><div className="mt-4 space-y-4">
      <Field label={tr('settings.name')}><input value={draft.name} onChange={(e) => set('name', e.target.value)} className={inputCls} /></Field>
      <Field label={tr('settings.positioning')}><input value={draft.positioning} onChange={(e) => set('positioning', e.target.value)} placeholder={tr('settings.positioning_ph')} className={inputCls} /></Field>
      <Field label={tr('settings.about')} hint={tr('settings.about_hint')}><textarea rows={3} value={draft.profile} onChange={(e) => set('profile', e.target.value)} placeholder={tr('settings.about_ph')} className={`${inputCls} min-h-20 py-2`} /></Field>
      <Field label={tr('settings.keywords')} hint={tr('settings.comma')}><input value={draft.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder={tr('settings.keywords_ph')} className={inputCls} /></Field>
      <Field label={tr('settings.avoid')}><input value={draft.avoid} onChange={(e) => set('avoid', e.target.value)} placeholder={tr('settings.avoid_ph')} className={inputCls} /></Field>
    </div></details>
    {error && <Notice tone="error">{error}</Notice>}
    <p className="text-xs leading-relaxed text-muted-foreground">{tr('onboarding.details_hint')}</p>
  </form>
}
export default CreatorProfile
