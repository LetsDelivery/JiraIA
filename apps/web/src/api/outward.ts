import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/** Etapa 5c's reads and writes: API tokens, service accounts, a space's webhooks and their deliveries. */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type ApiToken = Json<'/work/me/tokens', 'get'>['items'][number]
export type ServiceAccount = Json<'/work/service-accounts', 'get'>['items'][number]
export type Webhook = Json<'/work/spaces/{spaceId}/webhooks', 'get'>['items'][number]
export type WebhookEvent = Webhook['events'][number]
export type Delivery = Json<'/work/webhooks/{webhookId}/deliveries', 'get'>['items'][number]
export type WebhookInput = { name: string; url: string; events: WebhookEvent[]; enabled: boolean }

const hook = (webhookId: string) => ({ params: { path: { webhookId } } })

export const outwardRead = {
  myTokens: () => cached('tokens:mine', () => unwrap(api.GET('/work/me/tokens'))),
  serviceAccounts: () => cached('tokens:service', () => unwrap(api.GET('/work/service-accounts'))),
  webhooks: (spaceId: string) =>
    cached(`webhooks:${spaceId}`, () =>
      unwrap(api.GET('/work/spaces/{spaceId}/webhooks', { params: { path: { spaceId } } }))
    ),
  deliveries: (webhookId: string) => unwrap(api.GET('/work/webhooks/{webhookId}/deliveries', hook(webhookId)))
}

export const outwardWrite = {
  createToken: async (name: string, expiresInDays?: number) => {
    const created = await unwrap(
      api.POST('/work/me/tokens', { body: { name, ...(expiresInDays ? { expiresInDays } : {}) } })
    )
    invalidate('tokens:')
    return created
  },
  revokeToken: async (tokenId: string) => {
    await unwrap(api.DELETE('/work/api-tokens/{tokenId}', { params: { path: { tokenId } } }))
    invalidate('tokens:')
  },
  createServiceAccount: async (name: string) => {
    const created = await unwrap(api.POST('/work/service-accounts', { body: { name } }))
    invalidate('tokens:', 'members')
    return created
  },
  createServiceToken: async (memberId: string, name: string, expiresInDays?: number) => {
    const created = await unwrap(
      api.POST('/work/service-accounts/{memberId}/tokens', {
        params: { path: { memberId } },
        body: { name, ...(expiresInDays ? { expiresInDays } : {}) }
      })
    )
    invalidate('tokens:')
    return created
  },
  createWebhook: async (spaceId: string, body: WebhookInput) => {
    const created = await unwrap(api.POST('/work/spaces/{spaceId}/webhooks', { params: { path: { spaceId } }, body }))
    invalidate(`webhooks:${spaceId}`)
    return created
  },
  updateWebhook: async (webhookId: string, spaceId: string, body: WebhookInput) => {
    await unwrap(api.PUT('/work/webhooks/{webhookId}', { ...hook(webhookId), body }))
    invalidate(`webhooks:${spaceId}`)
  },
  rotateWebhook: async (webhookId: string, spaceId: string) => {
    const rotated = await unwrap(api.POST('/work/webhooks/{webhookId}/secret', hook(webhookId)))
    invalidate(`webhooks:${spaceId}`)
    return rotated
  },
  deleteWebhook: async (webhookId: string, spaceId: string) => {
    await unwrap(api.DELETE('/work/webhooks/{webhookId}', hook(webhookId)))
    invalidate(`webhooks:${spaceId}`)
  },
  redeliver: (webhookId: string, deliveryId: string) =>
    unwrap(
      api.POST('/work/webhooks/{webhookId}/deliveries/{deliveryId}/retry', {
        params: { path: { webhookId, deliveryId } }
      })
    )
}
