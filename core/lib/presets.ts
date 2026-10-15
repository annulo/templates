import { tr } from './i18n'
import type { ArticleType, RewritePreset } from './shuttle'

// AI 预设：交给 AI 做的事都是「产出哪种类型 + 一段要求（Prompt）」，改写成笔记、做成视频都一样。
// 接着改 AI 做出来的东西不用预设：回到做它的那段对话直接说（AGENTS.md「接着改 AI 做出来的东西」）。
// 用户的存在 rewrite_presets 表；模板自带的默认预设写在这里（名字、要求在 core/messages 的 presets.builtin.<id>），
// 用户改了默认的存一行 builtin = <id>（用它的名字和要求），删了存一行 builtin + hidden，「恢复默认」把那行删掉。

export type Preset = {
  /** 表里那行的 id；模板自带、没改过的是 builtin:<id> */
  key: string
  type: ArticleType
  name: string
  prompt: string
  /** 模板自带的哪一条 */
  builtin?: string
  /** 模板自带的、用户改过（可以恢复默认） */
  changed?: boolean
  /** 表里的那行（用户加的、改过的默认预设） */
  row?: PresetRow
}

export type PresetRow = RewritePreset & { name?: string; builtin?: string; hidden?: boolean }

/** 模板自带的预设。video：做视频的才有（项目里有做视频的任务时） */
const BUILTINS: { id: string; type: ArticleType; video?: boolean }[] = [{ id: 'make_video', type: 'video', video: true }]

export const builtinText = (id: string) => ({ name: tr(`presets.builtin.${id}.name`), prompt: tr(`presets.builtin.${id}.prompt`) })

/** 表里的行和模板自带的合在一起：自带的在前（用户改过的用改过的），用户自己加的按创建时间在后 */
export function mergePresets(rows: PresetRow[], opts: { video: boolean }): Preset[] {
  const out: Preset[] = []
  for (const b of BUILTINS) {
    if (b.video && !opts.video) continue
    const row = rows.find((r) => r.builtin === b.id)
    if (row?.hidden) continue
    const def = builtinText(b.id)
    out.push(row
      ? { key: row.id, type: b.type, name: row.name?.trim() || def.name, prompt: row.prompt, builtin: b.id, changed: true, row }
      : { key: `builtin:${b.id}`, type: b.type, name: def.name, prompt: def.prompt, builtin: b.id })
  }
  const mine = rows
    .filter((r) => !r.builtin)
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  for (const r of mine) out.push({ key: r.id, type: r.type, name: r.name?.trim() ?? '', prompt: r.prompt, row: r })
  return out
}

/** 按钮上显示的字：有名字用名字，没有用要求的开头 */
export const presetLabel = (p: Preset) => p.name || p.prompt
