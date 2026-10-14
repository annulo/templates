import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Badge, Button, Dialog, Field, Notice } from './ui'
import Select from './Select'
import { editableContentStages, manualEntryStage, type ContentEntry, type ContentWorkspace, type EditableContentStage } from '../lib/contentWorkspace'
import { runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'

const w = (key: string) => tr('workspace.' + key)
export default function ContentStatus({ entry, workspace, onChanged }: { entry: ContentEntry; workspace: ContentWorkspace; onChanged: () => void }) {
  const [open, setOpen] = useState(false), [stage, setStage] = useState<EditableContentStage | ''>('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const label = w('stage_' + entry.stage)
  const badge = <Badge tone={entry.stage === 'published' ? 'ok' : entry.stage === 'blocked' ? 'bad' : entry.stage === 'verify' ? 'warn' : 'default'}>{label}</Badge>
  return <>
    <button type="button" aria-label={`${w('edit_status')}：${entry.title}`} title={w('edit_status')}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={() => { setStage(manualEntryStage(entry, workspace) || ''); setError(''); setOpen(true) }}>
      {badge}<Pencil aria-hidden="true" className="size-3 text-muted-foreground" />
    </button>
    <Dialog open={open} onClose={() => !busy && setOpen(false)} title={w('edit_status')} footer={<>
      <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{tr('common.cancel')}</Button>
      <Button fn="content-workspace.setStage" disabled={busy} onClick={async () => {
        setBusy(true); setError('')
        try {
          await runLocal('content-workspace.setStage', { key: entry.key, workspace, stage })
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
      </div>
    </Dialog>
  </>
}
