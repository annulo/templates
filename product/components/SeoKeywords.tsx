import { ArrowRight } from 'lucide-react'
import type { ComponentProps } from 'react'
import type Keywords from './Keywords'
import { Button } from './ui'
import { runLocal } from '../lib/shuttle'
import { tr } from '../lib/i18n'
import type { Ctx } from './views/types'

/**
 * 产品运营给共用「关键词」标签的两件事（Search 的 keywords 插槽），别的和外贸一样：
 * - beforeLoad：把导入的 SEO 页面地图、AI 研究的页面机会并进关键词表（seomap.sync，能重复跑），按主题出现在卡片里；
 * - topicActions：卡片上「创建运营主题」（主题没挂页面机会就按主题建一条候选，seomap.opportunity），去运营主题做多平台内容。
 * 「写新内容」转成的选题带上主题挂的页面机会（keywords.toTopic），写文章时用它的受众、问题和建议。
 */
export function seoKeywords(ctx: Ctx): Pick<ComponentProps<typeof Keywords>, 'beforeLoad' | 'topicActions'> {
  return {
    beforeLoad: () => runLocal('seomap.sync', {}),
    topicActions: (t) => (
      <Button size="sm" variant="ghost" onClick={async () => {
        const { opportunity_id } = await runLocal<{ opportunity_id: string }>('seomap.opportunity', { cluster: t.cluster })
        const c = await runLocal<{ id: string }>('campaigns.createCampaign', { opportunity_id })
        ctx.go('campaigns', { campaign: c.id })
      }}>
        {tr('campaigns.create_campaign')} <ArrowRight />
      </Button>
    ),
  }
}
