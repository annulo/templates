import { useEffect, useState, type ReactNode } from 'react'
import { Check, Loader2, Play, type LucideIcon } from 'lucide-react'
import { openShuttleSettings, runLocal, type LocalProgress } from '../lib/shuttle'
import { Button, ErrorDetails } from './ui'
import { tr } from '../lib/i18n'
import { useCanRun } from '../lib/useShuttle'

/**
 * 执行一个本机函数（local/*.ts）的按钮：按钮上显示进度，跑完调 onDone，出错把原因写在按钮下面。
 * 函数报「到 设置 → 密钥 添加 XXX」时附一个「去设置」，直接打开 Shuttle 的密钥设置。
 * 确定的操作（检测、体检、发布）和短的一次性生成（起标题、翻译，函数里 ctx.llm 调一次）用它。
 * 写文章、周报这类流程长的生成和开放的、要改代码的活交给助手（看得见过程）。跑完会通知页面静默重拉数据（shuttle:refresh）。
 *
 * 调试：按住 Alt（Mac 上是 Option）点，参数里带上 _show_browser: true，这次要打开的浏览器都在前台，看得见它在点什么
 * （社媒插件 social/social.* 的发布、删除、采集、自检认它；不用浏览器的函数忽略它）。
 *
 * 默认把进度和报错写在按钮下面（适合单独放的按钮）。和别的按钮排在一行时用 inline：
 * 进度直接写在按钮上、按钮始终一行高，报错交给 onError 由这一行自己显示（不传就显示可点开的错误摘要），不会把旁边的按钮顶歪。
 */
export default function RunButton({
  fn,
  input,
  onDone,
  children,
  variant = 'default',
  size = 'sm',
  icon: Icon = Play,
  className,
  inline = false,
  onError,
  errorActions,
}: {
  fn: string
  input: unknown
  onDone?: (result: unknown) => void
  children: ReactNode
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm'
  icon?: LucideIcon
  className?: string
  inline?: boolean
  /** 出错时的报错（开始跑时会先调一次 onError('') 清掉上一次的） */
  onError?: (message: string) => void
  /** 报错旁边放的处理入口（比如报错说要去某个设置，就给一个打开它的按钮）；返回空就不放 */
  errorActions?: (message: string) => ReactNode
}) {
  const [prog, setProg] = useState<LocalProgress | null>(null)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), 2000)
    return () => clearTimeout(timer)
  }, [done])
  // 在 Shuttle 里都能点；不在的话按函数清单：云端版本随时能点，转给电脑的电脑在线才能点（lib/useShuttle.ts useCanRun）
  const ok = useCanRun(fn)
  const start = async (e?: { altKey?: boolean }) => {
    // Alt 点：参数是对象时加上 _show_browser，本机函数就在前台打开浏览器
    const params = e?.altKey && input && typeof input === 'object' && !Array.isArray(input) ? { ...(input as object), _show_browser: true } : input
    setDone(false)
    setErr('')
    onError?.('')
    setProg({ message: tr('ui.preparing') })
    let result: unknown
    try {
      result = await runLocal(fn, params, (ev) => ev.type === 'progress' && setProg(ev.data))
      setDone(true)
    } catch (e) {
      setErr((e as Error).message)
      onError?.((e as Error).message)
    } finally {
      setProg(null)
      onDone?.(result)
      // 函数多半改了数据：让页面各处静默重拉（pages/Index.tsx 监听）
      window.postMessage({ type: 'shuttle:refresh' }, window.location.origin)
    }
  }
  // 「到 设置 → 密钥 添加 XXX」「到 设置 → 连接 里连接 Google」（英文是 Settings → Keys / Connections）：附一个直达的「去设置」
  const needKey = /设置\s*→\s*(密钥|连接)|Settings\s*→\s*(Keys|Connections)/i.test(err)
  const section = /设置\s*→\s*连接|Settings\s*→\s*Connections/i.test(err) ? 'connections' : 'secrets'
  const settingsLink = errorActions?.(err) || (needKey && (
    <button type="button" className="ml-1 font-semibold underline underline-offset-2" onClick={() => openShuttleSettings(section)}>
      {tr('ui.go_settings')}
    </button>
  ))
  if (inline) {
    const label = prog ? (prog.total ? `${prog.done ?? 0}/${prog.total} ${prog.message ?? ''}` : (prog.message ?? tr('ui.running'))) : null
    return (
      <span className="inline-flex max-w-full min-w-0 w-fit flex-col items-start gap-1.5">
        <Button feedback={false} variant={variant} size={size} className={className} disabled={!ok || !!prog} title={ok ? (prog?.message ?? undefined) : tr('ui.run_offline')} onClick={start}>
          {prog ? <Loader2 className="animate-spin" /> : done ? <Check /> : <Icon />}
          {label ? <span className="max-w-48 truncate">{label}</span> : done ? tr('ui.done') : children}
        </Button>
        {err && !onError && (
          <span className="w-64 min-w-0 max-w-full"><ErrorDetails message={err} actions={settingsLink} /></span>
        )}
      </span>
    )
  }
  return (
    <span className="inline-flex max-w-full min-w-0 flex-col items-center gap-1.5">
      <Button feedback={false} variant={variant} size={size} className={className} disabled={!ok || !!prog} title={ok ? (prog?.message ?? undefined) : tr('ui.run_offline')} onClick={start}>
        {prog ? <Loader2 className="animate-spin" /> : done ? <Check /> : <Icon />}
        {prog ? (prog.total ? `${prog.done ?? 0}/${prog.total}` : tr('ui.running')) : done ? tr('ui.done') : children}
      </Button>
      {prog?.message && <span className="max-w-sm text-center text-xs text-balance text-muted-foreground">{prog.message}</span>}
      {err && (
        <span className="w-64 min-w-0 max-w-full"><ErrorDetails message={err} actions={settingsLink} /></span>
      )}
    </span>
  )
}
