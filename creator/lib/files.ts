// 资料库里的文件按类型（mime）显示、打开：AI 做出来的产物（artifacts）有视频、图片、网页、音频、文档……
// 本机文件是 local:<name>（Annulo 的本机文件，存在这台电脑上），页面上用 /_shuttle/files/<name> 显示；网址原样用。

/** 扩展名 → mime（表里没存 mime 的老数据、网址按扩展名猜） */
const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
  html: 'text/html', htm: 'text/html', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
}

export const extOf = (url?: string) => (url ?? '').split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''

/** 这条的类型：存了 mime 用它；没有按扩展名猜；再没有按老的 kind（image / video） */
export function mimeOf(a: { mime?: string; url?: string; kind?: string }): string {
  if (a.mime) return a.mime
  const byExt = EXT_MIME[extOf(a.url)]
  if (byExt) return byExt
  return a.kind === 'video' ? 'video/mp4' : a.kind === 'image' ? 'image/*' : ''
}

/** 资料库的大类（筛选用）：图片、视频、文字，其余都是 file */
export const kindOfMime = (mime: string) => (mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'file')

/** 工作目录里文件的引用（ctx.fs.ref 给的 folder:<文件夹 id>/<路径>#<版本>、work:<路径>#<版本>，Annulo 能力版本 62）：社媒笔记要发的成片、封面就存它，不复制 */
export const isWorkRef = (url?: string) => !!url && /^(folder|work):/.test(url)
/** 这台电脑上的文件：本机文件 local:<name>，或工作目录里文件的引用 */
export const isFileRef = (url?: string) => !!url && (url.startsWith('local:') || isWorkRef(url))

/** 页面上用的地址：本机文件、工作目录文件的引用换成 Annulo 的地址，网址原样 */
export const fileSrc = (url?: string) =>
  url?.startsWith('local:') ? '/_shuttle/files/' + url.slice(6) : isWorkRef(url) ? '/_shuttle/work-ref/' + encodeURIComponent(url!.split('#')[0]) : url ?? ''

/**
 * 用系统程序打开（网页用系统浏览器），reveal 时在访达 / 文件夹里显示：本机文件交给 Annulo（POST local/open，能力版本 43）；
 * 服务端部署时 Annulo 回一个地址，在新标签页打开。网址直接新标签页打开
 */
export async function openFile(url?: string, reveal = false) {
  if (!url) return
  if (!url.startsWith('local:')) {
    window.open(fileSrc(url), '_blank', 'noopener')
    return
  }
  const res = await fetch('/_shuttle/api/local/open', { method: 'POST', headers: { 'X-Shuttle': '1', 'content-type': 'application/json' }, body: JSON.stringify({ path: url, reveal }) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  if (body.open_url) window.open(body.open_url, '_blank', 'noopener')
}

/** 删掉一个本机文件（local:<name>）。不是本机文件的地址不动 */
export async function deleteLocalFile(ref?: string) {
  if (!ref?.startsWith('local:')) return
  const res = await fetch('/_shuttle/api/local/files/' + encodeURIComponent(ref.slice(6)), { method: 'DELETE', headers: { 'X-Shuttle': '1' } })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
}

export type FileItem = { url: string; mime: string; name?: string }

/** 资料库一条里的文件：一组（files）或单个（url） */
export function filesOf(a: { files?: string; url?: string; mime?: string; kind?: string; name?: string }): FileItem[] {
  try {
    const l = JSON.parse(a.files || '[]')
    if (Array.isArray(l) && l.length) return l.filter((f) => f && f.url).map((f) => ({ url: String(f.url), mime: f.mime || mimeOf({ url: f.url }), name: f.name }))
  } catch {}
  return a.url ? [{ url: a.url, mime: mimeOf(a), name: a.name }] : []
}
