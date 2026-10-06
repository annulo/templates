import { Suspense, useState } from 'react'
import { ArrowLeft, Check, Loader2, MessageSquareText, Sparkles } from 'lucide-react'
import { WIZARD_SCREENS } from '../../lib/edition'
import { tr } from '../../lib/i18n'
import { openChat, runLocal } from '../../lib/shuttle'
import type { ChecklistData } from '../../lib/useChecklist'
import type { Ctx, View } from '../views/types'
import { Button, Notice, Skeleton } from '../ui'
import RunButton from '../RunButton'
import { TaskButton } from '../Task'

/** 只有行业标了 wizard 的步骤才自动显示；进度始终来自业务数据。 */
export default function Wizard({ ctx, onExit, initialStep }: { ctx: Ctx; onExit: () => void; initialStep?: string | null }) {
  const { data, setData, error, setError, load } = ctx.checklist
  const [picked, setPicked] = useState<string | null>(initialStep ?? null)
  const [busy, setBusy] = useState(false)
  const [stepBusy, setStepBusy] = useState(false)
  const [chatId, setChatId] = useState('') // 正在跑的解析任务的对话
  const [siteCanContinue, setSiteCanContinue] = useState(false)
  const wizard = data?.wizard
  if (!wizard) return null
  const steps = wizard.steps
  // 已有资料可能让两步都被标记完成，此时 current 为 null，仍应能查看简报。
  const step = steps.find((s) => s.key === picked) ?? steps.find((s) => s.key === wizard.current) ?? steps.find((s) => !s.done) ?? steps[steps.length - 1]
  const index = step ? steps.indexOf(step) : steps.length
  const refresh = () => { setPicked(steps[index + 1]?.key ?? null); ctx.reloadProfile(); ctx.reloadChannels(); load() }
  const finish = async () => {
    setData(await runLocal<ChecklistData>('today.closeWizard', {}))
    ctx.reloadProfile()
    onExit()
  }
  const call = async (fn: string, input: unknown, exit = false) => {
    setBusy(true)
    setError('')
    try {
      const result = await runLocal<ChecklistData>(fn, input)
      setData(result)
      setPicked(null)
      if (exit || (fn === 'today.skip' && !result.wizard?.current)) {
        if (!exit) setData(await runLocal<ChecklistData>('today.closeWizard', {}))
        onExit()
      }
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const skip = () => step && call('today.skip', { key: step.key })
  const Screen = step?.screen ? WIZARD_SCREENS[step.screen] : undefined
  const siteLoading = step?.key === 'site' && stepBusy
  return (
    <main className="relative flex h-dvh min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-8">
        <span className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary-text" />{tr('wizard.title')}</span>
        <Button variant="ghost" size="sm" disabled={busy || stepBusy} onClick={() => call('today.closeWizard', {}, true)}>{tr('wizard.later')}</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:py-12">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{tr('wizard.progress', { n: Math.min(index + 1, steps.length), total: steps.length })}</p>
            <progress className="setup-progress block h-1.5 w-full overflow-hidden rounded-full" value={steps.filter((s) => s.done || s.skipped).length} max={steps.length || 1} aria-label={tr('wizard.title')} />
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          {step ? <section key={step.key} className="space-y-6">
            <div className="space-y-3"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{step.title}</h1><p className="text-sm leading-relaxed text-muted-foreground">{step.why}</p>{step.minutes && <p className="text-xs text-muted-foreground">{tr('today.minutes', { n: step.minutes })}</p>}</div>
            {Screen ? <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}><Screen ctx={ctx} step={step} onDone={refresh} onSkip={skip} onFinish={finish} onBusyChange={(b) => { setStepBusy(b); if (!b) setChatId('') }} onCanContinueChange={setSiteCanContinue} onChat={setChatId} /></Suspense> : step.done ? <Notice><Check className="mr-2 inline size-4" />{tr('wizard.step_done')}</Notice> : <div className="flex flex-wrap gap-3">
              {step.action.kind === 'run' ? <RunButton fn={step.action.fn} input={step.action.input ?? {}} onDone={refresh}>{step.action_label}</RunButton> : step.action.kind === 'task' ? <TaskButton task={step.action.task} input={step.action.input} onFinished={refresh} icon={Sparkles}>{step.action_label}</TaskButton> : <Button onClick={() => step.action.kind === 'go' && ctx.go(step.action.view as View, step.action.params)}>{step.action_label}</Button>}
              {step.ask && <TaskButton task={step.ask.task} input={step.ask.input} onFinished={refresh} variant="outline" icon={Sparkles}>{tr('today.ask')}</TaskButton>}
            </div>}
          </section> : null}
        </div>
      </div>
      <footer className="shrink-0 border-t border-border px-5 py-4">
        <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" disabled={busy || stepBusy || index === 0} onClick={() => setPicked(steps[index - 1]?.key ?? null)}><ArrowLeft />{tr('wizard.back')}</Button>
          {step?.key === 'profile' ? <Button type="submit" form="creator-profile" feedback={false} disabled={busy || stepBusy}>{stepBusy && <Loader2 className="size-4 animate-spin" />}{tr('onboarding.next')}</Button> : step && !step.done && <Button variant="ghost" disabled={busy} onClick={skip}>{tr('today.skip')}</Button>}
        </div>
      </footer>
      {siteLoading && <div role="status" aria-live="polite" className="absolute inset-0 z-50 flex items-center justify-center bg-background px-6 text-center">
        <div className="flex max-w-md flex-col items-center gap-5">
          <div className="flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-primary-text"><Loader2 className="size-10 animate-spin" /></div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{tr('onboarding.extracting_title')}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{tr('onboarding.extracting_wait')}</p>
          </div>
          {chatId && <Button variant="outline" size="sm" onClick={() => openChat(chatId)}><MessageSquareText />{tr('onboarding.view_chat')}</Button>}
        </div>
      </div>}
    </main>
  )
}
