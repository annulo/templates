import { tr } from './i18n'
import type { ArticleType, RewritePreset } from './shuttle'

// AI 预设：交给 AI 做的事都是「做法 + 一段要求（Prompt）」（creator/docs/artifacts.md「交给 AI」）：
//   here 在这篇上做：写这篇的正文、做产物挂在这篇上（照稿子写正文、配图、做视频…），types 是能用在哪些类型的文章上；
//   new  另写一篇：改写成 type 那种类型的一篇新文章。
// 用户的存在 rewrite_presets 表；模板自带的写在这里（名字、要求在 core/messages 的 presets.builtin.<id>），
// 用户改了默认的存一行 builtin = <id>（用它的名字和要求），删了存一行 builtin + hidden，「恢复默认」把那行删掉。
// 接着改 AI 做出来的东西不用预设：回到做它的那段对话直接说（AGENTS.md「接着改 AI 做出来的东西」）。

export type PresetMode = 'here' | 'new'

export type Preset = {
  /** 表里那行的 id；模板自带、没改过的是 builtin:<id> */
  key: string
  mode: PresetMode
  /** new：改写成的类型；here：没用（存第一个能用的类型） */
  type: ArticleType
  /** here：能用在哪些类型的文章上，空的是都能 */
  types: ArticleType[]
  name: string
  prompt: string
  /** 模板自带的哪一条 */
  builtin?: string
  /** 模板自带的、用户改过（可以恢复默认） */
  changed?: boolean
  /** 表里的那行（用户加的、改过的默认预设） */
  row?: PresetRow
}

export type PresetRow = RewritePreset & { name?: string; mode?: PresetMode; types?: string; builtin?: string; hidden?: boolean }

export const ALL_TYPES: ArticleType[] = ['article', 'post', 'video']

/** 模板自带的预设。here 的、to_video（另写一篇视频并做出来）只在项目能「在这篇上做」时出现（creator 的 tasks/work-on-article.md） */
const BUILTINS: { id: string; mode: PresetMode; type: ArticleType; types: ArticleType[] }[] = [
  { id: 'from_draft', mode: 'here', type: 'article', types: ALL_TYPES },
  { id: 'post_images', mode: 'here', type: 'post', types: ['post'] },
  { id: 'cover', mode: 'here', type: 'post', types: ['post', 'article'] },
  { id: 'make_video', mode: 'here', type: 'video', types: ALL_TYPES },
  { id: 'to_video', mode: 'new', type: 'video', types: [] },
]

export const builtinText = (id: string) => ({ name: tr(`presets.builtin.${id}.name`), prompt: tr(`presets.builtin.${id}.prompt`) })

export const parseTypes = (v?: string): ArticleType[] => {
  try {
    const l = JSON.parse(v || '[]')
    return Array.isArray(l) ? l.filter((t) => ALL_TYPES.includes(t)) : []
  } catch {
    return []
  }
}

/** 表里的行和模板自带的合在一起：自带的在前（用户改过的用改过的），用户自己加的按创建时间在后 */
export function mergePresets(rows: PresetRow[], opts: { here: boolean }): Preset[] {
  const out: Preset[] = []
  for (const b of BUILTINS) {
    if (!opts.here && (b.mode === 'here' || b.id === 'to_video')) continue
    const row = rows.find((r) => r.builtin === b.id)
    if (row?.hidden) continue
    const def = builtinText(b.id)
    const types = b.mode !== 'here' ? [] : row && parseTypes(row.types).length ? parseTypes(row.types) : b.types
    out.push(row
      ? { key: row.id, mode: b.mode, type: row.type ?? b.type, types, name: row.name?.trim() || def.name, prompt: row.prompt, builtin: b.id, changed: true, row }
      : { key: `builtin:${b.id}`, mode: b.mode, type: b.type, types, name: def.name, prompt: def.prompt, builtin: b.id })
  }
  const mine = rows.filter((r) => !r.builtin).sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  for (const r of mine) {
    const mode: PresetMode = r.mode === 'here' ? 'here' : 'new'
    if (mode === 'here' && !opts.here) continue
    out.push({ key: r.id, mode, type: r.type, types: mode === 'here' ? parseTypes(r.types) : [], name: r.name?.trim() ?? '', prompt: r.prompt, row: r })
  }
  return out
}

/** 这条「在这篇上做」的预设能不能用在这种类型的文章上 */
export const fitsType = (p: Preset, t: ArticleType) => p.mode !== 'here' || !p.types.length || p.types.includes(t)

/** 按钮上显示的字：有名字用名字，没有用要求的开头 */
export const presetLabel = (p: Preset) => p.name || p.prompt
