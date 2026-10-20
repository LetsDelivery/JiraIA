import { AsyncLocalStorage } from 'node:async_hooks'

import type { Role } from '@jiraia/authorization'

/**
 * The scope a proposal is applied or reverted in (ADR-0019).
 *
 * `agentId` is set while approved items run as their agent: inside the scope that agent counts as a
 * member of `spaceId` — the approver's consent, never a role it holds — and nowhere else. Every audit
 * event written inside carries `proposalId`, so the trail says the write came from the proposal.
 */
export type ProposalScope = { proposalId: string; spaceId: string; agentId?: string }

const scope = new AsyncLocalStorage<ProposalScope>()

/** Runs `work` inside the scope; it ends when `work` settles. */
export const underProposal = <T>(current: ProposalScope, work: () => Promise<T>): Promise<T> => scope.run(current, work)

/** The proposal a write belongs to, when it runs inside one. */
export const currentProposalId = (): string | undefined => scope.getStore()?.proposalId

/**
 * The role a member borrows on a space for the running proposal: `member` for its agent on its space,
 * nothing otherwise.
 *
 * @example underProposal({ proposalId, spaceId: 's', agentId: 'a' }, async () => borrowedRole('a', 's'))   // 'member'
 */
export const borrowedRole = (memberId: string, spaceId: string): Role | undefined => {
  const current = scope.getStore()
  return current?.agentId === memberId && current.spaceId === spaceId ? 'member' : undefined
}
