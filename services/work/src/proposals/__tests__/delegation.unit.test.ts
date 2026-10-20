import { describe, expect, it } from 'bun:test'

import { borrowedRole, currentProposalId, underProposal } from '../delegation.js'

describe('underProposal', () => {
  const scope = { proposalId: 'p1', spaceId: 's1', agentId: 'agent' }

  it('lends its agent the member role on its space only, while it runs', async () => {
    await underProposal(scope, async () => {
      await Promise.resolve()
      expect(borrowedRole('agent', 's1')).toBe('member')
      expect(borrowedRole('agent', 's2')).toBeUndefined()
      expect(borrowedRole('someone', 's1')).toBeUndefined()
    })
    expect(borrowedRole('agent', 's1')).toBeUndefined()
  })

  it('lends nothing when no agent runs it — a revert by a person', async () => {
    await underProposal({ proposalId: 'p1', spaceId: 's1' }, async () => {
      expect(borrowedRole('agent', 's1')).toBeUndefined()
      expect(currentProposalId()).toBe('p1')
    })
  })

  it('names the proposal only inside, and keeps concurrent ones apart', async () => {
    const seen = await Promise.all(
      ['p1', 'p2'].map((proposalId) =>
        underProposal({ proposalId, spaceId: 's1' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, proposalId === 'p1' ? 5 : 0))
          return currentProposalId()
        })
      )
    )
    expect(seen).toEqual(['p1', 'p2'])
    expect(currentProposalId()).toBeUndefined()
  })
})
