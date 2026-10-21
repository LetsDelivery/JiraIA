import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/**
 * Access governance (ADR-0024): the catalog of LET’S systems, requests to grant or remove a profile,
 * and who holds what. Everything is cached under `governance:`, cleared together on any write.
 */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type AccessSystem = Json<'/work/access/systems/{systemId}', 'get'>
export type AccessProfile = AccessSystem['profiles'][number]
export type Duty = AccessSystem['staff'][number]['duty']
export type Privilege = AccessProfile['privilege']
export type EntitlementRequest = Json<'/work/access/entitlement-requests/{requestId}', 'get'>
export type RequestStatus = EntitlementRequest['status']
export type Entitlement = Json<'/work/access/entitlements', 'get'>['items'][number]
export type Holiday = Json<'/work/access/holidays', 'get'>['items'][number]
export type SlaInput = { grantSlaDays: number; removalSlaDays: number; departureSlaHours: number }
export type AccessReview = Json<'/work/access/reviews/{reviewId}', 'get'>
export type ReviewItem = AccessReview['items'][number]
export type AccessReport = Json<'/work/access/report', 'get'>
export type ImportResult = Json<'/work/access/entitlements/import', 'post'>
export type InventoryRow = {
  email: string
  system: string
  profile: string
  grantedAt?: string
  expiresAt?: string
  reason?: string
}
export type HistoryEvent = Json<'/work/access/systems/{systemId}/history', 'get'>['items'][number]
export type GrantInput = { profileId: string; reason: string; beneficiaryId?: string; expiresAt?: string }

const onSystem = (systemId: string) => ({ params: { path: { systemId } } })
const onRequest = (requestId: string) => ({ params: { path: { requestId } } })

const _done = <T>(result: T): T => {
  invalidate('governance:')
  return result
}

export const governanceRead = {
  systems: () => cached('governance:systems', () => unwrap(api.GET('/work/access/systems'))),
  requests: () =>
    cached('governance:requests', () =>
      unwrap(api.GET('/work/access/entitlement-requests', { params: { query: {} } }))
    ),
  /** What the caller holds now. */
  mine: (memberId: string) =>
    cached(`governance:held:${memberId}`, () =>
      unwrap(api.GET('/work/access/entitlements', { params: { query: { memberId, held: 'true' } } }))
    ),
  reviews: () => cached('governance:reviews', () => unwrap(api.GET('/work/access/reviews', { params: { query: {} } }))),
  report: (from: string, to: string) =>
    cached(`governance:report:${from}:${to}`, () =>
      unwrap(api.GET('/work/access/report', { params: { query: { from, to } } }))
    ),
  history: (systemId: string) => unwrap(api.GET('/work/access/systems/{systemId}/history', onSystem(systemId))),
  /** Everything, held or not — what the auditor's export lists. */
  allEntitlements: () => unwrap(api.GET('/work/access/entitlements', { params: { query: { held: 'false' } } })),
  holidays: () => cached('governance:holidays', () => unwrap(api.GET('/work/access/holidays'))),
  /** Everything the caller may see that is held now — their systems', or all of it for an auditor. */
  held: () =>
    cached('governance:held', () =>
      unwrap(api.GET('/work/access/entitlements', { params: { query: { held: 'true' } } }))
    )
}

export const governanceWrite = {
  createSystem: async (body: { name: string; description: string; holdsPersonalData: boolean }) =>
    _done(await unwrap(api.POST('/work/access/systems', { body }))),
  archiveSystem: async (systemId: string, archived: boolean) =>
    _done(await unwrap(api.PATCH('/work/access/systems/{systemId}', { ...onSystem(systemId), body: { archived } }))),
  openReview: async (systemId: string, privilege: Privilege) =>
    _done(
      await unwrap(api.POST('/work/access/systems/{systemId}/reviews', { ...onSystem(systemId), body: { privilege } }))
    ),
  decideReviewItem: async (reviewId: string, entitlementId: string, decision: 'keep' | 'remove') =>
    _done(
      await unwrap(
        api.POST('/work/access/reviews/{reviewId}/items/{entitlementId}', {
          params: { path: { reviewId, entitlementId } },
          body: { decision }
        })
      )
    ),
  importInventory: async (rows: readonly InventoryRow[]) =>
    _done(await unwrap(api.POST('/work/access/entitlements/import', { body: { rows: [...rows] } }))),
  setSla: async (systemId: string, sla: SlaInput) =>
    _done(await unwrap(api.PATCH('/work/access/systems/{systemId}', { ...onSystem(systemId), body: sla }))),
  putHoliday: async (day: string, name: string) =>
    _done(await unwrap(api.PUT('/work/access/holidays/{day}', { params: { path: { day } }, body: { name } }))),
  removeHoliday: async (day: string) =>
    _done(await unwrap(api.DELETE('/work/access/holidays/{day}', { params: { path: { day } } }))),
  putStaff: async (systemId: string, duty: Duty, memberId: string) =>
    _done(
      await unwrap(
        api.PUT('/work/access/systems/{systemId}/staff/{duty}/{memberId}', {
          params: { path: { systemId, duty, memberId } }
        })
      )
    ),
  removeStaff: async (systemId: string, duty: Duty, memberId: string) =>
    _done(
      await unwrap(
        api.DELETE('/work/access/systems/{systemId}/staff/{duty}/{memberId}', {
          params: { path: { systemId, duty, memberId } }
        })
      )
    ),
  createProfile: async (systemId: string, body: { name: string; description: string; privilege: Privilege }) =>
    _done(await unwrap(api.POST('/work/access/systems/{systemId}/profiles', { ...onSystem(systemId), body }))),
  archiveProfile: async (profileId: string, archived: boolean) =>
    _done(
      await unwrap(
        api.PATCH('/work/access/profiles/{profileId}', { params: { path: { profileId } }, body: { archived } })
      )
    ),
  askGrant: async (input: GrantInput) =>
    _done(await unwrap(api.POST('/work/access/entitlement-requests', { body: { kind: 'grant', ...input } }))),
  askRemoval: async (entitlementId: string, reason: string) =>
    _done(
      await unwrap(api.POST('/work/access/entitlement-requests', { body: { kind: 'removal', entitlementId, reason } }))
    ),
  decide: async (requestId: string, approve: boolean, note: string) =>
    _done(
      await unwrap(
        api.POST('/work/access/entitlement-requests/{requestId}/decision', {
          ...onRequest(requestId),
          body: { approve, note }
        })
      )
    ),
  complete: async (requestId: string, evidence: string) =>
    _done(
      await unwrap(
        api.POST('/work/access/entitlement-requests/{requestId}/completion', {
          ...onRequest(requestId),
          body: { evidence }
        })
      )
    ),
  cancel: async (requestId: string) =>
    _done(await unwrap(api.POST('/work/access/entitlement-requests/{requestId}/cancellation', onRequest(requestId)))),
  setAuditor: async (memberId: string, isAccessAuditor: boolean) => {
    const member = await unwrap(
      api.POST('/work/members/{memberId}/access-auditor', { params: { path: { memberId } }, body: { isAccessAuditor } })
    )
    invalidate('members', 'me', 'governance:')
    return member
  }
}
