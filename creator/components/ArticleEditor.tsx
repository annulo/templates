import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Upload, X } from 'lucide-react'
import AssetPicker from './AssetPicker'
import UploadProgress from './UploadProgress'
import Lightbox from './Lightbox'
import RichEditor from './RichEditor'
import VideoField from './VideoField'
import { TextCover } from './views/Social'
import { Field, cx, inputCls } from './ui'
import { typePlatforms } from './ArticleTypes'
import { CHANNEL_TYPES } from '../lib/channels'
import { tr } from '../lib/i18n'
import { dbList, videoSrc, type Article, type Asset } from '../lib/shuttle'
import { uploadAssets, type UploadItem } from '../lib/assets'
import { usePasteFiles } from '../lib/usePasteFiles'
import { FIELDS } from '../plugins/social/local/_fields'
import { parseList, tagsOf, typeOf, type ArticleType } from '../local/_types'

// 一篇文章的编辑框和阅读视图，按文章类型显示字段（local/_types.ts）：
//   长文：标题、摘要、富文本正文（图在正文里）；图文笔记：标题、纯文字正文、一组配图、封面大字；视频：标题、视频、简介、分区。都有话题。

export type ArticleDraft = { title: string; summary: string; body: string; tags: string; images: string[]; cover_text: string; video: string; category: string }

export const draftOf = (a: Partial<Article>): ArticleDraft => ({ title: a.title ?? '', summary: a.summary ?? '', body: a.body ?? '', tags: tagsOf(a).join(' '), images: parseList(a.images), cover_text: a.cover_text ?? '', video: a.video ?? '', category: a.category ?? '' })
const splitTags = (s: string) => [...new Set(s.split(/[\s,，#]+/).map((x) => x.trim()).filter(Boolean))]
export const sameDraft = (x: ArticleDraft, y: ArticleDraft) => JSON.stringify({ ...x, tags: splitTags(x.tags) }) === JSON.stringify({ ...y, tags: splitTags(y.tags) })

/** 存进表的字段：只写这种类型用得上的 */
export function patchOf(d: ArticleDraft, t: ArticleType): Partial<Article> {
  const base: Partial<Article> = { title: d.title.trim(), body: t === 'article' ? d.body : d.body.trim(), tags: JSON.stringify(splitTags(d.tags)) }
  if (t === 'article') return { ...base, summary: d.summary.trim() }
  if (t === 'post') return { ...base, images: JSON.stringify(d.images), cover_text: d.cover_text.trim() }
  return { ...base, video: d.video, category: d.category.trim() }
}

/** 这种类型在各平台的上限：「X 280 · 小红书 1000」 */
function limitLine(t: ArticleType, pick: (f: (typeof FIELDS)[string]) => number) {
  return typePlatforms(t).map((p) => `${CHANNEL_TYPES[p]?.label ?? p} ${pick(FIELDS[p])}`).join(' · ')
}
const maxOf = (t: ArticleType, pick: (f: (typeof FIELDS)[string]) => number) => Math.max(0, ...typePlatforms(t).map((p) => pick(FIELDS[p])))
const chars = (s: string) => [...s].length

export function ArticleEditor({ type, draft, setDraft, editorKey }: { type: ArticleType; draft: ArticleDraft; setDraft: (f: (d: ArticleDraft) => ArticleDraft) => void; editorKey: number }) {
  const set = <K extends keyof ArticleDraft>(k: K, v: ArticleDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const imagesMax = maxOf('post', (f) => f.images)
  const tagsMax = maxOf(type, (f) => f.tags)
  const hasCategory = type === 'video' && typePlatforms('video').some((p) => FIELDS[p].category)
  const hasCover = type === 'post' && typePlatforms('post').some((p) => FIELDS[p].cover)
  return <div className="space-y-4">
    <input value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder={tr('content.title_ph')} aria-label={tr('social.f_title')} className={cx(inputCls, 'h-11 text-lg font-semibold')} />
    {type === 'article' && <>
      <textarea value={draft.summary} onChange={(e) => set('summary', e.target.value)} rows={2} aria-label={tr('content.new_summary')} placeholder={tr('content.summary_ph')} className={cx(inputCls, 'py-2')} />
      <RichEditor key={editorKey} value={draft.body} onChange={(body) => set('body', body)} />
    </>}
    {type === 'video' && <VideoField video={draft.video} onChange={(v) => set('video', v)} />}
    {type !== 'article' && <Field label={type === 'video' ? tr('article.f_desc') : tr('social.f_body')} hint={`${chars(draft.body)} · ${tr('article.limit_body', { list: limitLine(type, (f) => f.bodyMax) })}`}>
      <textarea className={cx(inputCls, 'py-3 leading-relaxed', type === 'post' ? 'min-h-64' : 'min-h-32')} value={draft.body} onChange={(e) => set('body', e.target.value)} placeholder={type === 'video' ? tr('article.desc_ph') : tr('article.post_ph')} />
    </Field>}
    {type === 'post' && <ImagesField images={draft.images} max={imagesMax} onChange={(l) => set('images', l)} hint={tr('article.limit_images', { list: limitLine('post', (f) => f.images) })} />}
    {hasCover && !draft.images.length && <Field label={tr('social.f_cover')} hint={tr('social.cover_hint')}><input className={inputCls} value={draft.cover_text} onChange={(e) => set('cover_text', e.target.value)} /></Field>}
    <Field label={tr('social.f_tags')} hint={tr('social.tags_hint', { n: tagsMax })}><input className={inputCls} value={draft.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
    {hasCategory && <Field label={tr('social.category')} hint={tr('article.category_hint')}><input className={inputCls} value={draft.category} onChange={(e) => set('category', e.target.value)} /></Field>}
  </div>
}

/** 图文笔记的配图：从资料库选、上传本机图片或直接粘贴，拖动排序（第一张是封面），点开看大图 */
function ImagesField({ images, max, hint, onChange }: { images: string[]; max: number; hint: string; onChange: (l: string[]) => void }) {
  const [picking, setPicking] = useState(false)
  // 本机图片：上传按钮、直接粘贴（截图、复制的图片），都先进资料库（uploadAssets），再加到配图里
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const upload = async (files: File[]) => {
    const room = max - images.length
    if (!files.length || room <= 0) return
    setUploading(true)
    try {
      const existing = await dbList('assets').catch(() => [] as Asset[])
      const urls = (await uploadAssets(files.slice(0, room), existing, setUploads)).flatMap((x) => (x.asset?.url ? [x.asset.url] : []))
      onChange([...images, ...urls.filter((u) => !images.includes(u))].slice(0, max))
      setUploads((l) => l.filter((x) => x.status === 'failed'))
    } finally {
      setUploading(false)
    }
  }
  // 「从资料库选」弹窗开着时它自己接粘贴，这里不接，免得传两遍
  usePasteFiles(!picking && !uploading && images.length < max, upload)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [zoom, setZoom] = useState('')
  const move = (from: number, to: number) => { const n = [...images]; const [x] = n.splice(from, 1); n.splice(to, 0, x); onChange(n) }
  return <Field group label={tr('social.f_images')} hint={hint}>
    <div className="space-y-2">
      {!!images.length && <div className="flex flex-wrap gap-2">{images.map((u, i) => <div key={u + i} draggable={images.length > 1}
        onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => { if (dragFrom !== null) e.preventDefault() }}
        onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== i) move(dragFrom, i); setDragFrom(null) }} onDragEnd={() => setDragFrom(null)}
        title={images.length > 1 ? tr('social.drag_sort') : undefined} className={cx('relative', images.length > 1 && 'cursor-grab active:cursor-grabbing', dragFrom === i && 'opacity-40')}>
        <button type="button" onClick={() => setZoom(u)} aria-label={tr('social.view_image')} className="block cursor-zoom-in rounded"><img src={u} alt="" draggable={false} className="size-24 rounded border border-border object-cover" /></button>
        {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{tr('article.cover')}</span>}
        <button type="button" aria-label={tr('social.remove_image')} onClick={() => onChange(images.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-foreground text-background opacity-80 hover:opacity-100"><X className="size-3" /></button>
      </div>)}</div>}
      {images.length < max && <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setPicking(true)} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:bg-accent"><Plus className="size-3.5" />{tr('social.pick_assets')}</button>
        <input ref={fileRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = '' }} />
        <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:bg-accent disabled:cursor-default disabled:opacity-50">{uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}{uploading ? tr('ui.uploading') : tr('ui.upload')}</button>
        <span className="text-xs text-muted-foreground">{tr('article.paste_hint')}</span>
      </div>}
      <UploadProgress items={uploads} />
    </div>
    {zoom && <Lightbox src={zoom} onClose={() => setZoom('')} />}
    <AssetPicker open={picking} kind="image" max={max - images.length} onClose={() => setPicking(false)} onPick={(urls) => { onChange([...images, ...urls.filter((u) => !images.includes(u))].slice(0, max)); setPicking(false) }} />
  </Field>
}

/** 阅读视图 */
export function ArticleView({ a }: { a: Article }) {
  const t = typeOf(a)
  const tags = tagsOf(a)
  const images = parseList(a.images)
  const [zoom, setZoom] = useState('')
  const tagLine = !!tags.length && <div className="mt-4 flex flex-wrap gap-1.5">{tags.map((x) => <span key={x} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">#{x}</span>)}</div>
  if (t === 'article') return <>
    {a.summary && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a.summary}</p>}
    <div className="mt-5 border-t border-border pt-4">{a.video && <video src={videoSrc(a.video)} controls className="mb-4 w-full rounded-lg bg-black" />}{a.body ? <BodyPreview key={a.updated_at} html={a.body} /> : <p className="text-sm text-muted-foreground">{tr('content.no_body')}</p>}</div>
    {tagLine}
  </>
  if (t === 'video') return <div className="mt-5 space-y-4 border-t border-border pt-4">
    {a.video ? <video src={videoSrc(a.video)} controls className="max-h-[60vh] w-full rounded-lg bg-black" /> : <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{tr('article.no_video')}</p>}
    {a.body ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{a.body}</p> : <p className="text-sm text-muted-foreground">{tr('article.no_desc')}</p>}
    {a.category && <p className="text-xs text-muted-foreground">{tr('social.category')}：{a.category}</p>}
    {tagLine}
  </div>
  return <div className="mt-5 space-y-4 border-t border-border pt-4">
    {images.length ? <div className="flex flex-wrap gap-2">{images.map((u, i) => <button key={u + i} type="button" onClick={() => setZoom(u)} className="relative cursor-zoom-in"><img src={u} alt="" loading="lazy" className="size-32 rounded-lg border border-border object-cover" />{i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{tr('article.cover')}</span>}</button>)}</div>
      : a.cover_text ? <div className="w-32 overflow-hidden rounded-lg border border-border"><TextCover text={a.cover_text} className="w-full" /></div> : <p className="text-xs text-muted-foreground">{tr('article.no_images')}</p>}
    {a.body ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{a.body}</p> : <p className="text-sm text-muted-foreground">{tr('content.no_body')}</p>}
    {tagLine}
    {zoom && <Lightbox src={zoom} onClose={() => setZoom('')} />}
  </div>
}

/** 长文正文是 agent 写的 HTML：放进沙箱 iframe 渲染（不执行脚本、不继承页面权限），样式跟随主题 */
export function BodyPreview({ html }: { html: string }) {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark')
  useEffect(() => {
    const update = () => setDark(document.documentElement.getAttribute('data-theme') === 'dark')
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    update()
    return () => observer.disconnect()
  }, [])
  const doc = `<!doctype html><meta charset="utf-8"><style>
  html{color-scheme:${dark ? 'dark' : 'light'}} body{margin:0;padding:4px 2px;font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:${dark ? '#e7e7e7' : '#1f1f1f'};background:${dark ? '#0a0a0a' : '#ffffff'}}
  h1,h2,h3{line-height:1.35;margin:1.4em 0 .5em} h2{font-size:1.25em} h3{font-size:1.08em}
  p{margin:.7em 0} a{color:${dark ? '#8fb6ff' : '#2455d6'}} img{max-width:100%;border-radius:8px}
  ul,ol{padding-left:1.4em} blockquote{margin:1em 0;padding-left:1em;border-left:3px solid ${dark ? '#444' : '#ddd'};color:${dark ? '#aaa' : '#666'}}
  code{background:${dark ? '#2a2a2a' : '#f2f2f2'};padding:.1em .35em;border-radius:4px}
  table{border-collapse:collapse} td,th{border:1px solid ${dark ? '#3a3a3a' : '#ddd'};padding:.3em .6em}
  </style><body>${html}</body>`
  const [h, setH] = useState(400)
  const bodyObserver = useRef<ResizeObserver | null>(null)
  useEffect(() => () => bodyObserver.current?.disconnect(), [])
  return (
    <iframe
      title={tr('content.body')}
      sandbox="allow-same-origin"
      srcDoc={doc}
      onLoad={(e) => {
        const body = e.currentTarget.contentDocument?.body
        bodyObserver.current?.disconnect()
        if (!body) return
        const measure = () => setH(Math.max(200, body.scrollHeight + 20))
        measure()
        bodyObserver.current = new ResizeObserver(measure)
        bodyObserver.current.observe(body)
      }}
      className="w-full border-0 bg-background"
      style={{ height: h, colorScheme: dark ? 'dark' : 'light' }}
    />
  )
}
