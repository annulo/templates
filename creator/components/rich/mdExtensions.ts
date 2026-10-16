// 内容文件夹改 .md 时给 RichEditor 多加的扩展（extensions 参数）：表格、任务列表。只在浏览器里动态加载（Folder.tsx），
// 包在 talizen.config.ts 的 importMap 里（@tiptap/extension-table、@tiptap/extension-list，版本和别的 @tiptap 包一样）
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'

// 表格列宽不让拖：md 的表格没有列宽，拖了也存不下来
export default [Table.configure({ resizable: false }), TableRow, TableHeader, TableCell, TaskList, TaskItem.configure({ nested: true })]
