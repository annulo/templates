import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { askInNewChat, openChat, runningChats } from '../lib/shuttle'
import { Button, ErrorDetails } from './ui'
import { tr } from '../lib/i18n'
import { useAssistant } from '../lib/useShuttle'

/**
 * 「交给助手」：新开一段对话把 prompt 交给右侧的运营助手（不塞进用户当前的对话），在右侧打开它。
 * 跑的时候按钮变成「进行中 · 看过程」，点了回到那段对话；跑完（或者停下来等用户回答）恢复，调 onFinished 让页面重拉数据。
 * 和 TaskButton 一个样子。不在 Shuttle 里时禁用并说明原因。
 */
export default function AskButton({
  prompt,
  title,
  children,
  onFinished,
  variant = 'outline',
  size = 'sm',
  className,
}: {
  prompt: string
  /** 对话标题，不给就用 prompt 的第一行 */
  title?: string
  children: ReactNode
  onFinished?: () => void
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm'
  className?: string
}) {
  const ok = useAssistant()
  const [chatId, setChatId] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  // 跑着的时候轮询：对话不在 running 里了（或者在等用户回答）就算这一轮做完了
  useEffect(() => {
    if (!chatId) return
    const t = window.setInterval(() => {
      runningChats()
        .then((chats) => {
          if (chats[chatId] !== 'running') {
            setChatId('')
            onFinished?.()
          }
        })
        .catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [chatId])

  if (chatId)
    return (
      <Button feedback={false} variant="outline" size={size} className={className} onClick={() => openChat(chatId)}>
        <Loader2 className="animate-spin" /> {tr('task.running')} · {tr('task.view')}
      </Button>
    )
  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const r = await askInNewChat(prompt, title)
      openChat(r.chat_id)
      setChatId(r.chat_id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }
  return (
    <span className="inline-flex max-w-full min-w-0 w-fit flex-col items-start gap-1.5">
      <Button feedback={false} variant={variant} size={size} className={className} disabled={!ok || starting} title={ok ? tr('ui.ask_title') : tr('ui.ask_offline')} onClick={start}>
        {starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {children}
      </Button>
      {error && <span className="w-64 min-w-0 max-w-full"><ErrorDetails message={error} /></span>}
    </span>
  )
}
