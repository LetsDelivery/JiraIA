import type { DomainEvent } from '../events/event.js'
import type { Notice } from '../notifications/fanout.js'
import type { CatalogRepository } from './catalog.repository.js'
import type { EntitlementRequestRepository } from './request.repository.js'
import type { RequestRead } from './request.schemas.js'

/** The actions of an entitlement request someone has to hear about (ADR-0024). */
export const ENTITLEMENT_ACTIONS = new Set(['requested', 'approved', 'declined', 'done', 'overdue'])

/**
 * Who hears about an entitlement request: a grant waiting reaches the system's owners, an approved
 * one — and every removal — its operators; the outcome reaches who asked and whom it is for; a
 * request past its deadline reaches owners and operators both.
 */
export class EntitlementNotices {
  constructor(private readonly deps: { requests: EntitlementRequestRepository; catalog: CatalogRepository }) {}

  async notices(event: DomainEvent): Promise<Notice[]> {
    const request = await this.deps.requests.find(event.organizationId, event.entityId)
    if (!request) {
      return []
    }
    const base = {
      cardId: null,
      spaceId: null,
      data: {
        requestId: request.id,
        requestKind: request.kind,
        systemName: request.systemName,
        profileName: request.profileName,
        personName: request.beneficiaryName,
        status: request.status
      }
    }
    return (await this._recipients(event.action, request)).map(({ memberId, kind }) => ({ ...base, memberId, kind }))
  }

  private async _recipients(action: string, request: RequestRead): Promise<Pick<Notice, 'memberId' | 'kind'>[]> {
    const staff = await this.deps.catalog.staffOf([request.systemId])
    const by = (duty: string) => staff.filter((each) => each.duty === duty).map((each) => each.memberId)
    const parties = [request.requesterId, request.beneficiaryId]
    const waiting = (ids: string[]) => ids.map((memberId) => ({ memberId, kind: 'entitlement_waiting' as const }))
    const decided = parties.map((memberId) => ({ memberId, kind: 'entitlement_decided' as const }))
    if (action === 'overdue') {
      return [...by('owner'), ...by('operator')].map((memberId) => ({ memberId, kind: 'entitlement_overdue' as const }))
    }
    if (action === 'requested') {
      // By kind, not status: the event is read after the fact, when a grant may be approved already.
      return waiting(request.kind === 'grant' ? by('owner') : by('operator'))
    }
    return action === 'approved' ? [...waiting(by('operator')), ...decided] : decided
  }
}
