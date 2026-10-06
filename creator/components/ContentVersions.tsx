import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, Clock3, FileText, Loader2, MoreHorizontal, Plus, Send, SlidersHorizontal, Sparkles, Trash2, Upload, X } from 'lucide-react'
import AssetPicker from './AssetPicker'
import Select from './Select'
import RichEditor from './RichEditor'
import RunButton from './RunButton'
import { TaskRequirements, useTaskRuns } from './Task'
import { Badge, Button, Dialog, Field, Notice, cx, fmtTime, inputCls } from './ui'
import { fmtNum } from '../lib/format'
import { CHANNEL_TYPES } from '../lib/channels'
import { useInShuttle } from '../lib/useShuttle'
import { dbCreate, dbDelete, dbList, dbPatch, runLocal, shuttleImage, uploadLocalFile, videoSrc, type Article, type Channel, type SocialPost } from '../lib/shuttle'
import { SOCIAL, SOCIAL_TASKS, writeSocial } from '../lib/social'
import { tr } from '../lib/i18n'
import type { Ctx } from './views/types'

const parse = (s?: string): string[] => { try { return JSON.parse(s || '[]') } catch { return [] } }
const metricsLine = (p: SocialPost) => tr('versions.metrics', { v: fmtNum(p.views ?? 0), l: fmtNum(p.likes ?? 0), c: fmtNum(p.comments ?? 0) })
const statusTone = (s?: string) => s === 'published' ? 'ok' as const : s === 'failed' ? 'bad' as const : s === 'pending_review' ? 'warn' as const : 'default' as const
/** 没发出去的社媒版本都能删记录（和 social.purge 一致） */
const deletable = (p: SocialPost) => p.status !== 'published' && p.status !== 'publishing'

function ChannelAvatar({ ch }: { ch: Channel }) {
  const Icon = CHANNEL_TYPES[ch.type]?.icon
  return ch.avatar ? <img src={shuttleImage(ch.avatar)} alt="" loading="lazy" className="size-7 shrink-0 rounded-full object-cover" /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{Icon && <Icon size={13} />}</span>
}

/**
 * 一个初稿下的各社媒账号版本。只列已经加了版本的账号；「添加账号」一次选一个或多个，空白新建或交给 AI 一起写；
 * 「批量发布」把审核通过的版本一次发出去。
 */
export default function ContentVersions({ ctx, article, focus, onChanged }: { ctx: Ctx; article: Article; /** 打开时展开的版本：social_posts 的 id（从社交媒体页、日历点过来），或账号 id（从内容列表的账号标签点过来） */ focus?: string; onChanged: () => void }) {
  const [selected, setSelected] = useState(focus ?? '')
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const accounts = ctx.channels.filter((ch) => !!SOCIAL[ch.type])
  const load = useCallback(() => {
    dbList('social_posts').then((ps) => setPosts(ps.filter((p) => p.article_id === article.id))).catch((e) => setError((e as Error).message))
  }, [article.id])
  useEffect(load, [load, ctx.rev])
  const writer = useTaskRuns(SOCIAL_TASKS, (r) => r.input?.source?.id === article.id, load)
  const act = async (key: string, fn: () => Promise<unknown>, reportError: (message: string) => void = setError) => {
    setBusy(key); setError(''); reportError('')
    try { await fn(); load(); onChanged(); return true } catch (e) { reportError((e as Error).message); return false } finally { setBusy('') }
  }
  const ownPosts = (ch: Channel) => posts.filter((p) => p.channel_id === ch.id && p.status !== 'removed')
  const running = (ch: Channel) => writer.runs.find((r) => (r.input?.channel_ids ?? []).includes(ch.id))
  // 列出来的账号：有版本或正在生成的
  const shownAccounts = accounts.filter((ch) => ownPosts(ch).length || running(ch))
  const addable = accounts.filter((ch) => !shownAccounts.includes(ch))
  // 一个能发的网站、账号都没有：「添加」点了也没得选，提示去渠道页加（带链接）
  const noChannels = !accounts.length
  const blankPost = async (ch: Channel) => {
    const t = new Date().toISOString()
    return dbCreate('social_posts', { article_id: article.id, channel_id: ch.id, title: article.title, body: '', tags: '[]', images: '[]', status: 'draft', source: 'manual', created_at: t, updated_at: t })
  }
  const add = (ids: string[], ai: boolean) => act('add', async () => {
    const chs = ctx.channels.filter((c) => ids.includes(c.id))
    // 空白新建，或者一次交给 AI（按平台各开一段对话）
    const social = chs.filter((c) => !!SOCIAL[c.type])
    if (ai && social.length) await writeSocial(article.id, social.map((c) => c.id), accounts)
    else for (const ch of social) { const p = await blankPost(ch); if (social.length === 1) setSelected(p.id) }
    setAdding(false)
  })
  const publishable = [
    ...posts.filter((p) => p.status === 'approved' || p.status === 'failed').map((p) => ({ key: p.id, ch: ctx.channels.find((c) => c.id === p.channel_id), title: p.title || tr('versions.untitled'), run: () => runLocal('social/social.publish', { post_id: p.id }) })),
  ].filter((x): x is typeof x & { ch: Channel } => !!x.ch)

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold">{tr('versions.title')}</h2><p className="mt-1 text-xs text-muted-foreground">{tr('versions.desc')}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {!!publishable.length && <Button fn="social/social.publish" size="sm" variant="outline" onClick={() => setPublishing(true)}><Send />{tr('versions.publish_batch', { n: publishable.length })}</Button>}
        <Button size="sm" disabled={!addable.length} title={noChannels ? tr('versions.no_channels') : !addable.length ? tr('versions.all_added') : undefined} onClick={() => setAdding(true)}><Plus />{tr('versions.add_channels')}</Button>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{tr('versions.flow_hint')}</p>
    {error && <Notice tone="error">{error}</Notice>}
    {!shownAccounts.length && <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      {noChannels ? <p className="text-sm text-muted-foreground">
        {tr('versions.no_channels')}
        <button type="button" className="ml-1 cursor-pointer text-primary-text hover:underline" onClick={() => ctx.go('channels')}>{tr('versions.go_add', { name: tr('nav.channels') })}</button>
      </p> : <>
        <p className="text-sm text-muted-foreground">{tr('versions.empty')}</p>
        <Button size="sm" className="mt-3" disabled={!addable.length} onClick={() => setAdding(true)}><Plus />{tr('versions.add_channels')}</Button>
      </>}
    </div>}
    <div className="space-y-2">
      {shownAccounts.map((ch) => {
        const pf = SOCIAL[ch.type]!
        const own = ownPosts(ch)
        const run = running(ch)
        const post = own.find((p) => p.id === selected) ?? (selected === ch.id ? own[0] : undefined)
        const open = selected === ch.id || !!post
        const head = post ?? own[0]
        const panelId = `social-version-${ch.id}`
        // 发出去的版本：最近一条的互动（采集时更新），看这篇发得怎么样不用离开内容页
        const live = own.filter((p) => p.status === 'published' && p.metrics_at).sort((a, b) => Date.parse(b.published_at || '') - Date.parse(a.published_at || ''))[0]
        return <div key={ch.id} className={cx('min-w-0 rounded-lg border', open ? 'border-primary/50' : 'border-border')}>
          <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
            <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setSelected(open ? '' : own[0]?.id || ch.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
              <ChevronDown className={cx('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
              <ChannelAvatar ch={ch} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{ch.name}</span><span className="block truncate text-xs text-muted-foreground">{pf.label}{own.length > 1 ? ` · ${tr('versions.count', { n: own.length })}` : ''}{live ? ` · ${metricsLine(live)}` : ''}</span></span>
            </button>
            {run ? <Badge tone="warn">{tr('versions.generating')}</Badge> : head && <Badge tone={statusTone(head.status)}>{tr(`meta.social_status.${head.status}`)}</Badge>}
            <AccountMenu disabled={!!busy} running={!!run} task={writer.tasks.find((t) => t.id === pf.task) ?? null} onSavedTask={writer.setTask} pfLabel={pf.label} noun={pf.noun}
              onAi={() => act(ch.id, () => writeSocial(article.id, [ch.id], accounts))}
              onBlank={() => act(ch.id, async () => { const p = await blankPost(ch); setSelected(p.id) })} />
          </div>
          {open && <div id={panelId} className="border-t border-border">
            {own.length > 1 && <div className="border-b border-border p-4">
              <Select value={post?.id ?? ''} onChange={setSelected} ariaLabel={tr('versions.choose')} title={tr('versions.choose')} options={own.map((p) => ({ value: p.id, label: `${p.title || tr('versions.untitled')} · ${tr(`meta.social_status.${p.status}`)}`, icon: <FileText className="size-4" /> }))} />
            </div>}
            {post ? <SocialVersion key={post.id} post={post} ch={ch} act={act} busy={busy} onChanged={load} onOpenData={() => ctx.go('social', { section: 'data', account: ch.id })} /> : <div className="p-4"><Notice>{run ? tr('versions.generating_hint') : tr('versions.not_created')}</Notice></div>}
          </div>}
        </div>
      })}
    </div>
    <AddChannelsDialog open={adding} channels={addable} busy={busy === 'add'} onClose={() => setAdding(false)} onAdd={add} />
    <PublishDialog open={publishing} items={publishable} onClose={() => { setPublishing(false); load(); onChanged() }} />
  </section>
}

/** 社媒账号那一行右边的「⋯」：再写一版（AI / 空白）、这个平台的 AI 要求。常用的审核、发布在展开后的版本里 */
function AccountMenu({ disabled, running, task, onSavedTask, pfLabel, noun, onAi, onBlank }: { disabled: boolean; running: boolean; task: Parameters<typeof TaskRequirements>[0]['task']; onSavedTask: Parameters<typeof TaskRequirements>[0]['onSaved']; pfLabel: string; noun: string; onAi: () => void; onBlank: () => void }) {
  const [open, setOpen] = useState(false)
  const [req, setReq] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const shuttle = useInShuttle() // 交给 AI 写要 Shuttle；空白新建只写表，哪里都能做
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const item = 'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:cursor-default disabled:opacity-50'
  return <div ref={ref} className="relative shrink-0">
    <Button size="sm" variant="ghost" aria-label={tr('versions.more')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><MoreHorizontal /></Button>
    {open && <div role="menu" className="absolute top-full right-0 z-30 mt-1 w-52 rounded-xl border border-border bg-background p-1 shadow-lg">
      <button type="button" role="menuitem" className={item} disabled={disabled || running || !shuttle} onClick={() => { setOpen(false); onAi() }}><Sparkles className="size-4" />{tr('versions.ai')}</button>
      <button type="button" role="menuitem" className={item} disabled={disabled} onClick={() => { setOpen(false); onBlank() }}><Plus className="size-4" />{tr('versions.new_blank')}</button>
      {task && <><div role="separator" className="my-1 border-t border-border" /><button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); setReq(true) }}><SlidersHorizontal className="size-4" />{tr('versions.ai_req')}</button></>}
    </div>}
    <TaskRequirements task={task} onSaved={onSavedTask} title={tr('social.req_title', { p: pfLabel })} hint={tr('social.req_hint', { noun })} open={req} onOpenChange={setReq} />
  </div>
}

/** 添加渠道：勾一个或多个还没有版本的网站和账号。网站版本从初稿复制；社媒账号可以空白新建，也可以一次交给 AI 写 */
function AddChannelsDialog({ open, channels, busy, onClose, onAdd }: { open: boolean; channels: Channel[]; busy: boolean; onClose: () => void; onAdd: (ids: string[], ai: boolean) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => { if (open) setPicked([]) }, [open])
  const toggle = (id: string) => setPicked((l) => l.includes(id) ? l.filter((x) => x !== id) : [...l, id])
  const social = picked.filter((id) => { const ch = channels.find((c) => c.id === id); return ch && !!SOCIAL[ch.type] })
  return <Dialog open={open} onClose={onClose} title={tr('versions.add_title')} width={560} footer={<>
    <Button variant="ghost" size="sm" onClick={onClose}>{tr('common.cancel')}</Button>
    <Button variant="outline" size="sm" disabled={busy || !picked.length} onClick={() => onAdd(picked, false)}><Plus />{tr('versions.add_blank')}</Button>
    <Button needsShuttle size="sm" disabled={busy || !social.length} title={!social.length ? tr('versions.add_ai_need_social') : undefined} onClick={() => onAdd(picked, true)}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{tr('versions.add_ai', { n: social.length })}</Button>
  </>}>
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{tr('versions.add_hint')}</p>
      {!channels.length ? <Notice>{tr('versions.all_added')}</Notice> : <div className="max-h-80 space-y-1 overflow-y-auto">{channels.map((ch) => <label key={ch.id} className={cx('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2', picked.includes(ch.id) ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-accent/50')}>
        <input type="checkbox" checked={picked.includes(ch.id)} onChange={() => toggle(ch.id)} className="size-4 accent-primary" />
        <ChannelAvatar ch={ch} />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{ch.name}</span><span className="block truncate text-xs text-muted-foreground">{CHANNEL_TYPES[ch.type]?.label}</span></span>
      </label>)}</div>}
    </div>
  </Dialog>
}

type PublishItem = { key: string; ch: Channel; title: string; run: () => Promise<unknown> }

/** 批量发布：列出审核通过的社媒版本和配好发布的网站版本，默认全选，一条条发，结果逐条显示 */
function PublishDialog({ open, items, onClose }: { open: boolean; items: PublishItem[]; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const [result, setResult] = useState<Record<string, 'running' | 'ok' | string>>({})
  const [running, setRunning] = useState(false)
  useEffect(() => { if (open) { setPicked(items.map((i) => i.key)); setResult({}) } }, [open])
  const go = async () => {
    setRunning(true)
    for (const it of items.filter((i) => picked.includes(i.key))) {
      setResult((r) => ({ ...r, [it.key]: 'running' }))
      try { await it.run(); setResult((r) => ({ ...r, [it.key]: 'ok' })) } catch (e) { setResult((r) => ({ ...r, [it.key]: (e as Error).message })) }
    }
    setRunning(false)
  }
  const done = Object.keys(result).length > 0 && !running
  return <Dialog open={open} onClose={() => { if (!running) onClose() }} title={tr('versions.publish_title')} width={560} footer={done ? <Button size="sm" onClick={onClose}>{tr('common.close')}</Button> : <>
    <Button variant="ghost" size="sm" disabled={running} onClick={onClose}>{tr('common.cancel')}</Button>
    <Button size="sm" disabled={running || !picked.length} onClick={go}>{running ? <Loader2 className="animate-spin" /> : <Send />}{tr('versions.publish_go', { n: picked.length })}</Button>
  </>}>
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{tr('versions.publish_hint')}</p>
      <div className="max-h-80 space-y-1 overflow-y-auto">{items.map((it) => {
        const r = result[it.key]
        return <label key={it.key} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" disabled={running || done} checked={picked.includes(it.key)} onChange={() => setPicked((l) => l.includes(it.key) ? l.filter((x) => x !== it.key) : [...l, it.key])} className="size-4 accent-primary" />
          <ChannelAvatar ch={it.ch} />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{it.ch.name}</span><span className="block truncate text-xs text-muted-foreground">{r && r !== 'running' && r !== 'ok' ? <span className="text-destructive">{r}</span> : it.title}</span></span>
          {r === 'running' ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : r === 'ok' ? <Badge tone="ok">{tr('versions.published')}</Badge> : r ? <Badge tone="bad">{tr('versions.failed')}</Badge> : null}
        </label>
      })}</div>
    </div>
  </Dialog>
}

function SocialVersion({ post, ch, act, busy, onChanged, onOpenData }: { post: SocialPost; ch: Channel; act: (key: string, fn: () => Promise<unknown>, reportError?: (message: string) => void) => void; busy: string; onChanged: () => void; onOpenData: () => void }) {
  const [error, setError] = useState('')
  const run = (key: string, fn: () => Promise<unknown>) => act(key, fn, setError)
  const pf = SOCIAL[ch.type]!
  const [title, setTitle] = useState(post.title)
  const [body, setBody] = useState(post.body || '')
  const [tags, setTags] = useState(parse(post.tags).join(' '))
  const [cover, setCover] = useState(post.cover_text || '')
  const [images, setImages] = useState(parse(post.images))
  const [video, setVideo] = useState(post.video || '')
  const [category, setCategory] = useState(post.category || '')
  const [schedule, setSchedule] = useState('')
  const [picker, setPicker] = useState<'image' | 'video' | ''>('')
  const [uploading, setUploading] = useState(false)
  const tagList = tags.split(/[\s,，#]+/).filter(Boolean)
  const published = post.status === 'published' || post.status === 'publishing'
  // 媒体按平台规则来，不用切「纯文字 / 图文 / 视频」：只发视频的平台只有视频；图文和视频二选一的，放了视频就不能再放图，反过来一样
  const videoOnly = pf.video === 'only'
  const canVideo = !!pf.video
  const canImages = !videoOnly && pf.imagesMax > 0
  const hasVideo = canVideo && !!video
  const data = () => ({ title: title.trim() || body.slice(0, 30), body: body.trim(), tags: JSON.stringify(tagList), images: JSON.stringify(hasVideo || !canImages ? [] : images), video: canVideo ? video : '', cover_text: cover.trim(), category: category.trim(), updated_at: new Date().toISOString() })
  const save = () => run('social-save', async () => { await dbPatch('social_posts', post.id, { ...data(), ...(post.status === 'approved' || post.status === 'scheduled' || post.status === 'failed' ? { status: 'pending_review' as const, scheduled_at: '' } : {}) }); onChanged() })
  const submit = () => run('social-submit', async () => {
    await dbPatch('social_posts', post.id, data())
    const result = await runLocal<{ problems: string[] }>('social/social.check', { post_id: post.id })
    if (result.problems?.length) throw new Error(result.problems.join('；'))
    await dbPatch('social_posts', post.id, { status: 'pending_review' })
  })
  const setStatus = (status: SocialPost['status']) => run(status, () => dbPatch('social_posts', post.id, { status }))
  const schedulePost = () => run('social-schedule', async () => {
    if (!schedule || Date.parse(schedule) <= Date.now()) throw new Error(tr('versions.future_time'))
    await dbPatch('social_posts', post.id, { status: 'scheduled', scheduled_at: new Date(schedule).toISOString() })
  })
  const upload = async (file?: File) => { if (!file) return; setUploading(true); try { const r = await uploadLocalFile(file); setVideo(r.ref) } finally { setUploading(false) } }
  const mediaHint = videoOnly ? tr('social.media_video_only') : canVideo && canImages ? tr('social.media_either', { n: pf.imagesMax }) : canImages ? tr('social.media_images', { n: pf.imagesMax }) : ''
  return <div className="min-w-0 space-y-4 p-4">
    {(post.post_url || post.status === 'published') && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {post.status === 'published' && <span className="text-muted-foreground tabular-nums">{post.metrics_at ? `${metricsLine(post)} · ${tr('versions.metrics_at', { when: fmtTime(post.metrics_at) })}` : tr('versions.no_metrics')}</span>}
      {post.status === 'published' && <button type="button" onClick={onOpenData} className="cursor-pointer text-primary-text hover:underline">{tr('versions.view_data')}</button>}
      {post.post_url && <a href={post.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-text">{tr('content.view_live')}<ArrowUpRight className="size-3" /></a>}
    </div>}
    {published && <Notice>{tr('versions.published_locked')}</Notice>}
    <fieldset disabled={published} className="space-y-4">
    <Field label={pf.title ? tr('social.f_title') : tr('social.f_title_x')} hint={String([...title].length)}><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
    <Field label={tr('social.f_body')} hint={`${pf.len(body, tagList)} · ${pf.bodyHint}`}><textarea className={cx(inputCls, 'min-h-64 py-3 leading-relaxed')} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
    <Field label={tr('social.f_tags')}><input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
    <Field label={videoOnly ? tr('social.f_video') : tr('social.f_media')} hint={mediaHint}>
      <div className="space-y-2">
        {canImages && !hasVideo && !!images.length && <div className="flex flex-wrap gap-2">{images.map((u, i) => <div key={u + i} className="relative"><img src={u} alt="" className="size-24 rounded border border-border object-cover" /><button type="button" aria-label={tr('social.remove_image')} onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-foreground text-background opacity-80 hover:opacity-100"><X className="size-3" /></button></div>)}</div>}
        {hasVideo && <div className="relative"><video src={videoSrc(video)} controls className="max-h-72 w-full rounded bg-black" /><Button size="sm" variant="ghost" className="mt-1" onClick={() => setVideo('')}><X />{tr('social.remove_video')}</Button></div>}
        <div className="flex flex-wrap gap-2">
          {canImages && !hasVideo && images.length < pf.imagesMax && <Button size="sm" variant="outline" onClick={() => setPicker('image')}><Plus />{tr('social.pick_assets')}</Button>}
          {canVideo && !hasVideo && !images.length && <><Button size="sm" variant="outline" onClick={() => setPicker('video')}>{tr('social.pick_video')}</Button><label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:bg-accent"><Upload className="size-3.5" />{uploading ? tr('social.uploading_pct', { n: 0 }) : tr('social.upload_local')}<input type="file" accept="video/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} /></label></>}
        </div>
      </div>
    </Field>
    <AssetPicker open={!!picker} kind={picker || 'image'} max={picker === 'video' ? 1 : pf.imagesMax - images.length} onClose={() => setPicker('')} onPick={(urls) => { if (picker === 'video') setVideo(urls[0] || ''); else setImages((l) => [...l, ...urls.filter((u) => !l.includes(u))].slice(0, pf.imagesMax)); setPicker('') }} />
    {pf.cover && !hasVideo && !images.length && <Field label={tr('social.f_cover')} hint={tr('social.cover_hint')}><input className={inputCls} value={cover} onChange={(e) => setCover(e.target.value)} /></Field>}
    {ch.type === 'bilibili' && <Field label={tr('social.category')}><input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} /></Field>}
    </fieldset>
    {(error || post.error) && <Notice tone="error">{error || post.error}</Notice>}
    {post.status === 'publishing' && <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4"><p className="min-w-0 flex-1 text-xs text-muted-foreground">{tr('social.stuck_hint')}</p><Button variant="outline" onClick={() => run('mark-failed', () => dbPatch('social_posts', post.id, { status: 'failed', error: tr('social.stuck_error') }))} disabled={!!busy}>{tr('social.mark_failed')}</Button></div>}
    {!published && <div key={post.status} className="space-y-3 border-t border-border pt-4">
      {/* 这一版走到哪一步、下一步做什么：草稿 → 提交审核 → 通过审核 → 发布或排期 */}
      <p className="text-xs text-muted-foreground">{tr(`versions.step_${post.status}`)}</p>
      <div className="flex flex-wrap items-center gap-2">
        {(post.status === 'draft' || post.status === 'rejected') && <Button successLabel={tr('ui.submitted')} onClick={submit} disabled={!!busy}><Check />{tr('versions.submit')}</Button>}
        {post.status === 'pending_review' && <Button successLabel={tr('ui.approved')} onClick={() => setStatus('approved')} disabled={!!busy}>{busy === 'approved' ? <Loader2 className="animate-spin" /> : <Check />}{tr('versions.approve')}</Button>}
        {(post.status === 'approved' || post.status === 'failed') && <>
          <RunButton inline size="default" variant="default" fn="social/social.publish" input={{ post_id: post.id }} icon={Send} onError={setError} onDone={onChanged}>{tr('social.publish_now')}</RunButton>
          <input type="datetime-local" aria-label={tr('social.schedule')} className={cx(inputCls, 'w-48')} value={schedule} onChange={(e) => setSchedule(e.target.value)} />
          <Button successLabel={tr('ui.scheduled')} variant="outline" onClick={schedulePost} disabled={!!busy}><Clock3 />{tr('social.schedule')}</Button>
        </>}
        {post.status === 'scheduled' && <Button successLabel={tr('ui.approved')} variant="outline" onClick={() => setStatus('approved')} disabled={!!busy}>{tr('versions.unschedule')}</Button>}
        <Button successLabel={tr('ui.saved')} variant="outline" onClick={save} disabled={!!busy}>{busy === 'social-save' && <Loader2 className="animate-spin" />}{tr('common.save')}</Button>
        {deletable(post) && <Button fn="social/social.purge" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => run('purge', () => runLocal('social/social.purge', { post_id: post.id }))} disabled={!!busy}><Trash2 />{tr('versions.delete_version')}</Button>}
      </div>
    </div>}
  </div>
}
