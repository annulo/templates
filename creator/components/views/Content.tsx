import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Loader, Pencil, Plus, Repeat2, Send, Trash2, X, Sparkles, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { WritingBriefDialog } from '../ContentEvidence'
import { ArticleEditor, ArticleView, draftOf, patchOf, sameDraft, type ArticleDraft } from '../ArticleEditor'
import { ARTICLE_TYPES, TYPE_META, TypeBadge, TypePicker, typeOf, type ArticleType } from '../ArticleTypes'
import { PublishDialog, PublishRecords } from '../ArticlePublish'
import RewriteDialog, { REWRITE_TASK } from '../RewriteDialog'
import { Badge, Button, Dialog, Field, Notice, PageHeader, Segmented, Skeleton, cx, fmtTime, inputCls, toast, type Tone } from '../ui'
import { TaskButton, TaskFailed, TaskRequirements, TaskRunning, useTask } from '../Task'
import { CHANNEL_TYPES } from '../../lib/channels'
import { dbCreate, dbDelete, dbList, dbPatch, type Article, type ArticleStatus, type Publication, type SocialPost, type Topic, type TopicStatus } from '../../lib/shuttle'
import type { Ctx } from './types'
import { numLocale, tr } from '../../lib/i18n'

// label 按当前语言取（getter）
const lbl = (key: string, tone: Tone) => ({ get label() { return tr(key) }, tone })
// 文章只有「草稿 / 已发布」两种：至少一个账号发出去了就是已发布。老数据里的 pending_review、rejected 按草稿显示
const ARTICLE_STATUS: Partial<Record<ArticleStatus, { label: string; tone: Tone }>> = {
  draft: lbl('content.a_draft', 'default'),
  published: lbl('content.a_published', 'ok'),
}
const TOPIC_STATUS: Record<TopicStatus, { label: string; tone: Tone }> = {
  idea: lbl('content.t_idea', 'primary'),
  writing: lbl('content.t_writing', 'warn'),
  done: lbl('content.t_done', 'ok'),
  dropped: lbl('content.t_dropped', 'default'),
}

type Tab = 'articles' | 'topics'

/** 任务 id（tasks/write-article.md）：「写一篇」「写成文章」交给助手按它写，过程看得见 */
const WRITE_TASK = 'write-article'
/** 任务 id（tasks/revise-article.md）：文章页「AI 修改」 */
const REVISE_TASK = 'revise-article'
/** 任务 id（tasks/suggest-topics.md）：「出一批选题」，GEO 页「写成选题」也是它 */
export const TOPICS_TASK = 'suggest-topics'
type Writer = ReturnType<typeof useTask>
type WriteInput = { topic_id?: string; subject?: string; channel_id?: string }

/**
 * 删掉一篇文章：已经发出去、正在发、排了期的不能删（先在发布记录里处理）；没发出去的发布记录（社媒的、网站的）一起删掉，
 * 免得留下指向不存在的文章的记录。删完顶部提示一下
 */
async function removeArticle(a: Article, posts: SocialPost[], pubs: Publication[]) {
  const mine = posts.filter((p) => p.article_id === a.id)
  const sites = pubs.filter((p) => p.article_id === a.id)
  if (mine.some((p) => ['published', 'publishing', 'scheduled'].includes(p.status)) || sites.some((p) => p.status === 'published' || p.status === 'publishing' || !!p.scheduled_at)) throw new Error(tr('article.delete_published'))
  for (const p of mine) await dbDelete('social_posts', p.id)
  for (const p of sites) await dbDelete('publications', p.id)
  await dbDelete('articles', a.id)
  toast(tr('article.deleted', { title: a.title || tr('versions.untitled') }))
}

/** 内容：文章（一篇一种类型，直接发到支持它的账号）和选题池 */
export default function Content({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const tab: Tab = params.tab === 'topics' ? 'topics' : 'articles'
  const [articles, setArticles] = useState<Article[] | null>(null)
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [posts, setPosts] = useState<SocialPost[]>([])
  // 网站的发布记录（publications）：一篇文章在一个网站上一行
  const [pubs, setPubs] = useState<Publication[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  // 社媒工作区的创建按钮进入同一套内容编辑流程；打开新建表单，不自动保存。
  useEffect(() => {
    if (params.new !== '1') return
    setCreating(true)
    setParam('new', '')
  }, [params.new])
  const [writingInput, setWritingInput] = useState<WriteInput | null>(null)
  const [writingType, setWritingType] = useState<ArticleType>('article')
  const [writingRequirements, setWritingRequirements] = useState('')
  // 「写作要求」在页头的「更多」里
  const [reqOpen, setReqOpen] = useState(false)

  const load = useCallback(() => {
    Promise.all([dbList('articles'), dbList('topics'), dbList('social_posts').catch(() => []), dbList('publications').catch(() => [])])
      .then(([a, t, p, pb]) => {
        setPosts(p.filter((x) => !!x.article_id))
        setPubs(pb)
        setArticles(a)
        setTopics(t)
      })
      .catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    setArticles(null)
    setTopics(null)
    load()
  }, [load])
  // 助手改了数据：静默重拉，不清空
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])
  // 后台发布（lib/publishQueue）发完一条、页面里改了文章或发布记录：静默重拉，发布记录和「已发布」跟着变
  useEffect(() => {
    const f = (e: Event) => { const t = (e as CustomEvent<{ table?: string }>).detail?.table; if (t === 'social_posts' || t === 'publications' || t === 'articles') load() }
    window.addEventListener('db:changed', f)
    return () => window.removeEventListener('db:changed', f)
  }, [load])
  // 每篇发到了哪些网站和账号（只算发出去的）：列表里显示成标签，也决定「已发布」
  const publishedTo = useMemo(() => {
    const to: Record<string, { id: string; channel_id: string }[]> = {}
    for (const p of pubs) if (p.status === 'published') (to[p.article_id] ??= []).push({ id: p.channel_id, channel_id: p.channel_id })
    for (const p of posts) if (p.status === 'published') (to[p.article_id!] ??= []).push(p)
    return to
  }, [posts, pubs])
  const statusOf = (a: Article): ArticleStatus => (publishedTo[a.id]?.length || a.status === 'published' ? 'published' : 'draft')

  const writer = useTask(WRITE_TASK, load)
  const openWriter = (input: WriteInput = {}, type: ArticleType = 'article') => {
    setWritingRequirements(writer.task?.prompt ?? '')
    setWritingType(type)
    setWritingInput(input)
  }
  const startWriting = async () => {
    if (!writingInput || !writingRequirements.trim()) return
    const id = await writer.run({ ...writingInput, type: writingType, writing_requirements: writingRequirements.trim() })
    if (id) { setWritingInput(null); setCreating(false) }
  }
  // 出选题的「AI 要求」按钮放在选题页的「出一批选题」旁边
  const suggester = useTask(TOPICS_TASK)
  const topicTitle = (id?: string) => topics?.find((t) => t.id === id)?.title
  const openArticle = params.article ? articles?.find((a) => a.id === params.article) : undefined
  const writerBusy = !writer.shuttle || !writer.task || writer.starting || !!writer.task.running.length

  if (openArticle) return <ArticleDetail key={openArticle.id} ctx={ctx} a={openArticle} all={articles ?? []} posts={posts.filter((p) => p.article_id === openArticle.id)} pubs={pubs.filter((p) => p.article_id === openArticle.id)} focus={params.version} displayStatus={statusOf(openArticle)} open={(id) => { setParam('version', ''); setParam('article', id) }} onBack={() => { setParam('version', ''); setParam('article', '') }} onChanged={load} />

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('content.title')}
        desc={tr('content.desc')}
        actions={
          <>
            <Button size="sm" onClick={() => { setParam('tab', 'articles'); setCreating(true) }}><Plus />{tr('content.new_article')}</Button>
            <Button variant="outline" size="sm" disabled={writerBusy} onClick={() => openWriter()}><Sparkles />{tr('content.write_one')}</Button>
            <HeaderMore items={[{ label: tr('content.req_btn'), icon: SlidersHorizontal, onClick: () => setReqOpen(true), hidden: !writer.task }]} />
          </>
        }
      />
      <div className="overflow-x-auto border-b border-border pb-3">
        <Segmented<Tab>
          value={tab}
          onChange={(v) => setParam('tab', v)}
          options={[
            { value: 'articles', label: `${tr('content.tab_articles')}${articles ? ` ${articles.length}` : ''}` },
            { value: 'topics', label: `${tr('content.tab_topics')}${topics ? ` ${topics.filter((t) => t.status === 'idea').length}` : ''}` },
          ]}
        />
      </div>
      {(error || writer.error) && <Notice tone="error">{error || writer.error}</Notice>}
      <TaskRunning
        runs={writer.task?.running ?? []}
        title={(r) => (topicTitle(r.input?.topic_id) ? tr('content.writing_topic', { title: topicTitle(r.input?.topic_id)! }) : r.input?.subject ? tr('content.writing_topic', { title: r.input.subject }) : tr('content.writing_pick'))}
        desc={tr('content.writing_desc')}
      />
      <TaskFailed task={writer.task} />
      {tab === 'articles' ? (
        <Articles ctx={ctx} publishedTo={publishedTo} openVersion={(id, version) => { setParam('version', version); setParam('article', id) }} list={articles?.map((a) => ({ ...a, status: statusOf(a) })) ?? null} status={params.status ?? ''} setStatus={(s) => setParam('status', s)} type={params.type ?? ''} setType={(t) => setParam('type', t)} open={(id) => setParam('article', id)} writer={writer} onWrite={() => openWriter()} onDelete={async (a) => { try { await removeArticle(a, posts, pubs); load() } catch (e) { toast((e as Error).message, 'error') } }} />
      ) : (
        <Topics ctx={ctx} list={topics} onChanged={load} writer={writer} suggester={suggester} onWrite={openWriter} />
      )}
      <TaskRequirements task={writer.task} onSaved={writer.setTask} title={tr('content.req_title')} hint={tr('content.req_hint')} open={reqOpen} onOpenChange={setReqOpen} />
      <NewArticleDialog open={creating} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); load(); setParam('article', id) }}
        aiDisabled={writerBusy}
        // 交给 AI：打开写作要求弹窗（类型、主题已经带上），确认后开写作任务
        onAi={(type, subject) => { setCreating(false); openWriter({ subject }, type) }} />
      <Dialog open={writingInput !== null} onClose={() => setWritingInput(null)} title={writingInput?.subject ? `${tr('content.write_one')} · ${writingInput.subject}` : tr('content.write_one')} width={700} footer={<><Button variant="ghost" onClick={() => setWritingInput(null)}>{tr('common.cancel')}</Button><Button onClick={startWriting} disabled={!writingRequirements.trim() || writer.starting}>{writer.starting ? <Loader className="animate-spin" /> : <Sparkles />}{tr('content.start_writing')}</Button></>}>
        <div className="space-y-4">
          <Field group label={tr('article.type')}><TypePicker value={writingType} onChange={setWritingType} /></Field>
          <p className="text-sm text-muted-foreground">{tr('content.one_time_requirements_hint')}</p>
          <Field label={tr('content.one_time_requirements')}><textarea value={writingRequirements} onChange={(e) => setWritingRequirements(e.target.value)} rows={12} className={cx(inputCls, 'py-2 leading-relaxed')} /></Field>
          {writer.error && <Notice tone="error">{writer.error}</Notice>}
        </div>
      </Dialog>
    </div>
  )
}

/** 页头的「更多」：不常用的设置（写作要求…）收在这里，点外面、按 Esc 收起 */
function HeaderMore({ items }: { items: { label: string; icon: typeof SlidersHorizontal; onClick: () => void; hidden?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const shown = items.filter((i) => !i.hidden)
  if (!shown.length) return null
  return <div ref={ref} className="relative">
    <Button variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{tr('content.more_actions')}<ChevronDown className="size-3.5" /></Button>
    {open && <div role="menu" className="absolute top-full right-0 z-40 mt-2 w-48 rounded-xl border border-border bg-popover p-1.5 text-sm text-popover-foreground shadow-xl">
      {shown.map((i) => <button key={i.label} type="button" role="menuitem" onClick={() => { setOpen(false); i.onClick() }} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"><i.icon className="size-4" />{i.label}</button>)}
    </div>}
  </div>
}

/** 新建文章：先选类型（字段、能发的平台跟着变），再写标题或主题；自己写就建一篇空的，或者交给 AI 写 */
function NewArticleDialog({ open, onClose, onDone, onAi, aiDisabled }: { open: boolean; onClose: () => void; onDone: (id: string) => void; onAi: (type: ArticleType, subject: string) => void; aiDisabled: boolean }) {
  const [type, setType] = useState<ArticleType>('article')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setTitle(''); setError(''); setType('article') } }, [open])
  const save = async () => {
    setSaving(true); setError('')
    try {
      const t = new Date().toISOString()
      const row = await dbCreate('articles', { type, title: title.trim(), summary: '', body: '', tags: '[]', status: 'draft', created_at: t, updated_at: t })
      onDone(row.id)
    } catch (e) { setError((e as Error).message); return false } finally { setSaving(false) }
  }
  return <Dialog open={open} onClose={onClose} title={tr('versions.new_source')} width={640} footer={<><Button variant="ghost" size="sm" onClick={onClose}>{tr('common.cancel')}</Button><Button needsShuttle variant="outline" size="sm" disabled={saving || aiDisabled || !title.trim()} onClick={() => onAi(type, title.trim())}><Sparkles />{tr('content.ai_write_this')}</Button><Button successLabel={tr('ui.saved')} size="sm" disabled={saving || !title.trim()} onClick={save}>{saving && <Loader className="animate-spin" />}{tr('common.save')}</Button></>}>
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      <Field group label={tr('article.type')} hint={tr('article.type_hint')}><TypePicker value={type} onChange={setType} /></Field>
      <Field label={tr('content.new_topic_label')} hint={tr('versions.new_hint')}><input autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void save() }} /></Field>
    </div>
  </Dialog>
}

function Articles({ ctx, publishedTo, openVersion, list, status, setStatus, type, setType, open, writer, onWrite, onDelete }: { onDelete: (a: Article) => Promise<void>; ctx: Ctx; publishedTo: Record<string, { id: string; channel_id: string }[]>; openVersion: (id: string, version: string) => void; list: Article[] | null; status: string; setStatus: (s: string) => void; type: string; setType: (t: string) => void; open: (id: string) => void; writer: Writer; onWrite: () => void }) {
  const [query, setQuery] = useState('')
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of list ?? []) { c[a.status] = (c[a.status] ?? 0) + 1; c['t:' + typeOf(a)] = (c['t:' + typeOf(a)] ?? 0) + 1 }
    return c
  }, [list])
  const needle = query.trim().toLocaleLowerCase()
  const shown = (list ?? []).filter((a) => (!status || a.status === status) && (!type || typeOf(a) === type) && (!needle || `${a.title} ${a.summary || ''} ${typeOf(a) === 'article' ? '' : a.body || ''}`.toLocaleLowerCase().includes(needle)))
  const chip = (on: boolean) => cx('inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors', on ? 'border-primary/40 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')

  if (!list) return <Skeleton className="h-40 rounded-xl" />
  if (list.length === 0)
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">{tr('content.no_articles')}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button size="sm" onClick={onWrite} disabled={!writer.shuttle || !writer.task || writer.starting || !!writer.task.running.length}>
            {writer.starting ? <Loader className="animate-spin" /> : <Sparkles />}
            {tr('content.write_one')}
          </Button>
        </div>
      </div>
    )
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" aria-label={tr('content.search')} placeholder={tr('content.search')} value={query} onChange={(e) => setQuery(e.target.value)} className={cx(inputCls, 'min-w-40 flex-1')} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {[['', tr('common.all'), list.length] as const, ...(Object.keys(ARTICLE_STATUS) as ArticleStatus[]).map((k) => [k, ARTICLE_STATUS[k]!.label, counts[k] ?? 0] as const)].map(([k, label, n]) =>
          k && !n ? null : <button key={k || 'all'} onClick={() => setStatus(k)} className={chip(status === k)}>{label}<span className="tabular-nums opacity-70">{n}</span></button>,
        )}
        <span className="mx-1 h-4 border-l border-border" />
        {ARTICLE_TYPES.map((t) => !counts['t:' + t] ? null : <button key={t} onClick={() => setType(type === t ? '' : t)} className={chip(type === t)}>{(() => { const I = TYPE_META[t].icon; return <I className="size-3" /> })()}{TYPE_META[t].label}<span className="tabular-nums opacity-70">{counts['t:' + t]}</span></button>)}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {shown.map((a) => {
          // 发到了哪些账号：点标签打开这篇、定位到那条发布记录。宽屏和状态标签一列、右边对齐；手机上放到标题下面换行，不挤标题
          const chips = !!publishedTo[a.id]?.length && publishedTo[a.id].map((v) => {
            const ch = ctx.channels.find((c) => c.id === v.channel_id)
            const Icon = ch ? CHANNEL_TYPES[ch.type]?.icon : undefined
            const label = ch ? ch.name : tr('content.removed_channel')
            const full = ch ? `${CHANNEL_TYPES[ch.type]?.label ?? ''} · ${ch.name}` : label
            return <button key={v.id} type="button" onClick={(e) => { e.stopPropagation(); openVersion(a.id, v.id) }} title={tr('content.open_version', { name: full })} className="inline-flex h-5 max-w-56 cursor-pointer items-center gap-1 rounded border border-border bg-muted/40 px-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary-text">{Icon && <Icon size={11} />}<span className="truncate">{label}</span></button>
          })
          const t = typeOf(a)
          const sub = t === 'article' ? a.summary : a.body
          return (
          <div key={a.id} role="button" tabIndex={0} onClick={() => open(a.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(a.id) } }} className={cx('group flex w-full cursor-pointer items-start gap-4 border-b border-border px-4 py-4 text-left last:border-b-0 hover:bg-accent/50', a.unread && 'bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring')}>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-sm font-medium leading-relaxed [overflow-wrap:anywhere] group-hover:text-primary-text">{a.unread && <span className="mr-1.5 inline-flex h-5 items-center rounded bg-primary px-1.5 align-[1px] text-[11px] font-semibold text-primary-foreground">{tr('article.new_badge')}</span>}{a.title || tr('versions.untitled')}</div>
              {sub && <div className="mt-1 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{sub}</div>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <TypeBadge type={t} />
                <span className="whitespace-nowrap">{tr('content.updated')} {fmtTime(a.updated_at || a.created_at)}</span>
              </div>
              {chips && <div className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden">{chips}</div>}
            </div>
            <div className="flex shrink-0 flex-col items-end justify-between gap-2 self-stretch">
              <span className="flex items-center gap-1">
                <RowDelete onDelete={() => onDelete(a)} />
                <Badge className="mt-0.5" tone={ARTICLE_STATUS[a.status]?.tone}>{ARTICLE_STATUS[a.status]?.label ?? a.status}</Badge>
              </span>
              {chips && <span className="hidden max-w-md flex-wrap items-center justify-end gap-1.5 md:flex">{chips}</span>}
            </div>
          </div>
          )
        })}
        {shown.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">{query.trim() ? tr('content.no_search_results') : tr('content.none_in_status')}</div>}
      </div>
    </div>
  )
}

/** 列表每行的删除：悬停时出现，点一下变成「确认删除」，再点才删；点到别处就取消。删不了的（发出去了）顶部提示原因 */
function RowDelete({ onDelete }: { onDelete: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return confirm
    ? <button type="button" disabled={busy} onClick={async (e) => { stop(e); setBusy(true); try { await onDelete() } finally { setBusy(false); setConfirm(false) } }} onBlur={() => !busy && setConfirm(false)} onKeyDown={stop} autoFocus
      className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md bg-destructive px-2 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-60">{busy ? <Loader className="size-3 animate-spin" /> : <Trash2 className="size-3" />}{tr('article.delete_confirm')}</button>
    : <button type="button" onClick={(e) => { stop(e); setConfirm(true) }} onKeyDown={stop} aria-label={tr('content.del')} title={tr('content.del')}
      className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
}

function ArticleDetail({ ctx, a, all, posts, pubs, focus, displayStatus, open, onBack, onChanged }: { ctx: Ctx; a: Article; all: Article[]; posts: SocialPost[]; pubs: Publication[]; focus?: string; displayStatus: ArticleStatus; open: (id: string) => void; onBack: () => void; onChanged: () => void }) {
  const type = typeOf(a)
  const [moreOpen, setMoreOpen] = useState(false)
  // 菜单往哪边展开：宽屏时按钮在一行最右边，往左；手机上按钮换到下一行的左边，往左会伸出屏幕，改往右。按打开时按钮的实际位置算
  const [moreLeft, setMoreLeft] = useState(false)
  const [requirementsOpen, setRequirementsOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!moreOpen) return
    moreRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const outside = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) { setMoreOpen(false); setConfirmDel(false) }
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMoreOpen(false); setConfirmDel(false); moreRef.current?.querySelector('button')?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [moreOpen])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ArticleDraft>(() => draftOf(a))
  // base：开始编辑时（或上次同步时）表里的内容。表里的文章在别处变了（AI 改完、别的窗口保存）：
  // 没动过就直接换成新的；动过了提示用户选（stale）。editorKey 换了编辑器才会重新载入内容
  const [base, setBase] = useState(draft)
  const [stale, setStale] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  // 顶上这条（按钮）是吸顶的：编辑器的工具条吸在它下面，不能吸到 top-0 被它盖住。高度会随换行变，量出来交给 --sticky-top
  const [headerH, setHeaderH] = useState(0)
  const headerObserver = useRef<ResizeObserver | null>(null)
  const headerRef = useCallback((el: HTMLDivElement | null) => {
    headerObserver.current?.disconnect()
    if (!el) return
    const measure = () => requestAnimationFrame(() => setHeaderH(el.offsetHeight))
    measure()
    headerObserver.current = new ResizeObserver(measure)
    headerObserver.current.observe(el)
  }, [])
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [rewritingOpen, setRewritingOpen] = useState(false)
  const st = ARTICLE_STATUS[displayStatus]
  // AI 修改：交给助手按任务 tasks/revise-article.md 改，它读的是表里现在的内容（包括手动改过的）
  const reviser = useTask(REVISE_TASK, onChanged)
  const revising = (reviser.task?.running ?? []).filter((r) => r.input?.article_id === a.id)
  // 改写：交给助手按任务 tasks/rewrite-article.md 另写一篇（原文不动），写好的出现在「改写出的文章」里
  const rewriter = useTask(REWRITE_TASK, onChanged)
  const rewriting = (rewriter.task?.running ?? []).filter((r) => r.input?.article_id === a.id)
  const source = a.source_id ? all.find((x) => x.id === a.source_id) : undefined
  const derived = all.filter((x) => x.source_id === a.id)
  // 刚改写完：上一次改写成功、是这篇的，挑那次之后存的改写出的文章，顶上给一个「打开」。点过「知道了」就不再提示（记在本机）
  const lastRewrite = !rewriting.length && rewriter.task?.last?.ok && rewriter.task.last.input?.article_id === a.id ? rewriter.task.last : null
  const doneKey = lastRewrite ? `creator.rewrite-seen:${a.id}:${lastRewrite.started_at}` : ''
  const [seen, setSeen] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('creator.rewrite-seen') || '[]') } catch { return [] } })
  const rewritten = lastRewrite && !seen.includes(doneKey) && Date.now() - Date.parse(lastRewrite.started_at) < 3 * 86400_000
    ? derived.filter((d) => (Date.parse(d.created_at || '') || 0) >= Date.parse(lastRewrite.started_at) - 60_000).sort((x, y) => (Date.parse(y.created_at || '') || 0) - (Date.parse(x.created_at || '') || 0))[0]
    : undefined
  const markSeen = () => { const next = [...seen, doneKey].slice(-50); setSeen(next); try { localStorage.setItem('creator.rewrite-seen', JSON.stringify(next)) } catch {} }
  // 改文章只写表，手机上（不在 Annulo 里）也能改；AI 修改、发布这些按钮自己会在 Annulo 外灰掉
  const locked = !!busy || revising.length > 0
  const fromRow = () => draftOf(a)
  const loadDraft = (d: ArticleDraft) => {
    setDraft(d)
    setBase(d)
    setStale(false)
    setEditorKey((k) => k + 1)
  }
  // 打开了就不再是新文章（左侧的数字跟着少一个）。只改这个字段，不动 updated_at
  useEffect(() => { if (a.unread) void dbPatch('articles', a.id, { unread: false }).then(onChanged).catch(() => {}) }, [a.id])
  // 空文章（刚新建的）直接进编辑
  useEffect(() => { if (!a.body && !a.video && !draftOf(a).images.length) { loadDraft(fromRow()); setEditing(true) } }, [a.id])
  useEffect(() => {
    if (!editing) return
    const now = fromRow()
    if (sameDraft(now, base)) return
    if (sameDraft(draft, base) || sameDraft(draft, now)) loadDraft(now)
    else setStale(true)
  }, [a.updated_at, a.title, a.summary, a.body, a.video, a.images, a.tags, a.cover_text, a.category])

  const run = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key)
    setError('')
    try {
      await f()
      onChanged()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy('')
    }
  }

  const startEdit = () => {
    loadDraft(fromRow())
    setEditing(true)
  }
  const dirty = editing && !sameDraft(draft, fromRow())
  const saveEdit = () =>
    run('save', async () => {
      if (!draft.title.trim()) throw new Error(tr('content.need_title'))
      await dbPatch('articles', a.id, { ...patchOf(draft, type), updated_at: new Date().toISOString() })
      setEditing(false)
      setStale(false)
    })

  // 有没保存的手动修改：先存再交给 AI，AI 才看得到
  const askAI = async () => {
    if (dirty && !(await saveEdit())) return
    setEditing(false)
    const id = await reviser.run({ article_id: a.id, note: note.trim() })
    if (id) {
      setAsking(false)
      setNote('')
    }
  }
  const startRewrite = async (to: ArticleType, req: string) => {
    if (dirty && !(await saveEdit())) return
    const id = await rewriter.run({ article_id: a.id, type: to, note: req })
    if (id) setRewritingOpen(false)
  }
  // 发布前有没保存的修改：先存，发出去的是保存后的内容
  const openPublish = async () => {
    if (dirty && !(await saveEdit())) return
    setEditing(false)
    setPublishing(true)
  }
  const item = 'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent'

  return (
    <div className="space-y-5">
      <div ref={headerRef} className="sticky -top-4 -mx-4 -mt-4 px-4 md:-mx-6 md:px-6 z-20 border-b border-border bg-background py-3">
        {/* 左边的箭头回列表（顶栏面包屑的「内容中心」也行）；右边是状态和操作。外面这条的 -mt-4 抵掉滚动区的上内边距 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={tr('content.back')} title={tr('content.back')} className="-ml-2 shrink-0 text-muted-foreground"><ArrowLeft /></Button>
            <TypeBadge type={type} />
            {displayStatus === 'published' && <Badge tone={st?.tone}>{st?.label}</Badge>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editing ? <><Button variant="ghost" size="sm" disabled={busy === 'save'} onClick={() => setEditing(false)}>{tr('common.cancel')}</Button><Button size="sm" variant="outline" successLabel={tr('ui.saved')} onClick={saveEdit} disabled={locked || !dirty}>{tr('common.save')}</Button></> : <Button variant="outline" size="sm" onClick={startEdit} disabled={locked}><Pencil />{tr('content.edit')}</Button>}
            <Button size="sm" variant="outline" onClick={() => setAsking(true)} disabled={locked || !reviser.shuttle}><Sparkles />{tr('content.ask_ai')}</Button>
            <Button size="sm" variant="outline" onClick={() => setRewritingOpen(true)} disabled={locked || !rewriter.shuttle}><Repeat2 />{tr('article.rewrite')}</Button>
            <Button size="sm" feedback={false} onClick={() => void openPublish()} disabled={locked}><Send />{tr('article.publish')}</Button>
            <div ref={moreRef} className="relative">
              <Button size="sm" variant="ghost" onClick={() => { const r = moreRef.current?.getBoundingClientRect(); setMoreLeft(!!r && r.right < 224 + 8); setMoreOpen((v) => !v); setConfirmDel(false) }} aria-haspopup="menu" aria-expanded={moreOpen} aria-controls={`article-more-${a.id}`}>
                {tr('content.more_actions')}<ChevronDown className="size-3.5" />
              </Button>
              {moreOpen && <div id={`article-more-${a.id}`} role="menu" aria-label={tr('content.more_actions')} className={cx('absolute top-full z-40 mt-2 w-56 rounded-xl border border-border bg-popover p-1.5 text-sm text-popover-foreground shadow-xl', moreLeft ? 'left-0' : 'right-0')}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') { setMoreOpen(false); return }
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
                  e.preventDefault()
                  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
                  const current = items.indexOf(document.activeElement as HTMLElement)
                  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                  items[next]?.focus()
                }}>
                {(reviser.task?.prompt_file || reviser.task?.prompt_has_default) && <><button type="button" role="menuitem" className={item} onClick={() => { setMoreOpen(false); setRequirementsOpen(true) }}><SlidersHorizontal className="size-4" />{tr('content.revise_req_btn')}</button><div role="separator" className="my-1 border-t border-border" /></>}
                <button type="button" role="menuitem" disabled={locked} className={cx(item, 'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 disabled:cursor-default disabled:opacity-50')} onClick={() => {
                  if (!confirmDel) { setConfirmDel(true); return }
                  void run('del', async () => {
                    await removeArticle(a, posts, pubs)
                    onBack()
                  })
                }}><Trash2 className="size-4" />{confirmDel ? tr('content.del_confirm') : tr('content.del')}</button>
              </div>}
            </div>
          </div>
        </div>
      </div>
      {(error || reviser.error || rewriter.error) && <Notice tone="error">{error || reviser.error || rewriter.error}</Notice>}
      <TaskRunning runs={revising} title={() => tr('content.revising_ai')} desc={tr('content.revising_desc')} />
      <TaskRunning runs={rewriting} title={(r) => tr('article.rewriting', { type: TYPE_META[(r.input?.type as ArticleType) ?? 'post']?.label ?? '' })} desc={tr('article.rewriting_desc')} />
      {!revising.length && reviser.task?.last && !reviser.task.last.ok && reviser.task.last.input?.article_id === a.id && <TaskFailed task={reviser.task} />}
      {!rewriting.length && rewriter.task?.last && !rewriter.task.last.ok && rewriter.task.last.input?.article_id === a.id && <TaskFailed task={rewriter.task} />}
      {rewritten && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <Repeat2 className="size-4 shrink-0 text-primary-text" />
        <span className="min-w-0 flex-1">{tr('article.rewritten', { type: TYPE_META[typeOf(rewritten)].label, title: rewritten.title })}</span>
        <Button size="sm" onClick={() => { markSeen(); open(rewritten.id) }}>{tr('article.open_rewritten')}</Button>
        <Button size="icon-sm" variant="ghost" aria-label={tr('article.dismiss')} title={tr('article.dismiss')} onClick={markSeen} className="text-muted-foreground"><X /></Button>
      </div>}

      {/* 和顶上的按钮左右对齐，不居中限宽；顶上那条吸在 -1rem（抵掉滚动区的上内边距），露出来的高度是它的高度减 1rem */}
      <article className="w-full min-w-0" style={{ '--sticky-top': `calc(${headerH}px - 1rem)` } as CSSProperties}>
        {editing ? (
          <div className="space-y-3">
            {stale && (
              <Notice>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">{tr('content.stale')}</span>
                  <Button size="sm" variant="outline" onClick={() => loadDraft(fromRow())}>{tr('content.stale_load')}</Button>
                </div>
              </Notice>
            )}
            <ArticleEditor type={type} draft={draft} setDraft={setDraft} editorKey={editorKey} />
          </div>
        ) : (
          <>
            <h1 className="text-2xl leading-snug font-semibold tracking-tight text-balance">{a.title}</h1>
            <div className="mt-2"><ArticleTime label={tr('content.updated')} value={a.updated_at || a.created_at} /></div>
            <ArticleView a={a} />
          </>
        )}
        {(source || derived.length > 0) && <div className="mt-6 space-y-1.5 border-t border-border pt-4 text-sm">
          {source && <p className="text-muted-foreground">{tr('article.from_source')}<button type="button" onClick={() => open(source.id)} className="ml-1 cursor-pointer text-primary-text hover:underline">{source.title}</button></p>}
          {derived.length > 0 && <div><p className="text-muted-foreground">{tr('article.derived')}</p><ul className="mt-1 space-y-1">{derived.map((d) => <li key={d.id} className="flex items-center gap-2"><TypeBadge type={typeOf(d)} /><button type="button" onClick={() => open(d.id)} className="min-w-0 cursor-pointer truncate text-left text-primary-text hover:underline">{d.title}</button></li>)}</ul></div>}
        </div>}
        <footer className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4"><ArticleTime label={tr('content.created')} value={a.created_at} /><ArticleTime label={tr('content.updated')} value={a.updated_at || a.created_at} /></footer>
      </article>

      <PublishRecords ctx={ctx} article={a} posts={posts} pubs={pubs} focus={focus} onChanged={onChanged} onPublish={openPublish} />

      <PublishDialog open={publishing} ctx={ctx} article={a} posts={posts} pubs={pubs} onClose={() => { setPublishing(false); onChanged() }} onRewrite={() => setRewritingOpen(true)} />
      <RewriteDialog open={rewritingOpen} article={a} starting={rewriter.starting} error={rewriter.error} onClose={() => setRewritingOpen(false)} onStart={startRewrite} />
      <TaskRequirements task={reviser.task} onSaved={reviser.setTask} title={tr('content.revise_req_title')} hint={tr('content.revise_req_hint')} open={requirementsOpen} onOpenChange={(o) => { setRequirementsOpen(o); if (!o) moreRef.current?.querySelector('button')?.focus() }} />
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={tr('content.ask_ai')}
        footer={
          <>
            <Button variant="outline" onClick={() => setAsking(false)}>
              {tr('common.cancel')}
            </Button>
            <Button onClick={askAI} disabled={!note.trim() || reviser.starting || busy === 'save'}>
              {(reviser.starting || busy === 'save') && <Loader className="animate-spin" />}
              {tr('content.ask_ai_submit')}
            </Button>
          </>
        }
      >
        <Field label={tr('content.ask_ai_label')} hint={dirty ? tr('content.ask_ai_hint_dirty') : tr('content.ask_ai_hint')}>
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={5} className={`${inputCls} py-2`} placeholder={tr('content.note_ph')} />
        </Field>
      </Dialog>
    </div>
  )
}

function ArticleTime({ label, value }: { label: string; value?: string }) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null
  const date = new Date(value)
  return <span className="text-xs leading-relaxed text-muted-foreground">{label} <time dateTime={value} title={date.toLocaleString(numLocale())}>{date.toLocaleString(numLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span>
}

function Topics({ ctx, list, onChanged, writer, suggester, onWrite }: { ctx: Ctx; list: Topic[] | null; onChanged: () => void; writer: Writer; suggester: Writer; onWrite: (input: { topic_id?: string; channel_id?: string }) => void }) {
  // 长文参照这个网站的写法（content.context 的 channel_id）
  const site = ctx.channels.find((c) => c.type === 'creght_site')
  const [adding, setAdding] = useState(false)
  const [briefTopic, setBriefTopic] = useState<Topic | null>(null)
  const [title, setTitle] = useState('')
  const [angle, setAngle] = useState('')
  const [error, setError] = useState('')
  const [showDone, setShowDone] = useState(false)

  const add = async () => {
    try {
      await dbCreate('topics', { title: title.trim(), angle: angle.trim(), source: 'manual', status: 'idea' })
      setTitle('')
      setAngle('')
      setAdding(false)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }
  const setStatus = async (t: Topic, status: TopicStatus) => {
    try {
      await dbPatch('topics', t.id, { status })
      onChanged()
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }

  if (!list) return <Skeleton className="h-40 rounded-xl" />
  const active = list.filter((t) => t.status === 'idea' || t.status === 'writing')
  const rest = list.filter((t) => t.status === 'done' || t.status === 'dropped')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <TaskButton task={TOPICS_TASK} match={(r) => !r.input?.channel_id} onFinished={onChanged} icon={Sparkles}>
          {tr('content.gen_topics')}
        </TaskButton>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus /> {tr('content.add_manual')}
        </Button>
        <div className="ml-auto flex flex-wrap gap-1">
          <TaskRequirements task={suggester.task} onSaved={suggester.setTask} title={tr('content.topics_req_title')} hint={tr('content.topics_req_hint')} label={tr('content.topics_req_btn')} />
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      {active.length === 0 ? (
        <Notice>{tr('content.topics_empty')}</Notice>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {active.map((t) => (
            <div key={t.id} className="flex flex-col items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="cursor-pointer text-left text-sm font-medium hover:text-primary-text" onClick={() => setBriefTopic(t)}>{t.title}</button>
                  <Badge tone={TOPIC_STATUS[t.status]?.tone}>{TOPIC_STATUS[t.status]?.label}</Badge>
                  {t.source === 'agent' && <span className="text-[10px] text-muted-foreground">{tr('content.by_agent')}</span>}
                  {t.source === 'search' && (
                    <span className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground" title={t.search_position ? tr('content.search_pos', { n: t.search_position }) : undefined}>
                      {tr('content.from_search')}{t.search_impressions ? tr('content.impressions', { n: t.search_impressions.toLocaleString(numLocale()) }) : ''}
                    </span>
                  )}
                </div>
                {t.angle && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.angle}</p>}
                {t.keywords && <p className="mt-1 text-[11px] text-muted-foreground/80">{tr('content.keywords', { k: t.keywords })}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setBriefTopic(t)}>{tr('brief.brief')}</Button>
                {t.status === 'idea' &&
                  (writer.task?.running.some((r) => r.input?.topic_id === t.id) ? (
                    <Badge tone="warn">
                      <Loader className="size-3 animate-spin" /> {TOPIC_STATUS.writing.label}
                    </Badge>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => onWrite({ topic_id: t.id, channel_id: site?.id })} disabled={!writer.shuttle || !writer.task || writer.starting}>
                      <Sparkles /> {tr('content.write_article')}
                    </Button>
                  ))}
                <Button variant="ghost" size="icon-sm" title={tr('content.drop')} aria-label={tr('content.drop')} onClick={() => setStatus(t, 'dropped')} className="text-muted-foreground">
                  <X />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <div>
          <button onClick={() => setShowDone((v) => !v)} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {showDone ? tr('content.collapse') : tr('content.rest_n', { n: rest.length })}
          </button>
          {showDone && (
            <ul className="mt-2 space-y-1">
              {rest.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge tone={TOPIC_STATUS[t.status]?.tone}>{TOPIC_STATUS[t.status]?.label}</Badge>
                  <button className="min-w-0 cursor-pointer truncate text-left hover:text-primary-text" onClick={() => setBriefTopic(t)}>{t.title}</button>
                  {t.status === 'dropped' && (
                    <button onClick={() => setStatus(t, 'idea')} className="cursor-pointer text-xs text-primary-text hover:underline">
                      {tr('content.restore')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {briefTopic && <WritingBriefDialog ctx={ctx} topic={briefTopic} onClose={() => setBriefTopic(null)} onChanged={onChanged} onWrite={() => onWrite({ topic_id: briefTopic.id, channel_id: site?.id })} />}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={tr('content.add_topic')}
        footer={
          <>
            <Button variant="outline" onClick={() => setAdding(false)}>
              {tr('common.cancel')}
            </Button>
            <Button onClick={add} disabled={!title.trim()}>
              {tr('common.add')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={tr('content.topic')}>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} h-9`} placeholder={tr('content.topic_ph')} />
          </Field>
          <Field label={tr('content.angle')} hint={tr('content.angle_hint')}>
            <textarea value={angle} onChange={(e) => setAngle(e.target.value)} rows={3} className={`${inputCls} py-2`} />
          </Field>
        </div>
      </Dialog>
    </div>
  )
}
