// Markdown ↔ 富文本编辑器的 HTML（components/Folder.tsx 用）：文件夹里的长文存成 .md，页面上用富文本编辑器改。
// md → HTML 用 marked，HTML → md 用 turndown（加 GFM：删除线、表格）；视频没有 md 写法，原样留 <video src width height> 标签。
import { marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

// 编辑器只有二、三级标题：一级标题当二级（存回去是 ##），不然会变成普通段落
export const mdToHtml = (md: string) => marked.parse(md, { async: false, gfm: true }).replace(/<(\/?)h1>/g, '<$1h2>')

let td: TurndownService | null = null
export function htmlToMd(html: string) {
  if (!td) {
    td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', hr: '---' })
    td.use(gfm)
    // 列表项：编辑器每项里包一个 <p>，turndown 默认写成「-   xx」加空行；写成紧凑的「- xx」
    td.addRule('listItem', {
      filter: 'li',
      replacement: (content, node) => {
        const parent = node.parentNode as HTMLElement
        const n = parent.nodeName === 'OL' ? Number(parent.getAttribute('start') || 1) + Array.prototype.indexOf.call(parent.children, node) : 0
        const prefix = n ? `${n}. ` : '- '
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
  return td.turndown(html).trim() + '\n'
}

/** 把 HTML 里图片、视频的地址换掉（加载时相对路径 → 预览地址，保存时反过来） */
export const mapSrc = (html: string, f: (src: string) => string) =>
  html.replace(/(<(?:img|video|source)\b[^>]*?\ssrc=")([^"]*)(")/gi, (_, a, src, b) => a + f(src) + b)

export const srcsOf = (html: string) => [...html.matchAll(/<(?:img|video|source)\b[^>]*?\ssrc="([^"]*)"/gi)].map((m) => m[1])
