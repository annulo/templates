import { useState } from 'react'
import { CheckCircle2, FilePenLine, RefreshCw } from 'lucide-react'
import Select from './Select'
import { toast } from './ui'
import { dbPatch, type Article } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import type { ContentStatus } from '../lib/articleStatus'

export default function ArticleStatus({ article, status, onChanged, disabled = false }: { article: Article; status: ContentStatus; onChanged: () => void | Promise<void>; disabled?: boolean }) {
  const [saving, setSaving] = useState(false)
  const manual = article.manual_status === 'draft' || article.manual_status === 'published' ? article.manual_status : 'auto'
  const change = async (value: 'auto' | ContentStatus) => {
    if (saving || disabled) return
    setSaving(true)
    try {
      await dbPatch('articles', article.id, { manual_status: value === 'auto' ? '' : value, updated_at: new Date().toISOString() })
      await onChanged()
      toast(tr('content_status.saved'))
    } catch (e) { toast((e as Error).message, 'error') }
    finally { setSaving(false) }
  }
  return <div onClick={e => e.stopPropagation()} aria-busy={saving} inert={saving || disabled} className={saving || disabled ? 'opacity-60' : ''}>
    <Select<'auto' | ContentStatus> value={manual} onChange={value => void change(value)} variant="inline" align="right" ariaLabel={tr('content_status.change', { title: article.title })} title={tr('content_status.title')} className="min-w-28" options={[
      { value: 'auto', label: manual === 'auto' ? `${tr(status === 'published' ? 'content.a_published' : 'content.a_draft')} · ${tr('content_status.auto_short')}` : tr('content_status.auto'), sub: tr('content_status.auto_hint'), icon: <RefreshCw className="size-3.5" /> },
      { value: 'draft', label: tr('content.a_draft'), sub: tr('content_status.draft_hint'), icon: <FilePenLine className="size-3.5" /> },
      { value: 'published', label: tr('content.a_published'), sub: tr('content_status.published_hint'), icon: <CheckCircle2 className="size-3.5" /> },
    ]} />
  </div>
}
