// Markdown ↔ HTML：发布长文时 md → HTML（FolderPublish.tsx），老文章搬进文件夹时 HTML → md（Folder.tsx 的 moveOld）。
// 页面上改 .md 不经过这里：编辑器直接读写 md（官方的 @tiptap/markdown，components/rich/mdExtensions.ts）。
// md → HTML 用 marked，HTML → md 用 turndown（加 GFM：删除线、表格、任务列表）；视频没有 md 写法，原样留 <video src width height> 标签。
// 只在浏览器里用。
import { Marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

// 用自己的一份 Marked，不用全局的 marked：编辑器（@tiptap/markdown）会往全局 marked 上注册 taskList 这类扩展，
// 全局的一旦被它改过，这里再转带列表的 md 就报「Token with "taskList" type was not found」，发布弹窗点了文案也填不进来
const md2html = new Marked({ async: false, gfm: true })
export const mdToHtml = (md: string) => md2html.parse(md, { async: false }) as string

// turndown 默认把 * _ [ ] # 这些都转义，存一次源码里就多出一堆反斜杠。只转义会改变意思的：行首的标题、引用、列表记号，和 * `
const escape = (s: string) => s
  .replace(/[*`]/g, '\\$&')
  .replace(/^(\s*)([#>+-])(?=\s)/gm, '$1\\$2')
  .replace(/^(\s*)(\d+)\.(?=\s)/gm, '$1$2\\.')

let td: TurndownService | null = null
export function htmlToMd(html: string) {
  if (!td) {
    td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', hr: '---' })
    td.use(gfm)
    ;(td as unknown as { escape: (s: string) => string }).escape = escape
    // 后加的规则优先（turndown 往前插）：盖掉 gfm 的单元格、删除线
    // 单元格：编辑器每格里包 <p>，换行写成 <br>，不然表格断成几行；| 要转义
    td.addRule('tableCell', {
      filter: ['th', 'td'],
      replacement: (content, node) => {
        const first = Array.prototype.indexOf.call(node.parentNode!.childNodes, node) === 0
        const cell = content.trim().replace(/\s*\n+\s*/g, '<br>').replace(/\|/g, '\\|')
        return `${first ? '| ' : ' '}${cell} |`
      },
    })
    td.addRule('strike', { filter: ['del', 's'], replacement: (c) => `~~${c}~~` })
    // 列表项：编辑器每项里包一个 <p>，turndown 默认写成「-   xx」加空行；写成紧凑的「- xx」
    td.addRule('listItem', {
      filter: 'li',
      replacement: (content, node) => {
        const parent = node.parentNode as HTMLElement
        const n = parent.nodeName === 'OL' ? Number(parent.getAttribute('start') || 1) + Array.prototype.indexOf.call(parent.children, node) : 0
        const task = (node as HTMLElement).getAttribute('data-type') === 'taskItem'
        const prefix = n ? `${n}. ` : task ? `- [${(node as HTMLElement).getAttribute('data-checked') === 'true' ? 'x' : ' '}] ` : '- '
        const body = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n{2,}/g, '\n').replace(/\n/g, '\n' + ' '.repeat(prefix.length))
        return prefix + body + (node.nextSibling ? '\n' : '')
      },
    })
    // 视频：编辑器外面可能包一层，取里面的 <video>，只留地址和宽高
    td.addRule('video', {
      filter: (n) => n.nodeName === 'VIDEO',
      replacement: (_c, n) => {
        const src = n.getAttribute('src') || n.querySelector('source')?.getAttribute('src') || ''
        const w = n.getAttribute('width'), h = n.getAttribute('height')
        return `\n\n<video src="${src}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''} controls></video>\n\n`
      },
    })
  }
  // 编辑器的表格前面有 <colgroup>：gfm 插件看到它就认不出表头行，整张表留成 HTML。md 没有列宽，去掉
  return td.turndown(html.replace(/<colgroup>[\s\S]*?<\/colgroup>/g, '')).trim() + '\n'
}

/** 把 HTML 里图片、视频的地址换掉（加载时相对路径 → 预览地址，保存时反过来） */
export const mapSrc = (html: string, f: (src: string) => string) =>
  html.replace(/(<(?:img|video|source)\b[^>]*?\ssrc=")([^"]*)(")/gi, (_, a, src, b) => a + f(src) + b)

export const srcsOf = (html: string) => [...html.matchAll(/<(?:img|video|source)\b[^>]*?\ssrc="([^"]*)"/gi)].map((m) => m[1])
