import { beforeEach, describe, expect, it } from 'bun:test'

import { uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { InMemoryMailer, UnavailableMailer } from '../notifications/mailer.js'

/**
 * Etapa 5f: every e-mail — a mention and an access notice as they happen, a card's changes after
 * their window, the LET’S Draw AI morning summary and Monday's — through the API, with `drain()`
 * standing in for the bus and a clock the suite moves.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com', 'lets.delivery'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime',
  WEB_URL: 'https://jiraia.test'
}
const MINUTE = 60_000

let service: ReturnType<typeof buildService>
let mailer: InMemoryMailer
let now: Date
let spaceId: string
let states: { id: string; name: string }[]
const people: Record<string, string> = {}

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const ana = as('ana@uselets.com')
const gil = as('gil@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

const later = (minutes: number) => {
  now = new Date(now.getTime() + minutes * MINUTE)
}

const invite = async (email: string, name: string) => {
  const member = (await ok(admin({ method: 'POST', path: '/members', body: { email, name } }), 201)) as { id: string }
  people[email] = member.id
  await ok(admin({ method: 'PUT', path: `/spaces/${spaceId}/members/${member.id}`, body: { role: 'member' } }))
  await as(email)({ method: 'GET', path: '/me' })
}

const newCard = async (title: string) =>
  (await ok(admin({ method: 'POST', path: `/spaces/${spaceId}/cards`, body: { title } }), 201)) as {
    id: string
    key: string
  }

const comment = async (who: ReturnType<typeof as>, cardId: string, body: string) => {
  await ok(who({ method: 'POST', path: `/cards/${cardId}/comments`, body: { body } }), 201)
  await service.drain()
}

const build = (overrides: Parameters<typeof buildService>[1] = {}) =>
  buildService(config, { db, mailer, clock: { now: () => now }, ...overrides })

beforeEach(async () => {
  await truncateSchema(db, 'work')
  now = new Date('2026-10-19T12:00:00Z')
  mailer = new InMemoryMailer()
  service = build()
  await bootstrapOrganization(
    { db, clock: { now: () => now }, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  const space = (await ok(
    admin({ method: 'POST', path: '/spaces', body: { key: 'PRD', name: 'Discovery', type: 'business' } }),
    201
  )) as { id: string }
  spaceId = space.id
  states = ((await ok(admin({ method: 'GET', path: `/spaces/${spaceId}/workflow` }))) as { states: typeof states })
    .states
  await invite('ana@uselets.com', 'Ana Lima')
  await invite('gil@uselets.com', 'Gil Souza')
})

describe('the e-mails that go as it happens', () => {
  it('mails a mention at once, with its words and the card, and only once', async () => {
    const card = await newCard('Rastreio')
    await comment(ana, card.id, `<@${people['gil@uselets.com']}> revisa?`)

    expect(await service.mail.sendDue()).toEqual({ sent: 1, failed: 0 })
    expect(mailer.sent).toEqual([
      expect.objectContaining({ to: 'gil@uselets.com', subject: `Ana Lima mencionou você em ${card.key}` })
    ])
    expect(mailer.sent[0]?.html).toContain('Discovery / PRD-1')
    expect(mailer.sent[0]?.html).toContain(`https://jiraia.test/espacos/PRD?card=${card.key}#comentar`)
    expect(await service.mail.sendDue()).toEqual({ sent: 0, failed: 0 })
  })

  it('gathers a card’s changes for ten minutes, then mails them in one message, old → new', async () => {
    const card = await newCard('Painel de SLA')
    await comment(gil, card.id, 'Acompanhando')
    mailer.sent.length = 0
    await ok(admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { priority: 'high' } }))
    const target = states[1] as { id: string; name: string }
    await ok(admin({ method: 'POST', path: `/cards/${card.id}/move`, body: { stateId: target.id, index: 0 } }))
    await service.drain()

    expect(await service.mail.sendDue()).toEqual({ sent: 0, failed: 0 })
    later(11)
    // Admin hears about Gil's comment too: Admin follows the card it opened.
    expect(await service.mail.sendDue()).toEqual({ sent: 2, failed: 0 })
    const gils = mailer.sent.find((each) => each.to === 'gil@uselets.com')
    expect(gils?.subject).toBe(`Admin fez 2 atualizações em ${card.key}`)
    expect(gils?.text).toContain('Prioridade: Média → Alta')
    expect(gils?.text).toContain(`Estado: ${states[0]?.name} → ${target.name}`)
  })

  it('settles what a person keeps to the panel, so turning e-mail on later does not mail the past', async () => {
    await ok(
      gil({ method: 'PUT', path: '/me/notification-preferences', body: { kind: 'mentioned', channel: 'in_app' } })
    )
    const card = await newCard('Cotação')
    await comment(ana, card.id, `<@${people['gil@uselets.com']}> olha`)
    expect(await service.mail.sendDue()).toEqual({ sent: 0, failed: 0 })

    await ok(
      gil({ method: 'PUT', path: '/me/notification-preferences', body: { kind: 'mentioned', channel: 'email' } })
    )
    expect(await service.mail.sendDue()).toEqual({ sent: 0, failed: 0 })
    expect(mailer.sent).toEqual([])
  })

  it('settles unsent a notice two days old, so a first sender is not a flood of old news', async () => {
    const card = await newCard('Rastreio')
    await comment(ana, card.id, `<@${people['gil@uselets.com']}> revisa?`)
    later(49 * 60)

    expect(await service.mail.sendDue()).toEqual({ sent: 0, failed: 0 })
    later(-49 * 60)
    expect(await service.mail.sendDue()).toEqual({ sent: 0, failed: 0 })
  })

  it('does not mail what was read first', async () => {
    const card = await newCard('Cotação')
    await comment(ana, card.id, `<@${people['gil@uselets.com']}> olha`)
    await ok(gil({ method: 'POST', path: '/me/notifications/read-all' }))

    expect(await service.mail.sendDue()).toEqual({ sent: 0, failed: 0 })
  })

  it('mails a request to edit a space to its admins at once', async () => {
    await invite('rui@uselets.com', 'Rui')
    await ok(admin({ method: 'DELETE', path: `/spaces/${spaceId}/members/${people['rui@uselets.com']}` }), 204)
    await ok(
      as('rui@uselets.com')({
        method: 'POST',
        path: '/access-requests',
        body: { product: 'jiraia', spaceId, message: 'Sou de CS' }
      }),
      201
    )
    await service.drain()

    await service.mail.sendDue()
    expect(mailer.sent.map((each) => [each.to, each.subject])).toContainEqual([
      'admin@uselets.com',
      'Rui pediu para editar Discovery'
    ])
  })

  it('waits, keeping every notice, while there is no sender', async () => {
    const card = await newCard('Rastreio')
    await comment(ana, card.id, `<@${people['gil@uselets.com']}> revisa?`)
    service = build({ mailer: new UnavailableMailer() })
    expect(await service.mail.sendDue()).toEqual({ sent: 0, failed: 0 })

    service = build()
    expect(await service.mail.sendDue()).toEqual({ sent: 1, failed: 0 })
  })
})

describe('the LET’S Draw AI morning', () => {
  it('tells who helped write a page that someone else changed it, and who was mentioned', async () => {
    const draw = (await ok(admin({ method: 'POST', path: '/draw/spaces', body: { name: 'Produto' } }), 201)) as {
      id: string
    }
    await ok(
      admin({
        method: 'PUT',
        path: `/draw/spaces/${draw.id}/members/${people['ana@uselets.com']}`,
        body: { role: 'member' }
      })
    )
    const page = (await ok(
      admin({ method: 'POST', path: `/draw/spaces/${draw.id}/contents`, body: { title: 'SLAs' } }),
      201
    )) as { id: string }
    await ok(ana({ method: 'POST', path: `/draw/contents/${page.id}/versions`, body: {} }), 201)
    await ok(
      ana({
        method: 'POST',
        path: `/draw/contents/${page.id}/comments`,
        body: { body: `<@${people['gil@uselets.com']}> confere?` }
      }),
      201
    )
    await service.drain()

    expect(await service.mail.sendDue()).toEqual({ sent: 0, failed: 0 })
    expect(await service.mail.morning()).toEqual({ sent: 2, failed: 0 })
    const byPerson = new Map(mailer.sent.map((each) => [each.to, each]))
    expect(byPerson.get('admin@uselets.com')?.text).toContain('SLAs: Ana Lima alterou')
    expect(byPerson.get('admin@uselets.com')?.html).toContain(`/draw/${draw.id}/${page.id}?painel=versoes`)
    expect(byPerson.get('gil@uselets.com')?.text).toContain('Ana Lima comentou em SLAs: @Gil Souza confere?')
    expect(await service.mail.morning()).toEqual({ sent: 0, failed: 0 })
  })
})

describe('Monday’s summary', () => {
  it('lists unanswered mentions and open cards where the person works, until they answer', async () => {
    const card = await newCard('Rastreio')
    await newCard('Ninguém pegou')
    await comment(ana, card.id, `<@${people['gil@uselets.com']}> revisa?`)
    later(1)
    await comment(gil, card.id, 'Respondo a primeira')
    await ok(admin({ method: 'PATCH', path: `/cards/${card.id}`, body: { assigneeId: people['gil@uselets.com'] } }))
    later(1)
    await comment(ana, card.id, `<@${people['gil@uselets.com']}> e agora?`)
    mailer.sent.length = 0

    await service.mail.weekly()
    const gils = mailer.sent.find((each) => each.to === 'gil@uselets.com')
    expect(gils?.subject).toBe('Sua semana no JiraIA: 1 menção e 1 card sem responsável')
    expect(gils?.html).toContain('atribuir=eu')

    later(1)
    await comment(gil, card.id, 'Respondido')
    mailer.sent.length = 0
    await service.mail.weekly()
    expect(mailer.sent.find((each) => each.to === 'gil@uselets.com')?.subject).toBe(
      'Sua semana no JiraIA: 0 menções e 1 card sem responsável'
    )
  })

  it('tells a wiki page’s owner its review is near, and links to the page', async () => {
    const collection = (await ok(
      admin({ method: 'POST', path: '/wiki/collections', body: { name: 'Clientes', reviewDays: 30 } }),
      201
    )) as { id: string }
    const page = (await ok(
      admin({ method: 'POST', path: `/wiki/collections/${collection.id}/pages`, body: { title: 'Loja Exemplo' } }),
      201
    )) as { id: string }
    await ok(admin({ method: 'PUT', path: `/wiki/pages/${page.id}/official`, body: { official: true } }))
    await ok(
      admin({ method: 'PUT', path: `/wiki/pages/${page.id}/owner`, body: { ownerId: people['gil@uselets.com'] } })
    )
    mailer.sent.length = 0
    await service.mail.weekly()
    expect(mailer.sent.find((each) => each.to === 'gil@uselets.com')).toBeUndefined()

    later(20 * 24 * 60)
    await service.mail.weekly()
    const gils = mailer.sent.find((each) => each.to === 'gil@uselets.com')
    expect(gils?.subject).toBe('Sua semana no JiraIA: 0 menções e 0 cards sem responsável, 1 página para revisar')
    expect(gils?.html).toContain(`/wiki/${collection.id}/${page.id}`)
  })

  it('sends nothing to whoever turned it off', async () => {
    await ok(
      gil({ method: 'PUT', path: '/me/notification-preferences', body: { kind: 'weekly_summary', channel: 'none' } })
    )
    await newCard('Ninguém pegou')
    await comment(gil, (await newCard('Outro')).id, 'Trabalho aqui')

    await service.mail.weekly()
    expect(mailer.sent.map((each) => each.to)).not.toContain('gil@uselets.com')
  })
})
