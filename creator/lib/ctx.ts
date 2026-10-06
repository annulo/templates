import type { Account } from './social'

export type View = 'drafts' | 'ideas' | 'accounts' | 'profile'

/** 各视图共用的：账号（社媒插件的表）、切换视图（pages/index.tsx 给） */
export type Ctx = {
  accounts: Account[]
  /** 社媒插件装了没有 */
  plugin: boolean
  reloadAccounts: () => void
  /** 定位填了没有：没填时写稿的地方提醒先填 */
  hasProfile: boolean
  go: (view: View, params?: Record<string, string>) => void
  params: URLSearchParams
}
