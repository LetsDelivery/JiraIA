import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { callerFromClaims } from '@jiraia/http'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { LETS_WORKFLOWS } from '../cards/workflow-defaults.js'
import { buildService } from '../container.js'
import { InMemoryFileStore } from '../files/file-store.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * Etapa 3 is done when each JQL of `backlog/fluxo-jira.md` has a saved view that returns the same
 * set on a test seed (prompt-construcao.md). For each JQL the seed holds matches the view must find
 * and decoys it must leave out.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}
const DAY = 86_400_000

type Card = { id: string; key: string }
type Space = { id: string; states: Map<string, string>; types: Map<string, string> }

let service: ReturnType<typeof buildService>
let clock: ReturnType<typeof fixedClock>
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

const card = async (space: Space, title: string, state: string, extra: Record<string, unknown> = {}) => {
  const body = { title, stateId: space.states.get(state), ...extra }
  clock.advance(60_000)
  return (await ok(admin({ method: 'POST', path: `/spaces/${space.id}/cards`, body }), 201)) as Card
}

const move = async (space: Space, target: Card, state: string) =>
  ok(admin({ method: 'POST', path: `/cards/${target.id}/move`, body: { stateId: space.states.get(state), index: 0 } }))

const saveView = async (name: string, space: Space, filter: Record<string, unknown>, extra = {}) =>
  (await ok(
    admin({ method: 'POST', path: '/views', body: { name, scope: 'space', spaceId: space.id, filter, ...extra } }),
    201
  )) as { id: string }

const keysOf = async (view: { id: string }, who = admin) =>
  ((await ok(who({ method: 'GET', path: `/views/${view.id}/cards` }))) as { items: Card[] }).items.map(
    (each) => each.key
  )

const giveRole = async (email: string, role: string, space: Space) => {
  const member = (await admin({ method: 'POST', path: '/members', body: { email, name: email } })).body as {
    id: string
  }
  await admin({ method: 'PUT', path: `/spaces/${space.id}/members/${member.id}`, body: { role } })
  return member.id
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(new Date('2026-10-01T12:00:00.000Z'))
  service = buildService(config, { db, clock, files: new InMemoryFileStore() })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  req = await createSpace('REQ')
  prd = await createSpace('PRD')
  tec = await createSpace('TEC')
})

describe('the JQLs of fluxo-jira.md, as saved views', () => {
  it('REQ aguardando triagem: requests not yet triaged, oldest first', async () => {
    await card(req, 'Exportar faturas', '🧞‍♂️ Itens solicitados')
    await card(req, 'Já priorizado', '🚨 Itens priorizados')
    await card(req, 'Relatório de atrasos', '🧞‍♂️ Itens solicitados')
    await card(prd, 'Outro espaço', 'Backlog')

    const view = await saveView(
      'REQ aguardando triagem',
      req,
      {
        spaceIds: [req.id],
        stateIds: [req.states.get('🧞‍♂️ Itens solicitados')]
      },
      { order: { by: 'created', descending: false } }
    )

    expect(await keysOf(view)).toEqual(['REQ-1', 'REQ-3'])
  })

  it('Discovery em andamento: opportunities from Priorizado to Em validação', async () => {
    await card(prd, 'No backlog', 'Backlog')
    await card(prd, 'Priorizada', 'Priorizado')
    await card(prd, 'Desenhando', 'Em UX/UI')
    await card(prd, 'Subtarefa em especificação', 'Especificação', { typeId: prd.types.get('Subtarefa') })
    await card(prd, 'Já em delivery', 'Em Delivery')

    const view = await saveView(
      'Discovery em andamento',
      prd,
      {
        spaceIds: [prd.id],
        typeIds: [prd.types.get('Oportunidade')],
        stateIds: ['Priorizado', 'Especificação', 'Em UX/UI', 'Em validação'].map((name) => prd.states.get(name))
      },
      { order: { by: 'key', descending: false } }
    )

    expect(await keysOf(view)).toEqual(['PRD-2', 'PRD-3'])
  })

  it('Bloqueados: the Discovery Board cards in Bloqueado', async () => {
    await card(prd, 'Andando', 'Em validação')
    await card(prd, 'Travado', 'Bloqueado')

    const view = await saveView('Bloqueados', prd, { spaceIds: [prd.id], stateIds: [prd.states.get('Bloqueado')] })

    expect(await keysOf(view)).toEqual(['PRD-2'])
  })

  it('Lançados nos últimos 7 dias: moved to Lançado since -7d, not created there', async () => {
    const old = await card(prd, 'Lançado há dez dias', 'Preparando para lançar')
    const recent = await card(prd, 'Lançado há dois dias', 'Preparando para lançar')
    await move(prd, old, 'Lançado')
    clock.advance(8 * DAY)
    await move(prd, recent, 'Lançado')
    await card(prd, 'Criado já lançado', 'Lançado')
    clock.advance(2 * DAY)

    const lancado = prd.states.get('Lançado')
    const view = await saveView('Lançados nos últimos 7 dias', prd, {
      spaceIds: [prd.id],
      stateIds: [lancado],
      movedTo: { stateIds: [lancado], after: '-7d' }
    })

    expect(await keysOf(view)).toEqual(['PRD-2'])
    clock.advance(6 * DAY)
    expect(await keysOf(view)).toEqual([])
  })

  it('Por KR: one OKR label across REQ and PRD, not TEC', async () => {
    await card(req, 'Pedido do comercial', '🚨 Itens priorizados', { labels: ['okr-novos-clientes'] })
    await card(req, 'Outro KR', '🚨 Itens priorizados', { labels: ['okr-saude-escala'] })
    await card(prd, 'Oportunidade do KR', 'Priorizado', { labels: ['business-form', 'okr-novos-clientes'] })
    await card(tec, 'Tarefa do KR', 'BACKLOG', { labels: ['okr-novos-clientes'] })

    const view = await saveView(
      'Por KR: okr-novos-clientes',
      prd,
      {
        spaceIds: [req.id, prd.id],
        labelsAny: ['okr-novos-clientes']
      },
      { order: { by: 'key', descending: false } }
    )

    expect(await keysOf(view)).toEqual(['PRD-1', 'REQ-1'])
  })

  it('REQ sem ligação com OKR: triaged requests with none of the OKR labels', async () => {
    await card(req, 'Sem label', '🚨 Itens priorizados')
    await card(req, 'Com KR', '🚨 Itens priorizados', { labels: ['okr-expansao-base'] })
    await card(req, 'Ainda na triagem', '🧞‍♂️ Itens solicitados')

    const view = await saveView('REQ sem ligação com OKR', req, {
      spaceIds: [req.id],
      notStateIds: [req.states.get('🧞‍♂️ Itens solicitados')],
      labelsNone: ['okr-novos-clientes', 'okr-expansao-base', 'okr-saude-escala', 'okr-nenhum']
    })

    expect(await keysOf(view)).toEqual(['REQ-1'])
  })
})

describe('who sees and changes a view', () => {
  it('a space view runs the same for every reader: all of LET’S reads the space (ADR-0012)', async () => {
    const gil = await giveRole('gil@uselets.com', 'reader', prd)
    await card(prd, 'Do Gil', 'Bloqueado', { assigneeId: gil })
    await card(prd, 'De outra pessoa', 'Bloqueado')
    const view = await saveView('Bloqueados', prd, { stateIds: [prd.states.get('Bloqueado')] })

    expect(await keysOf(view)).toEqual(['PRD-1', 'PRD-2'])
    expect(await keysOf(view, as('gil@uselets.com'))).toEqual(['PRD-1', 'PRD-2'])
  })

  it('a personal view is its owner alone; a reader may keep one but not share one', async () => {
    await giveRole('rui@uselets.com', 'reader', prd)
    const rui = as('rui@uselets.com')
    const mine = (await ok(
      rui({ method: 'POST', path: '/views', body: { name: 'Meus', scope: 'personal', spaceId: prd.id, filter: {} } }),
      201
    )) as { id: string; canEdit: boolean }
    const shared = await rui({
      method: 'POST',
      path: '/views',
      body: { name: 'Todos', scope: 'space', spaceId: prd.id }
    })

    expect(mine.canEdit).toBe(true)
    expect(shared.status).toBe(403)
    expect((await admin({ method: 'GET', path: `/views/${mine.id}` })).status).toBe(404)
    const listed = (await ok(rui({ method: 'GET', path: '/views', query: { spaceId: prd.id } }))) as {
      items: { name: string }[]
    }
    expect(listed.items.map((each) => each.name)).toEqual(['Meus'])
  })

  it('only the owner or a space admin changes a space view, and each change is in the audit trail', async () => {
    await giveRole('ana@uselets.com', 'member', prd)
    const view = await saveView('Bloqueados', prd, { stateIds: [prd.states.get('Bloqueado')] })
    const path = `/views/${view.id}`

    expect((await as('ana@uselets.com')({ method: 'PATCH', path, body: { name: 'Meu' } })).status).toBe(403)
    clock.advance(1000)
    const renamed = (await ok(admin({ method: 'PATCH', path, body: { name: 'Travados' } }))) as { name: string }
    expect(renamed.name).toBe('Travados')
    clock.advance(1000)
    const left = (await ok(admin({ method: 'DELETE', path }))) as { items: unknown[] }
    expect(left.items).toEqual([])
    const trail = (await ok(admin({ method: 'GET', path: `/spaces/${prd.id}/history` }))) as {
      items: { entityType: string; action: string }[]
    }
    const actions = trail.items.filter((each) => each.entityType === 'saved_view').map((each) => each.action)
    expect(actions).toEqual(['deleted', 'updated', 'created'])
  })

  it('refuses a space view without a space and a filter that names a bad value', async () => {
    expect((await admin({ method: 'POST', path: '/views', body: { name: 'X', scope: 'space' } })).status).toBe(400)
    const bad = { name: 'X', scope: 'personal', filter: { movedTo: { stateIds: [], after: 'ontem' } } }
    expect((await admin({ method: 'POST', path: '/views', body: bad })).status).toBe(400)
  })
})

describe('the Lista leaves out what was done long ago (ADR-0040)', () => {
  /** TEC: one card done 90 days ago, one done 10 days ago, one reopened, one never done, one created done. */
  const seed = async () => {
    const old = await card(tec, 'Concluído há muito', 'EM PROGRESSO')
    const reopened = await card(tec, 'Reaberto', 'EM PROGRESSO')
    const recent = await card(tec, 'Concluído há pouco', 'EM PROGRESSO')
    await card(tec, 'Em andamento', 'EM PROGRESSO')
    await move(tec, old, 'CONCLUÍDO')
    await move(tec, reopened, 'CONCLUÍDO')
    clock.advance(80 * DAY)
    await move(tec, reopened, 'EM PROGRESSO')
    await move(tec, recent, 'CONCLUÍDO')
    await card(tec, 'Criado já concluído', 'CONCLUÍDO')
    clock.advance(10 * DAY)
  }

  const listed = async (query: Record<string, string>) =>
    ((await ok(admin({ method: 'GET', path: `/spaces/${tec.id}/cards`, query }))) as { items: Card[] }).items
      .map((each) => each.key)
      .sort()

  it('lists every card but those that entered a done state before -60d', async () => {
    await seed()
    expect(await listed({})).toEqual(['TEC-1', 'TEC-2', 'TEC-3', 'TEC-4', 'TEC-5'])
    expect(await listed({ doneSince: '-60d' })).toEqual(['TEC-2', 'TEC-3', 'TEC-4', 'TEC-5'])
  })

  it('is a condition of the structured filter too', async () => {
    await seed()
    const view = await saveView('Sem concluídos antigos', tec, { spaceIds: [tec.id], doneSince: '-60d' })
    expect((await keysOf(view)).sort()).toEqual(['TEC-2', 'TEC-3', 'TEC-4', 'TEC-5'])
  })

  it('refuses a bound that is not days in the past', async () => {
    expect((await admin({ method: 'GET', path: `/spaces/${tec.id}/cards`, query: { doneSince: '60' } })).status).toBe(
      400
    )
  })
})
