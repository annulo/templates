import { useMemo, useState } from 'react'
import { useLocale } from 'talizen'
import { Search as SearchIcon } from 'lucide-react'
import Markdown from '../Markdown'
import Select from '../Select'
import { PageHeader, cx, inputCls } from '../ui'
import { ARTICLES, findArticle, type Article } from '../../help/index'
import type { Ctx } from './types'

// 帮助手册：左边目录（手机上是下拉）、右边正文、顶部搜索。?article=<id> 定位到某篇。
// 页面自己的几个字按语言写在这里（不进 messages），正文在 help/articles.ts。
const UI = {
  zh: { title: '帮助', desc: '每个功能怎么用、遇到问题怎么办。也可以直接问右侧的运营助手。', search: '搜索帮助', toc: '目录', empty: '没有找到相关的内容，换个词试试，或者直接问右侧的运营助手。' },
  en: { title: 'Help', desc: 'How each feature works and what to do when something goes wrong. You can also ask the assistant on the right.', search: 'Search help', toc: 'Contents', empty: 'Nothing matched. Try other words, or ask the assistant on the right.' },
}

/** 搜索：标题、摘要、正文里都包含每个词才算（不区分大小写） */
function matches(a: Article, lang: 'zh' | 'en', q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = `${a.title[lang]}\n${a.summary[lang]}\n${a.body[lang]}`.toLowerCase()
  return words.every((w) => text.includes(w))
}

export default function Help({ params, setParam }: { ctx: Ctx; params: Record<string, string>; setParam: (k: string, v: string) => void }) {
  const { locale } = useLocale()
  const lang: 'zh' | 'en' = locale === 'en' ? 'en' : 'zh'
  const ui = UI[lang]
  const [q, setQ] = useState('')
  const list = useMemo(() => ARTICLES.filter((a) => matches(a, lang, q)), [lang, q])
  const current = findArticle(params.article) ?? list[0] ?? ARTICLES[0]
  const open = (id: string) => setParam('article', id)

  return (
    <div className="space-y-6">
      <PageHeader title={ui.title} desc={ui.desc} />

      <div className="relative max-w-md">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ui.search} aria-label={ui.search} className={cx(inputCls, 'pl-9')} />
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{ui.empty}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* 手机：下拉；宽屏：左侧目录 */}
          <div className="lg:hidden">
            <Select value={current.id} onChange={open} ariaLabel={ui.toc} title={ui.toc} options={list.map((a) => ({ value: a.id, label: a.title[lang], sub: a.summary[lang] }))} />
          </div>
          <nav aria-label={ui.toc} className="hidden lg:block">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">{ui.toc}</div>
            <ul className="space-y-0.5">
              {list.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => open(a.id)}
                    aria-current={a.id === current.id ? 'page' : undefined}
                    className={cx(
                      'w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      a.id === current.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {a.title[lang]}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <article className="min-w-0 rounded-xl border border-border bg-background p-6">
            <h2 className="text-lg font-semibold tracking-tight">{current.title[lang]}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{current.summary[lang]}</p>
            <div className="mt-5 text-sm leading-relaxed">
              <Markdown text={current.body[lang]} />
            </div>
          </article>
        </div>
      )}
    </div>
  )
}
