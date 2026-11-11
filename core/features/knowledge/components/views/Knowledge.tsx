import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ClipboardPaste, ExternalLink, FileText, Globe, Link2, Loader2, Search, Sparkles, Trash2, Upload } from 'lucide-react'
import { Badge, Button, Dialog, Field, Notice, PageHeader, Segmented, Skeleton, cx, fmtTime, inputCls } from '../ui'
import { TaskButton } from '../Task'
import { runLocal } from '../../lib/shuttle'
import { ACCEPT, extractText, saveOriginal } from '../../lib/extract'
import { deleteLocalFile, openFile } from '../../lib/files'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

/** 任务 id（tasks/summarize-knowledge.md）：给一份资料写摘要和标签 */
const SUMMARIZE_TASK = 'summarize-knowledge'

export type KnowledgeDoc = {
  id: string
  kind: string
  title: string
  url: string
  file_name: string
  status: string
  error: string
  chars: number
  summary: string
  tags: string[]
  notes: string
  archived: boolean
  collected_at: string
  created_at: string
  updated_at: string
}
type Hit = { source_id: string; title: string; kind: string; url: string; snippet: string; score: number }
type Upload = { name: string; state: 'reading' | 'saving' | 'done' | 'failed'; error?: string }

/**
 * 企业资料：产品手册、FAQ、证书、报价口径、案例……助手写文章、回询盘、做背调时先查这里（knowledge.search）。
 * 文件在浏览器里读出文字（lib/extract.ts）再存；原文件存成本机文件，能打开看原样。
 */
export default function Knowledge({ ctx }: { ctx: Ctx }) {
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null)
  const [error, setError] = useState('')
  const [show, setShow] = useState<'active' | 'archived'>('active')
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dialog, setDialog] = useState<'' | 'url' | 'text'>('')
  const [open, setOpen] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    runLocal<KnowledgeDoc[]>('knowledge.list', {})
      .then(setDocs)
      .catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])

  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (!list.length) return
    setUploads(list.map((f) => ({ name: f.name, state: 'reading' })))
    const set = (i: number, u: Partial<Upload>) => setUploads((us) => us.map((x, j) => (j === i ? { ...x, ...u } : x)))
    for (const [i, f] of list.entries()) {
      try {
        const text = await extractText(f, tr('knowledge.unsupported'))
        set(i, { state: 'saving' })
        const ref = await saveOriginal(f)
        await runLocal('knowledge.addText', { title: f.name.replace(/\.[^.]+$/, ''), content: text, kind: 'file', file_name: f.name, url: ref })
        set(i, { state: 'done' })
      } catch (e) {
        set(i, { state: 'failed', error: (e as Error).message })
      }
    }
    load()
  }

  const shown = (docs ?? []).filter((d) => (show === 'archived' ? d.archived : !d.archived))
  const archivedCount = (docs ?? []).filter((d) => d.archived).length

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('knowledge.title')}
        desc={tr('knowledge.desc')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog('text')}>
              <ClipboardPaste /> {tr('knowledge.add_text')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDialog('url')}>
              <Link2 /> {tr('knowledge.add_url')}
            </Button>
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <Upload /> {tr('knowledge.upload')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                upload(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      {uploads.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-border bg-background p-3 text-sm">
          {uploads.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              {u.state === 'reading' || u.state === 'saving' ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
              <span className="truncate">{u.name}</span>
              <span className={cx('ml-auto shrink-0 text-xs', u.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{u.state === 'failed' ? u.error : tr(`knowledge.u_${u.state}`)}</span>
            </div>
          ))}
          {uploads.every((u) => u.state === 'done' || u.state === 'failed') && (
            <button type="button" onClick={() => setUploads([])} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              {tr('knowledge.u_clear')}
            </button>
          )}
        </div>
      )}

      <SearchBox disabled={!docs?.length} onOpen={setOpen} />

      <div className="flex items-center justify-between gap-3">
        <Segmented
          value={show}
          onChange={setShow}
          options={[
            { value: 'active', label: tr('knowledge.f_active', { n: docs ? (docs.length - archivedCount) : '' }) },
            { value: 'archived', label: tr('knowledge.f_archived', { n: docs ? archivedCount : '' }) },
          ]}
        />
      </div>

      {docs === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm">
          {show === 'archived' ? (
            <p className="text-muted-foreground">{tr('knowledge.empty_archived')}</p>
          ) : (
            <div className="space-y-3">
              <p className="font-medium">{tr('knowledge.empty_title')}</p>
              <p className="text-muted-foreground">{tr('knowledge.empty')}</p>
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Upload /> {tr('knowledge.upload')}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {shown.map((d) => (
            <DocRow key={d.id} doc={d} onOpen={() => setOpen(d.id)} onChanged={load} />
          ))}
        </div>
      )}

      {dialog === 'url' && <AddUrl onClose={() => setDialog('')} onDone={load} />}
      {dialog === 'text' && <AddText onClose={() => setDialog('')} onDone={load} />}
      {open && <DocDialog id={open} onClose={() => setOpen('')} onChanged={load} />}
    </div>
  )
}

const KIND_ICON: Record<string, typeof FileText> = { file: FileText, article: Globe, text: ClipboardPaste }

function DocRow({ doc: d, onOpen, onChanged }: { doc: KnowledgeDoc; onOpen: () => void; onChanged: () => void }) {
  const Icon = KIND_ICON[d.kind] ?? FileText
  return (
    <div className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 md:flex-row md:items-start">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-left">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{d.title || d.file_name || d.url}</span>
            {d.tags.map((t) => (
              <Badge key={t} tone="primary">{t}</Badge>
            ))}
          </div>
          {d.summary ? <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">{d.summary}</p> : <p className="text-xs text-muted-foreground">{tr('knowledge.no_summary')}</p>}
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{tr('knowledge.chars', { n: d.chars.toLocaleString() })}</span>
            {d.file_name && <span>{d.file_name}</span>}
            {!d.file_name && d.url && !d.url.startsWith('local:') && <span className="truncate">{d.url}</span>}
            <span>{fmtTime(d.updated_at || d.created_at)}</span>
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        <TaskButton task={SUMMARIZE_TASK} input={{ id: d.id }} match={(r) => r.input?.id === d.id} onFinished={onChanged} variant={d.summary ? 'ghost' : 'outline'} icon={Sparkles}>
          {d.summary ? tr('knowledge.summarize_again') : tr('knowledge.summarize')}
        </TaskButton>
      </div>
    </div>
  )
}

/** 试试问资料：和助手用的是同一个 knowledge.search，用户能看到助手会查到什么 */
function SearchBox({ disabled, onOpen }: { disabled: boolean; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async () => {
    if (!q.trim()) return
    setBusy(true)
    setErr('')
    try {
      setHits((await runLocal<{ hits: Hit[] }>('knowledge.search', { q, limit: 6 })).hits)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-background p-4">
      <div className="text-sm font-semibold">{tr('knowledge.search_title')}</div>
      <p className="text-xs text-muted-foreground">{tr('knowledge.search_hint')}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} disabled={disabled} onChange={(e) => setQ(e.target.value)} placeholder={tr('knowledge.search_placeholder')} className={cx(inputCls, 'h-8 pl-8')} />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={disabled || busy || !q.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Search />} {tr('knowledge.search')}
        </Button>
      </form>
      {err && <Notice tone="error">{err}</Notice>}
      {hits &&
        (hits.length === 0 ? (
          <p className="text-xs text-muted-foreground">{tr('knowledge.no_hits')}</p>
        ) : (
          <ul className="space-y-2">
            {hits.map((h, i) => (
              <li key={i} className="rounded-lg border border-border p-2.5 text-sm">
                <button type="button" onClick={() => onOpen(h.source_id)} className="mb-1 cursor-pointer text-xs font-semibold text-primary-text hover:underline">
                  {h.title}
                </button>
                <p className="line-clamp-4 text-xs whitespace-pre-wrap text-muted-foreground">{h.snippet}</p>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

function AddUrl({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      await runLocal('knowledge.addUrl', { url: url.trim() })
      onDone()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr('knowledge.add_url')}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{tr('knowledge.cancel')}</Button>
          <Button size="sm" disabled={busy || !url.trim()} onClick={save}>
            {busy && <Loader2 className="animate-spin" />} {tr('knowledge.read_url')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={tr('knowledge.url_label')} hint={tr('knowledge.url_hint')}>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={inputCls} />
        </Field>
        {err && <Notice tone="error">{err}</Notice>}
      </div>
    </Dialog>
  )
}

function AddText({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      await runLocal('knowledge.addText', { title, content, kind: 'text' })
      onDone()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      width={640}
      onClose={onClose}
      title={tr('knowledge.add_text')}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{tr('knowledge.cancel')}</Button>
          <Button size="sm" disabled={busy || !content.trim()} onClick={save}>{tr('knowledge.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={tr('knowledge.title_label')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr('knowledge.title_placeholder')} className={inputCls} />
        </Field>
        <Field label={tr('knowledge.content_label')} hint={tr('knowledge.content_hint')}>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} className={cx(inputCls, 'py-2')} />
        </Field>
        {err && <Notice tone="error">{err}</Notice>}
      </div>
    </Dialog>
  )
}

/** 一份资料：看正文，改标题、标签、备注，打开原文件，归档、删除 */
function DocDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [doc, setDoc] = useState<(KnowledgeDoc & { content: string }) | null>(null)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    runLocal<KnowledgeDoc & { content: string }>('knowledge.get', { id })
      .then((d) => {
        setDoc(d)
        setTitle(d.title)
        setTags(d.tags.join(', '))
        setNotes(d.notes)
      })
      .catch((e) => setErr(e.message))
  }, [id])
  const act = async (fn: string, input: Record<string, unknown>, close = false) => {
    setErr('')
    try {
      const r = await runLocal<{ url?: string }>(fn, { id, ...input })
      // 删资料时原文件（本机文件）一起删；删不掉也不影响
      if (fn === 'knowledge.remove') await deleteLocalFile(r?.url).catch(() => {})
      onChanged()
      if (close) onClose()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const local = doc?.url.startsWith('local:')
  return (
    <Dialog
      open
      width={820}
      onClose={onClose}
      title={doc?.title || tr('knowledge.title')}
      footer={
        doc && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-destructive"
              onClick={() => (confirmDelete ? act('knowledge.remove', {}, true) : setConfirmDelete(true))}
            >
              <Trash2 /> {confirmDelete ? tr('knowledge.delete_confirm') : tr('knowledge.delete')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => act('knowledge.update', { archived: !doc.archived }, true)}>
              {doc.archived ? <ArchiveRestore /> : <Archive />} {doc.archived ? tr('knowledge.restore') : tr('knowledge.archive')}
            </Button>
            <Button size="sm" onClick={() => act('knowledge.update', { title, tags: tags.split(/[,，、]/).map((t) => t.trim()).filter(Boolean), notes }, true)}>
              {tr('knowledge.save')}
            </Button>
          </>
        )
      }
    >
      {!doc ? (
        err ? <Notice tone="error">{err}</Notice> : <Skeleton className="h-40 rounded-xl" />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr('knowledge.title_label')}>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </Field>
            <Field label={tr('knowledge.tags_label')} hint={tr('knowledge.tags_hint')}>
              <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            {local && (
              <button type="button" onClick={() => openFile(doc.url).catch((e) => setErr(e.message))} className="inline-flex cursor-pointer items-center gap-1 font-medium text-primary-text hover:underline">
                <ExternalLink className="size-3.5" /> {tr('knowledge.open_file', { name: doc.file_name || '' })}
              </button>
            )}
            {!local && doc.url && (
              <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline">
                <ExternalLink className="size-3.5" /> {tr('knowledge.open_url')}
              </a>
            )}
            <span className="text-muted-foreground">{tr('knowledge.chars', { n: doc.chars.toLocaleString() })}</span>
          </div>
          {doc.summary && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">{tr('knowledge.summary')}</div>
              <p className="whitespace-pre-wrap">{doc.summary}</p>
            </div>
          )}
          <Field label={tr('knowledge.notes_label')}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={cx(inputCls, 'py-2')} />
          </Field>
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">{tr('knowledge.content')}</div>
            <pre className="max-h-96 overflow-y-auto rounded-lg border border-border p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap">{doc.content}</pre>
          </div>
          {err && <Notice tone="error">{err}</Notice>}
        </div>
      )}
    </Dialog>
  )
}
