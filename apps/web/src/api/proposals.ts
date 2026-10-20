import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/** Etapa 6a's reads and writes (ADR-0019): proposals, deciding on them, and a space's policy. */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type Proposal = Json<'/work/proposals/{proposalId}', 'get'>
export type ProposalItem = Proposal['items'][number]
export type ItemInput = ProposalItem['proposed']
export type ItemKind = ProposalItem['kind']
export type ProposalPolicy = Json<'/work/spaces/{spaceId}/proposal-policy', 'get'>
export type Approval = {
  itemIds?: string[]
  adjustments: { itemId: string; item: ItemInput }[]
  acknowledgeConflicts: boolean
  note: string
}

const one = (proposalId: string) => ({ params: { path: { proposalId } } })

/** A decision changes the proposal, maybe cards, and the count on the menu. */
const decided = <T>(result: T): T => {
  invalidate('proposals', 'space:')
  return result
}

export const proposalsRead = {
  list: (status: 'pending' | 'decided') =>
    cached(`proposals:${status}`, () => unwrap(api.GET('/work/proposals', { params: { query: { status } } }))),
  pendingCount: () => cached('proposals:count', () => unwrap(api.GET('/work/proposals/pending-count'))),
  forCard: (cardId: string) =>
    cached(`proposals:card:${cardId}`, () =>
      unwrap(api.GET('/work/cards/{cardId}/proposals', { params: { path: { cardId } } }))
    ),
  policy: (spaceId: string) =>
    cached(`proposals:policy:${spaceId}`, () =>
      unwrap(api.GET('/work/spaces/{spaceId}/proposal-policy', { params: { path: { spaceId } } }))
    )
}

export const proposalsWrite = {
  approve: async (proposalId: string, body: Approval) =>
    decided(await unwrap(api.POST('/work/proposals/{proposalId}/approve', { ...one(proposalId), body }))),
  reject: async (proposalId: string, note: string) =>
    decided(await unwrap(api.POST('/work/proposals/{proposalId}/reject', { ...one(proposalId), body: { note } }))),
  revert: async (proposalId: string) =>
    decided(await unwrap(api.POST('/work/proposals/{proposalId}/revert', one(proposalId)))),
  setPolicy: async (spaceId: string, autoApply: ItemKind[]) => {
    const saved = await unwrap(
      api.PUT('/work/spaces/{spaceId}/proposal-policy', { params: { path: { spaceId } }, body: { autoApply } })
    )
    invalidate(`proposals:policy:${spaceId}`)
    return saved
  }
}
