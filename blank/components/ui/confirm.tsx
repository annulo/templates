import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog'
import { buttonVariants } from './button'

// 代替 window.confirm：系统的确认框是英文的 Cancel / OK，样子也和页面不搭。
//   if (!(await confirm({ title: `删除「${name}」？`, description: '删了不能恢复', danger: true }))) return

type Options = {
  title: ReactNode
  description?: ReactNode
  /** 确定按钮的字，默认「确定」/ OK */
  okText?: string
  /** 取消按钮的字，默认「取消」/ Cancel */
  cancelText?: string
  /** 删除这类不能撤回的操作：确定按钮变红 */
  danger?: boolean
}

const isEn = () => {
  const l = ((window as any).TalizenConfig?.locale || document.documentElement.lang || 'zh') as string
  return l.toLowerCase().startsWith('en')
}

export function confirm(opts: Options): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const finish = (ok: boolean) => {
      resolve(ok)
      // 等关闭动画和焦点归还做完再卸载
      setTimeout(() => {
        root.unmount()
        host.remove()
      }, 200)
    }
    root.render(<ConfirmDialog {...opts} onDone={finish} />)
  })
}

function ConfirmDialog({ title, description, okText, cancelText, danger, onDone }: Options & { onDone: (ok: boolean) => void }) {
  const [open, setOpen] = useState(true)
  const en = isEn()
  const close = (ok: boolean) => {
    setOpen(false)
    onDone(ok)
  }
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {/* 没有说明时也给一个空的，免得 Radix 在控制台报缺少 Description */}
          <AlertDialogDescription className={description ? undefined : 'sr-only'}>{description ?? title}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>{cancelText ?? (en ? 'Cancel' : '取消')}</AlertDialogCancel>
          <AlertDialogAction className={danger ? buttonVariants({ variant: 'destructive' }) : undefined} onClick={() => close(true)}>
            {okText ?? (en ? 'OK' : '确定')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
