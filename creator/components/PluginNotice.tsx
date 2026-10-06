import { openShuttleSettings } from '../lib/shuttle'
import { tr } from '../lib/i18n'

/** 社媒插件（github.com/annulo/plugins 的 social）还没装时的提示：社媒账号、发帖都靠它。模板声明了它，新建项目时会自动装上 */
export default function PluginNotice({ plugin }: { plugin: boolean }) {
  if (plugin) return null
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
      <p className="min-w-0 flex-1 leading-relaxed text-muted-foreground">{tr('social.plugin_missing')}</p>
      <button type="button" onClick={() => openShuttleSettings('backend')} className="shrink-0 cursor-pointer text-sm font-medium text-primary-text hover:underline">
        {tr('social.plugin_open')}
      </button>
    </div>
  )
}
