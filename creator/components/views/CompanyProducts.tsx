import ProjectSettings from './ProjectSettings'
import { PageHeader } from '../ui'
import { tr } from '../../lib/i18n'
import type { Ctx } from './types'

/** 我的定位：读写 profile 表（外贸模板的「公司与产品」去掉了产品） */
export default function CompanyProducts({ ctx }: { ctx: Ctx; params?: Record<string, string>; setParam?: (key: string, value: string) => void }) {
  return (
    <div className="space-y-6">
      <PageHeader title={tr('company.title')} desc={tr('company.desc')} />
      <ProjectSettings ctx={ctx} embedded />
    </div>
  )
}
