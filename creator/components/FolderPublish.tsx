import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronDown, Crop, FileText, Film, Hand, HardDrive, Image as ImageIcon, Library, Loader2, Newspaper, Play, Send, Wand2, X } from 'lucide-react'
import AssetPicker from './AssetPicker'
import ImageCropper from './ImageCropper'
import Lightbox from './Lightbox'
import RichEditor from './RichEditor'
import Sortable from './Sortable'
import { ChannelAvatar, PlatformTag } from './ArticlePublish'
import { Badge, Button, Dialog, Notice, Segmented, cx, fmtTime, inputCls, toast } from './ui'
import { DateTimeChip } from './DateTimePicker'
import { IMAGE, MD, VIDEO, base, fmtSize, folderMediaFor, isDraft, joinPath, parent, workSrc, type Entry } from './Folder'
import { enqueue } from '../lib/publishQueue'
import { fileSrc } from '../lib/files'
import { tr, useT } from '../lib/i18n'
import { dbList, isSite, openChat, runLocal, runTask, uploadLocalFile, type Article } from '../lib/shuttle'
import { setupPublish } from './PublishTargets'
import { CHANNEL_TYPES } from '../lib/channels'
import { SOCIAL, loggedInElsewhere, useElsewhere } from '../lib/social'
import { FIELDS } from '../plugins/social/local/_fields'
import { lengthOn, supports } from '../local/_types'
import type { Ctx } from './views/types'

// 发布（自媒体的内容文件夹，docs/content-model.md「发布是挑选」）：内容本身没有类型，发的时候挑这次发成什么、用哪些文件。
//   发成：图文（文字 + 一组图）/ 视频（简介 + 一个视频）/ 长文（Markdown 转成富文本，图在正文里）。打开时按文件夹里有什么猜一个。
//   文字：从文件夹里挑一份 .md（开头 --- 包住的 title、tags 填进标题和话题，能当场改）；
//   图片、视频：文件夹里的直接点选，也能从资料库选。挑了文案自动配上和它在同一个目录的图、视频（用户自己点过的不动）。
//   三样都能「上传本机」：传上来的文件复制进这条内容的文件夹（folder.importLocal），和文件夹里原有的一样点选、发布。
//   视频封面（插件 FIELDS 的 videoCover）：平台要的比例不一样（FIELDS 的 coverRatio：小红书、抖音 3:4，B站 4:3），按勾的账号分成几组、每组挑一张，
//   文件夹里的图点选或从资料库选；默认用名字带「封面 / cover」、比例对得上这组的图，没有就用内容上设过的或最新的那张「封面」，都没有用平台默认的那一帧。
//   比例不对的提示会被裁，能当场裁（ImageCropper，裁好的存进文件夹），裁了不合适再交给 AI 重做。
//   填好交给我（FIELDS 的 handOver）：发布按钮的下拉里选（PublishButton）：勾的账号插件都只在浏览器里填好不点发布，窗口交给用户自己调（封面、合集…）、自己发；
//   不能这么做的平台（X、LinkedIn…）这时不能勾，排期的也不行（到点没人接手）。
// 选好账号、现在发或排期：folder.publish 每个账号新建一条帖子（存的就是这次挑的内容，排期到点照它发），放进后台发布队列。

/** 文案：名字带「文案 / copy」的 md，或者开头写了 title 的 md（见组件里的 isCopy）；成片：名字带「成片 / final」的视频（挑选规则，弹窗里有说明） */
/** 开头 --- 包住的那几行里写了 title（文案的写法）；正文第一行的 # 标题不算，分镜、说明文档也常这样开头 */
const frontTitle = (text: string) => { const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); return !!m && /^title:\s*\S/m.test(m[1]) }
const copyName = (p: string) => /文案|copy/i.test(p.split('/').pop() ?? '')
const isFinal = (p: string) => /成片|final/i.test(p.split('/').pop() ?? '')

type Kind = 'post' | 'video' | 'article'

/** 选中的图片、视频：文件夹里的是相对路径，资料库的是地址 */
type Media = { ref: string; src: string; name: string }

const isUrl = (u: string) => /^(https?:\/\/|\/_(annulo|shuttle)\/uploaded\/|local:|folder:|work:)/.test(u)

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

/** 封面比例的组：'3:4'；没写比例的平台归到 'any'（不检查比例） */
const ratioKey = (r?: [number, number]) => (r ? `${r[0]}:${r[1]}` : 'any')
/** 图片的宽高比和要的比例差多少算「会被裁」：3% 以内看不出来 */
const offRatio = (d: { w: number; h: number } | undefined, r?: [number, number]) => !!d && !!r && Math.abs(d.w / d.h - r[0] / r[1]) / (r[0] / r[1]) > 0.03
/** 图片的比例写成人看得懂的（1080×1920 → 9:16），认不出常见比例就写宽×高 */
const ratioText = (d: { w: number; h: number }) => {
  for (const [a, b] of [[1, 1], [3, 4], [4, 3], [9, 16], [16, 9], [2, 3], [3, 2], [4, 5], [5, 4], [21, 9]]) if (Math.abs(d.w / d.h - a / b) / (a / b) < 0.03) return `${a}:${b}`
  return `${d.w}×${d.h}`
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
  // 视频封面：按比例分组（ratioKey），每组一张；没在 covers 里的组用 autoCover 挑的，null 是平台默认的那一帧
  const [baseCover, setBaseCover] = useState<Media | null>(null)
  const [covers, setCovers] = useState<Record<string, Media | null>>({})
  // 文件夹里的图、上传、资料库选的封面给哪一组（只有一组时就是它）
  const [coverKey, setCoverKey] = useState('')
  // 图片的宽高（封面比例检查用）：文件夹里的图在缩略图加载时记下，别的用到时读
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({})
  const noteDim = (ref: string, w: number, h: number) => { if (w && h) setDims((d) => (d[ref]?.w === w && d[ref]?.h === h ? d : { ...d, [ref]: { w, h } })) }
  const [cropping, setCropping] = useState<{ key: string; ratio: [number, number]; m: Media } | null>(null)
  // 填好交给我（发布按钮的下拉）：只填不发，窗口交给用户；排期时不算
  const [handMode, setHandMode] = useState(false)
  const [picker, setPicker] = useState<'image' | 'video' | 'cover' | null>(null)
  // 上传本机：给哪一栏传（配图可以一次传几张），进度 0–1，null 是没在传
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploadFor, setUploadFor] = useState<'image' | 'video' | 'cover'>('image')
  const [uploading, setUploading] = useState<number | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  // 定时发布的时间（本地时间 'YYYY-MM-DDTHH:mm'），空的是现在发
  const [at, setAt] = useState('')
  const handing = handMode && !at
  const [result, setResult] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  // 预览（视频卡片上的播放按钮）：大窗口播一遍，看对了再选
  const [preview, setPreview] = useState('')

  const media = (ref: string): Media => ({ ref, src: isUrl(ref) ? fileSrc(ref) : workSrc(`${root}/${ref}`), name: isUrl(ref) ? t('from_library') : ref })
  const folderImages = useMemo(() => (files ?? []).filter((e) => IMAGE.test(e.path)).sort((a, b) => a.path.localeCompare(b.path, 'zh', { numeric: true })), [files])
  // 挑选规则（弹窗里写给人看，人自己整理文件时照着起名）：名字带「成片」的视频优先、默认选上；名字带「文案」的 md 排前面、默认用它，
  // 其余 md（分镜、脚本…）收进「更多」，没有带「文案」的就全摆出来
  // 开头写了 title 的 md 也算文案（文件名随手起的也能认出来）；打开时读一遍每份 md 的开头
  const [titled, setTitled] = useState<Set<string>>(new Set())
  const userPicked = useRef(false)
  // 打开时定下的那个视频：用户没自己点文案之前，视频就用它（不再按文案的目录重新挑，免得配到别的版本）
  const autoVideo = useRef('')
  const isCopy = (p: string) => copyName(p) || titled.has(p)
  const folderVideos = useMemo(() => (files ?? []).filter((e) => VIDEO.test(e.path)).sort((a, b) => Number(isFinal(b.path)) - Number(isFinal(a.path)) || b.mtime - a.mtime), [files])
  const copies = useMemo(() => (files ?? []).filter((e) => MD.test(e.path) && !isDraft(e.path)).sort((a, b) => Number(isCopy(b.path)) - Number(isCopy(a.path))), [files, titled])
  const [moreCopies, setMoreCopies] = useState(false)
  const named = copies.filter((e) => isCopy(e.path))
  const shownCopies = !named.length || moreCopies ? copies : copies.filter((e) => isCopy(e.path) || e.path === copy)
  const hiddenCopies = copies.length - shownCopies.length

  // 这条内容已经发过 / 排期到哪些账号：账号列表里提示「已发布 · 1 天前」「已排期 · 10月20日 9:00」，免得同一份重复发
  const [sent, setSent] = useState<Record<string, { status: string; at?: string }>>({})
  useEffect(() => {
    if (!open) return
    setSent({})
    // 网站的发布记录在 publications（没加过网站的项目这张表是空的）
    Promise.all([dbList('social_posts'), dbList('publications').catch(() => [])]).then(([posts, pubs]) => {
      const m: Record<string, { status: string; at?: string }> = {}
      for (const p of [...posts, ...pubs].filter((p) => p.article_id === article.id && (p.status === 'published' || p.status === 'scheduled'))) {
        const at = p.status === 'published' ? p.published_at : p.scheduled_at
        const had = m[p.channel_id]
        if (!had || (had.status !== 'published' && p.status === 'published') || (had.status === p.status && (at ?? '') > (had.at ?? ''))) m[p.channel_id] = { status: p.status, at }
      }
      setSent(m)
    }).catch(() => {})
  }, [open, article.id])

  // 打开时：读文件夹，猜发成什么，挑文案（名字带「文案 / copy」的优先，再是离视频近的），配好图、视频
  useEffect(() => {
    if (!open) return
    setFiles(null); setError(''); setResult({}); setPicked([]); setHandMode(false); setCovers({}); setCoverKey(''); setAt(''); setMoreCopies(false); setTitled(new Set()); userPicked.current = false; setTouched({ images: false, video: false })
    runLocal<{ path: string; entries: Entry[] }>('folder.list', { article_id: article.id }).then((r) => {
      const fs = r.entries.filter((e) => !e.dir)
      setRoot(r.path)
      setFiles(fs)
      const named = fs.filter((e) => IMAGE.test(e.path) && /封面|cover/i.test(base(e.path))).sort((a, b) => b.mtime - a.mtime)[0]
      setBaseCover(article.video_cover ? { ref: article.video_cover, src: fileSrc(article.video_cover), name: t('from_library') } : named ? { ref: named.path, src: workSrc(`${r.path}/${named.path}`), name: named.path } : null)
      const k = guessKind(fs)
      setKind(k)
      const mds = fs.filter((e) => MD.test(e.path) && !isDraft(e.path))
      // 先定视频（名字带「成片」的优先，再是最近改的），再挑离它最近的文案：默认选中的文案和视频是配套的（同一个版本目录里的）
      const vid = fs.filter((e) => VIDEO.test(e.path)).sort((a, b) => Number(isFinal(b.path)) - Number(isFinal(a.path)) || b.mtime - a.mtime)[0]
      autoVideo.current = vid?.path ?? ''
      return Promise.all(mds.map((e) => runLocal<{ text: string }>('folder.read', { article_id: article.id, path: e.path }).then((x) => (frontTitle(x.text) ? e.path : '')).catch(() => ''))).then((hits) => {
        const ok = new Set(hits.filter(Boolean))
        setTitled(ok)
        const score = (e: Entry) => (copyName(e.path) || ok.has(e.path) ? 0 : 10) + (vid ? near(parent(vid.path), e.path) : 0)
        if (!userPicked.current) setCopy([...mds].sort((a, b) => score(a) - score(b) || b.mtime - a.mtime)[0]?.path ?? '')
      })
    }).catch((e) => setError((e as Error).message))
  }, [open, article.id])

  // 点了一份 md：把它的标题、话题、正文填进来（覆盖现在的）；没手动挑过的图、视频换成离它最近的
  useEffect(() => {
    if (!open) return
    void import('./rich/mdExtensions').then((x) => setExts(x.default))
    if (!copy) { setMd(''); setPlain(''); setMdVer((v) => v + 1); setTitle(article.title); setTags(''); return }
    let stale = false
    Promise.all([runLocal<{ text: string }>('folder.read', { article_id: article.id, path: copy }), import('../lib/mdhtml')]).then(([r, m]) => {
      if (stale) return
      const c = parseCopy(r.text)
      setMd(c.body)
      setPlain(htmlPlain(m.mdToHtml(c.body)))
      setMdVer((v) => v + 1)
      setTitle(c.title || article.title)
      setTags(c.tags.join(', '))
    }).catch((e) => setError((e as Error).message))
    return () => { stale = true }
  }, [copy, fill, article.id, open])
  useEffect(() => {
    if (!files) return
    const dir = copy ? parent(copy) : ''
    if (!touched.images) {
      const best = Math.min(...folderImages.map((e) => near(dir, e.path)), 9)
      setImages(folderImages.filter((e) => near(dir, e.path) === best).slice(0, 18).map((e) => media(e.path)))
    }
    if (!touched.video) {
      const v = (!userPicked.current && autoVideo.current && folderVideos.find((e) => e.path === autoVideo.current)) || [...folderVideos].sort((a, b) => near(dir, a.path) - near(dir, b.path) || Number(isFinal(b.path)) - Number(isFinal(a.path)) || b.mtime - a.mtime)[0]
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
  // 网站（creght 站点、WordPress）在前，只发长文，跑网站自己的发布脚本（core/features/websites 的 publishing）
  const accounts = [...ctx.channels.filter(isSite), ...ctx.channels.filter((ch) => !!SOCIAL[ch.type])]
  const siteNotReady = (ch: (typeof accounts)[number]) => isSite(ch) && (ch.publish_status !== 'ready' || !ch.publisher)
  // 能设封面的账号：视频的封面（videoCover：小红书、抖音、B站），长文的文章封面（articleCover：知乎）
  const takesCover = (type: string) => (kind === 'video' ? !!FIELDS[type]?.videoCover : kind === 'article' && !!FIELDS[type]?.articleCover)
  const coverUsed = accounts.some((ch) => takesCover(ch.type))
  // 封面分组：勾了能设封面的账号就按它们分，没勾就按所有能设封面的账号先摆出来
  const coverAccounts = accounts.filter((ch) => takesCover(ch.type))
  const coverPicked = coverAccounts.filter((ch) => picked.includes(ch.id))
  const coverGroups = (() => {
    const m = new Map<string, { key: string; ratio?: [number, number]; platforms: string[] }>()
    for (const ch of coverPicked.length ? coverPicked : coverAccounts) {
      const ratio = FIELDS[ch.type]?.coverRatio
      const g = m.get(ratioKey(ratio)) ?? { key: ratioKey(ratio), ratio, platforms: [] }
      const label = CHANNEL_TYPES[ch.type as keyof typeof CHANNEL_TYPES]?.label ?? ch.type
      if (!g.platforms.includes(label)) g.platforms.push(label)
      m.set(g.key, g)
    }
    return [...m.values()]
  })()
  const activeKey = coverGroups.some((g) => g.key === coverKey) ? coverKey : coverGroups[0]?.key ?? ''
  // 文件夹里名字带「封面」的图（新的在前）：比例对得上这组的优先当默认
  const namedCovers = useMemo(() => folderImages.filter((e) => /封面|cover/i.test(base(e.path))).sort((a, b) => b.mtime - a.mtime), [folderImages])
  const coverOf = (key: string, ratio?: [number, number]): Media | null => {
    if (key in covers) return covers[key]
    const fit = ratio && namedCovers.find((e) => dims[e.path] && !offRatio(dims[e.path], ratio))
    return fit ? media(fit.path) : baseCover
  }
  const setCover = (m: Media | null, key = activeKey) => setCovers((c) => ({ ...c, [key]: m }))
  // 名字带「封面」的图和选中的封面先量好宽高：挑默认、提示会不会被裁都要用
  useEffect(() => {
    if (!coverUsed) return
    const want = [...namedCovers.map((e) => media(e.path)), ...coverGroups.map((g) => coverOf(g.key, g.ratio)).filter((m): m is Media => !!m)]
    for (const m of want) {
      if (dims[m.ref]) continue
      const i = new Image()
      i.onload = () => noteDim(m.ref, i.naturalWidth, i.naturalHeight)
      i.src = m.src
    }
  }, [coverUsed, namedCovers, covers, baseCover, root])
  const blocked = (ch: (typeof accounts)[number]) => isSite(ch) ? (kind !== 'article' ? t('site_article_only') : handing ? t('manual_cant') : siteNotReady(ch) ? t('site_setup') : '')
    : !supports(FIELDS[ch.type], kind) ? t('unsupported', { kind: t(`kind_${kind}`) })
    : handing && !FIELDS[ch.type]?.handOver ? t('manual_cant')
    : loggedInElsewhere(ch, machine) ? t('on_machine', { name: loggedInElsewhere(ch, machine) })
    : ch.login_status === 'expired' ? t('expired') : ''
  // 换了发成什么：不支持的账号取消勾选
  useEffect(() => { setPicked((l) => l.filter((id) => { const ch = accounts.find((c) => c.id === id); return ch && !blocked(ch) })) }, [kind, handing])
  const content = { type: kind, title, body, tags: JSON.stringify(tagList), images: JSON.stringify(images.map((i) => i.ref)), video: video?.ref ?? '' }

  /** 每个勾了的、能设封面的账号用它那一组的封面 */
  const coverCovers = () => Object.fromEntries(coverPicked.map((ch) => { const r = FIELDS[ch.type]?.coverRatio; return [ch.id, coverOf(ratioKey(r), r)?.ref ?? ''] }))
  const missing = kind === 'post' && !images.length ? t('need_images') : kind === 'video' && !video ? t('need_video') : !body.trim() && kind !== 'video' ? t('need_text') : ''
  const go = async () => {
    setRunning(true); setError('')
    const ts = at ? Date.parse(at) : 0
    if (at && !(ts > Date.now())) { setError(t('future_time')); setRunning(false); return }
    try {
      const r = await runLocal<{ ready: { channel_id: string; post_id?: string; publisher?: string }[]; problems: { channel_id: string; problems: string[] }[] }>('folder.publish', {
        article_id: article.id, kind, title, body, tags: tagList, images: images.map((i) => i.ref), video: video?.ref ?? '',
        ...(coverUsed ? { video_cover: coverOf(coverGroups[0]?.key ?? '', coverGroups[0]?.ratio)?.ref ?? '', video_covers: coverCovers() } : {}),
        channel_ids: picked, ...(ts ? { scheduled_at: new Date(ts).toISOString() } : {}),
      })
      const name = (id: string) => accounts.find((c) => c.id === id)?.name ?? ''
      // 交给我的排在最后：它要等人在窗口里点发布（最多 30 分钟），别让自动发的跟着等
      const handed = !ts && handMode
      if (!ts && r.ready.length) enqueue(r.ready.map((p) => ({ article_id: article.id, article_title: title || article.title, channel_id: p.channel_id, channel_name: name(p.channel_id), post_id: p.post_id, publisher: p.publisher, ...(handed ? { manual: true as const } : {}) })))
      if (r.ready.length) toast(ts ? t('scheduled_toast', { n: r.ready.length }) : handed ? t('manual_toast', { n: r.ready.length }) : t('started_toast', { n: r.ready.length }))
      if (!r.problems.length) { onClose(); return }
      setResult(Object.fromEntries(r.problems.map((p) => [p.channel_id, p.problems.join('；')])))
      setPicked(r.problems.map((p) => p.channel_id))
    } catch (e) { setError((e as Error).message) } finally { setRunning(false) }
  }

  /** 上传本机：每个文件存成本机文件，复制进内容文件夹的最外层（重名的在名字后面加序号），再选上（what 是给哪一栏，封面给 key 那一组） */
  const uploadLocal = async (list: File[], what = uploadFor, key = activeKey) => {
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
      if (what === 'image') { setTouched((x) => ({ ...x, images: true })); setImages((l) => [...l, ...added.filter((p) => !l.some((m) => m.ref === p)).map(media)]) }
      if (what === 'video') { setTouched((x) => ({ ...x, video: true })); setVideo(media(added[0])) }
      if (what === 'cover') setCover(media(added[0]), key)
      const r = await runLocal<{ path: string; entries: Entry[] }>('folder.list', { article_id: article.id })
      setFiles(r.entries.filter((e) => !e.dir))
    } catch (e) { setError((e as Error).message) } finally { setUploading(null) }
  }
  /** 裁好的封面存进文件夹（「原名 3x4.jpg」，和上传本机一样复制进最外层），选给裁的那一组 */
  const saveCrop = async (image: Blob) => {
    const c = cropping
    if (!c) return
    const stem = isUrl(c.m.ref) ? t('cover_file') : base(c.m.ref).replace(/\.[^.]+$/, '')
    setUploadFor('cover')
    setCoverKey(c.key)
    await uploadLocal([new File([image], `${stem} ${c.ratio[0]}x${c.ratio[1]}.jpg`, { type: 'image/jpeg' })], 'cover', c.key)
    setCropping(null)
  }
  /** 裁了不合适：交给 AI 照这个比例重做一张，放进文件夹（在这条内容上做，右侧看过程）；做好再回来选 */
  const redoCover = async (g: { key: string; platforms: string[] }) => {
    try {
      const r = await runTask('work-on-content', { article_id: article.id, note: t('cover_redo_note', { ratio: g.key, platforms: g.platforms.join('、') }) })
      openChat(r.chat_id)
      toast(t('cover_redo_started'))
    } catch (e) { setError((e as Error).message) }
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
      <PublishButton hand={handMode} onHand={setHandMode} scheduled={!!at} disabled={running || !picked.length || !!missing} running={running} title={missing || undefined} onClick={() => void go()}
        label={at ? t('schedule_go', { n: picked.length }) : handing ? t('manual_go', { n: picked.length }) : t('go', { n: picked.length })} />
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
              {shownCopies.map((e) => <button key={e.path} type="button" onClick={() => { userPicked.current = true; setCopy(e.path); setFill((x) => x + 1) }} title={t('fill_hint')} className={cx('inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs', copy === e.path ? 'border-primary/50 bg-primary/10 text-primary-text' : 'border-border hover:bg-muted')}><FileText className="size-3.5 shrink-0" /><span className="truncate">{e.path}</span></button>)}
              {hiddenCopies > 0 && <button type="button" onClick={() => setMoreCopies(true)} className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">{t('more_copies', { n: hiddenCopies })}</button>}
            </div> : <p className="text-xs text-muted-foreground">{t('no_md')}</p>}
            <p className="mt-1.5 text-xs text-muted-foreground">{t('copy_rule')}</p>
            {/* 每个框上面写它是什么：填进去以后 placeholder 就看不到了，光看内容分不清哪个是标题、哪个是话题 */}
            <label className="mt-3 block space-y-1"><span className="block text-xs text-muted-foreground">{t('title_ph')}</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('title_ph')} className={cx(inputCls, 'h-8')} /></label>
            <div className="mt-2 space-y-1">
              <span className="block text-xs text-muted-foreground">{t(kind === 'video' ? 'desc_ph' : 'body_ph')}</span>
              {kind === 'article'
                ? (exts ? <RichEditor key={`${copy}:${mdVer}`} markdown extensions={exts} resolveSrc={resolveSrc} folderMedia={folderMediaFor(root, parent(copy), files ?? [])} value={md} onChange={setMd} placeholder={t('body_ph')} /> : <Loader2 className="size-4 animate-spin text-muted-foreground" />)
                : <textarea value={plain} onChange={(e) => setPlain(e.target.value)} placeholder={t(kind === 'video' ? 'desc_ph' : 'body_ph')} className={cx(inputCls, 'min-h-40 resize-y py-2 leading-relaxed')} />}
            </div>
            {/* 话题单独一行，放在正文后面（和发出去的样子一样：正文在前、话题在后） */}
            <label className="mt-2 block space-y-1"><span className="block text-xs text-muted-foreground">{t('tags_label')}</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('tags_ph')} className={cx(inputCls, 'h-8')} /></label>
          </div>

          {kind === 'post' && <div>
            {section(t('images', { n: images.length }), pickers('image'))}
            {/* 选中的按顺序排（第一张是封面），拖动换顺序，点 × 拿掉；下面是文件夹里所有的图，点了加到最后 / 拿掉 */}
            {images.length ? <Sortable items={images} keyOf={(m) => m.ref} onChange={(l) => { setTouched((x) => ({ ...x, images: true })); setImages(l) }} className="flex flex-wrap gap-2">
              {(m, i) => <div className="group relative size-20 overflow-hidden rounded-md border border-border" title={`${m.name}\n${t('drag_to_sort')}`}>
                {thumb(m, false)}
                <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{i === 0 ? t('cover') : i + 1}</span>
                <button type="button" aria-label={t('remove')} onClick={() => { setTouched((x) => ({ ...x, images: true })); setImages((l) => l.filter((x) => x.ref !== m.ref)) }} className="absolute top-1 right-1 hidden cursor-pointer rounded bg-black/60 p-0.5 text-white group-hover:block"><X className="size-3" /></button>
              </div>}
            </Sortable> : <p className="text-xs text-muted-foreground">{t('no_images')}</p>}
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
              {[...folderVideos.map((e) => ({ ...media(e.path), size: e.size })), ...(video && isUrl(video.ref) ? [{ ...video, size: 0 }] : [])].map((m) => <div key={m.ref} role="button" tabIndex={0} onClick={() => { setTouched((x) => ({ ...x, video: true })); setVideo(m) }} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setTouched((x) => ({ ...x, video: true })); setVideo(m) } }} className={cx('group cursor-pointer overflow-hidden rounded-md border text-left', video?.ref === m.ref ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:bg-muted')}>
                <div className="relative aspect-video bg-black/40">{thumb(m, true)}{video?.ref === m.ref && <Check className="absolute top-1.5 right-1.5 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                  {/* 播放：先看一眼再决定选不选（只预览，不选中） */}
                  <button type="button" aria-label={t('preview')} title={t('preview')} onClick={(ev) => { ev.stopPropagation(); setPreview(m.src) }} className="absolute inset-0 m-auto flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/80"><Play className="size-4 fill-current" /></button>
                </div>
                <div className="px-2 py-1.5 text-xs" title={m.name}><div className="line-clamp-2 break-all">{m.name}</div>{m.size > 0 && <div className="text-muted-foreground">{fmtSize(m.size)}</div>}</div>
              </div>)}
            </div>
            {!folderVideos.length && !video && <p className="text-xs text-muted-foreground">{t('no_videos')}</p>}
            {folderVideos.length > 1 && <p className="mt-1.5 text-xs text-muted-foreground">{t('video_rule')}</p>}
          </div>}

          {coverUsed && <div>
            {section(t(kind === 'article' ? 'article_cover' : 'video_cover'), pickers('cover'))}
            <p className="mb-2 text-xs text-muted-foreground">{t(kind === 'article' ? 'article_cover_hint' : 'video_cover_hint')}</p>
            {/* 每种比例一组（小红书、抖音 3:4，B站 4:3）：几组时点哪组，下面的图、上传、资料库就给哪组 */}
            <div className="space-y-2">{coverGroups.map((g) => {
              const m = coverOf(g.key, g.ratio)
              const d = m ? dims[m.ref] : undefined
              const off = offRatio(d, g.ratio)
              const many = coverGroups.length > 1
              const on = many && g.key === activeKey
              const w = g.ratio ? Math.round((96 * g.ratio[0]) / g.ratio[1]) : 72
              return <div key={g.key} onClick={() => setCoverKey(g.key)} className={cx('flex flex-wrap items-start gap-3 rounded-lg border p-2', on ? 'border-primary/50 bg-primary/5' : 'border-border', many && 'cursor-pointer')}>
                <div className="w-24 shrink-0 pt-0.5">
                  <div className="text-sm font-medium">{g.ratio ? t('cover_group', { ratio: g.key }) : t(kind === 'article' ? 'article_cover' : 'video_cover')}</div>
                  <div className="text-xs leading-relaxed text-muted-foreground">{g.platforms.join('、')}</div>
                </div>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); setCoverKey(g.key); setCover(null, g.key) }} style={{ width: w }} className={cx('flex h-24 shrink-0 cursor-pointer items-center justify-center rounded-md border px-1 text-center text-xs text-muted-foreground', !m ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:bg-muted')}>{t('cover_default')}</button>
                {m && <div style={{ width: w }} className="relative h-24 shrink-0 overflow-hidden rounded-md border border-primary bg-black ring-2 ring-primary/40" title={m.name}>
                  <img src={m.src} alt="" onLoad={(ev) => noteDim(m.ref, ev.currentTarget.naturalWidth, ev.currentTarget.naturalHeight)} className="size-full object-cover" />
                  <Check className="absolute top-1 right-1 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />
                </div>}
                {/* 比例不对：平台会裁掉一块，先在这里裁，裁了不合适再交给 AI 重做；比例对的也能裁（调构图） */}
                {m && g.ratio && <div className="min-w-0 flex-1 basis-48 space-y-1.5">
                  {off && d && <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{t('cover_off', { now: ratioText(d), ratio: g.key, platforms: g.platforms.join('、') })}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant={off ? 'outline' : 'ghost'} feedback={false} onClick={(ev) => { ev.stopPropagation(); setCropping({ key: g.key, ratio: g.ratio!, m }) }}><Crop />{t('crop_go', { ratio: g.key })}</Button>
                    {off && <Button size="sm" variant="ghost" feedback={false} needsShuttle onClick={(ev) => { ev.stopPropagation(); void redoCover(g) }}><Wand2 />{t('cover_redo')}</Button>}
                  </div>
                </div>}
              </div>
            })}</div>
            {folderImages.length > 0 && <>
              <p className="mt-3 mb-1.5 text-xs text-muted-foreground">{coverGroups.length > 1 ? t('cover_folder_for', { ratio: activeKey }) : t('cover_folder')}</p>
              <div className="flex flex-wrap gap-1.5">
                {folderImages.map((e) => { const on = coverOf(activeKey, coverGroups.find((g) => g.key === activeKey)?.ratio)?.ref === e.path; return <button key={e.path} type="button" title={e.path} onClick={() => setCover(on ? null : media(e.path))} className={cx('relative size-12 cursor-pointer overflow-hidden rounded border', on ? 'border-primary ring-2 ring-primary/40' : 'border-border opacity-70 hover:opacity-100')}>
                  <img src={workSrc(`${root}/${e.path}`)} alt="" loading="lazy" onLoad={(ev) => noteDim(e.path, ev.currentTarget.naturalWidth, ev.currentTarget.naturalHeight)} className="size-full object-cover" />
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
                const { length, max } = isSite(ch) ? { length: 0, max: 0 } : lengthOn(content, ch.type)
                const was = sent[ch.id]
                const note = result[ch.id] ? <span className="text-destructive">{result[ch.id]}</span>
                  : why || (max > 0 && length > max ? <span className="text-amber-700 dark:text-amber-400">{t('too_long', { n: length, max })}</span>
                    : was ? <span className="text-primary-text">{t(was.status === 'published' ? 'sent_before' : 'scheduled_before', { at: fmtTime(was.at) })}</span>
                    : '')
                return <label key={ch.id} className={cx('flex items-center gap-3 rounded-lg border px-3 py-2', why ? 'cursor-default border-border opacity-60' : picked.includes(ch.id) ? 'cursor-pointer border-primary/50 bg-primary/5' : 'cursor-pointer border-border hover:bg-accent/50')}>
                  <input type="checkbox" disabled={!!why || running} checked={picked.includes(ch.id)} onChange={() => setPicked((l) => l.includes(ch.id) ? l.filter((x) => x !== ch.id) : [...l, ch.id])} className="size-4 accent-primary" />
                  <ChannelAvatar ch={ch} />
                  <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{ch.name}</span><PlatformTag type={ch.type} /></span><span className="block text-xs leading-relaxed text-muted-foreground">{note}</span></span>
                  {/* 网站没配好发布方式：交给助手配置（写发布脚本），配完回来就能勾 */}
                  {siteNotReady(ch) && kind === 'article' && <Button size="sm" variant="outline" needsShuttle onClick={(e) => { e.preventDefault(); void setupPublish(ch.id) }}>{t('site_setup_btn')}</Button>}
                  {result[ch.id] && <Badge tone="bad">{t('not_passed')}</Badge>}
                </label>
              })}</div>}
          </div>

          {missing && <p className="text-xs text-amber-700 dark:text-amber-400">{missing}</p>}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
      <input ref={fileInput} type="file" className="hidden" multiple={uploadFor === 'image'} accept={uploadFor === 'video' ? 'video/*' : 'image/*'} onChange={(e) => { void uploadLocal([...(e.target.files ?? [])]); e.target.value = '' }} />
      {preview && <Lightbox src={preview} video onClose={() => setPreview('')} />}
      {cropping && <ImageCropper open src={cropping.m.src} ratio={cropping.ratio} onClose={() => setCropping(null)} onDone={saveCrop} />}
      <AssetPicker open={!!picker} kind={picker === 'video' ? 'video' : 'image'} max={picker === 'image' ? undefined : 1} onClose={() => setPicker(null)} onPick={(urls) => {
        if (picker === 'video' && urls[0]) { setTouched((x) => ({ ...x, video: true })); setVideo(media(urls[0])) }
        if (picker === 'cover' && urls[0]) setCover(media(urls[0]))
        if (picker === 'image') { setTouched((x) => ({ ...x, images: true })); setImages((l) => [...l, ...urls.filter((u) => !l.some((m) => m.ref === u)).map(media)]) }
        setPicker(null)
      }} />
    </Dialog>
  )
}

/**
 * 发布按钮带一个下拉（照顶栏的项目切换：图标块、两行字、选中的打勾）：「发布」直接发出去，「填好交给我」只在浏览器里填好、窗口交给用户调了再发。
 * 选的是这次怎么发，按钮上的字跟着变；排期时只能直接发（到点没人接手），下拉里那一项灰掉、写明原因
 */
function PublishButton({ hand, onHand, scheduled, disabled, running, title, label, onClick }: { hand: boolean; onHand: (v: boolean) => void; scheduled: boolean; disabled: boolean; running: boolean; title?: string; label: string; onClick: () => void }) {
  const { t } = useT('fpub')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc, true) }
  }, [open])
  const on = hand && !scheduled
  const item = (value: boolean, icon: ReactNode, name: string, sub: string, off = false) => (
    <button type="button" disabled={off} onClick={() => { onHand(value); setOpen(false) }} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{name}</span><span className="block text-xs leading-relaxed text-muted-foreground">{sub}</span></span>
      {on === value && !off && <Check className="size-4 shrink-0 text-primary-text" />}
    </button>
  )
  return (
    <div ref={box} className="relative flex">
      <Button size="sm" disabled={disabled} title={title} onClick={onClick} className="rounded-r-none">{running ? <Loader2 className="animate-spin" /> : on ? <Hand /> : <Send />}{label}</Button>
      <Button size="sm" disabled={running} aria-label={t('publish_mode')} title={t('publish_mode')} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-l-none border-l border-primary-foreground/20 px-1.5"><ChevronDown /></Button>
      {open && (
        <div className="absolute right-0 bottom-full z-50 mb-1.5 w-80 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {item(false, <Send />, t('mode_publish'), t('mode_publish_hint'))}
          {item(true, <Hand />, t('manual'), scheduled ? t('manual_scheduled') : t('manual_hint'), scheduled)}
        </div>
      )}
    </div>
  )
}
