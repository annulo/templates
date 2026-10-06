import { useEffect, useState } from 'react'
import { useTranslations } from 'talizen'
import { Check, Loader2 } from 'lucide-react'
import { db } from '../../lib/annulo'
import { Button } from '../ui/button'
import { Input, Textarea } from '../ui/input'

const FIELDS = ['name', 'about', 'audience', 'pillars', 'voice', 'avoid'] as const
type Field = (typeof FIELDS)[number]

/** 定位：profile 表只有一行。出选题、写稿、改写成社媒帖子都参考它 */
export default function Profile({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations('profile')
  const [id, setId] = useState('')
  const [form, setForm] = useState<Record<Field, string>>(() => Object.fromEntries(FIELDS.map((f) => [f, ''])) as Record<Field, string>)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    db.list<Record<Field, string>>('profile').then((l) => {
      if (!l[0]) return
      setId(l[0].id)
      setForm(Object.fromEntries(FIELDS.map((f) => [f, l[0][f] ?? ''])) as Record<Field, string>)
    })
  }, [])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const row = { ...form, updated_at: new Date().toISOString() }
      if (id) await db.update('profile', id, row)
      else setId((await db.create('profile', row)).id)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('desc')}</p>
      </div>
      <div className="space-y-4">
        {FIELDS.map((f) => (
          <label key={f} className="block space-y-1.5">
            <span className="text-sm font-medium">{t(`${f}.label`)}</span>
            {f === 'name' ? (
              <Input value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} placeholder={t(`${f}.placeholder`)} />
            ) : (
              <Textarea value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} placeholder={t(`${f}.placeholder`)} rows={f === 'about' ? 4 : 2} />
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}
          {saved ? t('saved') : t('save')}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  )
}
