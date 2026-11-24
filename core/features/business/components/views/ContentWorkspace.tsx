import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, ClipboardList, Link2, Loader, NotebookPen, Plus, Search as SearchIcon, Sparkles } from 'lucide-react'
import { ArticleDetail, RowMore, removeArticle } from './Content'
import { WritingBriefPage } from '../ContentEvidence'
import SocialCreate, { socialOf } from '../SocialCreate'
import SocialWorkspace from './SocialWorkspace'
import { TypeBadge, TypePicker, type ArticleType } from '../ArticleTypes'
import { AiScoreTag, aiScoreOn } from '../AiScore'
import RewriteDialog, { REWRITE_TASK } from '../RewriteDialog'
import { aiWork } from '../Artifacts'
import ContentPerformance, { MetricsLine } from '../ContentPerformance'
import ContentStatus, { LinkChips, PublicationLinks, StageBadge } from '../ContentStatus'
import { TaskFailed, TaskLaunchButton, TaskRequirements, TaskRunning, useTask } from '../Task'
import { Button, Dialog, Field, Notice, PageHeader, Skeleton, cx, inputCls, toast } from '../ui'
import Select from '../Select'
import VideoField from '../VideoField'
import { contentEntries, entryAccountIds, entryMetrics, legacyContentWorkspace, type ContentData, type ContentEntry, type ContentStage, type ContentWorkspace } from '../../lib/contentWorkspace'
import { dbCreate, dbPatch, isPublishSite, isSite, runLocal } from '../../lib/shuttle'
import { isEn, tr } from '../../lib/i18n'
import { CONTENT_ORIGINS, contentOrigins, type ContentOrigin } from '../../lib/origins'
import type { Ctx } from './types'

export const w = (key: string, vars?: Record<string, unknown>) => tr('workspace.' + key, vars)

/** 页签：下划线样式，选中的加粗、底下一条深色线 */

// 列表按状态分组：要用户处理的在最上面，然后是进行中、已发布、已归档。筛了某个状态或按数据排序时不分组
const GROUPS: [string, ContentStage[]][] = [['attention', ['draft', 'ready', 'verify', 'blocked']], ['progress', ['planned', 'creating', 'scheduled']], ['published', ['published']], ['archived', ['archived']]]
function groupRows(rows: ContentEntry[], grouped: boolean): { key: string; rows: ContentEntry[] }[] {
  if (!grouped) return [{ key: 'all', rows }]
  return GROUPS.map(([key, stages]) => ({ key, rows: rows.filter(e => stages.includes(e.stage)) })).concat([{ key: 'other', rows: rows.filter(e => !GROUPS.some(([, st]) => st.includes(e.stage))) }])
}
const PAGE = 50
const stages: ContentStage[] = ['planned', 'creating', 'draft', 'ready', 'scheduled', 'published', 'verify', 'blocked', 'archived']
/**
 * 营销计划和复盘（运营主题模块，产品运营有）：模板的页面表（lib/views.tsx）传进来，没有就不显示这些
 *   Import 页头上「导入营销资料」；Reviews 社媒的「待复盘」页签和一条内容发布后的复盘（targets 给了只看这几条）；
 *   Plan 一条营销计划的详情（performance 是它发布后的效果）；inspiration 文章详情里能从灵感库选参考
 */
export type Marketing = {
  Import: (p: { data: ContentData; onDone: () => void }) => ReactNode
  Reviews: (p: { targets?: string[] }) => ReactNode
  Plan: (p: { params: Record<string, string>; setParam: (k: string, v: string) => void; entry?: ContentEntry; workspace: ContentWorkspace; onChanged: () => void; performance?: ReactNode }) => ReactNode
  inspiration?: boolean
}
type Props = { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void; workspace?: ContentWorkspace; marketing?: Marketing }

/** 读一次内容数据（content-workspace.context），ctx.rev 变了（助手改了表）重读 */
function useContentData(rev: unknown) {
  const [data, setData] = useState<ContentData | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    runLocal<ContentData>('content-workspace.context', {})
      .then((d) => (setData(d), setError('')))
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(reload, [reload, rev])
  return { data, error, reload }
}
type NewContent = { title: string; angle: string; type: ArticleType; account: string; topic?: any; savedId?: string; record?: boolean; body?: string; video?: string; stage?: 'draft' | 'published'; link?: string }

/**
 * 网站文章 / 社媒内容：同一份文章、选题表按工作区分开看（lib/contentWorkspace.ts 判断归属），新建、发布都只在所属工作区。
 * 外贸和产品运营共用（business 模块）；营销计划和复盘有运营主题模块的才有（marketing）。设计见 docs/content-workspaces.md
 */
export default function ContentWorkspace({ ctx, params, setParam: updateParam, workspace: requested, marketing }: Props) {
  // 内容「发布后的效果」下面的营销复盘（运营主题模块）
  const growthReviews = marketing ? (targets: string[]) => marketing.Reviews({ targets }) : undefined
  const { data, error, reload } = useContentData(ctx.rev)
  const all = data ? contentEntries(data) : []
  const workspace = requested || legacyContentWorkspace(params, all)
  const setParam = (key: string, value: string) => {
    if (['article', 'topic', 'plan'].includes(key) && !value) {
      if (!requested) updateParam('workspace', workspace)
      const field = key as 'article' | 'topic' | 'plan'
    }
    updateParam(key, value)
  }
  const entries = data ? contentEntries(data, workspace) : []
  // 还没记归属的（老数据、没带 workspace 建的选题）不单独一栏：放在列表里，行上「选发到哪」点一下归过去
  const unassigned = entries.filter(e => !e.workspaces.length)
  // 在平台上直接发的帖子：自媒体放进「已发布」，标「平台上发的」、能按来源筛（SocialWorkspace），不用先并入
  const owned = entries.filter(e => e.workspaces.includes(workspace) && !e.post), platform = entries.filter(e => e.post)
  const base = [...owned, ...unassigned]
  const assign = (entry: ContentEntry) => { setAssignmentScope(workspace); setAssignment(entry) }
  const stage = params.stage || (['draft', 'published'].includes(params.status) ? params.status : 'all')
  const [query, setQuery] = useState(''), [form, setForm] = useState<NewContent | null>(null)
  const [shown, setShown] = useState(PAGE)
  useEffect(() => setShown(PAGE), [params.stage, params.account, params.origin, params.sort, query])
  const [busy, setBusy] = useState(false), [saveError, setSaveError] = useState(''), [requirements, setRequirements] = useState(false)
  const [rewrite, setRewrite] = useState<any>(null), [assignment, setAssignment] = useState<ContentEntry | null>(null), [assignmentScope, setAssignmentScope] = useState<ContentWorkspace>(workspace)
  const writer = useTask('write-article', reload), rewriter = useTask(REWRITE_TASK, reload)
  const accounts = ctx.channels.filter(c => workspace === 'website' ? isPublishSite(c) : !isSite(c))
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
  const visible = new Set(groupRows(rows, stage === 'all' && sort === 'recent').flatMap(g => g.rows).slice(0, shown).map(e => e.key))
  const openNew = (topic?: any) => {
    setSaveError('')
    setForm({ title: topic?.title || '', angle: topic?.angle || '', type: workspace === 'website' ? 'article' : topic?.content_type || 'post', account: topic?.target_account_id || params.account || '', topic })
  }
  useEffect(() => { if (params.new === '1') { openNew(); setParam('new', '') } }, [params.new])
  const save = async (mode: 'topic' | 'draft' | 'ai' | 'record') => {
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
      } else if (mode === 'record') {
        // 直接录入已有内容：不经过 AI。存成一篇文章（视频、文案），已发布的再带上发布链接和状态（用户确认的记录，不伪造平台帖子和数据）
        const now = new Date().toISOString()
        const published = form.stage === 'published'
        const article = await dbCreate('articles', { title: fields.title, type: form.type, body: (form.body || '').trim(), summary: '', tags: '[]', status: 'draft',
          ...(form.type === 'video' && form.video ? { video: form.video } : {}),
          topic_id: topic.id, workspace, target_platform: fields.target_platform, target_account_id: fields.target_account_id,
          channel_id: '', created_at: now, updated_at: now } as any)
        await dbPatch('topics', topic.id, { article_id: article.id, status: 'done' })
        if (published) await runLocal('content-workspace.setStage', { key: 'topic:' + topic.id, workspace, stage: 'published', links: [(form.link || '').trim()] })
        if (!published) setParam('article', article.id)
      } else if (mode === 'draft') {
        const now = new Date().toISOString()
        const article = await dbCreate('articles', { title: fields.title, type: form.type, body: '', summary: '', tags: '[]', status: 'draft',
          topic_id: topic.id, workspace, target_platform: fields.target_platform, target_account_id: fields.target_account_id,
          channel_id: workspace === 'website' ? account?.id || '' : '', created_at: now, updated_at: now } as any)
        await dbPatch('topics', topic.id, { article_id: article.id, status: 'done' })
        setParam('article', article.id)
      }
      setParam('stage', 'all'); setParam('account', ''); setParam('origin', ''); setQuery('')
      setForm(null); reload()
    } catch (e) { setSaveError((e as Error).message) } finally { setBusy(false) }
  }
  const copy = async (article: any) => {
    const result = await runLocal<{ article_id: string }>('convert.copy', { article_id: article.id })
    reload(); setParam('article', result.article_id)
  }
  const selectedArticle = data?.articles.find(a => a.id === params.article)
  const selectedEntry = selectedArticle && entries.find(e => e.article?.id === selectedArticle.id)
  // 新建社媒内容（三步向导，components/SocialCreate.tsx）：?create=new 新的，?create=<选题 id> 接着做；向导做的选题点开也进向导
  const creating = workspace === 'social' && !params.article && (params.create || (params.topic && socialOf(data?.topics.find(t => t.id === params.topic)) ? params.topic : ''))
  const createTopic = creating && creating !== 'new' ? data?.topics.find(t => t.id === creating) || null : null
  const selectedTopic = !params.article && !creating && data?.topics.find(t => t.id === params.topic)
  const topicEntry = selectedTopic ? entries.find(e => e.topic?.id === selectedTopic.id && !e.article && !e.plan) || entries.find(e => e.topic?.id === selectedTopic.id) : undefined
  // 计划和选题详情的顶上一条：状态（点了改状态和链接）+ 发布链接，和正文详情的顶栏、发布记录一个样子
  const entryHeader = (entry: ContentEntry) => <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><ContentStatus entry={entry} workspace={workspace} onChanged={reload} /></div>
    <PublicationLinks entry={entry} workspace={workspace} onChanged={reload} />
  </div>
  const published = selectedArticle && entries.some(e => e.article?.id === selectedArticle.id && e.stage === 'published')
  // 每一行点标题都进它走得最远的那份记录：有成品进正文，没有成品进计划，只有选题进选题
  const openEntry = (entry: ContentEntry) => entry.post ? setParam('adopt', entry.post.id) : entry.article ? setParam('article', entry.article.id) : entry.plan ? setParam('plan', entry.plan.id) : socialOf(entry.topic) ? setParam('create', entry.topic.id) : setParam('topic', entry.topic.id)
  const destination = (entry: ContentEntry) => {
    const name = (id?: string) => ctx.channels.find(c => c.id === id)?.name || data?.channels.find(c => c.id === id)?.name
    const publishedIds = entryAccountIds(entry, data!, workspace, true)
    if (publishedIds.length) return publishedIds.map(id => name(id) || tr('content.removed_channel')).join(' · ')
    const id = entry.article?.target_account_id || entry.topic?.target_account_id || entry.plan?.target_account_id || entry.plan?.target_account?.id || entry.article?.channel_id
    return name(id) || entry.plan?.role_name || (entry.workspaces.length ? w('destination_pending') : w('unassigned'))
  }
  // 渲染一篇文章的详情页（发布记录、数据、复盘）：整页、或社媒两栏布局的右边（排期、已发布的）都用它
  const renderArticle = (article: any) => {
    const entry = entries.find(e => e.article?.id === article.id)
    const isPublished = entries.some(e => e.article?.id === article.id && e.stage === 'published')
    return <>
      <ArticleDetail key={article.id} work={aiWork} ctx={ctx} a={article} all={data!.articles}
        posts={data!.posts.filter(p => p.article_id === article.id)} pubs={data!.publications.filter(p => p.article_id === article.id)}
        focus={params.version} displayStatus={isPublished ? 'published' : 'draft'} inspiration={!!marketing?.inspiration} publishScope={workspace}
        statusControl={entry ? <ContentStatus entry={entry} workspace={workspace} onChanged={reload} /> : undefined}
        publicationLinks={entry ? <PublicationLinks entry={entry} workspace={workspace} onChanged={reload} recordsShown /> : undefined}
        open={id => setParam('article', id)} onBack={() => { setParam('article', ''); setParam('version', '') }} onChanged={reload} />
      {workspace === 'social' && entry && <ContentPerformance ctx={ctx} entry={entry} data={data!} reviews={growthReviews} />}
    </>
  }
  // 自媒体内容默认是「左边列表、右边直接编辑」（SocialWorkspace，平台上直接发的帖子也在里面）；选题、计划仍是原来的整页
  const split = workspace === 'social' && !!data && !params.plan && !params.topic && !creating
  return <div className="space-y-5">
    {split && <SocialWorkspace ctx={ctx} data={data!} entries={[...owned, ...unassigned, ...platform]} params={params} setParam={setParam} reload={reload} detail={renderArticle}
      openEntry={openEntry} onAssign={assign}
      tools={<>
        <TaskLaunchButton task="suggest-topics" input={{ workspace }} match={r => r.input?.workspace === workspace} reqKey="topic_requirements" onFinished={reload}
          title={tr('content.gen_topics')} desc={w('suggest_desc')} reqTitle={tr('content.req_title')} reqHint={tr('content.req_hint')} startLabel={tr('content.start_topics')} variant="ghost">{tr('content.gen_topics')}</TaskLaunchButton>
        {marketing && marketing.Import({ data: data!, onDone: reload })}
      </>} />}
    {!split && selectedArticle && renderArticle(selectedArticle)}
    {selectedTopic && <WritingBriefPage key={selectedTopic.id} ctx={ctx} topic={selectedTopic} header={topicEntry && entryHeader(topicEntry)} onClose={() => setParam('topic', '')} onChanged={reload} onWrite={async () => {
      try {
        // 网站文章：发到哪个网站定得下来就直接交给助手写；定不下来（几个网站、社媒要选账号）再弹新建内容选
        const site = workspace === 'website' ? accounts.find(c => c.id === selectedTopic.target_account_id) || (accounts.length === 1 ? accounts[0] : undefined) : undefined
        if (site) { await writer.run({ workspace, topic_id: selectedTopic.id, type: 'article', channel_id: site.id }); reload(); return }
        const latest = await runLocal<ContentData>('content-workspace.context', {})
        const topic = latest.topics.find(t => t.id === selectedTopic.id)
        if (topic) openNew(topic)
      } catch (e) { toast((e as Error).message, 'error') }
    }} />}
    {creating && data && (creating === 'new' || createTopic) && <SocialCreate key={createTopic?.id || 'new'} ctx={ctx} topic={createTopic}
      onCreated={id => updateParam('create', id)} onClose={() => { updateParam('create', ''); updateParam('topic', '') }} onChanged={reload}
      openArticle={id => { updateParam('create', ''); updateParam('topic', ''); setParam('article', id) }} />}
    {!split && !selectedArticle && !selectedTopic && !creating && <>
      <PageHeader title={w(workspace + '_content')} desc={w(workspace + '_desc')} actions={<>
        {workspace === 'social' && <Button onClick={() => setParam('create', 'new')}><Sparkles />{tr('social_create.new')}</Button>}
        <Button variant={workspace === 'social' ? 'outline' : 'default'} onClick={() => openNew()}><Plus />{w('new_content')}</Button>
        <TaskLaunchButton task="suggest-topics" input={{ workspace }} match={r => r.input?.workspace === workspace} reqKey="topic_requirements" onFinished={reload}
          title={tr('content.gen_topics')} desc={w('suggest_desc')} reqTitle={tr('content.req_title')} reqHint={tr('content.req_hint')} startLabel={tr('content.start_topics')} variant="outline">{tr('content.gen_topics')}</TaskLaunchButton>
        {marketing && data && marketing.Import({ data, onDone: reload })}
      </>} />
      <TaskRunning runs={(writer.task?.running || []).filter(r => r.input?.workspace === workspace || entries.some(e => e.topic?.id === r.input?.topic_id && e.workspaces.includes(workspace)))} title={() => w('stage_creating')} desc={tr('content.writing_desc')} />
      <TaskFailed task={writer.task} />
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Skeleton className="h-40 rounded-xl" />}
      {data && <>
        {/* 搜索占满剩下的宽度，筛选是后面一排紧凑的按钮（显示当前选的值） */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-48 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" aria-label={w('search')} placeholder={w('search')} value={query} onChange={e => setQuery(e.target.value)} className={cx(inputCls, 'h-8 rounded-lg pl-9')} />
          </label>
          <Select variant="inline" className="max-w-52" ariaLabel={w('stage_filter')} value={stage} onChange={v => setParam('stage', v)} options={[
            { value: 'all', label: w('all_stages') }, ...stages.map(s => ({ value: s, label: `${w('stage_' + s)} ${base.filter(e => e.stage === s).length}` }))]} />
          <Select variant="inline" className="max-w-52" ariaLabel={w('account_filter')} value={params.account || ''} onChange={v => setParam('account', v)} options={[
            { value: '', label: w(workspace === 'website' ? 'all_sites' : 'all_accounts') }, ...accounts.map(c => ({ value: c.id, label: c.name }))]} />
          <Select variant="inline" className="max-w-52" ariaLabel={tr('origin.filter')} value={origin} onChange={v => setParam('origin', v)} options={[
            { value: '', label: tr('origin.filter_all') }, ...CONTENT_ORIGINS.map(k => ({ k, n: base.filter(e => origins.get(e.key)?.includes(k)).length })).filter(o => o.n || o.k === origin).map(o => ({ value: o.k, label: `${tr('origin.k_' + o.k)} ${o.n}` }))]} />
          {workspace === 'social' && <Select variant="inline" className="max-w-52" ariaLabel={w('sort')} value={sort} onChange={v => setParam('sort', v === 'recent' ? '' : v)} options={[
            { value: 'recent', label: w('sort_recent') }, { value: 'views', label: w('sort_views') }, { value: 'gain', label: w('sort_gain') }]} />}
        </div>
        {!rows.length ? <Notice>{w('content_empty')}</Notice> : <>
          {groupRows(rows, stage === 'all' && sort === 'recent').map(group => {
            const list = group.rows.filter(e => visible.has(e.key))
            return !!list.length && <section key={group.key} className="space-y-2">
              {group.key !== 'all' && <h3 className="flex items-center gap-1.5 px-0.5 text-xs font-semibold text-muted-foreground">{w('group_' + group.key)}<span className="font-normal tabular-nums">{group.rows.length}</span></h3>}
              <div className="divide-y divide-border rounded-xl border border-border bg-background">
                {list.map(entry => <div key={entry.key} className="flex flex-wrap items-start gap-3 px-4 py-4">
            <div className="min-w-0 flex-1">
              <button type="button" className="cursor-pointer text-left text-sm font-semibold hover:text-primary-text" onClick={() => openEntry(entry)}>{entry.title || tr('versions.untitled')}</button>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <TypeBadge type={entry.article?.type || entry.topic?.content_type || entry.plan?.content_type || (entry.post?.video ? 'video' : workspace === 'website' ? 'article' : 'post')} />
                <span>{destination(entry)}</span>
                {workspace === 'website' && entry.article && aiScoreOn(ctx.channels) && <AiScoreTag a={entry.article} />}
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
                <Button size="sm" variant="outline" onClick={() => setParam('adopt', entry.post.id)}><Link2 />{w('adopt')}</Button>
              </> : <ContentStatus entry={entry} workspace={workspace} onChanged={reload} />}
              {!entry.workspaces.length && <Button size="sm" variant="outline" onClick={() => assign(entry)}>{w('assign_where')}</Button>}
              {!entry.post && <RowMore items={[
                ...(entry.plan ? [{ label: w('plan_details'), icon: <ClipboardList className="size-4" />, onSelect: () => setParam('plan', entry.plan.id) }] : []),
                ...(entry.topic ? [{ label: socialOf(entry.topic) ? tr('social_create.title') : w('brief'), icon: <NotebookPen className="size-4" />, onSelect: () => socialOf(entry.topic) ? setParam('create', entry.topic.id) : setParam('topic', entry.topic.id) }] : [])]}
                {...(entry.article ? { onRewrite: () => setRewrite(entry.article), onCopy: () => copy(entry.article), onDelete: async () => { await removeArticle(entry.article, data.posts, data.publications); reload() } } : {})} />}
            </div>
          </div>)}
              </div>
            </section>
          })}
          {rows.length > shown && <div><Button size="sm" variant="ghost" onClick={() => setShown(n => n + PAGE)}>{w('show_more', { n: rows.length - shown })}</Button></div>}
        </>}
      </>}
    </>}
    {params.plan && marketing?.Plan({ params, setParam, entry: entries.find(e => e.plan?.id === params.plan), workspace, onChanged: reload,
      performance: workspace === 'social' && data && entries.find(e => e.plan?.id === params.plan) ? <ContentPerformance ctx={ctx} entry={entries.find(e => e.plan?.id === params.plan)!} data={data} reviews={growthReviews} /> : undefined })}
    {params.adopt && data && entries.find(e => e.post?.id === params.adopt) && <AdoptPostDialog entry={entries.find(e => e.post?.id === params.adopt)!}
      metrics={metrics.get('post:' + params.adopt)} account={destination(entries.find(e => e.post?.id === params.adopt)!)}
      articles={entries.filter(e => e.article && e.workspaces.includes('social')).map(e => e.article)}
      onClose={() => setParam('adopt', '')} onDone={id => { setParam('adopt', ''); setParam('post', ''); reload(); setParam('article', id) }} />}
    <Dialog open={!!form} onClose={() => !busy && setForm(null)} title={w('new_content')} width={680} footer={<>
      <Button variant="ghost" disabled={busy} onClick={() => setForm(null)}>{tr('common.cancel')}</Button>
      {form?.record ? (
        <Button disabled={busy || !form.title.trim() || (form.stage === 'published' && !(form.link || '').trim())} onClick={() => save('record')}>{busy ? <Loader className="animate-spin" /> : <ClipboardList />}{w('record_save')}</Button>
      ) : (<>
        <Button variant="outline" disabled={busy || !form?.title.trim()} onClick={() => save('topic')}>{w('save_topic')}</Button>
        <Button variant="outline" disabled={busy || !form?.title.trim()} onClick={() => save('draft')}>{tr('content.write_self')}</Button>
        <Button disabled={busy || !form?.title.trim() || !writer.task || !writer.shuttle} onClick={() => save('ai')}>{busy ? <Loader className="animate-spin" /> : <Sparkles />}{w('ai_create')}</Button>
      </>)}
    </>}>
      {form && <div className="space-y-4">
        {saveError && <Notice tone="error">{saveError}</Notice>}
        <Field label={w('title')}><input autoFocus aria-label={w('title')} className={inputCls} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
        {workspace === 'social' && !form.topic && !form.savedId && (
          <button type="button" role="switch" aria-checked={!!form.record} onClick={() => setForm({ ...form, record: !form.record, stage: form.stage || 'draft', type: !form.record && form.type === 'post' ? 'video' : form.type })}
            className={cx('flex w-full cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors', form.record ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/40')}>
            <ClipboardList className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span><span className="font-medium">{w('record_toggle')}</span><span className="block text-xs text-muted-foreground">{w('record_hint')}</span></span>
          </button>
        )}
        {!form.record && <Field label={w('angle')}><textarea aria-label={w('angle')} className={inputCls} rows={3} value={form.angle} onChange={e => setForm({ ...form, angle: e.target.value })} /></Field>}
        {workspace === 'social' && <Field group label={tr('article.type')}><TypePicker value={form.type} onChange={type => setForm({ ...form, type })} /></Field>}
        <Field label={w(workspace === 'website' ? 'site_target' : 'account_target')}><Select ariaLabel={w('destination')} value={form.account} onChange={account => setForm({ ...form, account })} options={[
          { value: '', label: w('destination_pending') }, ...accounts.map(c => ({ value: c.id, label: c.name }))]} /></Field>
        {form.record && <>
          {form.type === 'video' && <VideoField video={form.video || ''} onChange={video => setForm({ ...form, video })} />}
          <Field label={w('record_body')}><textarea aria-label={w('record_body')} className={inputCls} rows={4} value={form.body || ''} onChange={e => setForm({ ...form, body: e.target.value })} /></Field>
          <Field group label={w('record_stage')}><div className="flex gap-2">
            {(['draft', 'published'] as const).map(st => (
              <button key={st} type="button" aria-pressed={form.stage === st} onClick={() => setForm({ ...form, stage: st })}
                className={cx('cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors', form.stage === st ? 'border-primary/40 bg-primary/10 font-semibold text-primary-text' : 'border-border text-muted-foreground hover:text-foreground')}>{w('record_' + st)}</button>
            ))}
          </div></Field>
          {form.stage === 'published' && <Field label={w('record_link')}><input aria-label={w('record_link')} className={inputCls} placeholder="https://" value={form.link || ''} onChange={e => setForm({ ...form, link: e.target.value })} /></Field>}
        </>}
        {!form.record && writer.task && <Button size="sm" variant="ghost" onClick={() => setRequirements(true)}>{tr('content.req_btn')}</Button>}
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
