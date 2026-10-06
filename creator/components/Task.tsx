import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'talizen'
import { Loader2, MessageSquareText, Pencil, RotateCcw, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { openChat, tasks, type Task, type TaskRun } from '../lib/annulo'
import { Button } from './ui/button'
import { Textarea } from './ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Markdown } from './Markdown'

// 任务（tasks/<id>.md）：出选题、写稿这类要 AI 想、要写的活。按钮点了新开一段对话交给右侧的助手，过程看得见；
// 跑的时候按钮变成「进行中 · 看过程」，跑完页面重拉数据。不在本机函数里调模型写长内容。

/** 几个任务里符合 match 的正在跑的；有一次跑完就调 onFinished。也返回这几个任务本身（给「AI 要求」用） */
export function useTaskRuns(ids: string[], match: (r: TaskRun) => boolean = () => true, onFinished?: () => void) {
  const [list, setList] = useState<Task[]>([])
  const prev = useRef(0)
  const latest = useRef({ match, onFinished })
  latest.current = { match, onFinished }
  const key = ids.join(',')
  const load = useCallback(() => {
    tasks
      .list()
      .then((all) => {
        const mine = all.filter((t) => key.split(',').includes(t.id))
        setList(mine)
        const n = mine.flatMap((t) => t.running).filter((r) => latest.current.match(r)).length
        if (n < prev.current) latest.current.onFinished?.()
        prev.current = n
      })
      .catch(() => {})
  }, [key])
  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])
  const runs = list.flatMap((t) => t.running).filter(match)
  const setTask = (t: Task) => setList((l) => l.map((x) => (x.id === t.id ? t : x)))
  return { tasks: list, runs, reload: load, setTask }
}

/** 交给助手的按钮。正在跑（符合 match 的）时变成「进行中 · 看过程」 */
export function TaskButton({
  task,
  input,
  match,
  onFinished,
  icon: Icon,
  variant = 'default',
  size = 'sm',
  disabled,
  children,
}: {
  task: string
  input?: unknown
  match?: (r: TaskRun) => boolean
  onFinished?: () => void
  icon?: LucideIcon
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'sm' | 'default'
  disabled?: boolean
  children: ReactNode
}) {
  const t = useTranslations('task')
  const { runs, reload } = useTaskRuns([task], match, onFinished)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  if (runs[0])
    return (
      <Button variant="outline" size={size} onClick={() => openChat(runs[0].chat_id)}>
        <Loader2 className="animate-spin" /> {t('running')}
      </Button>
    )
  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const r = await tasks.run(task, input)
      openChat(r.chat_id)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <Button variant={variant} size={size} disabled={disabled || starting} onClick={start}>
        {starting ? <Loader2 className="animate-spin" /> : Icon && <Icon />}
        {children}
      </Button>
      {error && <span className="max-w-80 text-xs text-destructive [overflow-wrap:anywhere]">{error}</span>}
    </span>
  )
}

/** 正在跑的任务，一行一个，带「看过程」 */
export function TaskRunning({ runs, title }: { runs: TaskRun[]; title: (r: TaskRun) => string }) {
  const t = useTranslations('task')
  if (!runs.length) return null
  return (
    <div className="space-y-2">
      {runs.map((r) => (
        <div key={r.chat_id} className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary-text" />
          <span className="min-w-0 flex-1 truncate">{title(r)}</span>
          <Button variant="outline" size="sm" onClick={() => openChat(r.chat_id)}>
            <MessageSquareText /> {t('view')}
          </Button>
        </div>
      ))}
    </div>
  )
}

/**
 * 「AI 要求」：放在发起任务的按钮旁边，点开看、改这个任务的「怎么写」。
 * 默认的在 prompts/<id>.md（模板的），用户改了存 user/prompts/<id>.md（插件的任务存 user/plugins/<插件>/prompts/），能恢复默认。
 */
/** label：按钮上的字，同一处有好几个时写清楚是哪个（「写稿要求」「X 的写法」），默认「AI 要求」 */
export function TaskRequirements({ task, onSaved, label }: { task?: Task; onSaved: (t: Task) => void; label?: string }) {
  const t = useTranslations('task')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!task || !(task.prompt_file || task.prompt_has_default)) return null
  const wrap = async (fn: () => Promise<Task>) => {
    setBusy(true)
    setError('')
    try {
      onSaved(await fn())
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}>
        <SlidersHorizontal /> {label ?? t('requirements')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setEditing(false)
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('requirementsTitle', { name: task.name })}</DialogTitle>
            <DialogDescription>{task.prompt_custom ? t('requirementsCustom') : t('requirementsHint')}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <Textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} className="text-sm leading-relaxed" />
          ) : (
            <div className="max-h-[50vh] overflow-y-auto rounded-lg bg-muted/50 p-3">{task.prompt ? <Markdown text={task.prompt} /> : <p className="text-sm text-muted-foreground">{t('requirementsEmpty')}</p>}</div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            {editing ? (
              <>
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                  {t('cancel')}
                </Button>
                <Button onClick={() => wrap(() => tasks.savePrompt(task.id, draft))} disabled={busy || !draft.trim()}>
                  {busy && <Loader2 className="animate-spin" />} {t('save')}
                </Button>
              </>
            ) : (
              <>
                {task.prompt_custom && task.prompt_has_default && (
                  <Button variant="ghost" className="mr-auto text-muted-foreground" onClick={() => wrap(() => tasks.resetPrompt(task.id))} disabled={busy}>
                    <RotateCcw /> {t('reset')}
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft(task.prompt)
                    setEditing(true)
                  }}
                >
                  <Pencil /> {t('edit')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
