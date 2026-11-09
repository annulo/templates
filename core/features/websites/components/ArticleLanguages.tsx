import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, BookA, Check, Languages, Loader2, MessageSquareText, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { Badge, Button, Dialog, Field, cx, fmtTime, inputCls, toast, type Tone } from './ui'
import Select from './Select'
import RichEditor from './RichEditor'
import { BodyPreview } from './ArticleEditor'
import { TaskRequirements, useTaskRuns } from './Task'
import { openChat, runLocal, runTask, type Article } from '../lib/shuttle'
import { isEn, tr } from '../lib/i18n'

// 文章页的语言一栏（docs/multilingual.md）：要发的网站开了多种语言时出现。原文是哪种语言、每种语言的译文（没翻 / AI 翻的 / 确认过 / 原文已改），
// 翻译交给助手（任务 translate-article），接着改回到翻它的那段对话；用户也能在这里直接改、确认。发布时 publishTo 把译文写进网站的各语言版本。

const TASK = 'translate-article'

type State = 'source' | 'none' | 'draft' | 'ready' | 'stale'
type LocaleRow = { locale: string; state: State; id?: string; status?: string; title?: string; summary?: string; body?: string; keywords?: string; chat_id?: string; updated_at?: string }
type Site = { id: string; name: string; locales: string[]; default_locale: string; review: boolean; url: string; urls: Record<string, string>; published: string[] }
type Info = { lang: string; article_lang: string; locales: string[]; default_locale: string; sites: Site[]; states: LocaleRow[] }
type Term = { id: string; term: string; translations: Record<string, string>; keep: boolean; note: string }

const STATE: Record<State, { key: string; tone: Tone }> = {
  source: { key: 'langs.s_source', tone: 'primary' },
  none: { key: 'langs.s_none', tone: 'default' },
  draft: { key: 'langs.s_draft', tone: 'warn' },
  ready: { key: 'langs.s_ready', tone: 'ok' },
  stale: { key: 'langs.s_stale', tone: 'bad' },
}

/** 语言代码按界面语言显示（zh → 中文 / Chinese），认不出就显示代码 */
export function localeName(code: string) {
  try {
    return new Intl.DisplayNames([isEn() ? 'en' : 'zh-CN'], { type: 'language' }).of(code) || code
  } catch {
    return code
  }
}

export default function ArticleLanguages({ a, onChanged }: { a: Article; onChanged?: () => void }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [sel, setSel] = useState('')
  const [editing, setEditing] = useState(false)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    runLocal<Info>('languages.article', { article_id: a.id }).then(setInfo).catch(() => setInfo(null))
  }, [a.id])
  // 原文改了（标题、正文）要重算「原文已改」
  useEffect(load, [load, a.title, a.summary, a.body, a.keywords])
  const { tasks, runs, setTask, reload } = useTaskRuns([TASK], (r) => (r.input as any)?.article_id === a.id, load)
  const running = runs[0]

  const states = info?.states ?? []
  const current = states.find((s) => s.locale === sel) ?? states.find((s) => s.state !== 'source') ?? states[0]
  useEffect(() => setEditing(false), [current?.locale])
  const todo = useMemo(() => states.filter((s) => s.state === 'none' || s.state === 'stale').map((s) => s.locale), [states])
  if (!info || !info.sites.length || !current) return null

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setErr('')
    try {
      await fn()
      load()
      onChanged?.()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  const translate = (locales: string[]) => act('translate', async () => {
    const r = await runTask(TASK, { article_id: a.id, locales })
    openChat(r.chat_id)
    reload()
  })
  // 接着改：回到翻它的那段对话；找不到原来的对话才新开一段
  const resume = (row: LocaleRow) => (row.chat_id ? openChat(row.chat_id) : translate([row.locale]))

  const names = (l: string[]) => l.map(localeName).join(isEn() ? ', ' : '、')
  const links = info.sites.map((s) => ({ site: s.name, url: s.urls[current.locale] })).filter((x) => x.url)

  return (
    <section className="mt-6 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold"><Languages className="size-4 text-primary-text" />{tr('langs.title')}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tr('langs.desc', { sites: info.sites.map((s) => s.name).join(isEn() ? ', ' : '、') })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setGlossaryOpen(true)}><BookA />{tr('langs.glossary')}</Button>
          <TaskRequirements task={tasks[0] ?? null} onSaved={setTask} title={tr('langs.req_title')} hint={tr('langs.req_hint')} />
          {running ? (
            <Button size="sm" variant="outline" onClick={() => openChat(running.chat_id)}><Loader2 className="animate-spin" />{tr('task.running')} · {tr('task.view')}</Button>
          ) : todo.length > 0 && (
            <Button size="sm" needsShuttle feedback={false} disabled={!!busy} onClick={() => translate(todo)}>
              {busy === 'translate' ? <Loader2 className="animate-spin" /> : <Languages />}
              {tr('langs.translate', { langs: names(todo) })}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{tr('langs.source')}</span>
        <Select variant="inline" ariaLabel={tr('langs.source')} value={info.lang} onChange={(lang) => act('lang', () => runLocal('languages.setLang', { article_id: a.id, lang }))}
          options={info.locales.map((l) => ({ value: l, label: localeName(l), sub: l === info.default_locale ? tr('langs.default') : l }))} />
        {info.lang !== info.default_locale && !states.find((s) => s.locale === info.default_locale && s.state !== 'none') && (
          <span className="text-xs text-amber-700 dark:text-amber-400">{tr('langs.need_default', { lang: localeName(info.default_locale) })}</span>
        )}
      </div>

      <div role="tablist" className="mt-3 flex flex-wrap gap-1.5">
        {states.map((s) => (
          <button key={s.locale} type="button" role="tab" aria-selected={s.locale === current.locale} onClick={() => setSel(s.locale)}
            className={cx('inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm transition-colors',
              s.locale === current.locale ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:bg-muted')}>
            {localeName(s.locale)}
            <Badge tone={STATE[s.state].tone}>{tr(STATE[s.state].key)}</Badge>
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        {current.state === 'source' ? (
          <p className="text-sm text-muted-foreground">{tr('langs.is_source')}</p>
        ) : current.state === 'none' ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">{tr('langs.not_yet', { lang: localeName(current.locale) })}</span>
            {!running && <Button size="sm" variant="outline" needsShuttle feedback={false} disabled={!!busy} onClick={() => translate([current.locale])}><Languages />{tr('langs.translate_one', { lang: localeName(current.locale) })}</Button>}
          </div>
        ) : editing ? (
          <TranslationEditor row={current} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); load(); onChanged?.() }} />
        ) : (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {current.state === 'stale' ? tr('langs.stale_hint') : current.state === 'draft' ? tr('langs.draft_hint') : tr('langs.ready_hint')}
                {current.updated_at && ` · ${fmtTime(current.updated_at)}`}
              </span>
              {current.state === 'stale' && !running && <Button size="sm" needsShuttle onClick={() => resume(current)}><RefreshCw />{tr('langs.update')}</Button>}
              {current.state !== 'ready' && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act('confirm', () => runLocal('translations.update', { id: current.id, confirm: true }))}><Check />{tr('langs.confirm')}</Button>}
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil />{tr('langs.edit')}</Button>
              {current.chat_id && <Button size="sm" variant="ghost" needsShuttle onClick={() => openChat(current.chat_id!)}><MessageSquareText />{tr('langs.continue')}</Button>}
              <Button size="icon-sm" variant="ghost" aria-label={tr('langs.remove')} title={tr('langs.remove')} disabled={!!busy}
                onClick={() => { if (window.confirm(tr('langs.remove_confirm', { lang: localeName(current.locale) }))) void act('remove', () => runLocal('translations.remove', { id: current.id })) }}><Trash2 /></Button>
            </div>
            {links.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {links.map((l) => <a key={l.site} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary-text hover:underline">{l.site}<ArrowUpRight className="size-3" /></a>)}
              </p>
            )}
            <h3 className="mt-3 text-lg leading-snug font-semibold">{current.title}</h3>
            {current.summary && <p className="mt-1 text-sm text-muted-foreground">{current.summary}</p>}
            <div dir={/^(ar|he|fa|ur)\b/.test(current.locale) ? 'rtl' : undefined}><BodyPreview html={current.body ?? ''} /></div>
            {current.keywords && <p className="mt-2 text-xs text-muted-foreground">{tr('langs.keywords')}：{current.keywords}</p>}
          </div>
        )}
        {err && <p className="mt-2 text-xs text-destructive [overflow-wrap:anywhere]">{err}</p>}
      </div>

      <GlossaryDialog open={glossaryOpen} onClose={() => setGlossaryOpen(false)} locales={info.locales} />
    </section>
  )
}

function TranslationEditor({ row, onCancel, onSaved }: { row: LocaleRow; onCancel: () => void; onSaved: () => void }) {
  const [d, setD] = useState({ title: row.title ?? '', summary: row.summary ?? '', body: row.body ?? '', keywords: row.keywords ?? '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    setSaving(true)
    setErr('')
    try {
      await runLocal('translations.update', { id: row.id, ...d })
      toast(tr('langs.saved'))
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-3" dir={/^(ar|he|fa|ur)\b/.test(row.locale) ? 'rtl' : undefined}>
      <Field label={tr('langs.f_title')}><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} className={inputCls} /></Field>
      <Field label={tr('langs.f_summary')}><textarea value={d.summary} onChange={(e) => setD({ ...d, summary: e.target.value })} rows={2} className={`${inputCls} py-2`} /></Field>
      <Field label={tr('langs.f_body')}><RichEditor value={d.body} onChange={(body) => setD((x) => ({ ...x, body }))} /></Field>
      <Field label={tr('langs.f_keywords')}><input value={d.keywords} onChange={(e) => setD({ ...d, keywords: e.target.value })} className={inputCls} /></Field>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2" dir="ltr">
        <Button variant="outline" size="sm" onClick={onCancel}>{tr('common.cancel')}</Button>
        <Button size="sm" onClick={save} disabled={saving || !d.title.trim()}>{saving && <Loader2 className="animate-spin" />}{tr('langs.save')}</Button>
      </div>
    </div>
  )
}

/** 术语表：一个词在各语言里固定怎么说，或者不翻。助手翻译时会自己补，这里能看、能改 */
function GlossaryDialog({ open, onClose, locales }: { open: boolean; onClose: () => void; locales: string[] }) {
  const [list, setList] = useState<Term[] | null>(null)
  const [draft, setDraft] = useState<{ term: string; keep: boolean; translations: Record<string, string> } | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    runLocal<Term[]>('glossary.list', {}).then(setList).catch((e) => setErr((e as Error).message))
  }, [])
  useEffect(() => {
    if (open) load()
  }, [open, load])
  const save = async () => {
    if (!draft?.term.trim()) return
    setErr('')
    try {
      await runLocal('glossary.save', { term: draft.term, keep: draft.keep, translations: draft.translations })
      setDraft(null)
      load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const remove = async (id: string) => {
    await runLocal('glossary.remove', { id }).catch((e) => setErr((e as Error).message))
    load()
  }
  return (
    <Dialog open={open} onClose={onClose} title={tr('glossary.title')} width={640}
      footer={<Button variant="outline" onClick={onClose}>{tr('common.close')}</Button>}>
      <p className="text-xs leading-relaxed text-muted-foreground">{tr('glossary.desc')}</p>
      {list === null ? (
        <p className="mt-3 text-sm text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {list.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">{tr('glossary.empty')}</li>}
          {list.map((g) => (
            <li key={g.id} className="flex items-start gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{g.term}{g.keep && <Badge className="ml-2">{tr('glossary.keep')}</Badge>}</div>
                {!g.keep && <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {Object.entries(g.translations).map(([l, v]) => <span key={l}><span className="text-foreground/60">{localeName(l)}</span> {v}</span>)}
                </div>}
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={tr('glossary.edit')} title={tr('glossary.edit')} onClick={() => setDraft({ term: g.term, keep: g.keep, translations: { ...g.translations } })}><Pencil /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={tr('glossary.remove')} title={tr('glossary.remove')} onClick={() => void remove(g.id)}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      )}
      {draft ? (
        <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <input autoFocus value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })} placeholder={tr('glossary.term_ph')} className={`${inputCls} flex-1`} />
            <label className="flex shrink-0 items-center gap-1.5 text-sm"><input type="checkbox" checked={draft.keep} onChange={(e) => setDraft({ ...draft, keep: e.target.checked })} />{tr('glossary.keep')}</label>
          </div>
          {!draft.keep && locales.map((l) => (
            <div key={l} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">{localeName(l)}</span>
              <input value={draft.translations[l] ?? ''} onChange={(e) => setDraft({ ...draft, translations: { ...draft.translations, [l]: e.target.value } })} className={`${inputCls} flex-1`} dir={/^(ar|he|fa|ur)\b/.test(l) ? 'rtl' : undefined} />
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}><X />{tr('common.cancel')}</Button>
            <Button size="sm" onClick={save} disabled={!draft.term.trim()}><Check />{tr('glossary.save')}</Button>
          </div>
        </div>
      ) : (
        <Button className="mt-3" size="sm" variant="outline" onClick={() => setDraft({ term: '', keep: false, translations: {} })}><Plus />{tr('glossary.add')}</Button>
      )}
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </Dialog>
  )
}
