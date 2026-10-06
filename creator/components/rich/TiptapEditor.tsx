// 文章正文编辑器（Tiptap）。第三方包只在浏览器里有（talizen.config.ts 的 importMap，SSR 没有），
// 所以这个文件只能经 components/RichEditor.tsx 在 useEffect 里 await import()，不要在别处静态引入。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import Image from '@tiptap/extension-image'
import { Bold, Code, Heading2, Heading3, ImageIcon, Images, Italic, Link2, List, ListOrdered, Minus, Pilcrow, Quote, SquareCode, Strikethrough, Unlink, Upload, type LucideIcon } from 'lucide-react'
import { uploadFile } from '../../lib/shuttle'
import { tr } from '../../lib/i18n'
import { cx } from '../ui'
import AssetPicker from '../AssetPicker'
import type { RichEditorProps } from '../RichEditor'


type SlashItem = { key: string; icon: LucideIcon; label: string; desc: string; words: string; run: (e: Editor) => void }
/** 光标位置（视口坐标）：菜单放在光标下方，下面放不下就放上方 */
type Slash = { from: number; to: number; query: string; top: number; bottom: number; left: number }

/** 斜杠菜单：输入 / 弹出，像飞书、Notion 一样插入块 */
function slashItems(pickImage: () => void): SlashItem[] {
  return [
    { key: 'p', icon: Pilcrow, label: tr('editor.p'), desc: tr('editor.p_desc'), words: 'text paragraph zhengwen 正文 段落', run: (e) => e.chain().focus().setParagraph().run() },
    { key: 'h2', icon: Heading2, label: tr('editor.h2'), desc: tr('editor.h2_desc'), words: 'h2 heading biaoti 标题 小标题', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
    { key: 'h3', icon: Heading3, label: tr('editor.h3'), desc: tr('editor.h3_desc'), words: 'h3 heading biaoti 标题 三级', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
    { key: 'ul', icon: List, label: tr('editor.ul'), desc: tr('editor.ul_desc'), words: 'list bullet liebiao 列表 无序', run: (e) => e.chain().focus().toggleBulletList().run() },
    { key: 'ol', icon: ListOrdered, label: tr('editor.ol'), desc: tr('editor.ol_desc'), words: 'list number ordered bianhao 编号 有序', run: (e) => e.chain().focus().toggleOrderedList().run() },
    { key: 'quote', icon: Quote, label: tr('editor.quote'), desc: tr('editor.quote_desc'), words: 'quote blockquote yinyong 引用', run: (e) => e.chain().focus().toggleBlockquote().run() },
    { key: 'code', icon: SquareCode, label: tr('editor.code_block'), desc: tr('editor.code_block_desc'), words: 'code block daima 代码', run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { key: 'hr', icon: Minus, label: tr('editor.hr'), desc: tr('editor.hr_desc'), words: 'hr divider line fengexian 分割线', run: (e) => e.chain().focus().setHorizontalRule().run() },
    { key: 'img', icon: ImageIcon, label: tr('editor.image'), desc: tr('editor.image_desc'), words: 'image picture tupian 图片 配图', run: () => pickImage() },
  ]
}

/** 光标前面是不是「/关键词」（在行首或空格后），是就返回菜单的位置 */
function findSlash(editor: Editor): Slash | null {
  const { selection } = editor.state
  if (!selection.empty) return null
  const $from = selection.$from
  if ($from.parent.type.name === 'codeBlock') return null
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
  const m = /(?:^|\s)\/([^\s/]{0,20})$/.exec(before)
  if (!m) return null
  const c = editor.view.coordsAtPos($from.pos)
  return { from: $from.pos - m[1].length - 1, to: $from.pos, query: m[1].toLowerCase(), top: c.top, bottom: c.bottom, left: c.left }
}

export default function TiptapEditor({ value, onChange }: RichEditorProps) {
  const [slash, setSlash] = useState<Slash | null>(null)
  const [active, setActive] = useState(0)
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const edRef = useRef<Editor | null>(null)

  // 上传图片（素材库同一套：传到运营后台站点的 creght 素材拿公开地址），插在光标处
  const insertImages = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return false
    setError('')
    for (const f of imgs) {
      setUploading((n) => n + 1)
      try {
        const r = await uploadFile(f)
        edRef.current?.chain().focus().setImage({ src: r.url, alt: f.name.replace(/\.[^.]+$/, '') }).run()
      } catch (e) {
        setError(tr('editor.upload_failed', { error: (e as Error).message }))
      } finally {
        setUploading((n) => n - 1)
      }
    }
    return true
  }
  const items = slashItems(() => fileInput.current?.click())
  const shown = slash ? items.filter((i) => !slash.query || i.words.includes(slash.query) || i.label.toLowerCase().includes(slash.query)) : []
  // 菜单放光标下方；下方不够放（不到 240px）而上方更宽，就翻到上方，用 bottom 贴住光标上沿往上长。
  // 高度限制在那一侧剩下的空间里，放不下就在菜单里滚动；横向不超出窗口
  const menuStyle = (s: Slash): CSSProperties => {
    const below = window.innerHeight - s.bottom - 12
    const above = s.top - 12
    const up = below < 240 && above > below
    const left = Math.max(8, Math.min(s.left, window.innerWidth - 264))
    return up ? { bottom: window.innerHeight - s.top + 6, left, maxHeight: Math.min(352, above) } : { top: s.bottom + 6, left, maxHeight: Math.min(352, below) }
  }
  // 上下键选到菜单外面的项：只滚菜单自己（scrollIntoView 会连页面一起滚）
  useEffect(() => {
    const m = menuRef.current
    const el = m?.querySelector<HTMLElement>('[data-active]')
    if (!m || !el) return
    if (el.offsetTop < m.scrollTop) m.scrollTop = el.offsetTop - 4
    else if (el.offsetTop + el.offsetHeight > m.scrollTop + m.clientHeight) m.scrollTop = el.offsetTop + el.offsetHeight - m.clientHeight + 4
  }, [active])
  // 键盘事件在 ProseMirror 里处理，拿最新的菜单状态要走 ref
  const menu = useRef({ slash, shown, active })
  menu.current = { slash, shown, active }

  const choose = (item: SlashItem) => {
    const e = edRef.current
    const s = menu.current.slash
    if (!e || !s) return
    e.chain().focus().deleteRange({ from: s.from, to: s.to }).run()
    setSlash(null)
    item.run(e)
  }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // 链接不加 nofollow、不强制新窗口：文章里多是站内链接，nofollow 影响 SEO
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { target: null, rel: null } } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? tr('editor.ph_heading') : tr('editor.ph')) }),
      Image,
    ],
    content: value,
    editorProps: {
      attributes: { class: 'rich-content min-h-80 px-5 py-4 outline-none' },
      handleKeyDown: (_view, ev) => {
        const { slash: s, shown: list, active: i } = menu.current
        if (!s || !list.length) return false
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          setActive((i + (ev.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length)
          return true
        }
        if (ev.key === 'Enter' || ev.key === 'Tab') {
          choose(list[Math.min(i, list.length - 1)])
          return true
        }
        if (ev.key === 'Escape') {
          setSlash(null)
          return true
        }
  
      return false
      },
      handlePaste: (_view, ev) => {
        const files = [...(ev.clipboardData?.files ?? [])]
        if (!files.some((f) => f.type.startsWith('image/'))) return false
        insertImages(files)
        return true
      },
      handleDrop: (_view, ev) => {
        const files = [...((ev as DragEvent).dataTransfer?.files ?? [])]
        if (!files.some((f) => f.type.startsWith('image/'))) return false
        insertImages(files)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
      const s = findSlash(editor)
      setSlash(s)
      if (!s || s.query !== menu.current.slash?.query) setActive(0)
    },
    onSelectionUpdate: ({ editor }) => setSlash(findSlash(editor)),
    onBlur: () => setTimeout(() => setSlash(null), 150),
  })
  edRef.current = editor

  useEffect(() => () => editor?.destroy(), [editor])

  return (
    <div className="relative rounded-lg border border-border bg-background">
      {editor && <Toolbar editor={editor} uploading={uploading > 0} onUpload={() => fileInput.current?.click()} onPick={() => setPicking(true)} />}
      {editor && <SelectionMenu editor={editor} />}
      <EditorContent editor={editor} />
      <AssetPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(urls) => {
          setPicking(false)
          const e = edRef.current
          if (!e) return
          let c = e.chain().focus()
          for (const u of urls) c = c.setImage({ src: u })
          c.run()
        }}
      />
      {slash && shown.length > 0 && (
        <div
          ref={menuRef}
          className="fixed z-50 w-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          style={menuStyle(slash)}
        >
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-muted-foreground">{tr('editor.blocks')}</div>
          {shown.map((it, i) => (
            <button
              key={it.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              data-active={i === active || undefined}
              onClick={() => choose(it)}
              className={cx('flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', i === active && 'bg-accent')}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <it.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{it.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{it.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {(uploading > 0 || error) && (
        <div className={cx('border-t border-border px-4 py-2 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>{error || tr('editor.uploading')}</div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          insertImages([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </div>
  )
}

/**
 * 编辑器顶上一直在的工具栏：常用的块（小标题、列表、引用）和插图片（上传 / 从素材库选）。
 * 斜杠菜单、粘贴、拖图片进来照样能用，但不知道的人找不到，所以常用的摆出来
 */
function Toolbar({ editor, uploading, onUpload, onPick }: { editor: Editor; uploading: boolean; onUpload: () => void; onPick: () => void }) {
  const [, rerender] = useState(0)
  // 光标移动时刷新按钮的选中状态
  useEffect(() => {
    const f = () => rerender((n) => n + 1)
    editor.on('selectionUpdate', f)
    editor.on('transaction', f)
    return () => {
      editor.off('selectionUpdate', f)
      editor.off('transaction', f)
    }
  }, [editor])
  const btn = (on: boolean, label: string, icon: ReactNode, run: () => void) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cx('flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4', on && 'bg-accent text-primary-text')}
    >
      {icon}
    </button>
  )
  const text = (label: string, icon: ReactNode, run: () => void, disabled = false) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      disabled={disabled}
      className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 [&_svg]:size-4"
    >
      {icon}
      {label}
    </button>
  )
  return (
    <div className="sticky top-[var(--sticky-top,0px)] z-10 flex flex-wrap items-center gap-0.5 rounded-t-lg border-b border-border bg-background/95 px-2 py-1 backdrop-blur">
      {btn(editor.isActive('heading', { level: 2 }), tr('editor.h2'), <Heading2 />, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
      {btn(editor.isActive('heading', { level: 3 }), tr('editor.h3'), <Heading3 />, () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
      {btn(editor.isActive('bulletList'), tr('editor.ul'), <List />, () => editor.chain().focus().toggleBulletList().run())}
      {btn(editor.isActive('orderedList'), tr('editor.ol'), <ListOrdered />, () => editor.chain().focus().toggleOrderedList().run())}
      {btn(editor.isActive('blockquote'), tr('editor.quote'), <Quote />, () => editor.chain().focus().toggleBlockquote().run())}
      <span className="mx-1 h-4 w-px bg-border" />
      {text(uploading ? tr('editor.uploading') : tr('editor.upload_image'), <Upload />, onUpload, uploading)}
      {text(tr('editor.pick_image'), <Images />, onPick)}
    </div>
  )
}

/** 选中文字时浮出的工具栏：块类型、加粗、斜体、删除线、行内代码、链接 */
function SelectionMenu({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false)
  const [url, setUrl] = useState('')
  const btn = (on: boolean, label: string, icon: ReactNode, run: () => void) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cx('flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-accent [&_svg]:size-4', on && 'bg-accent text-primary-text')}
    >
      {icon}
    </button>
  )
  const applyLink = () => {
    const v = url.trim()
    if (!v) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: /^[a-z]+:|^\//i.test(v) ? v : 'https://' + v }).run()
    setLinking(false)
  }
  return (
    <BubbleMenu editor={editor} options={{ placement: 'top' }} shouldShow={({ editor: e, state }) => !state.selection.empty && !e.isActive('image') && !e.isActive('codeBlock')}>
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        {linking ? (
          <>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyLink()
                if (e.key === 'Escape') setLinking(false)
              }}
              placeholder="https://"
              className="h-7 w-56 rounded-md bg-transparent px-2 text-xs outline-none"
            />
            <button type="button" onClick={applyLink} className="h-7 cursor-pointer rounded-md px-2 text-xs font-medium text-primary-text hover:bg-accent">
              {tr('editor.apply')}
            </button>
          </>
        ) : (
          <>
            {btn(editor.isActive('paragraph'), tr('editor.p'), <Pilcrow />, () => editor.chain().focus().setParagraph().run())}
            {btn(editor.isActive('heading', { level: 2 }), tr('editor.h2'), <Heading2 />, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
            {btn(editor.isActive('heading', { level: 3 }), tr('editor.h3'), <Heading3 />, () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
            <span className="mx-0.5 h-4 w-px bg-border" />
            {btn(editor.isActive('bold'), tr('editor.bold'), <Bold />, () => editor.chain().focus().toggleBold().run())}
            {btn(editor.isActive('italic'), tr('editor.italic'), <Italic />, () => editor.chain().focus().toggleItalic().run())}
            {btn(editor.isActive('strike'), tr('editor.strike'), <Strikethrough />, () => editor.chain().focus().toggleStrike().run())}
            {btn(editor.isActive('code'), tr('editor.code'), <Code />, () => editor.chain().focus().toggleCode().run())}
            <span className="mx-0.5 h-4 w-px bg-border" />
            {editor.isActive('link')
              ? btn(true, tr('editor.unlink'), <Unlink />, () => editor.chain().focus().extendMarkRange('link').unsetLink().run())
              : btn(false, tr('editor.link'), <Link2 />, () => {
                  setUrl(editor.getAttributes('link').href ?? '')
                  setLinking(true)
                })}
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
