// 帮助手册的篇目顺序。后台「帮助」页按这个顺序列目录；运营助手回答「怎么用」时也可以读 help/articles.ts。
import { assistant, channels, content, faq, overview, quickstart, settings, social, type Article } from './articles'

export type { Article, Localized } from './articles'

export const ARTICLES: Article[] = [quickstart, overview, content, social, channels, assistant, settings, faq]

export const findArticle = (id?: string) => ARTICLES.find((a) => a.id === id)
