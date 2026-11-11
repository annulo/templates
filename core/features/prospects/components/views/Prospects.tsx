import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Globe, Mail, Phone, Play, Search, Sparkles, UserPlus, X } from 'lucide-react'
import RunButton from '../RunButton'
import { Badge, Button, Field, Notice, PageHeader, Panel, Segmented, Skeleton, cx, fmtTime, inputCls, type Tone } from '../ui'
import { TaskButton } from '../Task'
import Select from '../Select'
import { runLocal } from '../../lib/shuttle'
import type { Ctx } from './types'
import { tr } from '../../lib/i18n'

/** 任务 id（tasks/draft-icp.md）：分析客户画像、写搜索词和 Apollo 条件 */
const ICP_TASK = 'draft-icp'

type Filters = {
  person_titles?: string[]
  person_seniorities?: string[]
  person_locations?: string[]
  organization_num_employees_ranges?: string[]
  q_organization_keyword_tags?: string[]
  q_keywords?: string
}
type Icp = { summary?: string; industries?: string[]; regions?: string[]; company_size?: string; roles?: string[]; buying_signals?: string[]; exclude?: string[] }
type Source = 'web' | 'apollo'
type Batch = { id: string; name: string; source: Source; icp: Icp; queries: string[]; filters: Filters; limit?: number; status: string; step?: string; found?: number; qualified?: number; error?: string; created_at: string; updated_at?: string }
type Person = {
  id: string; source?: Source; name: string; title?: string; company?: string; company_domain?: string; company_size?: string; industry?: string; country?: string; city?: string
  linkedin_url?: string; email?: string; email_status?: string; phone?: string; score?: number; score_reason?: string; opener?: string; status: string; lead_id?: string
}
type Data = { batches: { id: string; name: string; status: string; found: number; qualified: number; created_at: string }[]; batch: Batch | null; people: Person[] }
type Status = { ready: boolean; how: string; browser: boolean; seniorities: string[]; ranges: string[] }

const scoreTone = (s?: number): Tone => (s == null ? 'default' : s >= 80 ? 'ok' : s >= 60 ? 'primary' : s >= 40 ? 'warn' : 'default')
const join = (a?: string[]) => (a ?? []).join(', ')
const split = (s: string) => s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean)

/**
 * 主动获客：客户画像（任务 draft-icp）→ 确认搜索词（官网反查）或 Apollo 条件 → 找客户 + AI 评分（prospects.run）→ 挑合格的转成询盘，
 * 在询盘的看板、背调、回复里接着跟。领英只给主页链接，用户自己去看、自己加好友。
 */
export default function Prospects({ ctx, params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [show, setShow] = useState<'qualified' | 'all' | 'skipped' | 'converted'>('qualified')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const batchId = params.batch ?? ''

  const load = useCallback(() => {
    runLocal<Data>('prospects.list', batchId ? { batch_id: batchId } : {})
      .then(setData)
      .catch((e) => setError(e.message))
  }, [batchId])
  useEffect(load, [load])
  useEffect(() => {
    if (ctx.rev) load()
  }, [ctx.rev])
  useEffect(() => {
    runLocal<Status>('prospects.status', {})
      .then(setStatus)
      .catch(() => setStatus({ ready: false, how: '', browser: false, seniorities: [], ranges: [] }))
  }, [])

  const batch = data?.batch ?? null
  const people = data?.people ?? []
  const shown = people.filter((p) => (show === 'all' ? true : show === 'qualified' ? p.status === 'qualified' : p.status === show))
  const act = async (fn: string, input: unknown) => {
    setError('')
    try {
      const r = await runLocal<any>(fn, input)
      load()
      return r
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const step = !batch ? 0 : batch.status === 'draft' ? 1 : batch.status === 'running' ? (batch.step === 'score' ? 3 : 2) : batch.status === 'done' ? 4 : 1

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('prospects.title')}
        desc={tr('prospects.desc')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {(data?.batches.length ?? 0) > 1 && (
              <Select
                variant="inline"
                ariaLabel={tr('prospects.batch')}
                value={batch?.id ?? ''}
                onChange={(v) => setParam('batch', v)}
                className="w-56"
                options={(data?.batches ?? []).map((b) => ({ value: b.id, label: b.name, sub: tr('prospects.batch_line', { found: b.found, qualified: b.qualified, when: fmtTime(b.created_at) }) }))}
              />
            )}
            <TaskButton task={ICP_TASK} input={{}} onFinished={load} variant={batch ? 'outline' : 'default'} icon={Sparkles}>
              {batch ? tr('prospects.icp_new') : tr('prospects.icp_run')}
            </TaskButton>
          </div>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      <Steps step={step} />

      {data === null ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !batch ? (
        <div className="space-y-2 rounded-xl border border-dashed border-border p-6 text-sm">
          <p className="font-medium">{tr('prospects.empty_title')}</p>
          <p className="text-muted-foreground">{tr('prospects.empty')}</p>
        </div>
      ) : (
        <>
          <BatchPanel key={batch.id + (batch.updated_at ?? '')} batch={batch} status={status} onSaved={load} onError={setError} />

          {batch.error && <Notice tone={batch.status === 'failed' ? 'error' : 'muted'}>{batch.error}</Notice>}

          {people.length > 0 && (
            <Panel
              title={tr('prospects.people', { found: batch.found ?? people.length, qualified: batch.qualified ?? 0 })}
              aside={
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented
                    value={show}
                    onChange={setShow}
                    options={(['qualified', 'all', 'converted', 'skipped'] as const).map((k) => ({ value: k, label: `${tr(`prospects.f_${k}`)} ${k === 'all' ? people.length : people.filter((p) => p.status === k).length}` }))}
                  />
                  {picked.size > 0 && (
                    <RunButton inline variant="outline" fn="prospects.enrich" input={{ ids: [...picked] }} icon={Mail} onDone={() => (setPicked(new Set()), load())}>
                      {tr('prospects.enrich', { n: picked.size })}
                    </RunButton>
                  )}
                </div>
              }
            >
              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tr('prospects.none')}</p>
              ) : (
                <ul className="-mx-2 divide-y divide-border">
                  {shown.map((p) => (
                    <PersonRow
                      key={p.id}
                      person={p}
                      picked={picked.has(p.id)}
                      onPick={(on) => setPicked((s) => { const n = new Set(s); if (on) n.add(p.id); else n.delete(p.id); return n })}
                      onConvert={() => act('prospects.convert', { id: p.id })}
                      onSkip={() => act('prospects.update', { id: p.id, status: p.status === 'skipped' ? 'new' : 'skipped' })}
                      onOpenLead={() => ctx.go('leads', { lead: p.lead_id ?? '' })}
                    />
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  )
}

function Steps({ step }: { step: number }) {
  const names = ['s_icp', 's_confirm', 's_search', 's_score', 's_done']
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {names.map((n, i) => (
        <li key={n} className="flex items-center gap-2">
          <span className={cx('flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold', i < step ? 'border-primary bg-primary text-primary-foreground' : i === step ? 'border-primary text-primary-text' : 'border-border text-muted-foreground')}>
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cx(i <= step ? 'text-foreground' : 'text-muted-foreground')}>{tr(`prospects.${n}`)}</span>
          {i < names.length - 1 && <span className="h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  )
}

/** 一个批次：客户画像（只读）+ 筛选条件（能改）+ 开始获客 */
function BatchPanel({ batch, status, onSaved, onError }: { batch: Batch; status: Status | null; onSaved: () => void; onError: (m: string) => void }) {
  const f = batch.filters
  const [titles, setTitles] = useState(join(f.person_titles))
  const [locations, setLocations] = useState(join(f.person_locations))
  const [tags, setTags] = useState(join(f.q_organization_keyword_tags))
  const [keywords, setKeywords] = useState(f.q_keywords ?? '')
  const [seniorities, setSeniorities] = useState<string[]>(f.person_seniorities ?? [])
  const [ranges, setRanges] = useState<string[]>(f.organization_num_employees_ranges ?? [])
  const [limit, setLimit] = useState(String(batch.limit ?? (batch.source === 'web' ? 50 : 100)))
  const [source, setSource] = useState<Source>(batch.source)
  const [queries, setQueries] = useState((batch.queries ?? []).join('\n'))
  const icp = batch.icp
  const running = batch.status === 'running'
  const filters = { person_titles: split(titles), person_locations: split(locations), q_organization_keyword_tags: split(tags), q_keywords: keywords, person_seniorities: seniorities, organization_num_employees_ranges: ranges }
  const input = { batch_id: batch.id, source, queries: queries.split('\n').map((q) => q.trim()).filter(Boolean), filters, limit: Number(limit) || (source === 'web' ? 50 : 100) }
  const save = async () => {
    await runLocal('prospects.saveIcp', input)
  }
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  return (
    <Panel title={batch.name} aside={<Badge tone={batch.status === 'done' ? 'ok' : batch.status === 'failed' ? 'bad' : running ? 'warn' : 'default'}>{tr(`prospects.st_${batch.status}`)}</Badge>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-2 text-sm">
          <div className="text-xs font-semibold text-muted-foreground">{tr('prospects.icp')}</div>
          {icp.summary ? <p className="font-medium">{icp.summary}</p> : <p className="text-muted-foreground">{tr('prospects.icp_empty')}</p>}
          {(['industries', 'regions', 'roles', 'buying_signals', 'exclude'] as const).map((k) =>
            icp[k]?.length ? (
              <div key={k}>
                <span className="text-xs text-muted-foreground">{tr(`prospects.icp_${k}`)}：</span>
                <span>{icp[k]!.join('、')}</span>
              </div>
            ) : null,
          )}
          {icp.company_size && (
            <div>
              <span className="text-xs text-muted-foreground">{tr('prospects.icp_size')}：</span>
              {icp.company_size}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-muted-foreground">{tr('prospects.source')}</div>
            <Segmented value={source} onChange={(v) => !running && setSource(v)} options={(['web', 'apollo'] as const).map((k) => ({ value: k, label: tr(`prospects.src_${k}`) }))} />
          </div>
          <p className="text-xs text-muted-foreground">{tr(`prospects.src_${source}_desc`)}</p>
          {source === 'web' && status && !status.browser && <Notice tone="error">{tr('prospects.no_browser')}</Notice>}
          {source === 'apollo' && status && !status.ready && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{status.how}</div>
          )}
          {source === 'web' ? (
            <>
              <Field label={tr('prospects.f_queries')} hint={tr('prospects.f_queries_hint')}>
                <textarea value={queries} disabled={running} onChange={(e) => setQueries(e.target.value)} rows={8} placeholder={'LED panel light distributor Germany\nlighting wholesaler Poland -alibaba'} className={cx(inputCls, 'min-h-32 py-2 font-mono text-xs')} />
              </Field>
              <Field label={tr('prospects.f_limit_web')}>
                <input type="number" min={10} max={500} value={limit} disabled={running} onChange={(e) => setLimit(e.target.value)} className={cx(inputCls, 'sm:w-40')} />
              </Field>
            </>
          ) : (
            <>
              <Field label={tr('prospects.f_titles')} hint={tr('prospects.f_titles_hint')}>
                <input value={titles} disabled={running} onChange={(e) => setTitles(e.target.value)} className={inputCls} />
              </Field>
              <Field label={tr('prospects.f_seniorities')} group>
                <Chips all={status?.seniorities ?? []} on={seniorities} disabled={running} label={(v) => tr(`prospects.sen_${v}`)} onToggle={(v) => toggle(seniorities, setSeniorities, v)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr('prospects.f_locations')}>
                  <input value={locations} disabled={running} onChange={(e) => setLocations(e.target.value)} placeholder="Germany, France" className={inputCls} />
                </Field>
                <Field label={tr('prospects.f_tags')}>
                  <input value={tags} disabled={running} onChange={(e) => setTags(e.target.value)} placeholder="retail, pos" className={inputCls} />
                </Field>
              </div>
              <Field label={tr('prospects.f_ranges')} group>
                <Chips all={status?.ranges ?? []} on={ranges} disabled={running} label={(v) => v.replace(',', '–').replace(/–$/, '+')} onToggle={(v) => toggle(ranges, setRanges, v)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr('prospects.f_keywords')}>
                  <input value={keywords} disabled={running} onChange={(e) => setKeywords(e.target.value)} className={inputCls} />
                </Field>
                <Field label={tr('prospects.f_limit')}>
                  <input type="number" min={10} max={500} value={limit} disabled={running} onChange={(e) => setLimit(e.target.value)} className={inputCls} />
                </Field>
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" disabled={running} onClick={() => save().then(onSaved).catch((e) => onError(e.message))}>
              {tr('prospects.save')}
            </Button>
            <RunButton
              inline
              fn="prospects.run"
              input={input}
              icon={batch.status === 'done' ? Search : Play}
              onDone={onSaved}
              onError={() => onSaved()}
            >
              {batch.status === 'done' ? tr('prospects.run_more') : tr('prospects.run')}
            </RunButton>
            <span className="text-xs text-muted-foreground">{tr(`prospects.run_hint_${source}`)}</span>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function Chips({ all, on, disabled, label, onToggle }: { all: string[]; on: string[]; disabled?: boolean; label: (v: string) => string; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => onToggle(v)}
          aria-pressed={on.includes(v)}
          className={cx('h-7 cursor-pointer rounded-full border px-2.5 text-xs transition-colors disabled:opacity-50', on.includes(v) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
        >
          {label(v)}
        </button>
      ))}
    </div>
  )
}

function PersonRow({ person: p, picked, onPick, onConvert, onSkip, onOpenLead }: { person: Person; picked: boolean; onPick: (on: boolean) => void; onConvert: () => void; onSkip: () => void; onOpenLead: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.opener ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 复制不了就算了
    }
  }
  const web = p.source === 'web'
  return (
    <li className={cx('flex flex-col gap-3 px-2 py-3 md:flex-row md:items-start', p.status === 'skipped' && 'opacity-60')}>
      {web ? <Globe className="mt-1 hidden size-3.5 text-muted-foreground md:block" /> : <input type="checkbox" checked={picked} disabled={!!p.email} onChange={(e) => onPick(e.target.checked)} className="mt-1 hidden md:block" title={tr('prospects.pick')} />}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={scoreTone(p.score)}>{p.score == null ? tr('prospects.unscored') : p.score}</Badge>
          <span className="font-semibold">{p.name}</span>
          <span className="text-muted-foreground">{web ? p.industry : [p.title, p.company].filter(Boolean).join(' @ ')}</span>
          {p.country && <Badge>{p.country}</Badge>}
          {p.status === 'converted' && <Badge tone="ok">{tr('prospects.f_converted')}</Badge>}
        </div>
        {p.score_reason && <p className="text-xs text-muted-foreground">{p.score_reason}</p>}
        {p.opener && (
          <div className="flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
            <p className="flex-1 leading-relaxed">{p.opener}</p>
            <button type="button" onClick={copy} className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground" title={tr('prospects.copy')}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {p.company_domain && <a href={'https://' + p.company_domain} target="_blank" rel="noreferrer" className="hover:underline">{p.company_domain}</a>}
          {p.company_size && <span>{tr('prospects.size', { n: p.company_size })}</span>}
          {!web && p.industry && <span>{p.industry}</span>}
          {p.email ? (
            <a href={'mailto:' + p.email} className="inline-flex items-center gap-1 hover:underline"><Mail className="size-3" />{p.email}</a>
          ) : (
            p.email_status === 'unavailable' && <span>{tr('prospects.no_email')}</span>
          )}
          {web && p.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" />{p.phone}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {p.linkedin_url && (
          <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            LinkedIn <ExternalLink className="size-3.5" />
          </a>
        )}
        {p.status === 'converted' ? (
          <Button variant="ghost" size="sm" onClick={onOpenLead}>
            {tr('prospects.open_lead')}
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onConvert}>
              <UserPlus /> {tr('prospects.convert')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onSkip} title={p.status === 'skipped' ? tr('prospects.unskip') : tr('prospects.skip')}>
              <X />
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
