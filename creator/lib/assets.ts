import { dbCreate, uploadFile, type Asset, type AssetKind } from './shuttle'
import { tr } from './i18n'

// 显示名按当前语言取（getter）
export const ASSET_KINDS = {
  get image() {
    return tr('meta.asset_kinds.image')
  },
  get video() {
    return tr('meta.asset_kinds.video')
  },
  get text() {
    return tr('meta.asset_kinds.text')
  },
} as Record<AssetKind, string>

export function assetTags(a: Asset): string[] {
  try {
    const v = JSON.parse(a.tags ?? '[]')
    return Array.isArray(v) ? v.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

/** 标签输入框的文字拆成数组：空格、逗号、# 都算分隔 */
export const splitTags = (s: string) => [...new Set(s.split(/[\s,，#]+/).map((t) => t.trim()).filter(Boolean))]

/** 按地址的扩展名猜类型，猜不出当图片 */
export function kindOfUrl(url: string): AssetKind {
  const path = url.split(/[?#]/)[0].toLowerCase()
  if (/\.(mp4|mov|webm|m4v)$/.test(path)) return 'video'
  return 'image'
}

/** 地址最后一段当默认名称 */
export function nameOfUrl(url: string) {
  const last = url.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** 按关键词（名称、标签、文字内容）、类型、标签筛 */
export function filterAssets(list: Asset[], opts: { q?: string; kind?: string; tag?: string }) {
  const q = (opts.q ?? '').trim().toLowerCase()
  return list.filter((a) => {
    if (opts.kind && a.kind !== opts.kind) return false
    const tags = assetTags(a)
    if (opts.tag && !tags.includes(opts.tag)) return false
    if (!q) return true
    return [a.name, a.text, a.url, ...tags].some((v) => (v ?? '').toLowerCase().includes(q))
  })
}

/** 按文件的类型猜素材类型：视频是 video，其余当图片 */
export function kindOfType(contentType: string, name: string): AssetKind {
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('image/')) return 'image'
  return kindOfUrl(name)
}

/** 能进素材库的文件：图片、视频 */
export const ACCEPT_UPLOAD = 'image/*,video/*'

export type UploadItem = { name: string; status: 'waiting' | 'uploading' | 'done' | 'failed'; error?: string; asset?: Asset }

/**
 * 逐个上传文件、写进 assets（source: upload），每一步通过 onChange 报进度。
 * 同样内容之前传过（existed）且表里已有这个地址：不重复建，直接用已有的那条。
 */
export async function uploadAssets(files: File[], existing: Asset[], onChange: (items: UploadItem[]) => void): Promise<UploadItem[]> {
  const items: UploadItem[] = files.map((f) => ({ name: f.name, status: 'waiting' }))
  const emit = () => onChange(items.map((x) => ({ ...x })))
  emit()
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    items[i].status = 'uploading'
    emit()
    try {
      const r = await uploadFile(f)
      const had = existing.find((a) => a.url === r.url)
      const asset = had ?? (await dbCreate('assets', { url: r.url, kind: kindOfType(r.content_type || f.type, f.name), name: f.name, source: 'upload', created_at: new Date().toISOString() }))
      if (!had) existing = [...existing, asset]
      items[i] = { ...items[i], status: 'done', asset }
    } catch (e) {
      items[i] = { ...items[i], status: 'failed', error: (e as Error).message }
    }
    emit()
  }
  return items
}
