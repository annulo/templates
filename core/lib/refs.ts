// 引用 @<表>:<id>#<n>（Annulo 能力版本 45，Annulo 仓库 docs/references.md）：页面上「复制引用」复制的就是这串，用户贴进对话交给 AI。
// #n 是这条记录文件列表里的第 n 个（从 1 开始）：资料库是 files（只有 url 时 #1 就是它），图文文章是 images。

export const refOf = (table: string, id: string, n?: number) => `@${table}:${id}${n ? `#${n}` : ''}`

/** 复制到剪贴板（几条时一行一个） */
export async function copyRefs(refs: string[]) {
  await navigator.clipboard.writeText(refs.join('\n'))
}
