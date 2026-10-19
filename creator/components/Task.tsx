import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Loader2, MessageSquareText, Pencil, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import Markdown from './Markdown'
import { Button, Dialog, ErrorDetails, Field, Notice, cx, inputCls } from './ui'
import { getTask, listTasks, openChat, resetPrompt, runTask, savePrompt, type Task, type TaskRun } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { useAssistant } from '../lib/useShuttle'

/**
 * 项目的任务（tasks/<id>.md）：写周报、写文章这类长流程交给助手，在一段对话里跑，过程看得见。
 * useTask 轮询任务状态，running 变少了（有一次跑完）就调 onFinished 让页面重拉数据。
 */
export function useTask(id: string, onFinished?: () => void) {
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const shuttle = useAssistant()
  const prev = useRef(0)
  const done = useRef(onFinished)
  done.current = onFinished

  const apply = useCallback((t: Task) => {
    setTask(t)
    if (t.running.length < prev.current) done.current?.()
    prev.current = t.running.length
  }, [])
  const load = useCallback(() => {
    if (!shuttle) return
    getTask(id)
      .then(apply)
      .catch(() => {})
  }, [id, shuttle, apply])
  useEffect(() => {
    load()
    // 在跑的时候看得勤一点
    const t = window.setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])

  /** 开一段对话交给助手；成功返回对话 id */
  const run = async (input?: unknown) => {
    setStarting(true)
    setError('')
    try {
      const r = await runTask(id, input)
      apply(r.task)
      return r.chat_id
    } catch (e) {
      setError((e as Error).message)
      return ''
    } finally {
      setStarting(false)
    }
  }
  return { task, setTask, error, starting, run, reload: load, shuttle }
}

/**
 * 几个任务里符合条件的正在跑的（比如这篇文章的社媒改写，跨小红书、X 两个任务），有一次跑完就调 onFinished。
 * 也返回这几个任务本身（给 TaskRequirements 用）。
 */
export function useTaskRuns(ids: string[], match: (r: TaskRun) => boolean = () => true, onFinished?: () => void) {
  const [tasks, setTasks] = useState<Task[]>([])
  const shuttle = useAssistant()
  const prev = useRef(0)
  const done = useRef({ onFinished, match })
  done.current = { onFinished, match }
  const key = ids.join(',')
  const load = useCallback(() => {
    if (!shuttle) return
    listTasks()
      .then((l) => {
        const mine = l.filter((t) => key.split(',').includes(t.id))
        setTasks(mine)
        const n = mine.flatMap((t) => t.running).filter((r) => done.current.match(r)).length
        if (n < prev.current) done.current.onFinished?.()
        prev.current = n
      })
      .catch(() => {})
  }, [key, shuttle])
  useEffect(() => {
    load()
    const t = window.setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])
  const runs = tasks.flatMap((t) => t.running).filter(match)
  const setTask = (t: Task) => setTasks((l) => l.map((x) => (x.id === t.id ? t : x)))
  return { tasks, runs, reload: load, setTask, shuttle }
}

/**
 * 交给助手的任务按钮：点了开一段对话、在右侧打开（过程看得见）。
 * 这个任务有符合 match 的在跑时，按钮变成「进行中 · 查看对话」，点了打开那段对话；跑完调 onFinished。
 * 要 AI 想、要写的活都用它，不在本机函数里调模型写长内容（见 AGENTS.md「后台功能怎么分」）。
 */
export function TaskButton({
  task,
  input,
  match = () => true,
  onFinished,
  beforeRun,
  disabled = false,
  icon: Icon,
  variant = 'default',
  size = 'sm',
  className,
  children,
}: {
  task: string
  input?: unknown
  match?: (r: TaskRun) => boolean
  onFinished?: () => void
  /** 表单先校验/保存，再把返回值作为本次任务参数。 */
  beforeRun?: () => Promise<unknown>
  disabled?: boolean
  icon?: ComponentType<{ className?: string }>
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm'
  className?: string
  children: ReactNode
}) {
  const { runs, shuttle, reload } = useTaskRuns([task], match, onFinished)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const run = runs[0]
  if (run)
    return (
      <Button variant="outline" size={size} className={className} onClick={() => openChat(run.chat_id)}>
        <Loader2 className="animate-spin" /> {tr('task.running')} · {tr('task.view')}
      </Button>
    )
  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const prepared = beforeRun ? await beforeRun() : input
      const r = await runTask(task, prepared)
      openChat(r.chat_id)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }
  return (
    <span className="inline-flex max-w-full min-w-0 w-fit flex-col items-start gap-1.5">
      <Button feedback={false} variant={variant} size={size} className={className} disabled={disabled || !shuttle || starting} onClick={start}>
        {starting ? <Loader2 className="animate-spin" /> : Icon && <Icon />}
        {children}
      </Button>
      {error && <span className="w-64 min-w-0 max-w-full"><ErrorDetails message={error} /></span>}
    </span>
  )
}

/**
 * 交给助手、要用户想清楚再跑的按钮（和内容中心「出一批选题」一样）：点了先弹窗，说清这次会做什么，
 * 写这一次的要求（灰字是这件任务的默认写法，不填就照它做；「改默认要求」改的是以后每次都用的），点「开始」才开一段对话交给助手。
 * 这次的要求作为参数 reqKey 传给任务，任务文件里要写明怎么用它。在跑时按钮变成「进行中 · 查看对话」。
 */
export function TaskLaunchButton({
  task: id,
  input,
  reqKey = 'requirements',
  match = () => true,
  onFinished,
  title,
  desc,
  reqTitle,
  reqHint,
  startLabel,
  icon: Icon,
  variant = 'default',
  size = 'sm',
  className,
  children,
}: {
  task: string
  input?: Record<string, unknown>
  reqKey?: string
  match?: (r: TaskRun) => boolean
  onFinished?: () => void
  /** 弹窗标题、这次会做什么（一两句：交给谁、读什么、结果存到哪） */
  title: string
  desc: ReactNode
  /** 「改默认要求」那个弹窗的标题和说明（TaskRequirements） */
  reqTitle: string
  reqHint: string
  startLabel: string
  icon?: ComponentType<{ className?: string }>
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm'
  className?: string
  children: ReactNode
}) {
  const t = useTask(id, onFinished)
  const [req, setReq] = useState<string | null>(null)
  const [editDefault, setEditDefault] = useState(false)
  const run = t.task?.running.find(match)
  if (run)
    return (
      <Button variant="outline" size={size} className={className} onClick={() => openChat(run.chat_id)}>
        <Loader2 className="animate-spin" /> {tr('task.running')} · {tr('task.view')}
      </Button>
    )
  const start = async () => {
    const r = req?.trim()
    const chat = await t.run({ ...input, ...(r ? { [reqKey]: r } : {}) })
    if (chat) {
      setReq(null)
      openChat(chat)
    }
  }
  const hasDefault = !!t.task && !!(t.task.prompt_file || t.task.prompt_has_default)
  return (
    <>
      <Button feedback={false} variant={variant} size={size} className={className} disabled={!t.shuttle || !t.task} onClick={() => setReq('')}>
        {Icon && <Icon />}
        {children}
      </Button>
      <Dialog
        open={req !== null}
        onClose={() => setReq(null)}
        title={title}
        width={640}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReq(null)}>
              {tr('common.cancel')}
            </Button>
            <Button feedback={false} onClick={start} disabled={t.starting}>
              {t.starting ? <Loader2 className="animate-spin" /> : Icon && <Icon />}
              {startLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="text-sm leading-relaxed text-muted-foreground">{desc}</div>
          <Field label={tr('task.this_time')} hint={hasDefault ? tr('task.this_time_hint') : undefined}>
            <textarea autoFocus value={req ?? ''} placeholder={t.task?.prompt ?? ''} onChange={(e) => setReq(e.target.value)} rows={8} className={cx(inputCls, 'py-2 leading-relaxed')} />
          </Field>
          {hasDefault && (
            <button type="button" onClick={() => setEditDefault(true)} className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {tr('task.edit_default')}
            </button>
          )}
          {t.error && <ErrorDetails message={t.error} />}
        </div>
      </Dialog>
      <TaskRequirements task={t.task} onSaved={t.setTask} title={reqTitle} hint={reqHint} open={editDefault} onOpenChange={setEditDefault} editOnly />
    </>
  )
}

/** 正在跑的任务：一行一个，带「查看对话」（在右侧打开那段对话） */
/** desc 可以按这次运行给（比如显示用户交代的那句要求），没给就不显示 */
export function TaskRunning({ runs, title, desc }: { runs: TaskRun[]; title: (r: TaskRun) => string; desc?: string | ((r: TaskRun) => string) }) {
  if (!runs.length) return null
  return (
    <div className="space-y-2">
      {runs.map((r) => (
        <div key={r.chat_id} className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary-text" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{title(r)}</div>
            {(() => { const d = typeof desc === 'function' ? desc(r) : desc; return d ? <p className="mt-0.5 truncate text-xs text-muted-foreground" title={d}>{d}</p> : null })()}
          </div>
          <Button variant="outline" size="sm" onClick={() => openChat(r.chat_id)}>
            <MessageSquareText /> {tr('task.view')}
          </Button>
        </div>
      ))}
    </div>
  )
}

/** 最近一次失败：可以手动关闭；关闭只隐藏本次运行的提示，不删除任务记录。 */
export function TaskFailed({ task }: { task: Task | null }) {
  const last = task?.last
  if (!last || last.ok || task.running.length) return null
  return <TaskFailureNotice key={`${last.chat_id}:${last.started_at}`} run={last} />
}

function TaskFailureNotice({ run }: { run: TaskRun }) {
  const storageKey = `shuttle.task-failure.dismissed:${run.chat_id}:${run.started_at}`
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1' } catch { return false }
  })
  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem(storageKey, '1') } catch { /* 存储不可用时仍能关闭本页提示 */ }
  }
  if (dismissed) return null
  return (
    <Notice tone="error">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          {tr('task.failed', { error: run.error ?? '' })}
          <button type="button" className="ml-2 font-semibold underline underline-offset-2" onClick={() => openChat(run.chat_id)}>
            {tr('task.view')}
          </button>
        </div>
        <button type="button" className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-destructive/10 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={tr('common.close')} title={tr('common.close')} onClick={dismiss}><X className="size-3.5" /></button>
      </div>
    </Notice>
  )
}

/** 任务的「要求」：用户自己能改的说明（就是 tasks/<id>.md 的正文），改完下一次就照新的做 */
/**
 * 需求类任务的「AI 要求」：放在发起任务的按钮旁边的小按钮，点开弹窗，显示、编辑这个任务的「怎么写」。
 * 模板默认的在 prompts/<id>.md，用户改了存到 user/prompts/<id>.md（能恢复默认）；任务文件本身是系统流程，不给看。
 * 没有「怎么写」的任务（系统任务）不显示。
 */
/** editOnly：打开就是编辑框（从「改默认要求」这种明确要改的入口进来），取消、保存后直接关掉，没有只看的那一步 */
export function TaskRequirements({ task, onSaved, title, hint, label, open: controlledOpen, onOpenChange, editOnly = false }: { task: Task | null; onSaved: (t: Task) => void; title: string; hint: string; label?: string; open?: boolean; onOpenChange?: (open: boolean) => void; editOnly?: boolean }) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open || !editOnly || !task) return
    setDraft(task.prompt)
    setError('')
    setEditing(true)
  }, [open, editOnly])
  if (!task || !(task.prompt_file || task.prompt_has_default)) return null
  const text = task.prompt

  const close = () => {
    setOpen(false)
    setEditing(false)
    setError('')
  }
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      onSaved(await savePrompt(task.id, draft))
      if (editOnly) close()
      else setEditing(false)
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }
  const reset = async () => {
    setSaving(true)
    setError('')
    try {
      onSaved(await resetPrompt(task.id))
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      {controlledOpen === undefined && <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title={title} className="text-muted-foreground">
        <SlidersHorizontal /> {label ?? tr('task.ai_settings')}
      </Button>}
      <Dialog
        open={open}
        onClose={close}
        title={title}
        width={640}
        footer={
          editing ? (
            <>
              <Button variant="ghost" onClick={() => (editOnly ? close() : setEditing(false))} disabled={saving}>
                {tr('common.cancel')}
              </Button>
              <Button successLabel={tr('ui.saved')} onClick={save} disabled={saving || !draft.trim()}>
                {saving && <Loader2 className="animate-spin" />}
                {tr('common.save')}
              </Button>
            </>
          ) : (
            <>
              {task.prompt_custom && task.prompt_has_default && (
                <Button variant="ghost" onClick={reset} disabled={saving} className="mr-auto text-muted-foreground">
                  <RotateCcw /> {tr('task.reset')}
                </Button>
              )}
              <Button variant="ghost" onClick={close}>
                {tr('common.close')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(text)
                  setError('')
                  setEditing(true)
                }}
              >
                <Pencil /> {tr('task.edit')}
              </Button>
            </>
          )
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {hint}
          {task.prompt_custom && ` ${tr('task.custom_note')}`}
        </p>
        {editing ? (
          <div className="space-y-3">
            <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={14} className={`${inputCls} py-2 text-sm leading-relaxed`} />
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {text ? <Markdown text={text} className="text-sm" /> : <p className="text-sm text-muted-foreground">{tr('task.prompt_empty')}</p>}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        )}
      </Dialog>
    </>
  )
}
