import type { Channel, OAuthConnection } from './shuttle'
import type { ManagedConnection } from './managedConnections'
import type { OAuthProvider } from './oauthReturn'

export type AuthorizationChannel = Omit<Channel, 'api_credential'> & {
  api_credential?: string; instagram_user_id?: string; instagram_connection_id?: string;
  instagram_media_host?: string; threads_media_host?: string;
}
export type AuthorizationAccount = OAuthConnection['accounts'][number]
export type AuthorizationResource = { key: string; account: string; id: string; name: string; avatar?: string; added?: boolean }
export const authorizationReady = (a?: AuthorizationAccount) => !!a && !a.needs_reconnect && !a.missing_scopes?.length
export const resourceKey = (account: string, id: string) => JSON.stringify([account, id])

/** A returned identity must never silently fall back to another saved authorization. */
export function selectAuthorization(accounts: AuthorizationAccount[], preferred: string, exact = false) {
  return accounts.find(a => a.account === preferred)?.account || (exact ? '' : accounts.find(authorizationReady)?.account || accounts[0]?.account || '')
}

export function instagramResources(connections: ManagedConnection[], account: string, channel?: AuthorizationChannel): AuthorizationResource[] {
  return connections.filter(c => c.id === account && c.login_method === 'unified_login' && c.status === 'active' && !c.needs_reconnect)
    .flatMap(c => c.assets.filter(a => a.kind === 'instagram_account' && a.status === 'active' && (!channel || a.id === channel.instagram_user_id))
      .map(a => ({ key: resourceKey(c.id, a.id), account: c.id, id: a.id, name: '@' + a.name })))
}

/** Instagram credential sources remain separate; Facebook personal profiles cannot use the Page API. */
export function authorizationTarget(provider: OAuthProvider, channel?: AuthorizationChannel) {
  if (provider === 'instagram' && channel?.api_credential !== 'instagram_managed') return undefined
  if (provider === 'facebook' && channel?.fb_kind === 'profile') return undefined
  return channel
}

export function defaultResources(resources: AuthorizationResource[], previous: string[], channel?: AuthorizationChannel) {
  const retained = previous.filter(key => resources.some(r => r.key === key))
  if (retained.length) return retained
  const target = channel?.instagram_user_id || channel?.page_id || channel?.platform_uid
  const match = resources.find(r => r.id === target)
  return match ? [match.key] : resources.length === 1 ? [resources[0].key] : []
}
