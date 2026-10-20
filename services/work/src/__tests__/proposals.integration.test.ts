import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { uuidGenerator } from '@jiraia/core'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * Etapa 6a (escopo-mvp 6.2, ADR-0019): an agent proposes, a person who writes the space approves — all,
 * some, adjusted — or rejects; the change lands as the agent's, marked as the proposal's; a card that
 * moved on is not overwritten unasked; an applied proposal can be reverted; a space may let some kinds
 * through on arrival. The agent is a service account that only reads the space.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAIN: 'uselets.com',
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

const HOOK = 'https://erp.counterparty.test/jiraia'
let received: { type: string; proposal?: { status: string; items: unknown[] } }[] = []
const receiver = setupServer(
  http.post(HOOK, async ({ request }) => {
    received.push((await request.json()) as (typeof received)[number])
    return new HttpResponse('ok', { status: 200 })
  })
)
beforeAll(() => receiver.listen({ onUnhandledRequest: 'error' }))
afterAll(() => receiver.close())

let now = new Date('2026-10-19T12:00:00Z')
const clock = { now: () => new Date(now) }

let service: ReturnType<typeof buildService>
let spaceId: string
let agentId: string
let agentToken: string
let states: { id: string; name: string; group: string }[]

type Result = { status: number; body: unknown }
type Proposal = {
  id: string
  status: string
  autoApplied: boolean
  note: string
  canDecide: boolean
  canRevert: boolean
  decidedBy: { name: string } | null
  items: {
    id: string
    status: string
    kind: string
    card: { id: string; key: string } | null
    changes: Record<string, { before: unknown; after: unknown }>
    conflicts: Record<string, unknown>
    error: string | null
  }[]
  names: Record<string, string>
}
type Card = { id: string; key: string; title: string; stateId: string; priority: string; reporter: { id: string } }

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as('ana@uselets.com')

/** The agent, on `/v1` with its service-account token. */
const agent = async (input: Omit<Call, 'subject' | 'claims'>): Promise<Result> => {
  const event = apiEvent({ ...input, path: `/v1${input.path}` })
  return answer(
    await service.router({ ...event, headers: { ...event.headers, authorization: `Bearer ${agentToken}` } })
  )
}

const ok = async <T>(call: Promise<Result>, status = 200): Promise<T> => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body as T
}

const newCard = async (title: string) =>
  await ok<Card>(admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title } }), 201)

const propose = async (items: unknown[], reason = 'Triagem da semana') =>
  await ok<Proposal>(agent({ method: 'POST', path: `/spaces/${spaceId}/proposals`, body: { reason, items } }), 201)

const approve = (id: string, body: Record<string, unknown> = {}) =>
  admin({ method: 'POST', path: `/proposals/${id}/approve`, body })

const readCard = async (id: string) => await ok<Card>(admin({ method: 'GET', path: `/cards/${id}` }))

beforeEach(async () => {
  await truncateSchema(db, 'work')
  now = new Date('2026-10-19T12:00:00Z')
  received = []
  service = buildService(config, {
    db,
    clock,
    webhookHttp: createHttpClient({ provider: 'webhook', logger: createLogger('test', 'webhooks') })
  })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  spaceId = (
    await ok<{ id: string }>(
      admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Produto', type: 'business' } }),
      201
    )
  ).id
  states = (await ok<{ states: typeof states }>(admin({ method: 'GET', path: `/spaces/${spaceId}/workflow` }))).states
  agentId = (
    await ok<{ id: string }>(
      admin({ method: 'POST', path: '/service-accounts', body: { name: 'Agente de triagem' } }),
      201
    )
  ).id
  agentToken = (
    await ok<{ value: string }>(
      admin({ method: 'POST', path: `/service-accounts/${agentId}/tokens`, body: { name: 'MCP' } }),
      201
    )
  ).value
  await ok(admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }), 201)
})

describe('proposing', () => {
  it('is for agents, in a space they read, about its own cards', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([{ kind: 'comment', cardId: card.id, body: 'Revisar a cláusula 4' }])

    expect(proposal).toMatchObject({ status: 'pending', canDecide: false })
    expect(
      (await admin({ method: 'POST', path: `/spaces/${spaceId}/proposals`, body: { reason: 'x', items: [] } })).status
    ).toBe(400)
    expect(
      (
        await admin({
          method: 'POST',
          path: `/spaces/${spaceId}/proposals`,
          body: { reason: 'Eu mesma', items: [{ kind: 'comment', cardId: card.id, body: 'Oi' }] }
        })
      ).status
    ).toBe(403)

    const other = await ok<{ id: string }>(
      admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Tecnologia', type: 'software' } }),
      201
    )
    const foreign = await ok<Card>(
      admin({ method: 'POST', path: `/spaces/${other.id}/cards`, body: { title: 'X' } }),
      201
    )
    const refused = await agent({
      method: 'POST',
      path: `/spaces/${spaceId}/proposals`,
      body: { reason: 'Fora', items: [{ kind: 'comment', cardId: foreign.id, body: 'Oi' }] }
    })
    expect(refused.status).toBe(400)
  })

  it('does not let the agent write directly, before or after an approval', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([{ kind: 'update_card', cardId: card.id, changes: { priority: 'high' } }])
    await ok(approve(proposal.id))

    expect((await agent({ method: 'PATCH', path: `/cards/${card.id}`, body: { priority: 'low' } })).status).toBe(403)
    expect((await agent({ method: 'POST', path: `/proposals/${proposal.id}/approve`, body: {} })).status).toBe(403)
  })

  it('shows the pending ones to who can decide, with a count and on the card', async () => {
    const card = await newCard('Contrato')
    await propose([{ kind: 'update_card', cardId: card.id, changes: { stateId: states[1]?.id } }])

    expect(await ok(admin({ method: 'GET', path: '/proposals/pending-count' }))).toEqual({ pending: 1 })
    expect(await ok(ana({ method: 'GET', path: '/proposals/pending-count' }))).toEqual({ pending: 0 })
    const onCard = await ok<{ items: Proposal[] }>(admin({ method: 'GET', path: `/cards/${card.id}/proposals` }))
    expect(onCard.items).toHaveLength(1)
    expect(onCard.items[0]?.names[states[1]?.id ?? '']).toBe(states[1]?.name)
    const mine = await ok<{ items: Proposal[] }>(agent({ method: 'GET', path: '/proposals' }))
    expect(mine.items).toHaveLength(1)
  })
})

describe('approving', () => {
  it('applies a new card as the agent, marked as the proposal in its history', async () => {
    const proposal = await propose([{ kind: 'create_card', card: { title: 'Revisar contrato', priority: 'high' } }])
    const applied = await ok<Proposal>(approve(proposal.id))

    expect(applied).toMatchObject({ status: 'applied', decidedBy: { name: 'Admin' }, canRevert: true })
    const card = await readCard(applied.items[0]?.card?.id ?? '')
    expect(card).toMatchObject({ title: 'Revisar contrato', priority: 'high', reporter: { id: agentId } })
    const history = await ok<{ items: { actorId: string; proposalId: string | null }[] }>(
      admin({ method: 'GET', path: `/cards/${card.id}/history` })
    )
    expect(history.items[0]).toMatchObject({ actorId: agentId, proposalId: proposal.id })
  })

  it('applies only the chosen items, with the approver adjustments, and declines the rest', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([
      { kind: 'update_card', cardId: card.id, changes: { title: 'Contrato Acme' } },
      { kind: 'comment', cardId: card.id, body: 'Pronto para revisão' }
    ])
    const [update, comment] = proposal.items
    const applied = await ok<Proposal>(
      approve(proposal.id, {
        itemIds: [update?.id],
        adjustments: [
          {
            itemId: update?.id,
            item: { kind: 'update_card', cardId: card.id, changes: { title: 'Contrato Acme S.A.' } }
          }
        ]
      })
    )

    expect(applied.items.map((item) => item.status)).toEqual(['applied', 'declined'])
    expect((await readCard(card.id)).title).toBe('Contrato Acme S.A.')
    const comments = await ok<{ items: unknown[] }>(admin({ method: 'GET', path: `/cards/${card.id}/comments` }))
    expect(comments.items).toHaveLength(0)
    expect(comment?.status).toBe('pending')
  })

  it('refuses an adjustment that changes the kind or the card', async () => {
    const card = await newCard('Contrato')
    const other = await newCard('Outro')
    const proposal = await propose([{ kind: 'comment', cardId: card.id, body: 'Oi' }])
    const moved = { itemId: proposal.items[0]?.id, item: { kind: 'comment', cardId: other.id, body: 'Oi' } }

    expect((await approve(proposal.id, { adjustments: [moved] })).status).toBe(400)
  })

  it('asks before overwriting a card that changed since the proposal', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([{ kind: 'update_card', cardId: card.id, changes: { title: 'Contrato Acme' } }])
    await ok(admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { title: 'Contrato Beta' } }))

    const view = await ok<Proposal>(admin({ method: 'GET', path: `/proposals/${proposal.id}` }))
    expect(view.items[0]?.conflicts).toEqual({ title: { before: 'Contrato', after: 'Contrato Beta' } })
    expect((await approve(proposal.id)).status).toBe(409)
    expect((await readCard(card.id)).title).toBe('Contrato Beta')

    await ok(approve(proposal.id, { acknowledgeConflicts: true }))
    expect((await readCard(card.id)).title).toBe('Contrato Acme')
  })

  it('applies what it can and marks the item that failed', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([
      { kind: 'update_card', cardId: card.id, changes: { stateId: '00000000-0000-4000-8000-000000000000' } },
      { kind: 'comment', cardId: card.id, body: 'Seguimos' }
    ])
    const applied = await ok<Proposal>(approve(proposal.id))

    expect(applied.status).toBe('applied')
    expect(applied.items.map((item) => item.status)).toEqual(['failed', 'applied'])
    expect(applied.items[0]?.error).toContain('state')
  })

  it('stays pending when nothing can be applied', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([
      { kind: 'update_card', cardId: card.id, changes: { stateId: '00000000-0000-4000-8000-000000000000' } }
    ])

    expect((await approve(proposal.id)).status).toBe(409)
    expect((await ok<Proposal>(admin({ method: 'GET', path: `/proposals/${proposal.id}` }))).status).toBe('pending')
  })

  it('is for a person who writes the space', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([{ kind: 'comment', cardId: card.id, body: 'Oi' }])

    expect((await ana({ method: 'POST', path: `/proposals/${proposal.id}/approve`, body: {} })).status).toBe(403)
  })
})

describe('closing without applying', () => {
  it('rejects with a note the agent reads back', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([{ kind: 'comment', cardId: card.id, body: 'Oi' }])
    await ok(admin({ method: 'POST', path: `/proposals/${proposal.id}/reject`, body: { note: 'Fora do escopo' } }))

    const read = await ok<Proposal>(agent({ method: 'GET', path: `/proposals/${proposal.id}` }))
    expect(read).toMatchObject({ status: 'rejected', note: 'Fora do escopo' })
    expect(read.items[0]?.status).toBe('declined')
    expect((await approve(proposal.id)).status).toBe(409)
  })

  it('lets its agent withdraw it, and nobody else', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([{ kind: 'comment', cardId: card.id, body: 'Oi' }])

    expect((await admin({ method: 'POST', path: `/proposals/${proposal.id}/withdraw` })).status).toBe(403)
    const withdrawn = await ok<Proposal>(agent({ method: 'POST', path: `/proposals/${proposal.id}/withdraw` }))
    expect(withdrawn.status).toBe('withdrawn')
  })

  it('expires after 14 days', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([{ kind: 'comment', cardId: card.id, body: 'Oi' }])
    now = new Date(now.getTime() + 14 * 86_400_000 + 1)

    expect((await ok<Proposal>(admin({ method: 'GET', path: `/proposals/${proposal.id}` }))).status).toBe('expired')
    expect((await approve(proposal.id)).status).toBe(409)
    expect(await ok(admin({ method: 'GET', path: '/proposals/pending-count' }))).toEqual({ pending: 0 })
  })
})

describe('reverting', () => {
  const addCancelled = async () => {
    const workflow = await ok<{ states: typeof states }>(
      admin({ method: 'POST', path: `/spaces/${spaceId}/states`, body: { name: 'Cancelado', group: 'cancelled' } }),
      201
    )
    states = workflow.states
  }

  it('undoes every kind of item, newest first', async () => {
    await addCancelled()
    const card = await newCard('Contrato')
    const other = await newCard('Fornecedor')
    const proposal = await propose([
      { kind: 'create_card', card: { title: 'Novo' } },
      { kind: 'update_card', cardId: card.id, changes: { title: 'Contrato Acme', labels: ['juridico'] } },
      { kind: 'comment', cardId: card.id, body: 'Revisado' },
      { kind: 'link', cardId: card.id, link: { type: 'relates', key: other.key } }
    ])
    const applied = await ok<Proposal>(approve(proposal.id))
    const reverted = await ok<Proposal>(admin({ method: 'POST', path: `/proposals/${proposal.id}/revert` }))

    expect(reverted.status).toBe('reverted')
    expect(reverted.items.every((item) => item.status === 'reverted')).toBe(true)
    const created = await readCard(applied.items[0]?.card?.id ?? '')
    expect(states.find((state) => state.id === created.stateId)?.group).toBe('cancelled')
    expect(await readCard(card.id)).toMatchObject({ title: 'Contrato', labels: [] })
    expect(
      (await ok<{ items: unknown[] }>(admin({ method: 'GET', path: `/cards/${card.id}/comments` }))).items
    ).toHaveLength(0)
    expect(
      (await ok<{ links: unknown[] }>(admin({ method: 'GET', path: `/cards/${card.id}/relations` }))).links
    ).toHaveLength(0)
  })

  it('refuses a new card with no cancelled state to go to, and undoes nothing', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([
      { kind: 'create_card', card: { title: 'Novo' } },
      { kind: 'comment', cardId: card.id, body: 'Revisado' }
    ])
    await ok(approve(proposal.id))

    const refused = await admin({ method: 'POST', path: `/proposals/${proposal.id}/revert` })
    expect(refused).toMatchObject({ status: 409, body: { error: { message: expect.stringContaining('cancelled') } } })
    expect(
      (await ok<{ items: unknown[] }>(admin({ method: 'GET', path: `/cards/${card.id}/comments` }))).items
    ).toHaveLength(1)
  })

  it('refuses when the card changed after the proposal, and undoes nothing', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([
      { kind: 'comment', cardId: card.id, body: 'Revisado' },
      { kind: 'update_card', cardId: card.id, changes: { title: 'Contrato Acme' } }
    ])
    await ok(approve(proposal.id))
    await ok(admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { title: 'Contrato Beta' } }))

    expect((await admin({ method: 'POST', path: `/proposals/${proposal.id}/revert` })).status).toBe(409)
    expect((await ok<Proposal>(admin({ method: 'GET', path: `/proposals/${proposal.id}` }))).status).toBe('applied')
    expect(
      (await ok<{ items: unknown[] }>(admin({ method: 'GET', path: `/cards/${card.id}/comments` }))).items
    ).toHaveLength(1)
  })
})

describe('the space policy', () => {
  it('lets the kinds an admin chose apply on arrival, and holds the rest', async () => {
    const card = await newCard('Contrato')
    expect(
      (await ana({ method: 'PUT', path: `/spaces/${spaceId}/proposal-policy`, body: { autoApply: ['comment'] } }))
        .status
    ).toBe(403)
    await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/proposal-policy`, body: { autoApply: ['comment'] } }))

    const comment = await propose([{ kind: 'comment', cardId: card.id, body: 'Recebido' }])
    expect(comment).toMatchObject({ status: 'applied', autoApplied: true, decidedBy: null })
    const mixed = await propose([
      { kind: 'comment', cardId: card.id, body: 'Recebido' },
      { kind: 'update_card', cardId: card.id, changes: { priority: 'high' } }
    ])
    expect(mixed.status).toBe('pending')
    expect(await ok(admin({ method: 'GET', path: `/spaces/${spaceId}/proposal-policy` }))).toEqual({
      autoApply: ['comment']
    })
  })
})

describe('telling people and systems', () => {
  type Notice = { kind: string; data: { proposalId?: string; spaceName?: string } }

  it('notifies the space admins of a pending proposal, not of one applied on arrival', async () => {
    const card = await newCard('Contrato')
    const proposal = await propose([{ kind: 'comment', cardId: card.id, body: 'Oi' }])
    await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/proposal-policy`, body: { autoApply: ['comment'] } }))
    await propose([{ kind: 'comment', cardId: card.id, body: 'Recebido' }])
    await service.drain()

    const { items } = await ok<{ items: Notice[] }>(admin({ method: 'GET', path: '/me/notifications' }))
    expect(items.filter((notice) => notice.kind === 'proposal_received')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ proposalId: proposal.id, spaceName: 'Produto' }) })
    ])
  })

  it('sends the proposal events a webhook asked for', async () => {
    await ok(
      admin({
        method: 'POST',
        path: `/spaces/${spaceId}/webhooks`,
        body: { name: 'ERP', url: HOOK, events: ['proposal.proposed', 'proposal.approved'] }
      }),
      201
    )
    const card = await newCard('Contrato')
    const proposal = await propose([{ kind: 'comment', cardId: card.id, body: 'Oi' }])
    await ok(approve(proposal.id))
    await service.drain()

    expect(received.map((each) => each.type)).toEqual(['proposal.proposed', 'proposal.approved'])
    expect(received[1]?.proposal).toMatchObject({ status: 'applied', items: [{ kind: 'comment', status: 'applied' }] })
  })
})
