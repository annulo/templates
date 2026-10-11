import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquare, RefreshCw } from 'lucide-react'
import { canViewFacebookComments, mergeFacebookComments, type FacebookComment, type FacebookCommentPage } from '../lib/facebookComments'
import { tr } from '../lib/i18n'
import { runLocal, type Channel, type SocialPost } from '../lib/shuttle'
import { Button, Dialog, ErrorDetails, fmtTime } from './ui'

export default function FacebookComments({ post, channel }: { post: SocialPost; channel?: Channel }) {
  const [open, setOpen] = useState(false)
  if (!canViewFacebookComments(post, channel)) return null
  return <>
    <button type="button" onClick={() => setOpen(true)} className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-sm font-medium text-primary-text hover:underline"><MessageSquare className="size-3.5" />{tr('facebook_comments.view')}</button>
    {open && <CommentDialog key={`${post.id}:${post.post_id}:${channel?.oauth_account ?? ''}`} post={post} channel={channel!} onClose={() => setOpen(false)} />}
  </>
}

function CommentDialog({ post, channel, onClose }: { post: SocialPost; channel: Channel; onClose: () => void }) {
  const [comments, setComments] = useState<FacebookComment[] | null>(null)
  const [after, setAfter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState('')
  const pending = useRef(false)
  const request = useRef(0)
  const read = async (cursor = '') => {
    if (pending.current) return
    pending.current = true
    const version = ++request.current
    setBusy(true)
    setError('')
    try {
      const page = await runLocal<FacebookCommentPage>('social/facebook.comments', { post_id: post.id, ...(cursor ? { after: cursor } : {}) })
      if (version !== request.current) return
      setComments((old) => mergeFacebookComments(cursor ? old ?? [] : [], page.comments))
      setAfter(page.next_cursor)
      setLoadedAt(new Date().toISOString())
    } catch (e) {
      if (version === request.current) setError((e as Error).message)
    } finally {
      if (version === request.current) { pending.current = false; setBusy(false) }
    }
  }
  useEffect(() => {
    void read()
    return () => { request.current++; pending.current = false }
  }, [])
  return <Dialog open onClose={onClose} title={tr('facebook_comments.title')} width={640} footer={<Button variant="outline" onClick={onClose}>{tr('common.close')}</Button>}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="text-sm font-medium [overflow-wrap:anywhere]">{post.title || post.body?.split('\n')[0] || channel.name}</p><p className="mt-1 text-xs text-muted-foreground">{channel.name}{loadedAt && ` · ${tr('facebook_comments.updated', { when: fmtTime(loadedAt) })}`}</p></div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void read()}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}{tr('facebook_comments.refresh')}</Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{tr('facebook_comments.hint')}</p>
      {error && <div role="alert"><ErrorDetails message={error} /></div>}
      <div aria-busy={busy} aria-live="polite">
        {comments === null && busy ? <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tr('facebook_comments.loading')}</p> : comments !== null && !comments.length && !error && !busy ? <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">{tr('facebook_comments.empty')}</p> : null}
        {!!comments?.length && <ol className="divide-y divide-border rounded-lg border border-border">{comments.map((comment, i) => <li key={comment.id || `comment-${i}`} className="space-y-2 p-4"><p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{comment.message || tr('facebook_comments.no_text')}</p>{comment.created_time && <time dateTime={comment.created_time} title={comment.created_time} className="block text-xs text-muted-foreground">{fmtTime(comment.created_time)}</time>}</li>)}</ol>}
      </div>
      {comments !== null && <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{tr('facebook_comments.loaded', { n: comments.length })}</span>{after && <Button size="sm" variant="outline" disabled={busy} onClick={() => void read(after)}>{busy ? <Loader2 className="animate-spin" /> : null}{tr('facebook_comments.more')}</Button>}</div>}
    </div>
  </Dialog>
}
