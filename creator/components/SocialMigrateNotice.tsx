import { ArrowRightLeft } from 'lucide-react'
import RunButton from './RunButton'
import { openShuttleSettings } from '../lib/shuttle'
import { tr } from '../lib/i18n'

/**
 * 社媒账号搬到社媒插件（github.com/annulo/plugins 的 social）的提示：
 * 插件还没装时说去哪装；装了、channels 表里还留着以前加的社媒账号时给「迁移」按钮（local/social_migrate.ts）。
 */
export default function SocialMigrateNotice({ legacy, plugin, onDone }: { legacy: number; plugin: boolean; onDone: () => void }) {
  if (plugin && legacy === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
      <p className="min-w-0 flex-1 leading-relaxed text-muted-foreground">{plugin ? tr('social.migrate_hint', { n: legacy }) : tr('social.plugin_missing')}</p>
      {plugin ? (
        <RunButton fn="social_migrate.run" input={{}} icon={ArrowRightLeft} onDone={onDone}>
          {tr('social.migrate_btn')}
        </RunButton>
      ) : (
        <button type="button" onClick={() => openShuttleSettings('backend')} className="shrink-0 cursor-pointer text-sm font-medium text-primary-text hover:underline">
          {tr('social.plugin_open')}
        </button>
      )}
    </div>
  )
}
