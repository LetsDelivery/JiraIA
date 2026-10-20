# 19. Proposals are applied as their agent, with the approver's consent

Date: 2026-10-19

## Status

Accepted. Opens Etapa 6 (escopo-mvp 6.2). Narrowed by ADR-0022: proposals are for autonomous agents;
a person's assistant writes directly.

## Context

The architecture's second principle is "agents propose, people approve": a change an agent wants is a
**proposal**, with a diff, an author and a reason, applied only when a person approves it. Stênio asked
for the complete version: several changes in one proposal, approving some of them, adjusting a value
before approving, noticing when the card changed in the meantime, and undoing an applied proposal.
The agent that proposes may act for a person who connected it (Etapa 6c); it never sees more than they do.

## Decision

- **A proposal is a list of items** of four kinds: `create_card`, `update_card` (fields, state included),
  `comment` and `link`. All items are in one JiraIA space, which is the proposal's space. Only agents
  propose (`POST /spaces/{id}/proposals`); proposing needs to read the space. A person makes the change
  directly instead.
- **Each `update_card` item keeps its base**: the value of every field it touches when it was proposed.
  When the card's value differs now, the item is *stale*. Approving a stale item needs
  `acknowledgeConflicts`; otherwise the answer is 409 naming each field, and the panel shows the item
  again against the card as it is now.
- **Who approves:** whoever can write the space. They may approve only some items (the rest are
  declined), adjust an item's values (the original is kept beside the adjustment), or reject the whole
  proposal with a note the agent reads back. A pending proposal expires after 14 days. The agent may
  withdraw its own pending proposal.
- **Applied as the agent.** The approved items run through the same services a person's change does,
  with the agent as the caller — so a card created by a proposal has the agent as its reporter and a
  comment has it as its author. For the length of that one application the agent counts as a member
  of the proposal's space: the approver's consent, not a role the agent holds. This is an
  `AsyncLocalStorage` scope the access resolver reads (`proposals/delegation.ts`); it ends with the
  call and never reaches another space.
- **The trail says it came from a proposal.** Every audit event written inside that scope carries the
  proposal's id (`audit_events.proposal_id`), and the proposal itself has its own events: `proposed`,
  `approved`, `rejected`, `withdrawn`, `reverted`. A card's history reads "Agente X, by proposal, approved
  by Ana".
- **Items apply one at a time.** Each service keeps its own transaction, so a failing item does not
  undo the ones before it: it is marked `failed` with the error, and the proposal is `applied` with
  what went through. When no item goes through, nothing is marked and the first error is the answer.
- **Revert** undoes an applied proposal as the person who asks, newest item first: a created card goes
  to the space's first cancelled state (cards are never deleted), changed fields go back to their base
  — only if they still hold what the proposal wrote, else 409 —, a comment is removed and a link
  unlinked.
- **Execute mode:** a space admin chooses which kinds apply without approval
  (`PUT /spaces/{id}/proposal-policy`, nothing by default). A proposal whose items are all of those kinds
  is applied when it arrives, under the same scope, and shows as applied automatically.
- **Who hears about it:** the space's admins and lead get a `proposal_received` notice; webhooks may ask
  for `proposal.proposed`, `proposal.approved`, `proposal.rejected` and `proposal.reverted`.

## Consequences

- An agent with only the reader role can still have changes made in a space, always through a person
  who can write it. Its own role keeps deciding what it reads.
- Partial application is possible and visible; the proposal never claims more than it did.
- Revert is not a time machine: work done on top of the proposal's values blocks it field by field.
- Proposals for pages wait for the Draw editor to accept structured edits (Etapa 6, later).
