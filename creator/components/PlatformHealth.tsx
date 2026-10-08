import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Send, Stethoscope, Wrench, X } from 'lucide-react'
import RunButton from './RunButton'
import { TaskButton } from './Task'
import { Button, cx, fmtTime } from './ui'
import { dbList, dbPatch, type Channel, type PlatformHealth, type SocialPost } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import { CHANNEL_TYPES } from '../lib/channels'
import { postTitle } from '../lib/social'

/** 任务 id（社媒插件的 plugins/social/tasks/fix-platform.md）：照着现场改平台文件 */
export const FIX_TASK = 'social/fix-platform'

/** 各账号的健康记录（社媒插件的 social_health）；还没有这张表时是空的 */
export function usePlatformHealth(rev?: number) {
  const [rows, setRows] = useState<PlatformHealth[]>([])
  const load = useCallback(() => {
    dbList('social_health')
      .then(setRows)
      .catch(() => setRows([]))
  }, [])
  useEffect(load, [load, rev])
  return { rows, reload: load }
}

/** 这个账号流程失效的记录（页面 / 接口对不上了，不算登录过期；用户关掉了、之后没再失败的不算），新的在前 */
export function brokenOf(rows: PlatformHealth[], channelId: string) {
  return rows.filter((r) => r.channel_id === channelId && !r.ok && r.kind !== 'expired' && !(r.dismissed_at && String(r.dismissed_at) >= String(r.checked_at ?? ''))).sort((a, b) => String(b.checked_at ?? '').localeCompare(String(a.checked_at ?? '')))
}

/**
 * 流程失效的提示：哪个账号哪一步走不通了，旁边「重新自检」和「交给助手修」（社媒插件的任务 social/fix-platform）。
 * 平台改页面时发布、采集会悄悄坏掉，每天的自检（social.probeAll）和真实操作的失败都会记进来。
 * 发布、删除失败的能点到那条内容（post_id；旧记录没有，按同账号、同报错的失败内容找）；能关掉，之后再失败会重新出来。
 */
export function HealthAlerts({ accounts, rows, posts, onOpenPost, onChanged }: { accounts: Channel[]; rows: PlatformHealth[]; posts?: SocialPost[]; onOpenPost?: (id: string) => void; onChanged: () => void }) {
  const broken = accounts.map((a) => ({ a, r: brokenOf(rows, a.id)[0] })).filter((x) => !!x.r)
  if (!broken.length) return null
  return (
    <div className="space-y-2">
      {broken.map(({ a, r }) => {
        const post = r.op === 'publish' || r.op === 'remove' ? r.post_id || posts?.find((p) => p.channel_id === a.id && p.status === 'failed' && p.error === r.error)?.id : ''
        return (
        <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 font-medium text-destructive">
              {(() => {
                // 带上平台：同名账号可能在好几个平台都有
                const Icon = CHANNEL_TYPES[a.type]?.icon
                return Icon ? <Icon size={14} className="shrink-0" /> : null
              })()}
              <span>{tr('health.broken', { platform: CHANNEL_TYPES[a.type]?.label ?? a.type, name: a.name, op: tr(`health.op_${r.op}`) })}</span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {r.step && r.step !== r.op ? `${r.step}：` : ''}
              {r.error}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {tr('health.when', { when: fmtTime(r.checked_at ?? ''), n: r.fails ?? 1 })}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1">
            <RunButton inline watch fn="social/social.probe" input={{ channel_id: a.id }} icon={Stethoscope} variant="outline" onDone={onChanged}>
              {tr('health.probe_again')}
            </RunButton>
            {post && onOpenPost && (
              <Button size="sm" variant="ghost" onClick={() => onOpenPost(post)}>
                <ArrowUpRight />
                {tr('health.view_post')}
              </Button>
            )}
            <TaskButton task={FIX_TASK} input={{ channel_id: a.id }} match={(run) => run.input?.channel_id === a.id} icon={Wrench} onFinished={onChanged}>
              {tr('health.fix')}
            </TaskButton>
            <Button size="sm" variant="ghost" title={tr('common.close')} aria-label={tr('common.close')} onClick={() => dbPatch('social_health', r.id, { dismissed_at: new Date().toISOString() }).then(onChanged)}>
              <X />
            </Button>
          </div>
        </div>
        )
      })}
    </div>
  )
}

/**
 * 一个账号发布出的问题，每条都带处理入口：流程失效（HealthAlerts：重新自检、交给助手修）+ 发布失败的内容（看原因、重新发布）。
 * 页面上显示了「发布失败」「发布异常」的地方都放它，不让状态只看得到、处理不了。
 */
export function PublishProblems({ account, rows, posts, onOpenPost, onChanged }: { account: Channel; rows: PlatformHealth[]; posts: SocialPost[]; onOpenPost: (p: SocialPost) => void; onChanged: () => void }) {
  const failed = posts.filter((p) => p.channel_id === account.id && p.status === 'failed')
  const open = (id: string) => { const p = posts.find((x) => x.id === id); if (p) onOpenPost(p) }
  return (
    <>
      <HealthAlerts accounts={[account]} rows={rows} posts={posts} onOpenPost={open} onChanged={onChanged} />
      {failed.length > 0 && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <div className="font-medium text-destructive">{tr('health.failed_posts', { n: failed.length })}</div>
          <ul className="divide-y divide-destructive/15">
            {failed.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{postTitle(p)}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.error || tr('health.no_reason')}</div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <RunButton inline fn="social/social.publish" input={{ post_id: p.id }} icon={Send} variant="outline" onDone={onChanged}>
                    {tr('health.republish')}
                  </RunButton>
                  <Button size="sm" variant="ghost" onClick={() => onOpenPost(p)}>
                    <ArrowUpRight />
                    {tr('health.edit_post')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

/** 账号卡片上的一行：上次自检的结果 + 「自检」按钮；没走通的步骤（包括次要的）在下面逐条写出哪一步、为什么 */
export function ProbeLine({ ch, rows, onChanged }: { ch: Channel; rows: PlatformHealth[]; onChanged: () => void }) {
  const p = rows.find((r) => r.channel_id === ch.id && r.op === 'probe')
  const steps: { name: string; ok: boolean; soft?: boolean; error?: string }[] = (() => {
    try {
      return p?.steps ? JSON.parse(p.steps) : []
    } catch {
      return []
    }
  })()
  const warn = p?.ok ? steps.filter((s) => !s.ok && s.soft) : []
  // 没通过时列出失败的那一步；旧记录没有 steps 时退回 step + error
  const bad = !p || p.ok || p.kind === 'expired' ? warn : steps.filter((s) => !s.ok).length ? steps.filter((s) => !s.ok) : [{ name: p.step ?? '', ok: false, error: p.error }]
  return (
    <div className="space-y-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">
          {!p ? tr('health.never') : p.ok ? (
            <span className={cx(warn.length ? 'text-amber-600' : 'text-emerald-600')}>{warn.length ? tr('health.ok_warn', { when: fmtTime(p.checked_at ?? ''), n: warn.length }) : tr('health.ok', { when: fmtTime(p.checked_at ?? '') })}</span>
          ) : p.kind === 'expired' ? (
            tr('health.expired', { when: fmtTime(p.checked_at ?? '') })
          ) : (
            <span className="text-destructive">{tr('health.failed', { when: fmtTime(p.checked_at ?? ''), step: p.step ?? '' })}</span>
          )}
        </span>
        <RunButton inline watch fn="social/social.probe" input={{ channel_id: ch.id }} icon={Stethoscope} variant="ghost" onDone={onChanged}>
          {tr('health.probe')}
        </RunButton>
      </div>
      {bad.length > 0 && (
        <ul className="space-y-1">
          {bad.map((s, i) => (
            <li key={i} className={cx('break-words leading-relaxed', p?.ok ? 'text-amber-600' : 'text-destructive')}>
              {s.name}
              {s.error ? `：${s.error}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
