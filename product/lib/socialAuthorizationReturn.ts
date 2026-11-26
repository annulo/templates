import { listChannels, listOAuthConnections, runLocal } from './shuttle'
import { managedConnections } from './managedConnections'
import { authorizationReady, authorizationTarget, instagramResources, type AuthorizationChannel } from './socialAuthorization'
import type { OAuthReturn } from './oauthReturn'
import type { Choose } from '../components/ChooseAccounts'
import { tr } from './i18n'

/** Add only assets from this exact returned grant, using the project's existing plugin. */
export async function bindReturnedAuthorization(result: OAuthReturn, stillActive: () => boolean) {
  const { provider, account } = result
  const connection = (await listOAuthConnections()).find(c => c.key === provider)
  if (result.status !== 'connected' || !account || !connection?.available || connection.pending || !authorizationReady(connection.accounts.find(a => a.account === account))) {
    throw new Error(tr('social_authorization.source_missing'))
  }
  const channels = (await listChannels()).list as AuthorizationChannel[]
  const channel = result.channelId ? channels.find(c => c.id === result.channelId && c.type === provider) : undefined
  if (result.channelId && !channel) throw new Error(tr('account_authorization.target_missing'))
  const target = authorizationTarget(provider, channel)
  const checkActive = () => { if (!stillActive()) throw new Error(tr('social_authorization.add_cancelled')) }
  const checked = (value: { id?: string; ids?: string[] } | undefined) => {
    if (!value?.id && !value?.ids?.length) throw new Error(tr('social_authorization.bind_failed'))
  }
  checkActive()
  if (provider === 'facebook') {
    const response = await runLocal('social/social.login', { type: provider, mode: 'api', account, channel_id: target?.id }) as { choose?: Choose }
    const choose = response?.choose
    if (!choose || choose.type !== provider || choose.profile !== 'api' || choose.uid !== account || !Array.isArray(choose.pages)) throw new Error(tr('social_authorization.invalid_resources'))
    const ids = [...new Set(choose.pages.filter(p => !target || p.id === (target.page_id || target.platform_uid)).map(p => p.id))]
    if (!ids.length) throw new Error(tr('social_authorization.empty_facebook'))
    checkActive()
    checked(await runLocal('social/social.addChosen', { choose, profile_selected: false, page_ids: ids }))
  } else if (provider === 'instagram') {
    const rows = instagramResources(await managedConnections(provider), account, target)
    if (!rows.length) throw new Error(tr('social_authorization.empty_instagram'))
    for (const row of rows) {
      checkActive()
      checked(await runLocal('social/social.login', { type: provider, channel_id: target?.id, mode: 'managed', connection_id: account, asset_id: row.id, media_host: result.mediaHost }))
    }
  } else {
    // Retry/reload keeps the same row; never switch a legacy credential implicitly.
    const existing = target || channels.find(c => c.type === provider && c.api_credential === 'threads_oauth' && c.oauth_account === account)
    checkActive()
    checked(await runLocal('social/social.login', { type: provider, channel_id: existing?.id, mode: 'oauth', account, media_host: result.mediaHost }))
  }
}
