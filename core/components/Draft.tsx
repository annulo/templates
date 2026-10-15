import { useEffect, useState } from 'react'
import { ArrowDownToLine, ChevronDown, ChevronRight, Loader2, NotebookPen, Repeat2, Wand2 } from 'lucide-react'
import RichEditor from './RichEditor'
import { Button, Notice, cx } from './ui'
import { tr } from '../lib/i18n'
import { dbPatch, type Article } from '../lib/shuttle'
import { htmlImages, htmlText, parseList, typeOf } from '../local/_types'

// 稿子（articles.draft）：每篇文章可选的工作稿，默认折叠（creator/docs/artifacts.md「稿子」）。写为什么写这篇、大纲、草稿、剧本，不发出去。
// 下面三个入口：放进正文（不经过 AI，按类型换格式）、AI 写成正文（「在这篇上做」的预设，onAIWrite）、改写成…（另写一篇，onRewrite）。

const draftOf = (a: Article) => String((a as Article & { draft?: string }).draft ?? '')
const plain = (html: string) => htmlText(html).trim()

export default function Draft({ a, locked, onChanged, onAIWrite, onRewrite }: { a: Article; locked: boolean; onChanged: () => void; onAIWrite?: () => void; onRewrite: () => void }) {
  const saved = draftOf(a)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(saved)
  const [base, setBase] = useState(saved)
  const [editorKey, setEditorKey] = useState(0)
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState('')
  const dirty = value !== base
  // 稿子在别处变了（AI 改了、别的窗口）：没动过就换成新的；动过了留着用户的，保存时以用户的为准
  useEffect(() => {
    if (saved === base) return
    if (!dirty) { setValue(saved); setEditorKey((k) => k + 1) }
    setBase(saved)
  }, [saved])
  const run = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key); setErr('')
    try { await f(); onChanged(); return true } catch (e) { setErr((e as Error).message); return false } finally { setBusy('') }
  }
  const save = () => run('save', () => dbPatch('articles', a.id, { draft: value, updated_at: new Date().toISOString() } as Partial<Article>)).then((ok) => ok && setBase(value))
  // 放进正文：长文原样（富文本）；图文、视频转纯文字，图文的图抽出来当配图（原来没配图时）。正文不是空的先确认
  const hasBody = !!plain(String(a.body ?? '')) || (typeOf(a) === 'post' && parseList(a.images).length > 0)
  const toBody = async () => {
    if (hasBody && !confirm) { setConfirm(true); return }
    setConfirm(false)
    if (dirty && !(await save())) return
    const t = typeOf(a)
    const patch: Partial<Article> = t === 'article' ? { body: value } : { body: plain(value) }
    if (t === 'post' && !parseList(a.images).length && htmlImages(value).length) patch.images = JSON.stringify(htmlImages(value))
    await run('body', () => dbPatch('articles', a.id, { ...patch, updated_at: new Date().toISOString() }))
  }
  const first = plain(saved).split('\n').find((l) => l.trim()) ?? ''

  return (
    <div className={cx('rounded-lg border', open ? 'border-border' : 'border-dashed border-border')}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm">
        {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        <NotebookPen className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{tr('draft.title')}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{!open && (first || tr('draft.empty'))}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3 pt-3 pb-3">
          <p className="text-xs text-muted-foreground">{tr('draft.hint')}</p>
          <RichEditor key={editorKey} value={value} onChange={setValue} />
          {dirty && <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={!!busy || locked}>{busy === 'save' && <Loader2 className="animate-spin" />}{tr('common.save')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setValue(base); setEditorKey((k) => k + 1) }}>{tr('common.cancel')}</Button>
          </div>}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <Button size="sm" variant="outline" disabled={!plain(value) || !!busy || locked} onClick={toBody} onMouseLeave={() => setConfirm(false)}>{busy === 'body' ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}{confirm ? tr('draft.to_body_confirm') : tr('draft.to_body')}</Button>
            {onAIWrite && <Button size="sm" variant="outline" disabled={!plain(value) || locked} onClick={async () => { if (dirty && !(await save())) return; onAIWrite() }}><Wand2 />{tr('draft.ai_write')}</Button>}
            <Button size="sm" variant="outline" disabled={locked} onClick={async () => { if (dirty && !(await save())) return; onRewrite() }}><Repeat2 />{tr('draft.rewrite')}</Button>
          </div>
          {err && <Notice tone="error">{err}</Notice>}
        </div>
      )}
    </div>
  )
}
