import { useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { dbList, openChat, type Article } from '../lib/shuttle'
import { originsOf, type Origin } from '../lib/origins'
import { tr } from '../lib/i18n'
import type { Ctx } from './views/types'

// 选题和文章的「来源」一行（设计见仓库根目录 docs/content-origins.md）：选题从哪些记录来的，点了回到那一页；助手出的能打开出它的对话。

/** 点出处去哪一页；这个模板没有那一页的，ctx.go 会落到总览 */
function target(o: Origin): [string, Record<string, string>] | null {
  if (o.type === 'geo_question') return ['geo', { ...(o.channel_id ? { channel: o.channel_id } : {}), q: o.id }]
  if (o.type === 'keyword') return ['search', { tab: 'keywords' }]
  if (o.type === 'search_query') return ['search', {}]
  if (o.type === 'competitor_page' || o.type === 'competitor') return ['competitors', {}]
  if (o.type === 'inspiration_source') return ['content', { tab: 'inspiration', source: o.id }]
  if (o.type === 'opportunity') return ['opportunities', {}]
  if (o.type === 'campaign') return ['campaigns', {}]
  return null
}

/** 几个模板的 Topic 类型不完全一样，这里只要用到的字段 */
type TopicLike = { id: string; title: string; source?: string; origins?: string; chat_id?: string; workspace?: string }

const chip = 'inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-px text-[11px]'

export function TopicOrigins({ ctx, topic, prefix }: { ctx: Ctx; topic: TopicLike; prefix?: string }) {
  const list = originsOf(topic)
  if (!list.length && !topic.chat_id && topic.source !== 'manual') return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>{prefix ?? tr('origin.title')}</span>
      {list.map((o) => {
        const to = target(o)
        const text = `${tr('origin.t_' + o.type)}：${o.label || o.id}`
        return to ? (
          <button key={`${o.type}:${o.id}`} type="button" title={text} onClick={() => (ctx.go as (v: string, p?: Record<string, string>) => void)(to[0], to[1])} className={`${chip} cursor-pointer hover:border-primary/40 hover:text-primary-text`}>
            <span className="truncate">{text}</span>
          </button>
        ) : (
          <span key={`${o.type}:${o.id}`} title={text} className={chip}><span className="truncate">{text}</span></span>
        )
      })}
      {!list.length && topic.source === 'manual' && <span>{tr('origin.manual')}</span>}
      {topic.chat_id && (
        <button type="button" onClick={() => openChat(topic.chat_id!)} className="inline-flex cursor-pointer items-center gap-1 hover:text-primary-text">
          <MessageCircle className="size-3" />{tr('origin.by_chat')}
        </button>
      )}
    </div>
  )
}

/** 文章是从哪个选题写的（改写的顺着原文往上找），和那个选题的来源 */
export function ArticleOrigins({ ctx, a, all }: { ctx: Ctx; a: Article; all: Article[] }) {
  let root: Article | undefined = a
  for (let i = 0; root && !root.topic_id && root.source_id && i < 10; i++) root = all.find((x) => x.id === root!.source_id)
  const topicId = root?.topic_id
  const [topic, setTopic] = useState<TopicLike | null>(null)
  useEffect(() => {
    if (!topicId) return setTopic(null)
    dbList('topics').then((l) => setTopic((l as TopicLike[]).find((t) => t.id === topicId) ?? null)).catch(() => setTopic(null))
  }, [topicId])
  if (!topic) return null
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">
        {tr('origin.topic')}：
        <button type="button" onClick={() => (ctx.go as (v: string, p?: Record<string, string>) => void)('content', { topic: topic.id, ...(topic.workspace ? { workspace: topic.workspace } : {}) })} className="cursor-pointer text-primary-text hover:underline">{topic.title}</button>
      </p>
      <TopicOrigins ctx={ctx} topic={topic} />
    </div>
  )
}
