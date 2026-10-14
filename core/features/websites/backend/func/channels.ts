import type { TalizenFuncContext } from 'talizen/func-runtime'

// 表还没建（刚复制出来的后台、直接打开模板预览）时当作空表，页面显示空状态而不是报错
function query(ctx: TalizenFuncContext, table: string, opts: any) {
  try {
    return ctx.db.query(table, opts)
  } catch (e) {
    if (/table not found/i.test(String((e as Error)?.message ?? e))) return { list: [] }
    throw e
  }
}

// 渠道列表直接读本项目的 channels 表（网站）和社媒插件的 social_accounts 表（社媒账号），不经过本机 Shuttle：手机、别的电脑上打开后台也能看到渠道。增删渠道仍然走 Shuttle。
// 只给这个 creght 项目的成员读（ctx.member.require()），只返回渠道的类型、名称、站点 id 和访问地址。

const SITES = ['creght_site', 'wordpress']
const SOCIAL = ['xiaohongshu', 'douyin', 'x', 'linkedin', 'facebook', 'instagram', 'youtube', 'bilibili', 'zhihu']

export function list(_input: unknown, ctx: TalizenFuncContext) {
  ctx.member.require()
  const sites = (query(ctx, 'channels', { limit: 200 })?.list ?? []).filter((c: any) => SITES.includes(c?.type))
  const social = (query(ctx, 'social_accounts', { limit: 200 })?.list ?? []).filter((c: any) => SOCIAL.includes(c?.type))
  const list = [...sites, ...social]
    .filter((c: any) => typeof c?.name === 'string')
    .map((c: any) => ({
      id: String(c.id),
      type: c.type,
      name: c.name,
      project_id: typeof c.project_id === 'string' ? c.project_id : undefined,
      site_id: typeof c.site_id === 'string' ? c.site_id : undefined,
      preview_url: typeof c.preview_url === 'string' && /^https:\/\//.test(c.preview_url) ? c.preview_url : undefined,
    }))
  return { list }
}
