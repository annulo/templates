import { useState } from 'react'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button, Dialog, Field, Notice, inputCls, toast } from './ui'
import { runLocal, type Channel } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { FB } from '../plugins/social/local/_facebook_spec'

type Post = { id: string; status: string; post_id?: string; body: string; tags?: string }

export const facebookPostActions = (post: Post, channel?: Channel) => post.status === 'published' && !!post.post_id && channel?.type === 'facebook' && channel.auth_mode === 'api' && channel.fb_kind === 'page'

const t = (key: string) => tr('published_post.' + key)
const tagsOf = (v?: string): string[] => { try { const tags = JSON.parse(v || '[]'); return Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [] } catch { return [] } }

/** Shared by content records, the published-content pane and account performance. */
export default function FacebookPostActions({ post, channel, onChanged, disabled = false, remove = true }: { post: Post; channel?: Channel; onChanged: () => void; disabled?: boolean; remove?: boolean }) {
  const [mode, setMode] = useState<'edit' | 'remove' | ''>('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!facebookPostActions(post, channel)) return null
  const tagList = tags.split(/[\s,，#]+/).filter(Boolean)
  const open = (next: 'edit' | 'remove') => {
    setBody(post.body || '')
    setTags(tagsOf(post.tags).join(' '))
    setError('')
    setMode(next)
  }
  const close = () => { if (!busy) setMode('') }
  const submit = async () => {
    setBusy(true); setError('')
    try {
      await runLocal(`social/social.${mode}`, { post_id: post.id, ...(mode === 'edit' ? { body, tags: tagList } : {}) })
      toast(t(mode === 'edit' ? 'edited' : 'removed'), 'ok')
      setMode('')
      onChanged()
      window.postMessage({ type: 'shuttle:refresh' }, window.location.origin)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <>
    <Button size="sm" variant="outline" fn="social/social.edit" feedback={false} disabled={disabled || busy} onClick={() => open('edit')}><Pencil />{t('edit')}</Button>
    {remove && <Button size="sm" variant="ghost" fn="social/social.remove" feedback={false} className="text-destructive" disabled={disabled || busy} onClick={() => open('remove')}><Trash2 />{t('delete')}</Button>}
    <Dialog open={!!mode} onClose={close} dismissible={!busy} title={t(mode === 'remove' ? 'delete' : 'edit')} width={560} footer={<>
      <Button variant="ghost" feedback={false} disabled={busy} onClick={close}>{tr('common.cancel')}</Button>
      <Button variant={mode === 'remove' ? 'destructive' : 'default'} fn={`social/social.${mode || 'edit'}`} feedback={false} disabled={disabled || busy || (mode === 'edit' && (!body.trim() || tagList.length > FB.tagsMax))} onClick={submit}>
        {busy && <Loader2 className="animate-spin" />}{busy ? tr('ui.running') : t(mode === 'remove' ? 'confirm_delete' : 'save')}
      </Button>
    </>}>
      <div className="space-y-4">
        <p className="text-sm font-medium">{channel?.name}</p>
        {mode === 'edit' ? <>
          <p className="text-sm text-muted-foreground">{t('edit_hint')}</p>
          <Field label={t('body')}><textarea className={inputCls + ' min-h-48 resize-y'} value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} /></Field>
          <Field label={t('tags')} hint={t('tags_hint')}><input className={inputCls} value={tags} disabled={busy} onChange={(e) => setTags(e.target.value)} /></Field>
          {tagList.length > FB.tagsMax && <Notice tone="error">{t('too_many_tags')}</Notice>}
        </> : <>
          <Notice>{t('delete_hint')}</Notice>
          <p className="max-h-48 overflow-y-auto text-sm whitespace-pre-wrap">{post.body}</p>
        </>}
        {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      </div>
    </Dialog>
  </>
}
