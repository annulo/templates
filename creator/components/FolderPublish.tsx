import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, FileText, Film, HardDrive, Image as ImageIcon, Library, Loader2, Newspaper, Send, X } from 'lucide-react'
import AssetPicker from './AssetPicker'
import RichEditor from './RichEditor'
import { ChannelAvatar } from './ArticlePublish'
import { Badge, Button, Dialog, Notice, Segmented, cx, inputCls, toast } from './ui'
import { DateTimeChip } from './DateTimePicker'
import { IMAGE, MD, VIDEO, base, fmtSize, isDraft, joinPath, parent, workSrc, type Entry } from './Folder'
import { enqueue } from '../lib/publishQueue'
import { fileSrc } from '../lib/files'
import { tr, useT } from '../lib/i18n'
import { CHANNEL_TYPES } from '../lib/channels'
import { runLocal, uploadLocalFile, type Article } from '../lib/shuttle'
import { SOCIAL, loggedInElsewhere, useElsewhere } from '../lib/social'
import { FIELDS } from '../plugins/social/local/_fields'
import { lengthOn, supports } from '../local/_types'
import type { Ctx } from './views/types'

// 发布（自媒体的内容文件夹，docs/content-model.md「发布是挑选」）：内容本身没有类型，发的时候挑这次发成什么、用哪些文件。
//   发成：图文（文字 + 一组图）/ 视频（简介 + 一个视频）/ 长文（Markdown 转成富文本，图在正文里）。打开时按文件夹里有什么猜一个。
//   文字：从文件夹里挑一份 .md（开头 --- 包住的 title、tags 填进标题和话题，能当场改）；
//   图片、视频：文件夹里的直接点选，也能从资料库选。挑了文案自动配上和它在同一个目录的图、视频（用户自己点过的不动）。
//   三样都能「上传本机」：传上来的文件复制进这条内容的文件夹（folder.importLocal），和文件夹里原有的一样点选、发布。
//   视频封面（小红书、抖音用，插件 FIELDS 的 videoCover）：文件夹里的图点选或从资料库选；内容上设过封面就用它，没有就挑文件夹里名字带「封面 / cover」的图，都没有用平台默认的那一帧。
// 选好账号、现在发或排期：folder.publish 每个账号新建一条帖子（存的就是这次挑的内容，排期到点照它发），放进后台发布队列。

type Kind = 'post' | 'video' | 'article'

/** 选中的图片、视频：文件夹里的是相对路径，资料库的是地址 */
type Media = { ref: string; src: string; name: string }

const isUrl = (u: string) => /^(https?:\/\/|\/_(annulo|shuttle)\/uploaded\/|local:)/.test(u)

/** 文案 md：开头可以有 --- 包住的 title / tags，或者第一行 # 标题 */
function parseCopy(text: string) {
  let title = '', tags: string[] = [], body = text
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (m) {
    body = text.slice(m[0].length)
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (kv?.[1] === 'title') title = kv[2].trim()
      if (kv?.[1] === 'tags') tags = kv[2].replace(/^\[|\]$/g, '').split(/[,，\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean)
    }
  } else {
    const h = text.match(/^#\s+(.+)\r?\n/)
    if (h) { title = h[1].trim(); body = text.slice(h[0].length) }
  }
  return { title, tags, body: body.trim() }
}

/** 图文、视频的正文是纯文字：Markdown 转成 HTML 再按段落取文字（列表前面加「- 」，图片、视频去掉） */
function htmlPlain(html: string) {
  const d = document.createElement('div')
  d.innerHTML = html
  const out: string[] = []
  for (const el of Array.from(d.children)) {
    if (el.tagName === 'UL' || el.tagName === 'OL') out.push(Array.from(el.children).map((li, i) => `${el.tagName === 'OL' ? `${i + 1}.` : '-'} ${li.textContent?.trim()}`).join('\n'))
    else if (!/^(VIDEO|IMG|HR)$/.test(el.tagName)) { const t = el.textContent?.trim(); if (t) out.push(t) }
  }
  return out.join('\n\n')
}

/** 按文件夹里有什么猜发成什么：有视频发视频，有图发图文，都没有发长文 */
const guessKind = (files: Entry[]): Kind => (files.some((e) => VIDEO.test(e.path)) ? 'video' : files.some((e) => IMAGE.test(e.path)) ? 'post' : 'article')
/** 离 dir 最近的：同一个目录里的优先，再是它下面的，最后是别处的 */
const near = (dir: string, p: string) => (parent(p) === dir ? 0 : dir && p.startsWith(dir + '/') ? 1 : !dir ? 1 : 2)

export default function FolderPublish({ open, ctx, article, onClose }: { open: boolean; ctx: Ctx; article: Article; onClose: () => void }) {
  const { t } = useT('fpub')
  const [root, setRoot] = useState('')
  const [files, setFiles] = useState<Entry[] | null>(null)
  const [kind, setKind] = useState<Kind>('post')
  // 从哪份 md 填的文字（只用来填，填完下面都能改；也用它挑同目录的图、视频）
  const [copy, setCopy] = useState('')
  // 正文：长文是 md（富文本编辑器直接改，发的时候转成 HTML），图文、视频是纯文字。各存一份，切「发成」不丢
  const [md, setMd] = useState('')
  const [plain, setPlain] = useState('')
  const [mdVer, setMdVer] = useState(0)
  // 点同一份文件也重新填一次
  const [fill, setFill] = useState(0)
  const [exts, setExts] = useState<unknown[] | null>(null)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [images, setImages] = useState<Media[]>([])
  const [video, setVideo] = useState<Media | null>(null)
  // 用户自己点过图片、视频就不再跟着文案自动换
  const [touched, setTouched] = useState({ images: false, video: false })
  // 视频封面：null 是平台默认的那一帧
  const [cover, setCover] = useState<Media | null>(null)
  const [picker, setPicker] = useState<'image' | 'video' | 'cover' | null>(null)
  // 上传本机：给哪一栏传（配图可以一次传几张），进度 0–1，null 是没在传
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploadFor, setUploadFor] = useState<'image' | 'video' | 'cover'>('image')
  const [uploading, setUploading] = useState<number | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  // 定时发布的时间（本地时间 'YYYY-MM-DDTHH:mm'），空的是现在发
  const [at, setAt] = useState('')
  const [result, setResult] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const media = (ref: string): Media => ({ ref, src: isUrl(ref) ? fileSrc(ref) : workSrc(`${root}/${ref}`), name: isUrl(ref) ? t('from_library') : ref })
  const folderImages = useMemo(() => (files ?? []).filter((e) => IMAGE.test(e.path)).sort((a, b) => a.path.localeCompare(b.path, 'zh', { numeric: true })), [files])
  const folderVideos = useMemo(() => (files ?? []).filter((e) => VIDEO.test(e.path)).sort((a, b) => b.mtime - a.mtime), [files])
  const copies = useMemo(() => (files ?? []).filter((e) => MD.test(e.path) && !isDraft(e.path)), [files])

  // 打开时：读文件夹，猜发成什么，挑文案（名字带「文案 / copy」的优先，再是离视频近的），配好图、视频
  useEffect(() => {
    if (!open) return
    setFiles(null); setError(''); setResult({}); setPicked([]); setAt(''); setTouched({ images: false, video: false })
    runLocal<{ path: string; entries: Entry[] }>('folder.list', { article_id: article.id }).then((r) => {
      const fs = r.entries.filter((e) => !e.dir)
      setRoot(r.path)
      setFiles(fs)
      const named = fs.filter((e) => IMAGE.test(e.path) && /封面|cover/i.test(base(e.path))).sort((a, b) => b.mtime - a.mtime)[0]
      setCover(article.video_cover ? { ref: article.video_cover, src: fileSrc(article.video_cover), name: t('from_library') } : named ? { ref: named.path, src: workSrc(`${r.path}/${named.path}`), name: named.path } : null)
      const k = guessKind(fs)
      setKind(k)
      const mds = fs.filter((e) => MD.test(e.path) && !isDraft(e.path))
      const vid = fs.filter((e) => VIDEO.test(e.path)).sort((a, b) => b.mtime - a.mtime)[0]
      const score = (e: Entry) => (/文案|copy/i.test(base(e.path)) ? 0 : 10) + (vid ? near(parent(vid.path), e.path) : 0)
      setCopy([...mds].sort((a, b) => score(a) - score(b) || b.mtime - a.mtime)[0]?.path ?? '')
    }).catch((e) => setError((e as Error).message))
  }, [open, article.id])

  // 点了一份 md：把它的标题、话题、正文填进来（覆盖现在的）；没手动挑过的图、视频换成离它最近的
  useEffect(() => {
    if (!open) return
    void import('./rich/mdExtensions').then((x) => setExts(x.default))
    if (!copy) { setMd(''); setPlain(''); setMdVer((v) => v + 1); setTitle(article.title); setTags(''); return }
    Promise.all([runLocal<{ text: string }>('folder.read', { article_id: article.id, path: copy }), import('../lib/mdhtml')]).then(([r, m]) => {
      const c = parseCopy(r.text)
      setMd(c.body)
      setPlain(htmlPlain(m.mdToHtml(c.body)))
      setMdVer((v) => v + 1)
      setTitle(c.title || article.title)
      setTags(c.tags.join(', '))
    }).catch((e) => setError((e as Error).message))
  }, [copy, fill, article.id, open])
  useEffect(() => {
    if (!files) return
    const dir = copy ? parent(copy) : ''
    if (!touched.images) {
      const best = Math.min(...folderImages.map((e) => near(dir, e.path)), 9)
      setImages(folderImages.filter((e) => near(dir, e.path) === best).slice(0, 18).map((e) => media(e.path)))
    }
    if (!touched.video) {
      const v = [...folderVideos].sort((a, b) => near(dir, a.path) - near(dir, b.path))[0]
      setVideo(v ? media(v.path) : null)
    }
  }, [copy, files, root])

  // 发出去的正文：图文、视频是纯文字；长文把 md 转成 HTML，图片、视频的相对路径换成文件夹里的路径（发的时候存成本机文件）
  const [body, setBody] = useState('')
  useEffect(() => {
    if (kind !== 'article') { setBody(plain); return }
    if (!md.trim()) { setBody(''); return }
    void import('../lib/mdhtml').then((m) => setBody(m.mapSrc(m.mdToHtml(md), (s) => (isUrl(s) || s.startsWith('/') ? s : joinPath(parent(copy), decodeURI(s))))))
  }, [md, plain, kind, copy])
  // 长文编辑器里显示图片、视频：相对路径按填进来的那份 md 所在的目录找
  const resolveSrc = (s: string) => (isUrl(s) ? fileSrc(s) : s.startsWith('/') ? s : workSrc(`${root}/${joinPath(parent(copy), decodeURI(s))}`))
  const tagList = tags.split(/[,，\s]+/).map((x) => x.replace(/^#/, '').trim()).filter(Boolean)

  const machine = useElsewhere(ctx.channels)
  const accounts = ctx.channels.filter((ch) => !!SOCIAL[ch.type])
  const coverUsed = kind === 'video' && accounts.some((ch) => FIELDS[ch.type]?.videoCover)
  const blocked = (ch: { type: string; login_status?: string } & Parameters<typeof loggedInElsewhere>[0]) => !supports(FIELDS[ch.type], kind) ? t('unsupported', { kind: t(`kind_${kind}`) })
    : loggedInElsewhere(ch, machine) ? t('on_machine', { name: loggedInElsewhere(ch, machine) })
    : ch.login_status === 'expired' ? t('expired') : ''
  // 换了发成什么：不支持的账号取消勾选
  useEffect(() => { setPicked((l) => l.filter((id) => { const ch = accounts.find((c) => c.id === id); return ch && !blocked(ch) })) }, [kind])
  const content = { type: kind, title, body, tags: JSON.stringify(tagList), images: JSON.stringify(images.map((i) => i.ref)), video: video?.ref ?? '' }

  const missing = kind === 'post' && !images.length ? t('need_images') : kind === 'video' && !video ? t('need_video') : !body.trim() && kind !== 'video' ? t('need_text') : ''
  const go = async () => {
    setRunning(true); setError('')
    const ts = at ? Date.parse(at) : 0
    if (at && !(ts > Date.now())) { setError(t('future_time')); setRunning(false); return }
    try {
      const r = await runLocal<{ ready: { channel_id: string; post_id: string }[]; problems: { channel_id: string; problems: string[] }[] }>('folder.publish', {
        article_id: article.id, kind, title, body, tags: tagList, images: images.map((i) => i.ref), video: video?.ref ?? '', ...(kind === 'video' ? { video_cover: cover?.ref ?? '' } : {}), channel_ids: picked, ...(ts ? { scheduled_at: new Date(ts).toISOString() } : {}),
      })
      const name = (id: string) => accounts.find((c) => c.id === id)?.name ?? ''
      if (!ts && r.ready.length) enqueue(r.ready.map((p) => ({ article_id: article.id, article_title: title || article.title, channel_id: p.channel_id, channel_name: name(p.channel_id), post_id: p.post_id })))
      if (r.ready.length) toast(ts ? t('scheduled_toast', { n: r.ready.length }) : t('started_toast', { n: r.ready.length }))
      if (!r.problems.length) { onClose(); return }
      setResult(Object.fromEntries(r.problems.map((p) => [p.channel_id, p.problems.join('；')])))
      setPicked(r.problems.map((p) => p.channel_id))
    } catch (e) { setError((e as Error).message) } finally { setRunning(false) }
  }

  /** 上传本机：每个文件存成本机文件，复制进内容文件夹的最外层（重名的在名字后面加序号），再选上 */
  const uploadLocal = async (list: File[]) => {
    if (!list.length) return
    setUploading(0); setError('')
    try {
      const taken = new Set((files ?? []).map((e) => e.path))
      const added: string[] = []
      for (const f of list) {
        const r = await uploadLocalFile(f, setUploading)
        const dot = f.name.lastIndexOf('.')
        const stem = dot > 0 ? f.name.slice(0, dot) : f.name, ext = dot > 0 ? f.name.slice(dot) : ''
        let to = f.name
        for (let i = 2; taken.has(to); i++) to = `${stem} ${i}${ext}`
        taken.add(to)
        // 不在 Annulo 里打开的页面传到的是素材网址，复制不进文件夹：直接用网址
        added.push(r.ref.startsWith('local:') ? (await runLocal<{ path: string }>('folder.importLocal', { article_id: article.id, url: r.ref, to })).path : r.ref)
      }
      // 先记下用户自己点过，不然文件列表一变，自动挑图、视频的会把刚传的换掉
      if (uploadFor === 'image') { setTouched((x) => ({ ...x, images: true })); setImages((l) => [...l, ...added.filter((p) => !l.some((m) => m.ref === p)).map(media)]) }
      if (uploadFor === 'video') { setTouched((x) => ({ ...x, video: true })); setVideo(media(added[0])) }
      if (uploadFor === 'cover') setCover(media(added[0]))
      const r = await runLocal<{ path: string; entries: Entry[] }>('folder.list', { article_id: article.id })
      setFiles(r.entries.filter((e) => !e.dir))
    } catch (e) { setError((e as Error).message) } finally { setUploading(null) }
  }
  /** 一栏右上角的按钮：上传本机、从资料库选 */
  const pickers = (what: 'image' | 'video' | 'cover') => <span className="flex gap-1">
    <Button size="sm" variant="ghost" disabled={uploading != null} onClick={() => { setUploadFor(what); fileInput.current?.click() }}>
      {uploading != null && uploadFor === what ? <Loader2 className="animate-spin" /> : <HardDrive />}{uploading != null && uploadFor === what ? t('uploading', { n: Math.round(uploading * 100) }) : t('upload_local')}
    </Button>
    <Button size="sm" variant="ghost" disabled={uploading != null} onClick={() => setPicker(what)}><Library />{t('from_library')}</Button>
  </span>
  const section = (label: string, extra?: ReactNode) => <div className="mb-1.5 flex items-center justify-between gap-2"><p className="text-sm font-medium">{label}</p>{extra}</div>
  const thumb = (m: Media, isVideo: boolean) => isVideo
    ? <video src={`${m.src}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" />
    : <img src={m.src} alt="" loading="lazy" className="size-full object-cover" />

  return (
    <Dialog open={open} onClose={onClose} title={t('title')} width={760} footer={<>
      {/* 什么时候发放在发布按钮旁边（照 X、LinkedIn）：默认现在发，点日历图标定时间，定了显示成标签、点 × 改回现在发 */}
      <span className="mr-auto min-w-0"><DateTimeChip value={at} onChange={setAt} disabled={running} label={tr('datetime.schedule')} /></span>
      <Button variant="ghost" size="sm" onClick={onClose}>{Object.keys(result).length ? t('close') : t('cancel')}</Button>
      <Button size="sm" disabled={running || !picked.length || !!missing} title={missing || undefined} onClick={() => void go()}>{running ? <Loader2 className="animate-spin" /> : <Send />}{at ? t('schedule_go', { n: picked.length }) : t('go', { n: picked.length })}</Button>
    </>}>
      {!files ? (error ? <Notice tone="error">{error}</Notice> : <Loader2 className="size-4 animate-spin text-muted-foreground" />) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t('as')}</span>
            <Segmented value={kind} onChange={setKind} options={[
              { value: 'post', label: <><ImageIcon className="size-3.5" />{t('kind_post')}</> },
              { value: 'video', label: <><Film className="size-3.5" />{t('kind_video')}</> },
              { value: 'article', label: <><Newspaper className="size-3.5" />{t('kind_article')}</> },
            ]} />
          </div>

          {/* 文字：标题、话题、正文都在这里改（只改这次发的，不改文件）；文件夹里的 md 点一下把内容填进来 */}
          <div>
            {section(kind === 'video' ? t('text_video') : t('text'))}
            {copies.length ? <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t('fill_from')}</span>
              {copies.map((e) => <button key={e.path} type="button" onClick={() => { setCopy(e.path); setFill((x) => x + 1) }} title={t('fill_hint')} className={cx('inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs', copy === e.path ? 'border-primary/50 bg-primary/10 text-primary-text' : 'border-border hover:bg-muted')}><FileText className="size-3.5 shrink-0" /><span className="truncate">{e.path}</span></button>)}
            </div> : <p className="text-xs text-muted-foreground">{t('no_md')}</p>}
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_200px]">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('title_ph')} className={cx(inputCls, 'h-8')} />
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('tags_ph')} className={cx(inputCls, 'h-8')} />
            </div>
            <div className="mt-2">
              {kind === 'article'
                ? (exts ? <RichEditor key={`${copy}:${mdVer}`} markdown extensions={exts} resolveSrc={resolveSrc} value={md} onChange={setMd} placeholder={t('body_ph')} /> : <Loader2 className="size-4 animate-spin text-muted-foreground" />)
                : <textarea value={plain} onChange={(e) => setPlain(e.target.value)} placeholder={t(kind === 'video' ? 'desc_ph' : 'body_ph')} className={cx(inputCls, 'min-h-40 resize-y py-2 leading-relaxed')} />}
            </div>
          </div>

          {kind === 'post' && <div>
            {section(t('images', { n: images.length }), pickers('image'))}
            {/* 选中的按顺序排（第一张是封面），点 × 拿掉；下面是文件夹里所有的图，点了加到最后 / 拿掉 */}
            {images.length ? <div className="flex flex-wrap gap-2">
              {images.map((m, i) => <div key={m.ref} className="group relative size-20 overflow-hidden rounded-md border border-border" title={m.name}>
                {thumb(m, false)}
                <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{i === 0 ? t('cover') : i + 1}</span>
                <button type="button" aria-label={t('remove')} onClick={() => { setTouched((x) => ({ ...x, images: true })); setImages((l) => l.filter((x) => x.ref !== m.ref)) }} className="absolute top-1 right-1 hidden cursor-pointer rounded bg-black/60 p-0.5 text-white group-hover:block"><X className="size-3" /></button>
              </div>)}
            </div> : <p className="text-xs text-muted-foreground">{t('no_images')}</p>}
            {folderImages.length > 0 && <>
              <p className="mt-3 mb-1.5 text-xs text-muted-foreground">{t('folder_images')}</p>
              <div className="flex flex-wrap gap-1.5">
                {folderImages.map((e) => { const on = images.some((m) => m.ref === e.path); return <button key={e.path} type="button" title={e.path} onClick={() => { setTouched((x) => ({ ...x, images: true })); setImages((l) => (on ? l.filter((m) => m.ref !== e.path) : [...l, media(e.path)])) }} className={cx('relative size-12 cursor-pointer overflow-hidden rounded border', on ? 'border-primary ring-2 ring-primary/40' : 'border-border opacity-70 hover:opacity-100')}>
                  <img src={workSrc(`${root}/${e.path}`)} alt="" loading="lazy" className="size-full object-cover" />
                  {on && <Check className="absolute right-0.5 bottom-0.5 size-3.5 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                </button> })}
              </div>
            </>}
          </div>}

          {kind === 'video' && <div>
            {section(t('video'), pickers('video'))}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {[...folderVideos.map((e) => ({ ...media(e.path), size: e.size })), ...(video && isUrl(video.ref) ? [{ ...video, size: 0 }] : [])].map((m) => <button key={m.ref} type="button" onClick={() => { setTouched((x) => ({ ...x, video: true })); setVideo(m) }} className={cx('cursor-pointer overflow-hidden rounded-md border text-left', video?.ref === m.ref ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:bg-muted')}>
                <div className="relative aspect-video bg-black/40">{thumb(m, true)}{video?.ref === m.ref && <Check className="absolute top-1.5 right-1.5 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}</div>
                <div className="px-2 py-1.5 text-xs"><div className="truncate">{m.name}</div>{m.size > 0 && <div className="text-muted-foreground">{fmtSize(m.size)}</div>}</div>
              </button>)}
            </div>
            {!folderVideos.length && !video && <p className="text-xs text-muted-foreground">{t('no_videos')}</p>}
          </div>}

          {coverUsed && <div>
            {section(t('video_cover'), pickers('cover'))}
            <p className="mb-2 text-xs text-muted-foreground">{t('video_cover_hint')}</p>
            <div className="flex flex-wrap items-start gap-2">
              <button type="button" onClick={() => setCover(null)} className={cx('flex h-24 w-[72px] cursor-pointer items-center justify-center rounded-md border px-1 text-center text-xs text-muted-foreground', !cover ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:bg-muted')}>{t('cover_default')}</button>
              {cover && <div className="relative h-24 w-[72px] overflow-hidden rounded-md border border-primary ring-2 ring-primary/40" title={cover.name}>
                <img src={cover.src} alt="" className="size-full object-cover" />
                <Check className="absolute top-1 right-1 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />
              </div>}
            </div>
            {folderImages.length > 0 && <>
              <p className="mt-3 mb-1.5 text-xs text-muted-foreground">{t('cover_folder')}</p>
              <div className="flex flex-wrap gap-1.5">
                {folderImages.map((e) => { const on = cover?.ref === e.path; return <button key={e.path} type="button" title={e.path} onClick={() => setCover(on ? null : media(e.path))} className={cx('relative size-12 cursor-pointer overflow-hidden rounded border', on ? 'border-primary ring-2 ring-primary/40' : 'border-border opacity-70 hover:opacity-100')}>
                  <img src={workSrc(`${root}/${e.path}`)} alt="" loading="lazy" className="size-full object-cover" />
                  {on && <Check className="absolute right-0.5 bottom-0.5 size-3.5 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                </button> })}
              </div>
            </>}
          </div>}

          <div>
            {section(t('accounts'))}
            {!accounts.length ? <Notice>{t('no_accounts')}<button type="button" className="ml-1 cursor-pointer text-primary-text hover:underline" onClick={() => { onClose(); ctx.go('channels') }}>{t('go_add')}</button></Notice>
              : <div className="max-h-64 space-y-1 overflow-y-auto">{[...accounts].sort((a, b) => Number(!!blocked(a)) - Number(!!blocked(b))).map((ch) => {
                const why = blocked(ch)
                const { length, max } = lengthOn(content, ch.type)
                const note = result[ch.id] ? <span className="text-destructive">{result[ch.id]}</span>
                  : why || (max > 0 && length > max ? <span className="text-amber-700 dark:text-amber-400">{t('too_long', { n: length, max })}</span> : CHANNEL_TYPES[ch.type]?.label)
                return <label key={ch.id} className={cx('flex items-center gap-3 rounded-lg border px-3 py-2', why ? 'cursor-default border-border opacity-60' : picked.includes(ch.id) ? 'cursor-pointer border-primary/50 bg-primary/5' : 'cursor-pointer border-border hover:bg-accent/50')}>
                  <input type="checkbox" disabled={!!why || running} checked={picked.includes(ch.id)} onChange={() => setPicked((l) => l.includes(ch.id) ? l.filter((x) => x !== ch.id) : [...l, ch.id])} className="size-4 accent-primary" />
                  <ChannelAvatar ch={ch} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{ch.name}</span><span className="block text-xs leading-relaxed text-muted-foreground">{note}</span></span>
                  {result[ch.id] && <Badge tone="bad">{t('not_passed')}</Badge>}
                </label>
              })}</div>}
          </div>

          {missing && <p className="text-xs text-amber-700 dark:text-amber-400">{missing}</p>}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
      <input ref={fileInput} type="file" className="hidden" multiple={uploadFor === 'image'} accept={uploadFor === 'video' ? 'video/*' : 'image/*'} onChange={(e) => { void uploadLocal([...(e.target.files ?? [])]); e.target.value = '' }} />
      <AssetPicker open={!!picker} kind={picker === 'video' ? 'video' : 'image'} max={picker === 'image' ? undefined : 1} onClose={() => setPicker(null)} onPick={(urls) => {
        if (picker === 'video' && urls[0]) { setTouched((x) => ({ ...x, video: true })); setVideo(media(urls[0])) }
        if (picker === 'cover' && urls[0]) setCover(media(urls[0]))
        if (picker === 'image') { setTouched((x) => ({ ...x, images: true })); setImages((l) => [...l, ...urls.filter((u) => !l.some((m) => m.ref === u)).map(media)]) }
        setPicker(null)
      }} />
    </Dialog>
  )
}
