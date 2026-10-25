import { useEffect, useState, type ComponentType } from 'react'
import { Notice, Skeleton } from './ui'
import { tr } from '../lib/i18n'

/**
 * placeholder：空的时候段落里的提示，不给用「输入正文……」。
 * markdown：改的是 .md 文件（自媒体的内容文件夹）：value、onChange 都是 md（不是 HTML），一到六级标题都能用，斜杠菜单多一个「表格」。
 *   要在 extensions 里传官方的 Markdown（@tiptap/markdown）和表格扩展；建好时先 onChange 一次规范化后的 md，页面拿它当没改过的样子。
 * extensions：模板自己加的 Tiptap 扩展，模板在 importMap 里给包、自己动态加载好了再传进来。
 * resolveSrc：图片、视频显示用的地址（存的还是原地址），比如 md 里的相对路径换成预览地址；不传按资料库的规则（本机文件 local:）
 * folderMedia：手边现成的图片、视频（自媒体内容文件夹里的）：工具栏多一个「从文件夹选」，选了插在光标处。
 *   src 是存进正文的地址（比如相对 md 的路径），preview 是显示用的地址；不传或为空就没有这个按钮
 */
export type FolderMedia = { src: string; preview: string; name: string; video?: boolean }
export type RichEditorProps = { value: string; onChange: (value: string) => void; placeholder?: string; markdown?: boolean; extensions?: unknown[]; resolveSrc?: (src: string) => string; folderMedia?: FolderMedia[] }

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
