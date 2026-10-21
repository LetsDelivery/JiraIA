import { ValidationException } from '@jiraia/core'

import type { Duty } from './catalog.schemas.js'
import type { Scope } from './request.repository.js'
import type { Abilities, EntitlementRequestRow } from './request.schemas.js'

/** The longest a privileged grant lasts before it must be asked for again (ADR-0024). */
export const PRIVILEGED_MAX_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

/** Who is asking, and what they answer for: system id → duties. */
export type Governor = {
  id: string
  isOrgAdmin: boolean
  isAccessAuditor: boolean
  duties: ReadonlyMap<string, ReadonlySet<Duty>>
}

export const hasDuty = (who: Governor, systemId: string, duty: Duty): boolean =>
  who.isOrgAdmin || (who.duties.get(systemId)?.has(duty) ?? false)

/** Auditors and organization admins see everything; anyone else, what names them or their systems. */
export const scopeOf = (who: Governor): Scope =>
  who.isOrgAdmin || who.isAccessAuditor
    ? { all: true }
    : { all: false, memberId: who.id, systemIds: [...who.duties.keys()] }

/** Nobody approves nor carries out a request that names them (ADR-0024). */
export const isInvolved = (who: Governor, request: Pick<EntitlementRequestRow, 'requesterId' | 'beneficiaryId'>) =>
  request.requesterId === who.id || request.beneficiaryId === who.id

type Request = Pick<EntitlementRequestRow, 'systemId' | 'status' | 'requesterId' | 'beneficiaryId'>

export const abilitiesOf = (who: Governor, request: Request): Abilities => ({
  canDecide: request.status === 'requested' && hasDuty(who, request.systemId, 'owner') && !isInvolved(who, request),
  canComplete: request.status === 'approved' && hasDuty(who, request.systemId, 'operator') && !isInvolved(who, request),
  canCancel: ['requested', 'approved'].includes(request.status) && (isInvolved(who, request) || who.isOrgAdmin)
})

/**
 * Until when a grant lasts. A privileged one must say, at most 90 days ahead; a standard one may say,
 * in the future. Least access: privilege is never open-ended.
 */
export const expiryOf = (privilege: string, asked: string | undefined, now: Date): Date | null => {
  const at = asked ? new Date(asked) : null
  if (privilege === 'privileged' && !at) {
    throw new ValidationException('A privileged profile needs an expiry date', { privilege })
  }
  if (at && at.getTime() <= now.getTime()) {
    throw new ValidationException(`Expiry "${asked}" is not in the future`, { expiresAt: asked })
  }
  if (privilege === 'privileged' && at && at.getTime() - now.getTime() > PRIVILEGED_MAX_DAYS * DAY_MS) {
    throw new ValidationException(`Expiry "${asked}" is more than ${PRIVILEGED_MAX_DAYS} days ahead`, {
      expiresAt: asked
    })
  }
  return at
}
