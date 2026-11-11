// 在浏览器里把文件读成文字（企业资料用）：txt / md / csv / json 直接读，PDF 用 pdf.js，Word（.docx）用 mammoth。
// 两个库都是用到才加载（talizen.config.ts 的 importMap，从 esm.talizen.com 来），不进页面的首屏。
// 扫描件、图片做的 PDF 没有文字层，读出来是空的：页面提示用户复制文字粘贴进来。

const PDF_WORKER = 'https://esm.talizen.com/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs?raw'
const MAMMOTH = 'https://esm.talizen.com/mammoth@1.9.0/mammoth.browser.min.js?raw'

/** 能读的扩展名（文件选择框的 accept 也用它） */
export const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm'

export const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

/** 读出文件里的文字；读不了这种格式抛错（错误信息给用户看） */
export async function extractText(file: File, unsupported: string): Promise<string> {
  const ext = extOf(file.name)
  if (ext === 'pdf') return pdfText(file)
  if (ext === 'docx') return docxText(file)
  if (['txt', 'md', 'markdown', 'csv', 'json'].includes(ext)) return file.text()
  if (ext === 'html' || ext === 'htm') {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html')
    doc.querySelectorAll('script,style,noscript,nav,footer').forEach((n) => n.remove())
    return doc.body?.innerText || doc.body?.textContent || ''
  }
  throw new Error(unsupported)
}

let pdfjs: Promise<any> | null = null
function loadPdf() {
  pdfjs ||= import('pdfjs-dist').then((m: any) => {
    const lib = m.default ?? m
    // worker 在别的域名上，直接 new Worker 会被拦：用同源的 blob 包一层 import 它（esm.talizen.com 允许跨域）
    try {
      const url = URL.createObjectURL(new Blob([`import ${JSON.stringify(PDF_WORKER)}`], { type: 'text/javascript' }))
      lib.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' })
    } catch {
      lib.GlobalWorkerOptions.workerSrc = PDF_WORKER
    }
    return lib
  })
  return pdfjs
}

async function pdfText(file: File): Promise<string> {
  const lib = await loadPdf()
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // 按行拼：pdf.js 每个文字块带 hasEOL，换行处断开
    let line = ''
    const lines: string[] = []
    for (const it of content.items as any[]) {
      line += it.str ?? ''
      if (it.hasEOL) {
        lines.push(line.trimEnd())
        line = ''
      }
    }
    if (line) lines.push(line.trimEnd())
    pages.push(lines.join('\n'))
  }
  return pages.join('\n\n')
}

let mammoth: Promise<any> | null = null
async function docxText(file: File): Promise<string> {
  // mammoth 的浏览器版是 UMD，加载后挂在 window.mammoth 上
  mammoth ||= import(/* @vite-ignore */ MAMMOTH).then(() => (window as any).mammoth)
  const lib = await mammoth
  const r = await lib.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return r.value ?? ''
}

/** 原文件存成 Annulo 的本机文件（local:<name>），以后能打开看原样；不在 Annulo 里（手机上）存不了就返回空 */
export async function saveOriginal(file: File): Promise<string> {
  try {
    const res = await fetch('/_shuttle/api/local/files', {
      method: 'POST',
      headers: { 'X-Shuttle': '1', 'X-Filename': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) return ''
    return (await res.json()).ref ?? ''
  } catch {
    return ''
  }
}
