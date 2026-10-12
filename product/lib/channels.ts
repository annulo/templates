import type { ComponentType } from 'react'
import { Globe } from 'lucide-react'
import { CreghtLogo, DouyinLogo, FacebookLogo, InstagramLogo, LinkedinLogo, WechatLogo, XiaohongshuLogo, XLogo, YoutubeLogo, BilibiliLogo, ZhihuLogo } from '../components/BrandIcons'
import type { ChannelType } from './shuttle'
import { tr } from './i18n'

/** 社媒和 Creght 网站用真实 logo（components/BrandIcons.tsx），WordPress 网站用地球 */
export type ChannelMeta = { label: string; icon: ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>; ready: boolean; hint: string }

/** 渠道类型的显示信息。ready=false 的还不能添加。 */
// label / hint 是 getter：每次按当前语言从 messages 的 meta.channel_types 取
const meta = (type: ChannelType, icon: ChannelMeta['icon'], ready: boolean): ChannelMeta => ({
  get label() {
    return tr(`meta.channel_types.${type}.label`)
  },
  get hint() {
    return tr(`meta.channel_types.${type}.hint`)
  },
  icon,
  ready,
})
export const CHANNEL_TYPES: Record<ChannelType, ChannelMeta> = {
  creght_site: meta('creght_site', CreghtLogo, true),
  wordpress: meta('wordpress', Globe, true),
  xiaohongshu: meta('xiaohongshu', XiaohongshuLogo, true),
  douyin: meta('douyin', DouyinLogo, true),
  wechat_mp: meta('wechat_mp', WechatLogo, false),
  x: meta('x', XLogo, true),
  linkedin: meta('linkedin', LinkedinLogo, true),
  facebook: meta('facebook', FacebookLogo, true),
  instagram: meta('instagram', InstagramLogo, true),
  youtube: meta('youtube', YoutubeLogo, true),
  bilibili: meta('bilibili', BilibiliLogo, true),
  zhihu: meta('zhihu', ZhihuLogo, true),
}
