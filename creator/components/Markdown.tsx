import type { ReactNode } from 'react'

// 够用的小 Markdown 渲染：标题、段落、列表、表格、引用、分隔线，行内的加粗、代码、链接。
// 直接生成 React 元素，不拼 HTML（正文是助手写的，不信任里面的标签）。

function inline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[2]) out.push(<strong key={k} className="font-semibold">{m[2]}</strong>)
    else if (m[3]) out.push(<code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{m[3]}</code>)
    else
      out.push(
        <a key={k} href={m[5]} target="_blank" rel="noreferrer" className="font-medium text-primary-text underline-offset-2 hover:underline">
          {m[4]}
        </a>,
      )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const k = `b${i}`
    if (!line.trim()) {
      i++
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      const cls = level <= 2 ? 'mt-5 text-sm font-semibold first:mt-0' : 'mt-4 text-[13px] font-semibold first:mt-0'
      blocks.push(<div key={k} className={cls}>{inline(h[2], k)}</div>)
      i++
      continue
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      blocks.push(<hr key={k} className="my-4 border-border" />)
      i++
      continue
    }
    // 表格：表头行 + 分隔行
    if (line.includes('|') && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      blocks.push(
        <div key={k} className="my-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                {head.map((c, j) => (
                  <th key={j} className="px-3 py-2 font-medium whitespace-nowrap">{inline(c, `${k}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border last:border-b-0">
                  {head.map((_, j) => (
                    <td key={j} className="px-3 py-2 align-top tabular-nums">{inline(r[j] ?? '', `${k}r${ri}c${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    const ul = /^\s*[-*]\s+/
    const ol = /^\s*\d+[.)]\s+/
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line)
      const re = ordered ? ol : ul
      const items: string[] = []
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''))
      const Tag = ordered ? 'ol' : 'ul'
      blocks.push(
        <Tag key={k} className={`my-2 space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${k}i${j}`)}</li>
          ))}
        </Tag>,
      )
      continue
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push(
        <blockquote key={k} className="my-3 border-l-2 border-primary/40 pl-3 text-muted-foreground">
          {inline(q.join(' '), k)}
        </blockquote>,
      )
      continue
    }
    // 段落：连续的普通行合成一段
    const p: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s|^\s*[-*]\s|^\s*\d+[.)]\s|^\s*>/.test(lines[i]) && !(lines[i].includes('|') && isRule(lines[i + 1] ?? ''))) p.push(lines[i++])
    if (!p.length) {
      // 兜底：不认识的行也要前进，避免死循环
      p.push(lines[i++])
    }
    blocks.push(<p key={k} className="my-2">{inline(p.join(' '), k)}</p>)
  }
  return <div className={`text-sm leading-relaxed ${className ?? ''}`}>{blocks}</div>
}
