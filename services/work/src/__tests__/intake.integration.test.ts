import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { uuidGenerator } from '@jiraia/core'
import { callerFromClaims } from '@jiraia/http'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { sql } from 'drizzle-orm'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

import { LETS_WORKFLOWS } from '../cards/workflow-defaults.js'
import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * Etapa 5a end to end: the REQ's intake form, and the two rules the cut-over needs (escopo-mvp
 * 4.1–4.5) — a prioritized request opens an Opportunity in PRD and tells #product_updates; a finished
 * TEC card moves the PRD card it delivers. Slack is MSW on a counterparty host; `drain()` stands in
 * for the bus.
 */
const db = await testDatabase('services/work/drizzle')
const SLACK = 'https://slack.counterparty.test/services/T0/B0/secret1234'
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime',
  WEB_URL: 'https://jiraia.test'
}

let posted: { text: string }[] = []
const slack = setupServer(
  http.post(SLACK, async ({ request }) => {
    posted.push((await request.json()) as { text: string })
    return HttpResponse.text('ok')
  })
)

type Space = { id: string; states: Map<string, string>; types: Map<string, string> }
type Card = { id: string; key: string; title: string; stateId: string; labels: string[]; description: string }

let service: ReturnType<typeof buildService>
let req: Space
let prd: Space
let tec: Space

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

const createSpace = async (key: 'REQ' | 'PRD' | 'TEC'): Promise<Space> => {
  const caller = callerFromClaims(googleClaims('admin@uselets.com'))
  const space = await service.spaces.create(
    caller,
    { key, name: key, description: '', type: 'business' },
    LETS_WORKFLOWS[key]
  )
  const workflow = await service.workflows.get(caller, space.id)
  return {
    id: space.id,
    states: new Map(workflow.states.map((state) => [state.name, state.id])),
    types: new Map(workflow.types.map((type) => [type.name, type.id]))
  }
}

const newCard = async (space: Space, title: string) =>
  (await ok(admin({ method: 'POST', path: `/spaces/${space.id}/cards`, body: { title } }), 201)) as Card

const move = (space: Space, card: Card, state: string) =>
  ok(admin({ method: 'POST', path: `/cards/${card.id}/move`, body: { stateId: space.states.get(state), index: 0 } }))

const cardsOf = async (space: Space) =>
  ((await ok(admin({ method: 'GET', path: `/spaces/${space.id}/cards` }))) as { items: Card[] }).items

const connectSlack = async () =>
  (
    (await ok(
      admin({
        method: 'POST',
        path: '/integrations/slack/channels',
        body: { name: '#product_updates', webhookUrl: SLACK }
      }),
      201
    )) as { id: string }
  ).id

const reqToPrd = (channelId: string) => ({
  name: 'REQ priorizado → Oportunidade no PRD',
  trigger: { type: 'state_changed', toStateId: req.states.get('🚨 Itens priorizados') },
  actions: [
    {
      type: 'create_card',
      spaceId: prd.id,
      typeId: prd.types.get('Oportunidade'),
      stateId: prd.states.get('Backlog'),
      link: { type: 'delivers', direction: 'inward' }
    },
    { type: 'slack', channelId, text: '{{card.key}} virou {{created.key}}: <{{created.url}}|{{created.title}}>' }
  ]
})

const tecToPrd = () => ({
  name: 'TEC concluído → PRD preparando para lançar',
  trigger: { type: 'state_changed', toGroup: 'done' },
  actions: [
    {
      type: 'move_linked',
      linkType: 'delivers',
      direction: 'outward',
      spaceId: prd.id,
      stateId: prd.states.get('Preparando para lançar'),
      comment: '{{card.key}} foi concluído no TEC.'
    }
  ]
})

beforeAll(() => slack.listen({ onUnhandledRequest: 'error' }))
afterAll(() => slack.close())

beforeEach(async () => {
  await truncateSchema(db, 'work')
  posted = []
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: { now: () => new Date('2026-10-17T12:00:00Z') }, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  req = await createSpace('REQ')
  prd = await createSpace('PRD')
  tec = await createSpace('TEC')
})

describe('intake forms', () => {
  const form = () => ({
    name: 'Pedido para Produto',
    typeId: req.types.get('Requisição'),
    labels: ['business-form'],
    questions: [
      { id: 'titulo', label: 'O que você precisa?', required: true, target: 'title' },
      { id: 'problema', label: 'Qual é o problema hoje?', required: true, target: 'description' },
      { id: 'impacto', label: 'Quem é afetado?', target: 'description' },
      { id: 'prazo', label: 'Até quando?', target: 'dueDate' }
    ]
  })

  it('turns an answer by someone who only reads the space into a card with the form labels', async () => {
    const created = (await ok(admin({ method: 'POST', path: `/spaces/${req.id}/forms`, body: form() }), 201)) as {
      id: string
    }
    const sent = (await ok(
      as('ana@uselets.com')({
        method: 'POST',
        path: `/forms/${created.id}/submissions`,
        body: { answers: { titulo: 'Exportar faturas em lote', problema: 'Hoje é uma por uma.', prazo: '2026-11-30' } }
      }),
      201
    )) as { card: { key: string } }

    expect(sent.card.key).toBe('REQ-1')
    const [card] = await cardsOf(req)
    expect(card).toMatchObject({ title: 'Exportar faturas em lote', labels: ['business-form'], dueDate: '2026-11-30' })
    const opened = (await ok(admin({ method: 'GET', path: `/cards/${card?.id}` }), 200)) as { description: string }
    expect(opened.description).toBe('**Qual é o problema hoje?**\nHoje é uma por uma.')
    expect(
      await as('ana@uselets.com')({ method: 'POST', path: `/spaces/${req.id}/cards`, body: { title: 'x' } })
    ).toMatchObject({ status: 403 })
  })

  it('refuses an answer that leaves a required question empty, naming it', async () => {
    const created = (await ok(admin({ method: 'POST', path: `/spaces/${req.id}/forms`, body: form() }), 201)) as {
      id: string
    }
    const refused = await admin({
      method: 'POST',
      path: `/forms/${created.id}/submissions`,
      body: { answers: { titulo: 'x' } }
    })

    expect(refused.status).toBe(400)
    expect(JSON.stringify(refused.body)).toContain('Qual é o problema hoje?')
  })

  it('keeps form building to the space admins', async () => {
    const refused = await as('ana@uselets.com')({ method: 'POST', path: `/spaces/${req.id}/forms`, body: form() })
    expect(refused.status).toBe(403)
  })
})

describe('automations', () => {
  it('opens an Opportunity in PRD when a request is prioritized, links them and tells Slack', async () => {
    const rule = (await ok(
      admin({ method: 'POST', path: `/spaces/${req.id}/automations`, body: reqToPrd(await connectSlack()) }),
      201
    )) as { id: string }
    const request = await newCard(req, 'Alertas de atraso por WhatsApp')

    await move(req, request, '🚨 Itens priorizados')
    await service.drain()

    const [opportunity] = await cardsOf(prd)
    expect(opportunity).toMatchObject({
      key: 'PRD-1',
      title: 'Alertas de atraso por WhatsApp',
      stateId: prd.states.get('Backlog')
    })
    const relations = (await ok(admin({ method: 'GET', path: `/cards/${request.id}/relations` }))) as {
      links: { type: string; direction: string; card: { key: string } }[]
    }
    expect(relations.links).toEqual([
      expect.objectContaining({
        type: 'delivers',
        direction: 'inward',
        card: expect.objectContaining({ key: 'PRD-1' })
      })
    ])
    expect(posted).toEqual([
      { text: 'REQ-1 virou PRD-1: <https://jiraia.test/espacos/PRD?card=PRD-1|Alertas de atraso por WhatsApp>' }
    ])
    const runs = (await ok(admin({ method: 'GET', path: `/automations/${rule.id}/runs` }))) as {
      items: { status: string; steps: unknown[] }[]
    }
    expect(runs.items[0]).toMatchObject({
      status: 'succeeded',
      steps: [{ action: 'create_card', detail: 'PRD-1' }, expect.anything()]
    })
  })

  it('runs once per event, even when the bus delivers it again', async () => {
    await ok(
      admin({ method: 'POST', path: `/spaces/${req.id}/automations`, body: reqToPrd(await connectSlack()) }),
      201
    )
    const request = await newCard(req, 'Relatório de atrasos')
    await move(req, request, '🚨 Itens priorizados')
    await service.drain()

    await db.execute(sql`UPDATE work.audit_events SET dispatched_at = NULL`)
    await service.drain()

    expect(await cardsOf(prd)).toHaveLength(1)
    expect(posted).toHaveLength(1)
  })

  it('moves the PRD card a finished TEC card delivers, comments, and starts no rule of its own', async () => {
    await ok(admin({ method: 'POST', path: `/spaces/${tec.id}/automations`, body: tecToPrd() }), 201)
    const loop = {
      name: 'PRD movido → comentário',
      trigger: { type: 'state_changed' },
      actions: [{ type: 'comment', body: 'não devia rodar' }]
    }
    await ok(admin({ method: 'POST', path: `/spaces/${prd.id}/automations`, body: loop }), 201)
    const opportunity = await newCard(prd, 'Rastreio em tempo real')
    const delivery = await newCard(tec, 'API de rastreio')
    await ok(
      admin({ method: 'POST', path: `/cards/${delivery.id}/links`, body: { type: 'delivers', key: opportunity.key } }),
      201
    )

    await move(tec, delivery, 'CONCLUÍDO')
    await service.drain()

    const [moved] = await cardsOf(prd)
    expect(moved?.stateId).toBe(prd.states.get('Preparando para lançar') as string)
    const comments = (await ok(admin({ method: 'GET', path: `/cards/${opportunity.id}/comments` }))) as {
      items: { body: string; author: { name: string } }[]
    }
    expect(comments.items).toEqual([
      expect.objectContaining({
        body: 'TEC-1 foi concluído no TEC.',
        author: expect.objectContaining({ name: 'Automação' })
      })
    ])
  })

  it('refuses a rule that reaches a space its maker cannot write in', async () => {
    const ana = (await ok(
      admin({ method: 'POST', path: '/members', body: { email: 'ana@uselets.com', name: 'Ana' } }),
      201
    )) as { id: string }
    await ok(admin({ method: 'PUT', path: `/spaces/${tec.id}/members/${ana.id}`, body: { role: 'admin' } }))

    const refused = await as('ana@uselets.com')({
      method: 'POST',
      path: `/spaces/${tec.id}/automations`,
      body: tecToPrd()
    })

    expect(refused.status).toBe(403)
  })
})

describe('slack channels', () => {
  it('never hands the webhook back, and only an organization admin connects one', async () => {
    await connectSlack()
    const listed = (await ok(as('ana@uselets.com')({ method: 'GET', path: '/integrations/slack/channels' }))) as {
      items: unknown[]
    }

    expect(listed.items).toEqual([
      expect.objectContaining({ name: '#product_updates', webhookHint: 'slack.counterparty.test/…1234' })
    ])
    expect(JSON.stringify(listed)).not.toContain('secret1234/')
    expect(
      (
        await as('ana@uselets.com')({
          method: 'POST',
          path: '/integrations/slack/channels',
          body: { name: '#x', webhookUrl: SLACK }
        })
      ).status
    ).toBe(403)
  })
})
