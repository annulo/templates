import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Loader, Pencil, Plus, Trash2, X, Sparkles, ChevronDown, SlidersHorizontal } from 'lucide-react'
import ContentVersions from '../ContentVersions'
import { WritingBriefDialog } from '../ContentEvidence'
import RichEditor from '../RichEditor'
import AssetPicker from '../AssetPicker'
import { Badge, Button, Dialog, Field, Notice, PageHeader, Segmented, Skeleton, cx, fmtTime, inputCls, type Tone } from '../ui'
import { TaskButton, TaskFailed, TaskRequirements, TaskRunning, useTask } from '../Task'
import { CHANNEL_TYPES } from '../../lib/channels'
import { dbCreate, dbDelete, dbList, dbPatch, type Article, type ArticleStatus, type Topic, type TopicStatus } from '../../lib/shuttle'
import type { Ctx } from './types'
import { numLocale, tr } from '../../lib/i18n'

// label 按当前语言取（getter）
const lbl = (key: string, tone: Tone) => ({ get label() { return tr(key) }, tone })
// 初稿只有「草稿 / 已发布」两种：审核按渠道版本走。老数据里的 pending_review、rejected 按草稿显示
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
/** 任务 id（tasks/revise-article.md）：文章页「让 AI 改」 */
const REVISE_TASK = 'revise-article'
/** 任务 id（tasks/suggest-topics.md）：「出一批选题」，GEO 页「写成选题」也是它 */
export const TOPICS_TASK = 'suggest-topics'
type Writer = ReturnType<typeof useTask>

/** 内容：文章（审核、发布）和选题池 */
export default function Content({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const tab: Tab = params.tab === 'topics' ? 'topics' : 'articles'
  const [articles, setArticles] = useState<Article[] | null>(null)
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [publishedIds, setPublishedIds] = useState<string[]>([])
  // 每篇初稿发到了哪些渠道（网站版本 + 社媒版本，只算已发布的），列表里每行接在更新时间后面显示成标签
  const [publishedTo, setPublishedTo] = useState<Record<string, PublishedTo[]>>({})
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  // 社媒工作区的创建按钮进入同一套内容编辑流程；打开草稿表单，不自动保存。
  useEffect(() => {
    if (params.new !== '1') return
    setCreating(true)
    setParam('new', '')
  }, [params.new])
  const [writingInput, setWritingInput] = useState<{ topic_id?: string } | null>(null)
  const [writingRequirements, setWritingRequirements] = useState('')

  const load = useCallback(() => {
    Promise.all([dbList('articles'), dbList('topics'), dbList('social_posts').catch(() => [])])
      .then(([a, t, posts]) => {
        setPublishedIds([...new Set(posts.filter((p) => p.status === 'published').map((p) => p.article_id).filter((id): id is string => !!id))])
        const to: Record<string, PublishedTo[]> = {}
        for (const p of posts) if (p.status === 'published' && p.article_id) (to[p.article_id] ??= []).push({ id: p.id, channel_id: p.channel_id, post: true })
        setPublishedTo(to)
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

  const writer = useTask(WRITE_TASK, load)
  const openWriter = (input: { topic_id?: string; channel_id?: string } = {}) => {
    setWritingRequirements(writer.task?.prompt ?? '')
    setWritingInput(input)
  }
  const startWriting = async () => {
    if (!writingInput || !writingRequirements.trim()) return
    const id = await writer.run({ ...writingInput, writing_requirements: writingRequirements.trim() })
    if (id) setWritingInput(null)
  }
  // 出选题的「AI 要求」按钮放在选题页的「出一批选题」旁边
  const suggester = useTask(TOPICS_TASK)
  const topicTitle = (id?: string) => topics?.find((t) => t.id === id)?.title
  const openArticle = params.article ? articles?.find((a) => a.id === params.article) : undefined

  if (openArticle) return <ArticleDetail key={openArticle.id} ctx={ctx} a={openArticle} version={params.version} displayStatus={publishedIds.includes(openArticle.id) ? 'published' : openArticle.status} onBack={() => { setParam('version', ''); setParam('article', '') }} onChanged={load} />

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('content.title')}
        desc={tr('content.desc')}
        actions={
          <>
            <Button size="sm" onClick={() => { setParam('tab', 'articles'); setCreating(true) }}><Plus />{tr('content.new_article')}</Button>
            <Button variant="outline" size="sm" disabled={!writer.shuttle || !writer.task || writer.starting || !!writer.task.running.length} onClick={() => openWriter()}><Sparkles />{tr('content.write_one')}</Button>
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
        title={(r) => (topicTitle(r.input?.topic_id) ? tr('content.writing_topic', { title: topicTitle(r.input?.topic_id)! }) : tr('content.writing_pick'))}
        desc={tr('content.writing_desc')}
      />
      <TaskFailed task={writer.task} />
      {tab === 'articles' ? (
        <Articles ctx={ctx} publishedTo={publishedTo} openVersion={(id, version) => { setParam('version', version); setParam('article', id) }} list={articles?.map((a) => ({ ...a, status: (publishedIds.includes(a.id) || a.status === 'published' ? 'published' : 'draft') as ArticleStatus })) ?? null} status={params.status ?? ''} setStatus={(s) => setParam('status', s)} open={(id) => setParam('article', id)} writer={writer} onWrite={openWriter} />
      ) : (
        <Topics ctx={ctx} list={topics} onChanged={load} writer={writer} suggester={suggester} onWrite={openWriter} />
      )}
      <NewArticleDialog open={creating} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); load(); setParam('article', id) }}
        aiDisabled={!writer.shuttle || !writer.task || writer.starting || !!writer.task.running.length}
        // 一步交给 AI：用默认写法加上这次的主题，直接开写作任务，不用先建空初稿再让 AI 改
        onAi={async (topic) => { const id = await writer.run({ writing_requirements: `${writer.task?.prompt ?? ''}\n\n${tr('content.ai_topic_line', { topic })}`.trim() }); if (id) setCreating(false) }} />
      <Dialog open={writingInput !== null} onClose={() => setWritingInput(null)} title={tr('content.write_one')} width={700} footer={<><Button variant="ghost" onClick={() => setWritingInput(null)}>{tr('common.cancel')}</Button><Button onClick={startWriting} disabled={!writingRequirements.trim() || writer.starting}>{writer.starting ? <Loader className="animate-spin" /> : <Sparkles />}{tr('content.start_writing')}</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{tr('content.one_time_requirements_hint')}</p>
          <Field label={tr('content.one_time_requirements')}><textarea autoFocus value={writingRequirements} onChange={(e) => setWritingRequirements(e.target.value)} rows={14} className={cx(inputCls, 'py-2 leading-relaxed')} /></Field>
          {writer.error && <Notice tone="error">{writer.error}</Notice>}
        </div>
      </Dialog>
    </div>
  )
}

function NewArticleDialog({ open, onClose, onDone, onAi, aiDisabled }: { open: boolean; onClose: () => void; onDone: (id: string) => void; onAi: (topic: string) => Promise<void>; aiDisabled: boolean }) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setTitle(''); setError('') } }, [open])
  const save = async () => {
    setSaving(true); setError('')
    try {
      const t = new Date().toISOString()
      const row = await dbCreate('articles', { title: title.trim(), summary: '', body: '', status: 'draft', created_at: t, updated_at: t })
      onDone(row.id)
    } catch (e) { setError((e as Error).message); return false } finally { setSaving(false) }
  }
  return <Dialog open={open} onClose={onClose} title={tr('versions.new_source')} width={520} footer={<><Button variant="ghost" size="sm" onClick={onClose}>{tr('common.cancel')}</Button><Button successLabel={tr('ui.saved')} variant="outline" size="sm" disabled={saving || !title.trim()} onClick={save}>{saving && <Loader className="animate-spin" />}{tr('content.save_draft')}</Button><Button size="sm" disabled={saving || aiDisabled || !title.trim()} onClick={async () => { setSaving(true); try { await onAi(title.trim()) } finally { setSaving(false) } }}><Sparkles />{tr('content.ai_write_this')}</Button></>}><div className="space-y-4">{error && <Notice tone="error">{error}</Notice>}<p className="text-sm text-muted-foreground">{tr('versions.new_hint')}</p><Field label={tr('content.new_topic_label')}><input autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void save() }} /></Field></div></Dialog>
}

/** 一篇初稿的一个已发布版本（social_posts） */
type PublishedTo = { id: string; channel_id: string; post?: boolean }

function Articles({ ctx, publishedTo, openVersion, list, status, setStatus, open, writer, onWrite }: { ctx: Ctx; publishedTo: Record<string, PublishedTo[]>; openVersion: (id: string, version: string) => void; list: Article[] | null; status: string; setStatus: (s: string) => void; open: (id: string) => void; writer: Writer; onWrite: () => void }) {
  const [query, setQuery] = useState('')
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of list ?? []) c[a.status] = (c[a.status] ?? 0) + 1
    return c
  }, [list])
  const needle = query.trim().toLocaleLowerCase()
  const shown = (list ?? []).filter((a) => (!status || a.status === status) && (!needle || `${a.title} ${a.summary || ''}`.toLocaleLowerCase().includes(needle)))
  const channelName = (id?: string) => ctx.channels.find((c) => c.id === id)?.name ?? ''

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
          <TaskRequirements task={writer.task} onSaved={writer.setTask} title={tr('content.req_title')} hint={tr('content.req_hint')} label={tr('content.req_btn')} />
        </div>
      </div>
    )
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" aria-label={tr('content.search')} placeholder={tr('content.search')} value={query} onChange={(e) => setQuery(e.target.value)} className={cx(inputCls, 'min-w-40 flex-1')} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[['', tr('common.all'), list.length] as const, ...(Object.keys(ARTICLE_STATUS) as ArticleStatus[]).map((k) => [k, ARTICLE_STATUS[k]!.label, counts[k] ?? 0] as const)].map(([k, label, n]) =>
          k && !n ? null : (
            <button
              key={k || 'all'}
              onClick={() => setStatus(k)}
              className={cx('inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors', status === k ? 'border-primary/40 bg-primary/10 text-primary-text' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}
            >
              {label}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ),
        )}
        <div className="ml-auto"><TaskRequirements task={writer.task} onSaved={writer.setTask} title={tr('content.req_title')} hint={tr('content.req_hint')} label={tr('content.req_btn')} /></div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {shown.map((a) => {
          // 发到了哪些渠道：点标签打开这篇在那个渠道的媒体版本。宽屏和状态标签一列、右边对齐；手机上放到标题下面换行，不挤标题
          const chips = !!publishedTo[a.id]?.length && publishedTo[a.id].map((v) => {
            const ch = ctx.channels.find((c) => c.id === v.channel_id)
            const Icon = ch ? CHANNEL_TYPES[ch.type]?.icon : undefined
            // 标签上只放图标和账号名，平台名放进悬停说明
            const label = ch ? ch.name : tr('content.removed_channel')
            const full = ch ? `${CHANNEL_TYPES[ch.type]?.label ?? ''} · ${ch.name}` : label
            const cls = 'inline-flex h-5 max-w-56 cursor-pointer items-center gap-1 rounded border border-border bg-muted/40 px-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary-text'
            const inner = <>{Icon && <Icon size={11} />}<span className="truncate">{label}</span></>
            // 版本定位：社媒传帖子 id，网站传渠道 id（ContentVersions 的 focus 两种都认）
            return <button key={v.id} type="button" onClick={(e) => { e.stopPropagation(); openVersion(a.id, v.post ? v.id : v.channel_id) }} title={tr('content.open_version', { name: full })} className={cls}>{inner}</button>
          })
          return (
          <div key={a.id} role="button" tabIndex={0} onClick={() => open(a.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(a.id) } }} className={cx('group flex w-full cursor-pointer items-start gap-4 border-b border-border px-4 text-left last:border-b-0 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', 'py-4')}>
            <div className="min-w-0 flex-1">
              <div className={cx('text-sm font-medium leading-relaxed [overflow-wrap:anywhere] group-hover:text-primary-text', 'line-clamp-2')}>{a.title}</div>
              {a.summary && <div className="mt-1 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{a.summary}</div>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                {!publishedTo[a.id]?.length && channelName(a.channel_id) && <span>{channelName(a.channel_id)}</span>}
                <span className="whitespace-nowrap">{tr('content.updated')} {fmtTime(a.updated_at || a.created_at)}</span>
              </div>
              {chips && <div className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden">{chips}</div>}
            </div>
            <div className="flex shrink-0 flex-col items-end justify-between gap-2 self-stretch">
              <Badge className="mt-0.5" tone={ARTICLE_STATUS[a.status]?.tone}>{ARTICLE_STATUS[a.status]?.label ?? a.status}</Badge>
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

/** 文章正文是 agent 写的 HTML：放进沙箱 iframe 渲染（不执行脚本、不继承页面权限），样式跟随主题 */
function BodyPreview({ html }: { html: string }) {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark')
  useEffect(() => {
    const update = () => setDark(document.documentElement.getAttribute('data-theme') === 'dark')
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    update()
    return () => observer.disconnect()
  }, [])
  const doc = `<!doctype html><meta charset="utf-8"><style>
  html{color-scheme:${dark ? 'dark' : 'light'}} body{margin:0;padding:4px 2px;font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:${dark ? '#e7e7e7' : '#1f1f1f'};background:${dark ? '#0a0a0a' : '#ffffff'}}
  h1,h2,h3{line-height:1.35;margin:1.4em 0 .5em} h2{font-size:1.25em} h3{font-size:1.08em}
  p{margin:.7em 0} a{color:${dark ? '#8fb6ff' : '#2455d6'}} img{max-width:100%;border-radius:8px}
  ul,ol{padding-left:1.4em} blockquote{margin:1em 0;padding-left:1em;border-left:3px solid ${dark ? '#444' : '#ddd'};color:${dark ? '#aaa' : '#666'}}
  code{background:${dark ? '#2a2a2a' : '#f2f2f2'};padding:.1em .35em;border-radius:4px}
  table{border-collapse:collapse} td,th{border:1px solid ${dark ? '#3a3a3a' : '#ddd'};padding:.3em .6em}
  </style><body>${html}</body>`
  const [h, setH] = useState(400)
  const bodyObserver = useRef<ResizeObserver | null>(null)
  useEffect(() => () => bodyObserver.current?.disconnect(), [])
  return (
    <iframe
      title={tr('content.body')}
      sandbox="allow-same-origin"
      srcDoc={doc}
      onLoad={(e) => {
        const body = e.currentTarget.contentDocument?.body
        bodyObserver.current?.disconnect()
        if (!body) return
        const measure = () => setH(Math.max(200, body.scrollHeight + 20))
        measure()
        bodyObserver.current = new ResizeObserver(measure)
        bodyObserver.current.observe(body)
      }}
      className="w-full border-0 bg-background"
      style={{ height: h, colorScheme: dark ? 'dark' : 'light' }}
    />
  )
}

function ArticleDetail({ ctx, a, version, displayStatus, onBack, onChanged }: { ctx: Ctx; a: Article; version?: string; displayStatus: ArticleStatus; onBack: () => void; onChanged: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false)
  // 菜单往哪边展开：宽屏时按钮在一行最右边，往左；手机上按钮换到下一行的左边，往左会伸出屏幕，改往右。按打开时按钮的实际位置算
  const [moreLeft, setMoreLeft] = useState(false)
  const [requirementsOpen, setRequirementsOpen] = useState(false)
  const [keywordsExpanded, setKeywordsExpanded] = useState(false)
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
  const [section, setSection] = useState<'source' | 'versions'>(version ? 'versions' : 'source')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', summary: '', body: '', video: '' })
  // base：开始编辑时（或上次同步时）表里的内容。表里的文章在别处变了（AI 改完、别的窗口保存）：
  // 没动过就直接换成新的；动过了提示用户选（stale）。editorKey 换了编辑器才会重新载入内容
  const [base, setBase] = useState(draft)
  const [stale, setStale] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  // 顶上这条（页签和按钮）是吸顶的：编辑器的工具条吸在它下面，不能吸到 top-0 被它盖住。高度会随换行变，量出来交给 --sticky-top
  const [headerH, setHeaderH] = useState(0)
  const headerObserver = useRef<ResizeObserver | null>(null)
  // 固定的回调（不然每次渲染都重新挂一遍）；量到的高度下一帧再设，免得在 ResizeObserver 回调里改布局
  const headerRef = useCallback((el: HTMLDivElement | null) => {
    headerObserver.current?.disconnect()
    if (!el) return
    const measure = () => requestAnimationFrame(() => setHeaderH(el.offsetHeight))
    measure()
    headerObserver.current = new ResizeObserver(measure)
    headerObserver.current.observe(el)
  }, [])
  const [pickingVideo, setPickingVideo] = useState(false)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const st = ARTICLE_STATUS[displayStatus]
  // 让 AI 改：交给助手按任务 tasks/revise-article.md 改，它读的是表里现在的内容（包括手动改过的）
  const reviser = useTask(REVISE_TASK, onChanged)
  const revising = (reviser.task?.running ?? []).filter((r) => r.input?.article_id === a.id)
  // 改初稿只写表，手机上（不在 Shuttle 里）也能改；让 AI 改、发布这些按钮自己会在 Shuttle 外灰掉
  const locked = !!busy || revising.length > 0
  const published = a.status === 'published'
  const fromRow = () => ({ title: a.title, summary: a.summary ?? '', body: a.body ?? '', video: a.video ?? '' })
  const sameDraft = (x: typeof draft, y: typeof draft) => x.title === y.title && x.summary === y.summary && x.body === y.body && x.video === y.video
  const loadDraft = (d: typeof draft) => {
    setDraft(d)
    setBase(d)
    setStale(false)
    setEditorKey((k) => k + 1)
  }
  useEffect(() => { if (a.status === 'draft' && !a.body) { loadDraft(fromRow()); setEditing(true) } }, [a.id])
  useEffect(() => {
    if (!editing) return
    const now = fromRow()
    if (sameDraft(now, base)) return
    if (sameDraft(draft, base) || sameDraft(draft, now)) loadDraft(now)
    else setStale(true)
  }, [a.title, a.summary, a.body, a.video])

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
    setSection('source')
  }
  const dirty = editing && !sameDraft(draft, fromRow())
  const saveEdit = () =>
    run('save', async () => {
      if (!draft.title.trim()) throw new Error(tr('content.need_title'))
      await dbPatch('articles', a.id, { title: draft.title.trim(), summary: draft.summary.trim(), body: draft.body, video: draft.video, updated_at: new Date().toISOString(), ...(published ? {} : { status: draft.body.trim() ? 'pending_review' as ArticleStatus : 'draft' as ArticleStatus }) })
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

  return (
    <div className="space-y-5">
      <div ref={headerRef} className="sticky -top-4 -mx-4 -mt-4 px-4 md:-mx-6 md:px-6 z-20 border-b border-border bg-background py-3">
        {/* 页签在左、状态和操作在右，一排放下；左边的箭头回列表（顶栏面包屑的「内容中心」也行）。
            外面这条的 -mt-4 抵掉滚动区的上内边距：上下都只剩 py-3 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={tr('content.back')} title={tr('content.back')} className="-ml-2 shrink-0 text-muted-foreground"><ArrowLeft /></Button>
            <div className="overflow-x-auto">
              <Segmented value={section} onChange={setSection} options={[
                { value: 'source', label: tr('content.source_tab') },
                { value: 'versions', label: tr('versions.title') },
              ]} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* 审核按渠道版本走（媒体版本里每一版单独提交、通过），初稿本身不审核：这里只在发出去以后标「已发布」 */}
            {displayStatus === 'published' && <Badge tone={st?.tone}>{st?.label}</Badge>}
            {/* 「修改」「让 AI 改」改的是初稿，只在初稿页签显示；媒体版本各渠道的操作在各自的版本里 */}
            {section === 'source' && <>
              {editing ? <><Button variant="ghost" size="sm" disabled={busy === 'save'} onClick={() => setEditing(false)}>{tr('common.cancel')}</Button><Button size="sm" successLabel={tr('ui.saved')} onClick={saveEdit} disabled={locked || !dirty}>{tr('common.save')}</Button></> : <Button variant="outline" size="sm" onClick={startEdit} disabled={locked}><Pencil />{tr('content.edit')}</Button>}
              <Button size="sm" variant="outline" onClick={() => setAsking(true)} disabled={locked || !reviser.shuttle}><Sparkles />{tr('content.ask_ai')}</Button>
            </>}
            <div ref={moreRef} className="relative">
              <Button size="sm" variant="outline" onClick={() => { const r = moreRef.current?.getBoundingClientRect(); setMoreLeft(!!r && r.right < 224 + 8); setMoreOpen((v) => !v); setConfirmDel(false) }} aria-haspopup="menu" aria-expanded={moreOpen} aria-controls={`article-more-${a.id}`}>
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
                {(reviser.task?.prompt_file || reviser.task?.prompt_has_default) && <button type="button" role="menuitem" className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent" onClick={() => { setMoreOpen(false); setRequirementsOpen(true) }}><SlidersHorizontal className="size-4" />{tr('content.revise_req_btn')}</button>}
                {/* 「查看已发布内容」不放这里：一篇会发到多个渠道，只能开一个。各渠道的已发布内容在「媒体版本」里分别打开 */}
                {(reviser.task?.prompt_file || reviser.task?.prompt_has_default) && <div role="separator" className="my-1 border-t border-border" />}
                <button type="button" role="menuitem" disabled={locked} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-destructive outline-none hover:bg-destructive/10 focus-visible:bg-destructive/10 disabled:cursor-default disabled:opacity-50" onClick={() => {
                  if (!confirmDel) { setConfirmDel(true); return }
                  void run('del', async () => {
                    const posts = await dbList('social_posts')
                    if (posts.some((p) => p.article_id === a.id)) throw new Error(tr('versions.delete_with_versions'))
                    await dbDelete('articles', a.id); onBack()
                  })
                }}><Trash2 className="size-4" />{confirmDel ? tr('content.del_confirm') : tr('content.del')}</button>
              </div>}
            </div>
          </div>
        </div>
      </div>
      {(error || reviser.error) && <Notice tone="error">{error || reviser.error}</Notice>}
      <TaskRunning runs={revising} title={() => tr('content.revising_ai')} desc={tr('content.revising_desc')} />
      {!revising.length && reviser.task?.last && !reviser.task.last.ok && reviser.task.last.input?.article_id === a.id && <TaskFailed task={reviser.task} />}
      {section !== 'source' && <div className="space-y-2"><h1 className="text-xl font-semibold leading-snug [overflow-wrap:anywhere]">{a.title}</h1><ArticleTime label={tr('content.updated')} value={a.updated_at || a.created_at} /></div>}

      {a.review_note && a.status === 'rejected' && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
          <div className="text-xs font-semibold text-destructive">{tr('content.review_note')}</div>
          <p className="mt-1 leading-relaxed">{a.review_note}</p>
        </div>
      )}
      <div hidden={section !== 'source'}>
        {/* 和顶上的页签、按钮左右对齐，不再居中限宽；不套卡片，直接铺在页面上 */}
        {/* 顶上那条吸在 -1rem（抵掉滚动区的上内边距），露出来的高度是它的高度减 1rem */}
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
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={tr('content.title_ph')} aria-label={tr('social.f_title')} className={cx(inputCls, 'h-11 text-lg font-semibold')} />
              <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} rows={2} aria-label={tr('content.new_summary')} placeholder={tr('content.summary_ph')} className={cx(inputCls, 'py-2')} />
              <RichEditor key={editorKey} value={draft.body} onChange={(body) => setDraft((d) => ({ ...d, body }))} />
              <Field group label={tr('content.optional_video')} hint={tr('content.video_hint')}><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setPickingVideo(true)}>{tr('social.pick_video')}</Button>{draft.video && <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, video: '' }))}>{tr('common.delete')}</Button>}</div>{draft.video && <video src={draft.video} controls className="mt-2 max-h-48 rounded border border-border" />}</Field>
              <AssetPicker open={pickingVideo} kind="video" max={1} onClose={() => setPickingVideo(false)} onPick={(urls) => { setDraft((d) => ({ ...d, video: urls[0] ?? '' })); setPickingVideo(false) }} />
            </div>
          ) : (
            <>
              <h1 className="text-2xl leading-snug font-semibold tracking-tight text-balance">{a.title}</h1>
              <div className="mt-2"><ArticleTime label={tr('content.updated')} value={a.updated_at || a.created_at} /></div>
              {a.summary && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a.summary}</p>}
              {a.keywords && <div className="mt-3 text-xs leading-relaxed text-muted-foreground"><p className={cx('[overflow-wrap:anywhere]', !keywordsExpanded && 'line-clamp-2')}>{tr('content.keywords', { k: a.keywords })}</p><button type="button" className="mt-1 cursor-pointer text-primary-text hover:underline" aria-expanded={keywordsExpanded} onClick={() => setKeywordsExpanded((v) => !v)}>{tr(keywordsExpanded ? 'content.hide_keywords' : 'content.show_keywords')}</button></div>}
              <div className="mt-5 border-t border-border pt-4">{a.video && <video src={a.video} controls className="mb-4 w-full rounded-lg bg-black" />}{a.body ? <BodyPreview key={a.updated_at} html={a.body} /> : <p className="text-sm text-muted-foreground">{tr('content.no_body')}</p>}</div>
            </>
          )}
          <footer className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4"><ArticleTime label={tr('content.created')} value={a.created_at} /><ArticleTime label={tr('content.updated')} value={a.updated_at || a.created_at} />{a.published_at && <ArticleTime label={tr('content.published')} value={a.published_at} />}</footer>
        </article>
      </div>
      <div hidden={section !== 'versions'}><ContentVersions ctx={ctx} article={a} focus={version} onChanged={onChanged} /></div>



      <TaskRequirements task={reviser.task} onSaved={reviser.setTask} title={tr('content.revise_req_title')} hint={tr('content.revise_req_hint')} open={requirementsOpen} onOpenChange={(open) => { setRequirementsOpen(open); if (!open) moreRef.current?.querySelector('button')?.focus() }} />
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
                    <Button variant="outline" size="sm" onClick={() => onWrite({ topic_id: t.id })} disabled={!writer.shuttle || !writer.task || writer.starting}>
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

      {briefTopic && <WritingBriefDialog ctx={ctx} topic={briefTopic} onClose={() => setBriefTopic(null)} onChanged={onChanged} onWrite={() => onWrite({ topic_id: briefTopic.id })} />}
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
