import { useState } from 'react'
import { ExternalLink, Link2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Dialog, Field, Notice, cx, inputCls } from './ui'
import Select from './Select'
import { editableContentStages, manualEntryStage, publishedUrl, type ContentEntry, type ContentWorkspace, type EditableContentStage } from '../lib/contentWorkspace'
import { runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'

const w = (key: string, vars?: Record<string, unknown>) => tr('workspace.' + key, vars)
const MAX_LINKS = 20
// 列表里的短名：站点 + 最后一段路径，同一个站点的几条链接也分得开
const shortUrl = (url: string) => {
  try {
    const u = new URL(url), last = u.pathname.split('/').filter(Boolean).pop()
    return u.hostname.replace(/^www\./, '') + (last ? '/' + decodeURIComponent(last) : '')
  } catch { return url }
}
/** Links from publication records and verified receipts: shown everywhere, changed only where they were recorded. */
const recordUrls = (entry: ContentEntry) => (entry.publicationUrls || []).filter(u => !(entry.linkedUrls || []).includes(u))

type Props = { entry: ContentEntry; workspace: ContentWorkspace; onChanged: () => void }

/** The one place a task's status and its confirmed publication links are edited: list rows, plan, topic and draft details all open it. */
function StatusDialog({ entry, workspace, onChanged, onClose }: Props & { onClose: () => void }) {
  const [stage, setStage] = useState<EditableContentStage | ''>(manualEntryStage(entry, workspace) || '')
  const [links, setLinks] = useState<string[]>(entry.linkedUrls || [])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const records = recordUrls(entry)
  const filled = links.map(l => l.trim()).filter(Boolean)
  const invalid = filled.some(l => !publishedUrl(l))
  const needsLink = workspace === 'social' && stage === 'published' && !records.length && !filled.length
  const save = async () => {
    setBusy(true); setError('')
    try {
      await runLocal('content-workspace.setStage', { key: entry.key, workspace, stage, links: filled })
      onChanged(); onClose()
    } catch (e) { setError((e as Error).message); return false } finally { setBusy(false) }
  }
  return <Dialog open onClose={() => !busy && onClose()} title={w('edit_status')} width={560} footer={<>
    <Button variant="ghost" disabled={busy} onClick={onClose}>{tr('common.cancel')}</Button>
    <Button fn="content-workspace.setStage" disabled={busy || needsLink || invalid} onClick={save}>{tr('common.save')}</Button>
  </>}>
    <div className="space-y-5">
      <p className="break-words text-sm font-medium">{entry.title || tr('versions.untitled')}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field group label={w('stage_filter')} hint={w('status_edit_note')}>
        <Select ariaLabel={w('stage_filter')} value={stage} onChange={setStage} options={[
          { value: '', label: w('status_auto') },
          ...editableContentStages.map(s => ({ value: s, label: w('stage_' + s) }))]} />
      </Field>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm leading-none font-medium">{w('publication_links')}</span>
          {(records.length > 0 || links.length > 0) && <Button size="sm" variant="ghost" disabled={busy || links.length >= MAX_LINKS} onClick={() => setLinks([...links, ''])}><Plus />{w('add_link')}</Button>}
        </div>
        {records.map(url => <div key={url} className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <a href={url} target="_blank" rel="noreferrer" title={url} className="min-w-0 flex-1 truncate text-primary-text hover:underline">{url}</a>
          <Badge>{w('from_records')}</Badge>
        </div>)}
        {links.map((value, i) => <div key={i} className="flex items-center gap-2">
          <input type="url" aria-label={w('published_url')} autoFocus={!value && i === links.length - 1} placeholder="https://" value={value}
            className={cx(inputCls, !!value.trim() && !publishedUrl(value.trim()) && 'border-destructive')}
            onChange={e => setLinks(links.map((l, j) => j === i ? e.target.value : l))} />
          <Button size="icon-sm" variant="ghost" aria-label={w('remove_link')} title={w('remove_link')} disabled={busy}
            onClick={() => setLinks(links.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>)}
        {!records.length && !links.length && <button type="button" onClick={() => setLinks([''])}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground hover:bg-accent">
          <Plus className="size-3.5" />{w('add_link')}</button>}
        <p className={cx('text-xs', needsLink || invalid ? 'text-destructive' : 'text-muted-foreground')}>
          {invalid ? w('link_invalid') : needsLink ? w('link_required') : w('published_url_hint')}
        </p>
      </div>
    </div>
  </Dialog>
}

export function StageBadge({ stage }: { stage: string }) {
  return <Badge tone={stage === 'published' ? 'ok' : stage === 'blocked' ? 'bad' : stage === 'verify' ? 'warn' : 'default'}>{w('stage_' + stage)}</Badge>
}

/** Status badge: click it to edit status and links. The same in list rows and every detail view. */
export default function ContentStatus({ entry, workspace, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" aria-label={`${w('edit_status')}：${entry.title}`} title={w('edit_status')}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={() => setOpen(true)}>
      <StageBadge stage={entry.stage} /><Pencil aria-hidden="true" className="size-3 text-muted-foreground" />
    </button>
    {open && <StatusDialog entry={entry} workspace={workspace} onChanged={onChanged} onClose={() => setOpen(false)} />}
  </>
}

/** Publication links block, the same in every detail view; its edit button opens the status dialog.
 * `recordsShown`: the page already lists publication records above, so only confirmed links are listed here. */
export function PublicationLinks({ entry, workspace, onChanged, recordsShown = false }: Props & { recordsShown?: boolean }) {
  const [open, setOpen] = useState(false)
  const urls = recordsShown ? entry.linkedUrls || [] : entry.publicationUrls || []
  return <div className="space-y-2 rounded-lg border border-border px-3 py-3">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-medium text-muted-foreground">{w(recordsShown ? 'linked_publications' : 'publication_links')}</p>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{urls.length ? <><Pencil />{w('edit_links')}</> : <><Plus />{w('add_link')}</>}</Button>
    </div>
    {urls.length ? urls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 break-all text-xs text-primary-text hover:underline">
      <ExternalLink className="mt-0.5 size-3 shrink-0" /><span>{url}</span>
    </a>) : <p className="text-xs text-muted-foreground">{w(recordsShown ? 'links_empty_manual' : 'links_empty')}</p>}
    {open && <StatusDialog entry={entry} workspace={workspace} onChanged={onChanged} onClose={() => setOpen(false)} />}
  </div>
}

/** Compact links for a list row: site-name chips that open the published content. */
export function LinkChips({ urls }: { urls: string[] }) {
  if (!urls.length) return null
  return <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
    {urls.slice(0, 2).map(url => <a key={url} href={url} target="_blank" rel="noreferrer" title={url}
      className="inline-flex max-w-56 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-primary-text hover:bg-accent">
      <Link2 className="size-3 shrink-0" /><span className="truncate">{shortUrl(url)}</span>
    </a>)}
    {urls.length > 2 && <span>+{urls.length - 2}</span>}
  </span>
}
