import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'talizen'
import { ArrowLeft, Check, Eye, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { db, onRefresh, type Row } from '../../lib/annulo'
import type { Ctx } from '../../lib/ctx'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input, Textarea } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { confirm } from '../ui/confirm'
import { Markdown } from '../Markdown'
import { TaskButton, TaskRequirements, useTaskRuns } from '../Task'
import Distribute from './Distribute'

export type Draft = Row & { title: string; summary?: string; body?: string; status?: 'draft' | 'ready' | 'archived'; idea_id?: string; url?: string }

const STATUSES = ['draft', 'ready', 'archived'] as const

/** 稿件：列表 + 一篇的编辑、改稿、发到社媒（?draft=<id>） */
export default function Drafts({ ctx }: { ctx: Ctx }) {
  const t = useTranslations('drafts')
  const locale = useLocale()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [title, setTitle] = useState('')
  const reqs = useTaskRuns(['write-draft', 'revise-draft'])

  const load = useCallback(() => {
    db.list<Draft>('drafts').then(setDrafts)
  }, [])
  useEffect(() => {
    load()
    return onRefresh(load)
  }, [load])

  const id = ctx.params.get('draft')
  const current = id ? drafts.find((d) => d.id === id) : undefined
  if (id && current) return <Editor key={current.id} ctx={ctx} draft={current} onChanged={load} reqs={reqs} />

  const create = async () => {
    if (!title.trim()) return
    const now = new Date().toISOString()
    const row = await db.create('drafts', { title: title.trim(), body: '', status: 'draft', created_at: now, updated_at: now })
    setTitle('')
    load()
    ctx.go('drafts', { draft: row.id })
  }
  const sorted = [...drafts].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('desc')}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {[...reqs.tasks].sort((a, b) => (a.id === 'write-draft' ? -1 : b.id === 'write-draft' ? 1 : 0)).map((task) => (
            <TaskRequirements key={task.id} task={task} onSaved={reqs.setTask} label={t(task.id === 'write-draft' ? 'reqWrite' : 'reqRevise')} />
          ))}
        </div>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('newPlaceholder')} className="flex-1" />
        <Button type="submit" variant="outline" disabled={!title.trim()}>
          <Plus /> {t('new')}
        </Button>
      </form>

      <ul className="divide-y divide-border rounded-xl border border-border">
        {sorted.length === 0 && (
          <li className="space-y-2 px-4 py-10 text-center text-sm text-muted-foreground">
            <p>{t('empty')}</p>
            <Button variant="outline" size="sm" onClick={() => ctx.go('ideas')}>
              <Sparkles /> {t('goIdeas')}
            </Button>
          </li>
        )}
        {sorted.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => ctx.go('drafts', { draft: d.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.title}</div>
                <div className="truncate text-xs text-muted-foreground">{d.summary || t('noSummary')}</div>
              </div>
              <StatusPill status={d.status ?? 'draft'} />
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{d.updated_at ? new Date(d.updated_at).toLocaleDateString(locale) : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const t = useTranslations('drafts')
  return <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', status === 'ready' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>{t(`status.${status}`)}</span>
}

function Editor({ ctx, draft, onChanged, reqs }: { ctx: Ctx; draft: Draft; onChanged: () => void; reqs: ReturnType<typeof useTaskRuns> }) {
  const t = useTranslations('drafts')
  const [form, setForm] = useState({ title: draft.title, summary: draft.summary ?? '', body: draft.body ?? '', url: draft.url ?? '' })
  const [preview, setPreview] = useState(!!draft.body)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [request, setRequest] = useState('')
  const dirty = form.title !== draft.title || form.summary !== (draft.summary ?? '') || form.body !== (draft.body ?? '') || form.url !== (draft.url ?? '')

  // 助手改了稿件（改稿任务跑完）时，没在编辑的话跟着换成新内容
  useEffect(() => {
    if (!dirty) setForm({ title: draft.title, summary: draft.summary ?? '', body: draft.body ?? '', url: draft.url ?? '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.updated_at])

  const save = async (patch: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      await db.update('drafts', draft.id, { ...form, ...patch, updated_at: new Date().toISOString() })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!(await confirm({ title: t('confirmDelete', { title: draft.title }), description: t('confirmDeleteHint'), danger: true }))) return
    await db.remove('drafts', draft.id)
    onChanged()
    ctx.go('drafts')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => ctx.go('drafts')}>
          <ArrowLeft /> {t('back')}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={draft.status ?? 'draft'} onValueChange={(v) => save({ status: v })}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => save()} disabled={busy || !dirty}>
            {busy ? <Loader2 className="animate-spin" /> : saved && <Check />}
            {saved ? t('saved') : t('save')}
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('delete')} className="text-muted-foreground hover:text-destructive" onClick={remove}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="h-11 text-lg font-semibold" />
        <Input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder={t('summaryPlaceholder')} />
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Button variant={preview ? 'ghost' : 'secondary'} size="sm" onClick={() => setPreview(false)}>
              <Pencil /> {t('edit')}
            </Button>
            <Button variant={preview ? 'secondary' : 'ghost'} size="sm" onClick={() => setPreview(true)}>
              <Eye /> {t('preview')}
            </Button>
          </div>
          {preview ? (
            <div className="min-h-64 rounded-lg border border-border p-4">{form.body ? <Markdown text={form.body} /> : <p className="text-sm text-muted-foreground">{t('bodyEmpty')}</p>}</div>
          ) : (
            <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={t('bodyPlaceholder')} rows={20} className="font-mono text-[13px] leading-relaxed" />
          )}
        </div>
        <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={t('urlPlaceholder')} className="font-mono text-xs" />
      </div>

      <section className="space-y-2 rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold">{t('revise')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={request} onChange={(e) => setRequest(e.target.value)} placeholder={t('revisePlaceholder')} className="min-w-0 flex-1" />
          <TaskButton task="revise-draft" input={{ draft_id: draft.id, request }} match={(r) => r.input?.draft_id === draft.id} onFinished={onChanged} icon={Sparkles} variant="outline" disabled={dirty}>
            {t('reviseBtn')}
          </TaskButton>
          <TaskRequirements task={reqs.tasks.find((x) => x.id === 'revise-draft')} onSaved={reqs.setTask} />
        </div>
        {dirty && <p className="text-xs text-muted-foreground">{t('saveFirst')}</p>}
      </section>

      <Distribute ctx={ctx} draft={draft} />
    </div>
  )
}
