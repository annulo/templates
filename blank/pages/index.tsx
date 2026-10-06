import { useEffect, useState } from 'react'
import { useTranslations } from 'talizen'
import { BarChart3, Check, Plus, Sparkles, Trash2 } from 'lucide-react'
import { ask, db, openChat, runLocal } from '../lib/annulo'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { confirm } from '../components/ui/confirm'

type Note = { id: string; text: string; done?: boolean }

export default function Home() {
  const t = useTranslations()
  const examples = t.raw<string[]>('examples') ?? []
  const [notes, setNotes] = useState<Note[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [stats, setStats] = useState('')
  const [sent, setSent] = useState('')

  const load = () =>
    db
      .list<Note>('notes')
      .then(setNotes)
      .catch(() => setErr(t('notInApp')))
  useEffect(() => {
    load()
    // 助手改了表（或用户在别处改了）时外壳会通知页面刷新
    const on = (e: MessageEvent) => e.origin === location.origin && ['shuttle:refresh', 'annulo:refresh'].includes(e.data?.type) && load()
    addEventListener('message', on)
    return () => removeEventListener('message', on)
  }, [])

  const add = async () => {
    if (!text.trim()) return
    await db.create('notes', { text: text.trim(), done: false })
    setText('')
    load()
  }
  const toggle = async (n: Note) => {
    await db.update('notes', n.id, { done: !n.done })
    load()
  }
  const remove = async (n: Note) => {
    if (!(await confirm({ title: t('confirmDelete', { text: n.text }), danger: true }))) return
    await db.remove('notes', n.id)
    load()
  }
  const count = async () => {
    const r = await runLocal<{ total: number; done: number }>('notes.stats')
    setStats(t('statsResult', { total: r.total, done: r.done }))
  }
  const send = async (text: string) => {
    const { chat_id } = await ask(text)
    setSent(text)
    openChat(chat_id)
  }

  return (
    <main className="mx-auto max-w-2xl space-y-10 px-6 py-12">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="leading-relaxed text-muted-foreground">{t('intro')}</p>
      </header>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary-text" />
          {t('try')}
        </h2>
        <div className="grid gap-2">
          {examples.map((e) => (
            <button key={e} type="button" onClick={() => send(e)} className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm hover:bg-accent">
              {e}
            </button>
          ))}
        </div>
        {sent && <p className="text-xs text-muted-foreground">{t('sent')}</p>}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{t('notes')}</h2>
          <p className="text-xs text-muted-foreground">{t('notesHint')}</p>
        </div>
        {err ? (
          <p className="text-sm text-destructive">{err}</p>
        ) : (
          <>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                add()
              }}
            >
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('placeholder')} className="flex-1" />
              <Button type="submit">
                <Plus />
                {t('add')}
              </Button>
            </form>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {notes.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{t('empty')}</li>}
              {notes.map((n) => (
                <li key={n.id} className="flex items-center gap-3 px-4 py-2.5">
                  <button type="button" onClick={() => toggle(n)} aria-pressed={!!n.done} className="flex size-5 items-center justify-center rounded border border-border">
                    {n.done && <Check className="size-3.5" />}
                  </button>
                  <span className={'flex-1 text-sm ' + (n.done ? 'text-muted-foreground line-through' : '')}>{n.text}</span>
                  <button type="button" onClick={() => remove(n)} aria-label="delete" className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={count}>
                <BarChart3 className="size-3.5" />
                {t('stats')}
              </Button>
              {stats && <span className="text-xs text-muted-foreground">{stats}</span>}
            </div>
          </>
        )}
      </section>
    </main>
  )
}
