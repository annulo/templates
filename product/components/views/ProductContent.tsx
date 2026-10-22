import { useEffect, useState } from 'react'
import { ArrowUpRight, ClipboardList, Link2, Loader, NotebookPen, Plus, Sparkles } from 'lucide-react'
import { ArticleDetail, RowMore, removeArticle } from './Content'
import { WritingBriefDialog } from '../ContentEvidence'
import { TypeBadge, TypePicker, type ArticleType } from '../ArticleTypes'
import RewriteDialog, { REWRITE_TASK } from '../RewriteDialog'
import { aiWork } from '../Artifacts'
import { GrowthReviews, MarketingImport, MarketingPlans } from '../MarketingWorkspace'
import ContentPerformance, { MetricsLine } from '../ContentPerformance'
import ContentStatus, { LinkChips, PublicationLinks, StageBadge } from '../ContentStatus'
import { TaskFailed, TaskLaunchButton, TaskRequirements, TaskRunning, useTask } from '../Task'
import { Button, Dialog, Field, Notice, PageHeader, Skeleton, cx, inputCls, toast } from '../ui'
import Select from '../Select'
import { useProductData } from '../ProductFields'
import { contentEntries, entryAccountIds, entryMetrics, legacyContentWorkspace, reviewWorkspace, type ContentData, type ContentEntry, type ContentStage, type ContentWorkspace } from '../../lib/contentWorkspace'
import { dbCreate, dbPatch, isSite, runLocal } from '../../lib/shuttle'
import { isEn, tr } from '../../lib/i18n'
import { CONTENT_ORIGINS, contentOrigins, type ContentOrigin } from '../../lib/origins'
import type { Ctx } from './types'

export const w = (key: string, vars?: Record<string, unknown>) => tr('workspace.' + key, vars)
const PAGE = 50
const stages: ContentStage[] = ['planned', 'creating', 'draft', 'ready', 'scheduled', 'published', 'verify', 'blocked', 'archived']
type Props = { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void; workspace?: ContentWorkspace }
type NewContent = { title: string; angle: string; type: ArticleType; account: string; topic?: any; savedId?: string }

export default function ProductContent({ ctx, params, setParam: updateParam, workspace: requested }: Props) {
  const { data, error, reload } = useProductData<ContentData>('content-workspace.context', {}, ctx.rev)
  const all = data ? contentEntries(data) : []
  const workspace = requested || legacyContentWorkspace(params, all)
  const setParam = (key: string, value: string) => {
    if (['article', 'topic', 'plan'].includes(key) && !value) {
      if (!requested) updateParam('workspace', workspace)
      const field = key as 'article' | 'topic' | 'plan'
      const previous = params[key] && all.find(e => e[field]?.id === params[key])
      if (previous && !previous.workspaces.length) updateParam('ownership', 'unassigned')
    }
    updateParam(key, value)
  }
  const entries = data ? contentEntries(data, workspace) : []
  const unassigned = entries.filter(e => !e.workspaces.length)
  // 在平台上直接发的帖子单独一栏：常常有几百条，混进来会把自己做的内容淹掉
  const owned = entries.filter(e => e.workspaces.includes(workspace) && !e.post), platform = entries.filter(e => e.post)
  const base = params.ownership === 'unassigned' ? unassigned : params.ownership === 'platform' ? platform : owned
  const stage = params.stage || (['draft', 'published'].includes(params.status) ? params.status : 'all')
  const [query, setQuery] = useState(''), [form, setForm] = useState<NewContent | null>(null)
  const [shown, setShown] = useState(PAGE)
  useEffect(() => setShown(PAGE), [params.ownership, params.stage, params.account, params.origin, params.sort, query])
  const [busy, setBusy] = useState(false), [saveError, setSaveError] = useState(''), [requirements, setRequirements] = useState(false)
  const [rewrite, setRewrite] = useState<any>(null), [assignment, setAssignment] = useState<ContentEntry | null>(null), [assignmentScope, setAssignmentScope] = useState<ContentWorkspace>(workspace)
  const writer = useTask('write-article', reload), rewriter = useTask(REWRITE_TASK, reload)
  const accounts = ctx.channels.filter(c => workspace === 'website' ? isSite(c) : !isSite(c))
  // 社媒内容的数据挂在每一行上（各账号累计 + 近 7 天涨了多少），可以按数据排
  const metrics = new Map(workspace === 'social' && data ? entries.map(e => [e.key, entryMetrics(e, data)] as const) : [])
  const sort = workspace === 'social' && ['views', 'gain'].includes(params.sort) ? params.sort : 'recent'
  const score = (e: ContentEntry) => { const m = metrics.get(e.key); return !m ? -1 : sort === 'views' ? m.views : m.gain ? m.gain.views : -1 }
  // 来源（选题出处、改写、直接写）读的时候往回追，见 core/lib/origins.ts 的 contentOrigins
  const origins = new Map(data ? entries.map(e => [e.key, e.post ? [] : contentOrigins(e, data.articles, data.topics)] as const) : [])
  const origin = CONTENT_ORIGINS.includes(params.origin as ContentOrigin) ? params.origin as ContentOrigin : ''
  const rows = base.filter(e => (stage === 'all' || e.stage === stage)
    && (!origin || origins.get(e.key)?.includes(origin))
    && (!params.account || entryAccountIds(e, data!, workspace).includes(params.account))
    && (!query.trim() || [e.title, e.topic?.angle, e.plan?.notes, e.article?.body, e.post?.body].join(' ').toLowerCase().includes(query.trim().toLowerCase())))
  if (sort !== 'recent') rows.sort((a, b) => score(b) - score(a))
  const dueReviews = workspace === 'social' && data ? (data.reviews || []).filter((r: any) => r.status === 'pending' && r.due_at <= new Date().toISOString() && reviewWorkspace(r, data) === 'social').length : 0
  const reviewing = workspace === 'social' && params.ownership === 'reviews'
  const openNew = (topic?: any) => {
    setSaveError('')
    setForm({ title: topic?.title || '', angle: topic?.angle || '', type: workspace === 'website' ? 'article' : topic?.content_type || 'post', account: topic?.target_account_id || params.account || '', topic })
  }
  useEffect(() => { if (params.new === '1') { openNew(); setParam('new', '') } }, [params.new])
  const save = async (mode: 'topic' | 'draft' | 'ai') => {
    if (!form || !form.title.trim()) return
    setBusy(true); setSaveError('')
    try {
      const account = accounts.find(c => c.id === form.account)
      const fields = { title: form.title.trim(), angle: form.angle.trim(), workspace, content_type: form.type,
        target_platform: workspace === 'website' ? 'website' : account?.type || '', target_account_id: account?.id || '' }
      let topic = form.topic || (form.savedId ? data?.topics.find(t => t.id === form.savedId) : null)
      if (topic || form.savedId) {
        const id = topic?.id || form.savedId!
        await dbPatch('topics', id, fields as any); topic = { ...topic, ...fields, id }
      } else {
        topic = await dbCreate('topics', { ...fields, source: 'manual', status: 'idea', created_at: new Date().toISOString(),
          brief: JSON.stringify({ language: isEn() ? 'en' : 'zh', channels: fields.target_platform || 'social', product_ids: [] }) } as any)
        setForm(f => f && ({ ...f, savedId: topic.id }))
      }
      if (mode === 'ai') {
        const chat = await writer.run({ workspace, topic_id: topic.id, type: form.type, ...(workspace === 'website' && account ? { channel_id: account.id } : {}) })
        if (!chat) return
      } else if (mode === 'draft') {
        const now = new Date().toISOString()
        const article = await dbCreate('articles', { title: fields.title, type: form.type, body: '', summary: '', tags: '[]', status: 'draft',
          topic_id: topic.id, workspace, target_platform: fields.target_platform, target_account_id: fields.target_account_id,
          channel_id: workspace === 'website' ? account?.id || '' : '', created_at: now, updated_at: now } as any)
        await dbPatch('topics', topic.id, { article_id: article.id, status: 'done' })
        setParam('article', article.id)
      }
      setParam('ownership', ''); setParam('stage', 'all'); setParam('account', ''); setParam('origin', ''); setQuery('')
      setForm(null); reload()
    } catch (e) { setSaveError((e as Error).message) } finally { setBusy(false) }
  }
  const copy = async (article: any) => {
    const result = await runLocal<{ article_id: string }>('convert.copy', { article_id: article.id })
    reload(); setParam('article', result.article_id)
  }
  const selectedArticle = data?.articles.find(a => a.id === params.article)
  const selectedEntry = selectedArticle && entries.find(e => e.article?.id === selectedArticle.id)
  const selectedTopic = !params.article && data?.topics.find(t => t.id === params.topic)
  const topicEntry = selectedTopic ? entries.find(e => e.topic?.id === selectedTopic.id && !e.article && !e.plan) || entries.find(e => e.topic?.id === selectedTopic.id) : undefined
  // 计划和选题详情的顶上一条：状态（点了改状态和链接）+ 发布链接，和正文详情的顶栏、发布记录一个样子
  const entryHeader = (entry: ContentEntry) => <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><ContentStatus entry={entry} workspace={workspace} onChanged={reload} /></div>
    <PublicationLinks entry={entry} workspace={workspace} onChanged={reload} />
  </div>
  const published = selectedArticle && entries.some(e => e.article?.id === selectedArticle.id && e.stage === 'published')
  // 每一行点标题都进它走得最远的那份记录：有成品进正文，没有成品进计划，只有选题进选题
  const openEntry = (entry: ContentEntry) => entry.post ? setParam('post', entry.post.id) : entry.article ? setParam('article', entry.article.id) : entry.plan ? setParam('plan', entry.plan.id) : setParam('topic', entry.topic.id)
  const destination = (entry: ContentEntry) => {
    const name = (id?: string) => ctx.channels.find(c => c.id === id)?.name || data?.channels.find(c => c.id === id)?.name
    const publishedIds = entryAccountIds(entry, data!, workspace, true)
    if (publishedIds.length) return publishedIds.map(id => name(id) || tr('content.removed_channel')).join(' · ')
    const id = entry.article?.target_account_id || entry.topic?.target_account_id || entry.plan?.target_account_id || entry.plan?.target_account?.id || entry.article?.channel_id
    return name(id) || entry.plan?.role_name || (entry.workspaces.length ? w('destination_pending') : w('unassigned'))
  }
  return <div className="space-y-5">
    {selectedArticle ? <ArticleDetail key={selectedArticle.id} work={aiWork} ctx={ctx} a={selectedArticle} all={data!.articles}
      posts={data!.posts.filter(p => p.article_id === selectedArticle.id)} pubs={data!.publications.filter(p => p.article_id === selectedArticle.id)}
      focus={params.version} displayStatus={published ? 'published' : 'draft'} inspiration publishScope={workspace}
      statusControl={selectedEntry ? <ContentStatus entry={selectedEntry} workspace={workspace} onChanged={reload} /> : undefined}
      publicationLinks={selectedEntry ? <PublicationLinks entry={selectedEntry} workspace={workspace} onChanged={reload} recordsShown /> : undefined}
      open={id => setParam('article', id)} onBack={() => { setParam('article', ''); setParam('version', '') }} onChanged={reload} />
      : null}
    {selectedArticle && workspace === 'social' && selectedEntry && <ContentPerformance ctx={ctx} entry={selectedEntry} data={data!} />}
    {!selectedArticle && <>
      <PageHeader title={w(workspace + '_content')} desc={w(workspace + '_desc')} actions={<>
        <Button onClick={() => openNew()}><Plus />{w('new_content')}</Button>
        <TaskLaunchButton task="suggest-topics" input={{ workspace }} match={r => r.input?.workspace === workspace} reqKey="topic_requirements" onFinished={reload}
          title={tr('content.gen_topics')} desc={w('suggest_desc')} reqTitle={tr('content.req_title')} reqHint={tr('content.req_hint')} startLabel={tr('content.start_topics')} variant="outline">{tr('content.gen_topics')}</TaskLaunchButton>
        <MarketingImport data={data} onDone={reload} />
      </>} />
      <TaskRunning runs={(writer.task?.running || []).filter(r => r.input?.workspace === workspace || entries.some(e => e.topic?.id === r.input?.topic_id && e.workspaces.includes(workspace)))} title={() => w('stage_creating')} desc={tr('content.writing_desc')} />
      <TaskFailed task={writer.task} />
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Skeleton className="h-40 rounded-xl" />}
      {data && <>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setParam('ownership', '')} className={cx('cursor-pointer rounded-lg px-3 py-2 text-sm', !params.ownership || params.ownership === 'owned' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent')}>{w('owned_count', { n: owned.length })}</button>
          {!!unassigned.length && <button type="button" onClick={() => setParam('ownership', 'unassigned')} className={cx('cursor-pointer rounded-lg px-3 py-2 text-sm', params.ownership === 'unassigned' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent')}>{w('unassigned_count', { n: unassigned.length })}</button>}
          {!!platform.length && <button type="button" onClick={() => setParam('ownership', 'platform')} className={cx('cursor-pointer rounded-lg px-3 py-2 text-sm', params.ownership === 'platform' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent')}>{w('platform_count', { n: platform.length })}</button>}
          {workspace === 'social' && <button type="button" onClick={() => setParam('ownership', 'reviews')} className={cx('cursor-pointer rounded-lg px-3 py-2 text-sm', reviewing ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent')}>
            {w('reviews_tab')}{!!dueReviews && <span className="ml-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary-text">{dueReviews}</span>}</button>}
        </div>
        {reviewing ? <GrowthReviews ctx={ctx} workspace="social" /> : <>
        {params.ownership === 'unassigned' && <Notice>{w('unassigned_note')}</Notice>}
        {params.ownership === 'platform' && <Notice>{w('platform_note')}</Notice>}
        <div className={cx('grid grid-cols-1 gap-3', workspace === 'social' ? 'sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_150px_160px_160px_150px]' : 'sm:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_160px_176px_176px]')}>
          <input type="search" aria-label={w('search')} placeholder={w('search')} value={query} onChange={e => setQuery(e.target.value)} className={cx(inputCls, 'min-w-0 xl:col-span-1', workspace === 'social' ? 'sm:col-span-2' : 'sm:col-span-3')} />
          <Select ariaLabel={w('stage_filter')} value={stage} onChange={v => setParam('stage', v)} options={[
            { value: 'all', label: w('all_stages') }, ...stages.map(s => ({ value: s, label: `${w('stage_' + s)} ${base.filter(e => e.stage === s).length}` }))]} />
          <Select ariaLabel={w('account_filter')} value={params.account || ''} onChange={v => setParam('account', v)} options={[
            { value: '', label: w(workspace === 'website' ? 'all_sites' : 'all_accounts') }, ...accounts.map(c => ({ value: c.id, label: c.name }))]} />
          <Select ariaLabel={tr('origin.filter')} value={origin} onChange={v => setParam('origin', v)} options={[
            { value: '', label: tr('origin.filter_all') }, ...CONTENT_ORIGINS.map(k => ({ k, n: base.filter(e => origins.get(e.key)?.includes(k)).length })).filter(o => o.n || o.k === origin).map(o => ({ value: o.k, label: `${tr('origin.k_' + o.k)} ${o.n}` }))]} />
          {workspace === 'social' && <Select ariaLabel={w('sort')} value={sort} onChange={v => setParam('sort', v === 'recent' ? '' : v)} options={[
            { value: 'recent', label: w('sort_recent') }, { value: 'views', label: w('sort_views') }, { value: 'gain', label: w('sort_gain') }]} />}
        </div>
        {!rows.length ? <Notice>{w('content_empty')}</Notice> : <div className="divide-y divide-border rounded-xl border border-border bg-background">
          {rows.slice(0, shown).map(entry => <div key={entry.key} className="flex flex-wrap items-start gap-3 px-4 py-4">
            <div className="min-w-0 flex-1">
              <button type="button" className="cursor-pointer text-left text-sm font-medium hover:text-primary-text" onClick={() => openEntry(entry)}>{entry.title || tr('versions.untitled')}</button>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <TypeBadge type={entry.article?.type || entry.topic?.content_type || entry.plan?.content_type || (entry.post?.video ? 'video' : workspace === 'website' ? 'article' : 'post')} />
                <span>{destination(entry)}</span>
                {origins.get(entry.key)?.filter(k => k !== 'topic' && k !== 'direct').map(k => <span key={k}>{tr('origin.k_' + k)}</span>)}
                {entry.post && <span>{w('from_platform')}</span>}
                {entry.plan?.content_id && <span>{entry.plan.content_id}</span>}
                {entry.workspaces.length > 1 && <span>{w('shared_content')}</span>}
                <LinkChips urls={entry.publicationUrls} />
              </div>
              {(entry.topic?.angle || entry.plan?.notes) && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{entry.topic?.angle || entry.plan?.notes}</p>}
              <MetricsLine m={metrics.get(entry.key)} />
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {entry.post ? <>
                <StageBadge stage={entry.stage} />
                <Button size="sm" variant="outline" onClick={() => setParam('post', entry.post.id)}><Link2 />{w('adopt')}</Button>
              </> : <ContentStatus entry={entry} workspace={workspace} onChanged={reload} />}
              {!entry.workspaces.length && <Button size="sm" variant="outline" onClick={() => { setAssignmentScope(workspace); setAssignment(entry) }}>{w('assign')}</Button>}
              {!entry.post && <RowMore items={[
                ...(entry.plan ? [{ label: w('plan_details'), icon: <ClipboardList className="size-4" />, onSelect: () => setParam('plan', entry.plan.id) }] : []),
                ...(entry.topic ? [{ label: w('brief'), icon: <NotebookPen className="size-4" />, onSelect: () => setParam('topic', entry.topic.id) }] : [])]}
                {...(entry.article ? { onRewrite: () => setRewrite(entry.article), onCopy: () => copy(entry.article), onDelete: async () => { await removeArticle(entry.article, data.posts, data.publications); reload() } } : {})} />}
            </div>
          </div>)}
          {rows.length > shown && <div className="px-4 py-3"><Button size="sm" variant="ghost" onClick={() => setShown(n => n + PAGE)}>{w('show_more', { n: rows.length - shown })}</Button></div>}
        </div>}
      </>}
      </>}
    </>}
    {params.plan && <MarketingPlans ctx={ctx} params={params} setParam={setParam} detailsOnly
      contentEntry={entries.find(e => e.plan?.id === params.plan)} workspace={workspace} onChanged={reload}
      performance={workspace === 'social' && data && entries.find(e => e.plan?.id === params.plan) ? <ContentPerformance ctx={ctx} entry={entries.find(e => e.plan?.id === params.plan)!} data={data} /> : undefined} />}
    {params.post && data && entries.find(e => e.post?.id === params.post) && <AdoptPostDialog entry={entries.find(e => e.post?.id === params.post)!}
      metrics={metrics.get('post:' + params.post)} account={destination(entries.find(e => e.post?.id === params.post)!)}
      articles={entries.filter(e => e.article && e.workspaces.includes('social')).map(e => e.article)}
      onClose={() => setParam('post', '')} onDone={id => { setParam('post', ''); reload(); setParam('article', id) }} />}
    {selectedTopic && <WritingBriefDialog key={selectedTopic.id} ctx={ctx} topic={selectedTopic} header={topicEntry && entryHeader(topicEntry)} onClose={() => setParam('topic', '')} onChanged={reload} onWrite={async () => {
      try {
        const latest = await runLocal<ContentData>('content-workspace.context', {})
        const topic = latest.topics.find(t => t.id === selectedTopic.id)
        if (topic) { setParam('topic', ''); openNew(topic) }
      } catch (e) { toast((e as Error).message, 'error') }
    }} />}
    <Dialog open={!!form} onClose={() => !busy && setForm(null)} title={w('new_content')} width={680} footer={<>
      <Button variant="ghost" disabled={busy} onClick={() => setForm(null)}>{tr('common.cancel')}</Button>
      <Button variant="outline" disabled={busy || !form?.title.trim()} onClick={() => save('topic')}>{w('save_topic')}</Button>
      <Button variant="outline" disabled={busy || !form?.title.trim()} onClick={() => save('draft')}>{tr('content.write_self')}</Button>
      <Button disabled={busy || !form?.title.trim() || !writer.task || !writer.shuttle} onClick={() => save('ai')}>{busy ? <Loader className="animate-spin" /> : <Sparkles />}{w('ai_create')}</Button>
    </>}>
      {form && <div className="space-y-4">
        {saveError && <Notice tone="error">{saveError}</Notice>}
        <Field label={w('title')}><input autoFocus aria-label={w('title')} className={inputCls} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label={w('angle')}><textarea aria-label={w('angle')} className={inputCls} rows={3} value={form.angle} onChange={e => setForm({ ...form, angle: e.target.value })} /></Field>
        {workspace === 'social' && <Field group label={tr('article.type')}><TypePicker value={form.type} onChange={type => setForm({ ...form, type })} /></Field>}
        <Field label={w(workspace === 'website' ? 'site_target' : 'account_target')}><Select ariaLabel={w('destination')} value={form.account} onChange={account => setForm({ ...form, account })} options={[
          { value: '', label: w('destination_pending') }, ...accounts.map(c => ({ value: c.id, label: c.name }))]} /></Field>
        {writer.task && <Button size="sm" variant="ghost" onClick={() => setRequirements(true)}>{tr('content.req_btn')}</Button>}
        {writer.error && <Notice tone="error">{writer.error}</Notice>}
      </div>}
    </Dialog>
    <Dialog open={!!assignment} onClose={() => setAssignment(null)} title={w('assign')} footer={<Button fn="content-workspace.assign" onClick={async () => {
      await runLocal('content-workspace.assign', { key: assignment!.key, workspace: assignmentScope }); setAssignment(null); reload()
    }}>{tr('common.save')}</Button>}>
      <div className="space-y-4"><p>{assignment?.title}</p><Notice>{w('assign_note')}</Notice><Select ariaLabel={w('assign')} value={assignmentScope} onChange={setAssignmentScope} options={[
        { value: 'website', label: w('website_content') }, { value: 'social', label: w('social_content') }]} /></div>
    </Dialog>
    <TaskRequirements task={writer.task} onSaved={writer.setTask} title={tr('content.req_title')} hint={tr('content.req_hint')} open={requirements} onOpenChange={setRequirements} />
    {rewrite && <RewriteDialog open article={rewrite} starting={rewriter.starting} error={rewriter.error} onClose={() => setRewrite(null)}
      onStart={async (type, note) => { if (await rewriter.run({ article_id: rewrite.id, type, note })) setRewrite(null) }}
      onConvert={async type => { const result = await runLocal<{ article_id: string }>('convert.toType', { article_id: rewrite.id, type }); setRewrite(null); reload(); setParam('article', result.article_id) }} />}
  </div>
}

/** 没有出处的帖子：看一眼内容和数据，关联到已有内容，或者存为一条内容（之后改写、复盘都在那条内容里） */
function AdoptPostDialog({ entry, metrics, account, articles, onClose, onDone }: { entry: ContentEntry; metrics?: ReturnType<typeof entryMetrics>; account: string; articles: any[]; onClose: () => void; onDone: (articleId: string) => void }) {
  const p = entry.post
  const [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const adopt = async (article_id?: string) => {
    setBusy(true); setError('')
    try { onDone((await runLocal<{ article_id: string }>('content-workspace.adoptPost', { post_id: p.id, article_id })).article_id) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <Dialog open onClose={() => !busy && onClose()} title={entry.title || tr('versions.untitled')} width={640} footer={<>
    <Button variant="ghost" disabled={busy} onClick={onClose}>{tr('common.cancel')}</Button>
    <Button variant="outline" disabled={busy || !target} fn="content-workspace.adoptPost" onClick={() => adopt(target)}><Link2 />{w('adopt_link')}</Button>
    <Button disabled={busy} fn="content-workspace.adoptPost" onClick={() => adopt()}>{busy ? <Loader className="animate-spin" /> : <Plus />}{w('adopt_new')}</Button>
  </>}>
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StageBadge stage={entry.stage} /><span>{account}</span>
        {p.published_at && <span>{new Date(p.published_at).toLocaleString(isEn() ? 'en' : 'zh-CN')}</span>}
        {entry.publicationUrls[0] && <a href={entry.publicationUrls[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-primary-text">{w('open_on_platform')}<ArrowUpRight className="size-3.5" /></a>}
      </div>
      <MetricsLine m={metrics} />
      {p.body && <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{p.body}</p>}
      <Notice>{w('adopt_note')}</Notice>
      <Field label={w('adopt_target')}><Select ariaLabel={w('adopt_target')} value={target} onChange={setTarget} options={[
        { value: '', label: w('adopt_pick') }, ...articles.map(a => ({ value: a.id, label: a.title || tr('versions.untitled') }))]} /></Field>
    </div>
  </Dialog>
}
