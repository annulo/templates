import { useEffect, useRef } from 'react'

/**
 * 粘贴上传：enabled 时监听整页的粘贴，剪贴板里有符合 accept 的文件（截图、复制的图片）就交给 onFiles，不再当文字粘贴。
 * 光标在富文本编辑器（contenteditable）里时不管：编辑器自己处理粘贴进正文的图片。
 * 截图粘贴出来的文件名都是 image.png，按时间改个名，资料库里好认。
 * 同一时间只让一处开着（比如配图框在「从资料库选」弹窗打开时关掉自己的），不然一次粘贴会传两遍。
 */
export function usePasteFiles(enabled: boolean, onFiles: (files: File[]) => void, accept: RegExp = /^image\//) {
  const cb = useRef(onFiles)
  cb.current = onFiles
  useEffect(() => {
    if (!enabled) return
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[contenteditable="true"], [contenteditable=""]')) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => accept.test(f.type))
      if (!files.length) return
      e.preventDefault()
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
      cb.current(files.map((f, i) => (/^image\.\w+$/i.test(f.name) || !f.name ? new File([f], `paste-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }) : f)))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [enabled, accept])
}
