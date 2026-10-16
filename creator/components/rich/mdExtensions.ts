// 内容文件夹改 .md 时给 RichEditor 加的扩展（extensions 参数）：官方的 Markdown（直接读写 md，不经过 HTML）、表格、任务列表，
// 再加上几处让「读进来再存回去」尽量不改原文的调整（mdTweaks、紧凑表格）。只在浏览器里动态加载（Folder.tsx），
// 包在 talizen.config.ts 的 importMap 里（@tiptap/markdown、@tiptap/extension-table、@tiptap/extension-list，版本和别的 @tiptap 包一样）
import { Extension } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'

type Json = { type?: string; attrs?: Record<string, unknown>; content?: Json[] }
type Helpers = { renderChildren: (nodes: Json | Json[], separator?: string) => string }

/**
 * 表格写成紧凑的样子（`| a | b |`、`|---|---|`），和人、AI 平常写的一样。
 * 官方的会按最宽的格子补空格对齐、前面多一个空行，存一次整张表的每一行都变
 */
function compactTable(node: Json, h: Helpers) {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => ({
    text: (cell.content ?? []).map((c) => h.renderChildren(c)).join('\n').replace(/[ \t]*\r?\n[ \t]*/g, '<br>').replace(/\s+/g, ' ').trim(),
    header: cell.type === 'tableHeader',
    align: cell.attrs?.align as string | undefined,
  })))
  const cols = Math.max(0, ...rows.map((r) => r.length))
  if (!cols) return ''
  const line = (cells: string[]) => `| ${Array.from({ length: cols }, (_, i) => cells[i] ?? '').join(' | ')} |`
  const head = rows[0].some((c) => c.header) ? rows[0] : []
  const body = head.length ? rows.slice(1) : rows
  const align = Array.from({ length: cols }, (_, i) => rows.find((r) => r[i]?.align)?.[i]?.align)
  const sep = `|${align.map((a) => (a === 'left' ? ':---' : a === 'right' ? '---:' : a === 'center' ? ':---:' : '---')).join('|')}|`
  return [line(head.map((c) => c.text)), sep, ...body.map((r) => line(r.map((c) => c.text)))].join('\n')
}

/**
 * 官方把文字里的 \ ` * _ [ ] ~ 全加反斜杠、< & 换成实体，存一次源码里多出一堆 \~、\[、&lt;。
 * 这里只转义真会被读成格式的：* `、词边上的 _、~~、像链接的 [..](、像标签的 <x、像实体的 &x;
 */
function escapeText(text: string) {
  return text
    .replace(/\\(?=[\\`*_[\]~<&])/g, '\\\\')
    .replace(/[`*]/g, '\\$&')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (m) => m.replace('_', '\\_'))
    .replace(/~~/g, '\\~\\~')
    .replace(/\[([^\]]*)\]\(/g, '\\[$1\\](')
    .replace(/<(?=[A-Za-z/!?])/g, '&lt;')
    .replace(/&(?=#?\w+;)/g, '&amp;')
}

const mdTweaks = Extension.create({
  name: 'mdTweaks',
  // 在 Markdown 扩展建好 editor.markdown 之后再改它
  priority: 1,
  onBeforeCreate() {
    const m = (this.editor as unknown as { markdown?: { codeTypes: Set<string>; encodeTextForMarkdown: (text: string, node: { marks?: (string | { type: string })[] }, parent?: { type?: string }) => string } }).markdown
    if (!m) return
    m.encodeTextForMarkdown = (text, node, parent) => {
      const inCode = (parent?.type && m.codeTypes.has(parent.type)) || (node.marks ?? []).some((x) => m.codeTypes.has(typeof x === 'string' ? x : x.type))
      return inCode ? text : escapeText(text)
    }
  },
})

export default [
  Markdown.configure({ markedOptions: { gfm: true } }),
  mdTweaks,
  Table.extend({ renderMarkdown: (node: Json, h: Helpers) => compactTable(node, h) }).configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
]
