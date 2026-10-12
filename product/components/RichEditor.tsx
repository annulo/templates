import { useEffect, useState, type ComponentType } from 'react'
import { Notice, Skeleton } from './ui'
import { tr } from '../lib/i18n'

export type RichEditorProps = { value: string; onChange: (html: string) => void }

/**
 * 文章正文的编辑器（飞书 / Notion 式：输入 / 插入块，选中文字浮出格式工具栏，粘贴、拖进图片直接上传）。存的是 HTML。
 * 编辑器用的 Tiptap 是第三方包，只能在浏览器里加载：这里在 useEffect 里 await import，页面其余部分照常服务端渲染。
 */
export default function RichEditor(props: RichEditorProps) {
  const [Editor, setEditor] = useState<ComponentType<RichEditorProps> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    import('./rich/TiptapEditor')
      .then((m) => setEditor(() => m.default))
      .catch((e: Error) => setError(e.message))
  }, [])
  if (error) return <Notice tone="error">{tr('editor.load_failed', { error })}</Notice>
  if (!Editor) return <Skeleton className="h-80 rounded-lg" />
  return <Editor {...props} />
}
