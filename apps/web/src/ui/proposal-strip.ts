import type { Proposal } from '@/api/proposals'
import { type Html, html } from '@/lib/html'

import { icon } from './icons'

/** The line on a card's detail when an agent's proposal about it waits for a decision (ADR-0019). */
export const proposalStrip = (proposals: readonly Proposal[]): Html => {
  const [first] = proposals
  if (!first) {
    return html``
  }
  const who =
    proposals.length === 1
      ? `${first.author.name} propôs mudanças neste card`
      : `${proposals.length} propostas esperam por este card`
  return html`
    <p class="proposal-strip" data-proposal-strip>
      ${icon('robot', 16)}<span>${who}</span>
      <a href="/propostas?proposta=${first.id}">Ver proposta</a>
    </p>
  `
}
