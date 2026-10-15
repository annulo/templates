import { useState } from 'react'
import { ExternalLink, Pencil } from 'lucide-react'
import { Badge, Button, Dialog, Field, Notice, inputCls } from './ui'
import Select from './Select'
import { editableContentStages, manualEntryStage, type ContentEntry, type ContentWorkspace, type EditableContentStage } from '../lib/contentWorkspace'
import { runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'

const w = (key: string) => tr('workspace.' + key)
export function PublicationLinks({ urls }: { urls: string[] }) {
  if (!urls.length) return null
  return <div className="space-y-2 rounded-lg border border-border px-3 py-3">
    <p className="text-xs font-medium text-muted-foreground">{w('linked_publications')}</p>
    {urls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 break-all text-xs text-primary-text hover:underline">
      <ExternalLink className="mt-0.5 size-3 shrink-0" /><span>{url}</span>
    </a>)}
  </div>
}
export default function ContentStatus({ entry, workspace, onChanged }: { entry: ContentEntry; workspace: ContentWorkspace; onChanged: () => void }) {
  const [open, setOpen] = useState(false), [stage, setStage] = useState<EditableContentStage | ''>('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const urls = entry.publicationUrls || []
  const label = w('stage_' + entry.stage)
  const badge = <Badge tone={entry.stage === 'published' ? 'ok' : entry.stage === 'blocked' ? 'bad' : entry.stage === 'verify' ? 'warn' : 'default'}>{label}</Badge>
  return <>
    <button type="button" aria-label={`${w('edit_status')}：${entry.title}`} title={w('edit_status')}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={() => { setStage(manualEntryStage(entry, workspace) || ''); setUrl(''); setError(''); setOpen(true) }}>
      {badge}<Pencil aria-hidden="true" className="size-3 text-muted-foreground" />
    </button>
    <Dialog open={open} onClose={() => !busy && setOpen(false)} title={w('edit_status')} footer={<>
      <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{tr('common.cancel')}</Button>
      <Button fn="content-workspace.setStage" disabled={busy || (workspace === 'social' && stage === 'published' && !urls.length && !url.trim())} onClick={async () => {
        setBusy(true); setError('')
        try {
          await runLocal('content-workspace.setStage', { key: entry.key, workspace, stage, ...(workspace === 'social' && stage === 'published' && url.trim() ? { published_url: url.trim() } : {}) })
          onChanged(); setOpen(false)
        } catch (e) { setError((e as Error).message); return false } finally { setBusy(false) }
      }}>{tr('common.save')}</Button>
    </>}>
      <div className="space-y-4">
        <p className="break-words text-sm font-medium">{entry.title}</p>
        {error && <Notice tone="error">{error}</Notice>}
        <Field group label={w('stage_filter')}><Select ariaLabel={w('stage_filter')} value={stage} onChange={setStage} options={[
          { value: '', label: w('status_auto') },
          ...editableContentStages.map(s => ({ value: s, label: w('stage_' + s) }))]} /></Field>
        <p className="text-xs text-muted-foreground">{w('status_edit_note')}</p>
        {workspace === 'social' && stage === 'published' && <>
          <PublicationLinks urls={urls} />
          <Field label={w('published_url')} hint={w('published_url_hint')}>
            <input type="url" aria-label={w('published_url')} className={inputCls} placeholder="https://" value={url} onChange={e => setUrl(e.target.value)} />
          </Field>
        </>}
      </div>
    </Dialog>
  </>
}
