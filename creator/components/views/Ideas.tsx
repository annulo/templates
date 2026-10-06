import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'talizen'
import { ArrowRight, PenLine, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { db, onRefresh, type Row } from '../../lib/annulo'
import type { Ctx } from '../../lib/ctx'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { confirm } from '../ui/confirm'
import { TaskButton, TaskRequirements, TaskRunning, useTaskRuns } from '../Task'

export type Idea = Row & { title: string; angle?: string; notes?: string; status?: 'idea' | 'drafting' | 'dropped'; source?: string }
type Draft = Row & { idea_id?: string }

const FILTERS = ['idea', 'drafting', 'dropped'] as const

/** 选题：AI 出一批（任务 suggest-ideas），或者自己记；挑一个交给 AI 写成稿件（任务 write-draft） */
export default function Ideas({ ctx }: { ctx: Ctx }) {
  const t = useTranslations('ideas')
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('idea')
  const [hint, setHint] = useState('')
  const [title, setTitle] = useState('')
  const [angle, setAngle] = useState('')

  const load = useCallback(() => {
    db.list<Idea>('ideas').then(setIdeas)
    db.list<Draft>('drafts').then(setDrafts)
  }, [])
  useEffect(() => {
    load()
    return onRefresh(load)
  }, [load])
  const suggest = useTaskRuns(['suggest-ideas'])
  const writing = useTaskRuns(['write-draft'], () => true, load)

  const add = async () => {
    if (!title.trim()) return
    const now = new Date().toISOString()
    await db.create('ideas', { title: title.trim(), angle: angle.trim(), status: 'idea', source: 'manual', created_at: now, updated_at: now })
    setTitle('')
    setAngle('')
    load()
  }
  const setStatus = async (i: Idea, status: Idea['status']) => {
    await db.update('ideas', i.id, { status, updated_at: new Date().toISOString() })
    load()
  }
  const remove = async (i: Idea) => {
    if (!(await confirm({ title: t('confirmDelete', { title: i.title }), danger: true }))) return
    await db.remove('ideas', i.id)
    load()
  }

  const shown = ideas.filter((i) => (i.status ?? 'idea') === filter)
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('desc')}</p>
      </div>

      {!ctx.hasProfile && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          {t('noProfile')}{' '}
          <button type="button" className="font-medium text-primary-text hover:underline" onClick={() => ctx.go('profile')}>
            {t('fillProfile')}
          </button>
        </p>
      )}

      <section className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder={t('hintPlaceholder')} className="min-w-0 flex-1" />
          <TaskButton task="suggest-ideas" input={{ hint }} icon={Sparkles} onFinished={load}>
            {t('suggest')}
          </TaskButton>
          <TaskRequirements task={suggest.tasks[0]} onSaved={suggest.setTask} />
        </div>
        <p className="text-xs text-muted-foreground">{t('suggestHint')}</p>
      </section>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('titlePlaceholder')} className="min-w-48 flex-[2]" />
        <Input value={angle} onChange={(e) => setAngle(e.target.value)} placeholder={t('anglePlaceholder')} className="min-w-48 flex-[3]" />
        <Button type="submit" variant="outline" disabled={!title.trim()}>
          <Plus /> {t('add')}
        </Button>
      </form>

      <TaskRunning runs={writing.runs} title={(r) => t('writingRun', { title: ideas.find((i) => i.id === r.input?.idea_id)?.title ?? '' })} />

      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={cn('rounded-md px-2.5 py-1 text-xs', filter === f ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60')}>
            {t(`filter.${f}`)} · {ideas.filter((i) => (i.status ?? 'idea') === f).length}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border">
        {shown.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">{t(`empty.${filter}`)}</li>}
        {shown.map((i) => {
          const draft = drafts.find((d) => d.idea_id === i.id)
          return (
            <li key={i.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-medium">{i.title}</div>
                {i.angle && <p className="text-xs leading-relaxed text-muted-foreground">{i.angle}</p>}
                {i.notes && <p className="text-xs leading-relaxed text-muted-foreground/80">{i.notes}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {draft ? (
                  <Button variant="outline" size="sm" onClick={() => ctx.go('drafts', { draft: draft.id })}>
                    {t('openDraft')} <ArrowRight />
                  </Button>
                ) : i.status === 'dropped' ? (
                  <Button variant="ghost" size="sm" onClick={() => setStatus(i, 'idea')}>
                    <RotateCcw /> {t('restore')}
                  </Button>
                ) : (
                  <>
                    <TaskButton task="write-draft" input={{ idea_id: i.id }} match={(r) => r.input?.idea_id === i.id} onFinished={load} icon={PenLine} variant="outline">
                      {t('write')}
                    </TaskButton>
                    <Button variant="ghost" size="icon-sm" title={t('drop')} onClick={() => setStatus(i, 'dropped')}>
                      <X />
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="icon-sm" title={t('delete')} className="text-muted-foreground hover:text-destructive" onClick={() => remove(i)}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
