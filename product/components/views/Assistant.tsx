import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, Loader2, MessageSquarePlus, MessageSquareText, Square, Wrench } from 'lucide-react'
import Markdown from '../Markdown'
import { Button, ErrorDetails, Notice, Skeleton, cx } from '../ui'
import { remoteAbort, remoteChat, remoteChats, remoteSend, watchComputer, assistantOnline, type ChatSummary, type ComputerStatus, type RemoteChat } from '../../lib/shuttle'
import { useT } from '../../lib/i18n'
import { useInShuttle } from '../../lib/useShuttle'
import type { Ctx } from './types'

/**
 * 手机上的助手：电脑上的 Shuttle 开着远程访问时，经它跑电脑上的助手（lib/remote.ts remoteAI）。
 * 列出对话、看一段对话、发消息、停止。不推流：跑着的时候每 3 秒拉一次（已存的消息 + 这一轮此刻的快照）。
 * 在 Shuttle 里不用这页：助手在右侧。
 */
export default function Assistant({ params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const { t } = useT('assistant')
  const shuttle = useInShuttle()
  const [computer, setComputer] = useState<ComputerStatus | null>(null)
  useEffect(() => (shuttle ? undefined : watchComputer(setComputer)), [shuttle])

  if (shuttle) return <Notice>{t('in_shuttle')}</Notice>
  if (!computer) return <Skeleton className="h-40 rounded-xl" />
  if (!assistantOnline(computer)) return <Notice>{computer.online ? t('need_update') : t('offline')}</Notice>
  return params.chat ? <ChatView id={params.chat} onBack={() => setParam('chat', '')} /> : <ChatList onOpen={(id) => setParam('chat', id)} />
}

function Composer({ onSend, running, onStop, placeholder }: { onSend: (text: string) => Promise<void>; running?: boolean; onStop?: () => void; placeholder: string }) {
  const { t } = useT('assistant')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async () => {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true)
    setError('')
    try {
      await onSend(v)
      setText('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-h-10 flex-1 resize-none bg-transparent px-1.5 py-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        {running && onStop ? (
          <Button size="sm" variant="outline" onClick={onStop} aria-label={t('stop')}>
            <Square /> {t('stop')}
          </Button>
        ) : (
          <Button size="sm" onClick={send} disabled={!text.trim() || busy} aria-label={t('send')}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        )}
      </div>
      {running && <p className="text-xs text-muted-foreground">{t('running_hint')}</p>}
      {error && <ErrorDetails message={error} />}
    </div>
  )
}

function ChatList({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useT('assistant')
  const [list, setList] = useState<ChatSummary[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    remoteChats()
      .then((l) => {
        setList(l)
        setError('')
      })
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 10000)
    return () => clearInterval(timer)
  }, [load])
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('desc')}</p>
      </div>
      <Composer placeholder={t('new_placeholder')} onSend={async (text) => onOpen((await remoteSend(text)).chat_id)} />
      {error && <ErrorDetails message={error} />}
      {!list ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !list.length ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="flex w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-accent">
              {c.status === 'running' ? <Loader2 className="size-4 shrink-0 animate-spin text-primary-text" /> : <MessageSquareText className="size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.title || t('untitled')}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.status === 'running' ? t('status_running') : c.status === 'asking' ? t('status_asking') : new Date(c.updated_at).toLocaleString()}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChatView({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useT('assistant')
  const [chat, setChat] = useState<RemoteChat | null>(null)
  const [error, setError] = useState('')
  const [poke, setPoke] = useState(0) // 发完消息马上拉一次
  const bottom = useRef<HTMLDivElement>(null)
  const running = chat?.status === 'running'

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const c = await remoteChat(id)
        if (!alive) return
        setChat(c)
        setError('')
        timer = setTimeout(tick, c.status === 'running' ? 3000 : 15000)
      } catch (e) {
        if (!alive) return
        setError((e as Error).message)
        timer = setTimeout(tick, 10000)
      }
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id, poke])

  const count = (chat?.messages.length ?? 0) + (chat?.live ? 1 : 0)
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [count])

  const messages = [...(chat?.messages ?? []), ...(chat?.live ? [{ ...chat.live, live: true }] : [])]
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack} aria-label={t('back')}>
          <ArrowLeft /> {t('back')}
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{chat?.title || t('untitled')}</h1>
        <Button size="sm" variant="outline" onClick={onBack} aria-label={t('new')}>
          <MessageSquarePlus /> {t('new')}
        </Button>
      </div>
      {error && <ErrorDetails message={error} />}
      {!chat ? (
        <Skeleton className="h-60 rounded-xl" />
      ) : (
        <div className="space-y-4">
          {messages.map((m, i) => (
            <Message key={m.id ?? i} m={m} />
          ))}
          {running && !chat.live && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t('thinking')}
            </p>
          )}
        </div>
      )}
      <div ref={bottom} />
      <div className="sticky bottom-0 bg-background pb-2">
        <Composer
          placeholder={chat?.status === 'asking' ? t('answer_placeholder') : t('reply_placeholder')}
          running={running}
          onStop={() => remoteAbort(id).then(() => setPoke((n) => n + 1))}
          onSend={async (text) => {
            await remoteSend(text, id)
            setPoke((n) => n + 1)
          }}
        />
      </div>
    </div>
  )
}

type Part = { type: string; text?: string; toolName?: string; input?: any; state?: string; errorText?: string; data?: { text?: string } }

function toolArg(input: any) {
  const v = input?.command ?? input?.path ?? input?.file_path ?? input?.query ?? input?.table ?? input?.summary
  return typeof v === 'string' ? v : ''
}

function Message({ m }: { m: { role: string; parts?: Part[]; live?: boolean; metadata?: { error?: string; aborted?: boolean } } }) {
  const { t } = useT('assistant')
  const parts = m.parts ?? []
  if (m.role === 'user') {
    const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2 text-sm whitespace-pre-wrap">{text}</div>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {parts.map((p, i) => {
        if (p.type === 'text' && p.text?.trim()) return <Markdown key={i} text={p.text} />
        if (p.type === 'data-steer' && p.data?.text)
          return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2 text-sm whitespace-pre-wrap">{p.data.text}</div>
            </div>
          )
        if (p.type === 'dynamic-tool') {
          if (p.toolName === 'request_user_input') {
            const qs: { label: string; options?: { label: string }[] }[] = p.input?.questions ?? []
            return (
              <div key={i} className="space-y-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-3 text-sm">
                <div className="font-semibold">{p.input?.title || t('questions')}</div>
                <ol className="list-decimal space-y-1 pl-5">
                  {qs.map((q, j) => (
                    <li key={j}>
                      {q.label}
                      {q.options?.length ? <span className="text-muted-foreground">（{q.options.map((o) => o.label).join(' / ')}）</span> : null}
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted-foreground">{t('questions_hint')}</p>
              </div>
            )
          }
          return (
            <div key={i} className={cx('flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', p.state === 'output-error' && 'text-destructive')}>
              {p.state === 'input-available' ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Wrench className="size-3.5 shrink-0" />}
              <span className="shrink-0 font-medium">{p.toolName}</span>
              <span className="min-w-0 truncate font-mono">{toolArg(p.input)}</span>
            </div>
          )
        }
        return null
      })}
      {m.metadata?.error && <ErrorDetails message={m.metadata.error} />}
      {m.metadata?.aborted && <p className="text-xs text-muted-foreground">{t('aborted')}</p>}
    </div>
  )
}
