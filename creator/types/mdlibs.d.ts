// lib/mdhtml.ts 用到的包（从 talizen.config.ts 的 importMap 加载，本地没有类型）
declare module 'marked' {
  export const marked: { parse(md: string, opts?: { async?: false; gfm?: boolean; breaks?: boolean }): string }
}
declare module 'turndown' {
  type Rule = { filter: string | string[] | ((node: HTMLElement) => boolean); replacement: (content: string, node: HTMLElement) => string }
  export default class TurndownService {
    constructor(opts?: Record<string, unknown>)
    turndown(html: string): string
    keep(filter: string | string[]): this
    addRule(key: string, rule: Rule): this
    use(plugin: unknown): this
  }
}
declare module 'turndown-plugin-gfm' {
  export const gfm: unknown
}
