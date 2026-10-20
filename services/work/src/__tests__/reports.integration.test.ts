import { beforeEach, describe, expect, it } from 'bun:test'

import { fixedClock, uuidGenerator } from '@jiraia/core'
import { callerFromClaims } from '@jiraia/http'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'

import { LETS_WORKFLOWS } from '../cards/workflow-defaults.js'
import { buildService } from '../container.js'
import { InMemoryFileStore } from '../files/file-store.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { DEFAULT_WIDGETS } from '../reports/defaults.js'

/**
 * Etapa 5d (ADR-0016): a space's dashboard and the data of each widget, over a trail whose times the
 * test sets — so lead and cycle times are known to the hour.
 */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAIN: 'uselets.com',
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}
const DAY = 86_400_000
const START = new Date('2026-10-01T12:00:00.000Z').getTime()
const WIDGET = '11111111-1111-4111-8111-111111111111'

type Card = { id: string; key: string }
type Space = { id: string; states: Map<string, string> }

let service: ReturnType<typeof buildService>
let clock: ReturnType<typeof fixedClock>
let prd: Space
let req: Space

const as = (email: string) => async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims(email) })))
const admin = as('admin@uselets.com')
const reader = as('rui@uselets.com')

const ok = async (call: Promise<{ status: number; body: unknown }>, status = 200) => {
  const result = await call
  expect(result).toMatchObject({ status })
  return result.body
}

/** Moves the clock to `days` after the start; the trail records each write at that time. */
const travel = (days: number) => clock.advance(START + days * DAY - clock.now().getTime())

const createSpace = async (key: 'REQ' | 'PRD'): Promise<Space> => {
  const caller = callerFromClaims(googleClaims('admin@uselets.com'))
  const space = await service.spaces.create(
    caller,
    { key, name: key, description: '', type: 'business' },
    LETS_WORKFLOWS[key]
  )
  const workflow = await service.workflows.get(caller, space.id)
  return { id: space.id, states: new Map(workflow.states.map((state) => [state.name, state.id])) }
}

const card = async (title: string, state: string, extra: Record<string, unknown> = {}) => {
  const body = { title, stateId: prd.states.get(state), ...extra }
  return (await ok(admin({ method: 'POST', path: `/spaces/${prd.id}/cards`, body }), 201)) as Card
}

const move = async (target: Card, state: string) =>
  ok(admin({ method: 'POST', path: `/cards/${target.id}/move`, body: { stateId: prd.states.get(state), index: 0 } }))

const run = async (widget: Record<string, unknown>, who = admin, space = prd) =>
  (await ok(
    who({
      method: 'POST',
      path: `/spaces/${space.id}/reports/run`,
      body: { widget: { id: WIDGET, width: 'half', ...widget } }
    })
  )) as Record<string, unknown>

/**
 * A: Backlog → Especificação (day 2) → Lançado (day 5): lead 5, cycle 3.
 * B: Backlog → Lançado (day 1): lead 1, no cycle — it never was in progress.
 * C: created in Especificação → Lançado (day 4): lead 4, cycle 4.
 * D: created on day 6 in Backlog, labelled, assigned, due on day 9.
 */
const seedTimeline = async () => {
  const me = (await ok(admin({ method: 'GET', path: '/me' }))) as { id: string }
  const [a, b, c] = [await card('A', 'Backlog'), await card('B', 'Backlog'), await card('C', 'Especificação')]
  travel(1)
  await move(b, 'Lançado')
  travel(2)
  await move(a, 'Especificação')
  travel(4)
  await move(c, 'Lançado')
  travel(5)
  await move(a, 'Lançado')
  travel(6)
  const d = await card('D', 'Backlog', { labels: ['okr-x', 'okr-y'], assigneeId: me.id, priority: 'high' })
  await ok(admin({ method: 'PATCH', path: `/cards/${d.id}`, body: { dueDate: '2026-10-10' } }))
  clock.advance(DAY + 3_600_000)
  return { me, d }
}

beforeEach(async () => {
  await truncateSchema(db, 'work')
  clock = fixedClock(new Date(START))
  service = buildService(config, { db, clock, files: new InMemoryFileStore() })
  await bootstrapOrganization(
    { db, clock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  prd = await createSpace('PRD')
  req = await createSpace('REQ')
  await admin({ method: 'POST', path: '/members', body: { email: 'rui@uselets.com', name: 'Rui' } })
})

describe('the data of each widget', () => {
  it('counts what was created, updated, completed and is due in the last days', async () => {
    await seedTimeline()

    const count = async (measure: string, days: number) => (await run({ kind: 'count', measure, days })).value
    expect(await count('completed', 7)).toBe(3)
    expect(await count('completed', 3)).toBe(1)
    expect(await count('created', 7)).toBe(1)
    expect(await count('due_soon', 7)).toBe(1)
    expect(await count('updated', 3)).toBe(2)
  })

  it('splits the cards by state, by assignee and by label, the largest slice first', async () => {
    const { me } = await seedTimeline()

    expect(await run({ kind: 'breakdown', by: 'state', chart: 'donut' })).toEqual({
      kind: 'breakdown',
      total: 4,
      slices: [
        { key: prd.states.get('Lançado') ?? '', label: 'Lançado', count: 3 },
        { key: prd.states.get('Backlog') ?? '', label: 'Backlog', count: 1 }
      ]
    })
    const byAssignee = await run({ kind: 'breakdown', by: 'assignee', chart: 'bars' })
    expect(byAssignee.slices).toEqual([
      { key: null, label: null, count: 3 },
      { key: me.id, label: 'Admin', count: 1 }
    ])
    const byLabel = await run({ kind: 'breakdown', by: 'label', chart: 'bars' })
    expect(byLabel).toMatchObject({ total: 4, slices: [{ key: null, count: 3 }, { key: 'okr-x' }, { key: 'okr-y' }] })
  })

  it('counts creations per day and completions per ISO week, zero where nothing happened', async () => {
    await seedTimeline()

    const created = await run({ kind: 'trend', measure: 'created', interval: 'day', days: 10 })
    expect(created.buckets).toHaveLength(10)
    expect(created.buckets).toContainEqual({ start: '2026-10-01', count: 3 })
    expect(created.buckets).toContainEqual({ start: '2026-10-07', count: 1 })
    expect(created.buckets).toContainEqual({ start: '2026-10-03', count: 0 })

    const completed = await run({ kind: 'trend', measure: 'completed', interval: 'week', days: 14 })
    expect(completed.buckets).toEqual([
      { start: '2026-09-21', count: 0 },
      { start: '2026-09-28', count: 1 },
      { start: '2026-10-05', count: 2 }
    ])
  })

  it('measures lead time from creation and cycle time from the first move into progress', async () => {
    await seedTimeline()

    const lead = (await run({ kind: 'timing', measure: 'lead', interval: 'week', days: 14 })) as {
      buckets: { start: string; count: number; averageDays: number | null }[]
      averageDays: number
    }
    expect(lead.buckets.map((each) => each.count)).toEqual([0, 1, 2])
    expect(lead.buckets[1]?.averageDays).toBeCloseTo(1, 1)
    expect(lead.buckets[2]?.averageDays).toBeCloseTo(4.5, 1)
    expect(lead.averageDays).toBeCloseTo(10 / 3, 1)

    const cycle = (await run({ kind: 'timing', measure: 'cycle', interval: 'week', days: 14 })) as typeof lead
    expect(cycle.buckets.map((each) => each.count)).toEqual([0, 0, 2])
    expect(cycle.averageDays).toBeCloseTo(3.5, 1)
  })

  it('counts a reopened card from its last completion', async () => {
    const a = await card('A', 'Backlog')
    travel(1)
    await move(a, 'Lançado')
    travel(8)
    await move(a, 'Em Delivery')
    travel(9)
    await move(a, 'Lançado')

    expect((await run({ kind: 'count', measure: 'completed', days: 2 })).value).toBe(1)
  })

  it('crosses the states with the assignees, in board order', async () => {
    const { me } = await seedTimeline()

    const matrix = (await run({ kind: 'matrix', by: 'assignee' })) as {
      columns: { name: string }[]
      rows: { key: string | null; counts: number[]; total: number }[]
    }
    const names = matrix.columns.map((column) => column.name)
    expect(names[0]).toBe('Backlog')
    expect(matrix.rows[0]).toMatchObject({ key: null, total: 3 })
    expect(matrix.rows[0]?.counts[names.indexOf('Lançado')]).toBe(3)
    expect(matrix.rows[1]).toMatchObject({ key: me.id, total: 1 })
  })

  it('lists the cards a page at a time', async () => {
    await seedTimeline()

    const page = await run({ kind: 'cards' })
    expect(page).toMatchObject({ kind: 'cards', total: 4, page: 1, pageSize: 20 })
    expect((page.items as Card[]).map((each) => each.key)).toEqual(['PRD-1', 'PRD-2', 'PRD-3', 'PRD-4'])
    expect((page.items as unknown[])[3]).toMatchObject({
      type: 'Oportunidade',
      priority: 'high',
      state: { name: 'Backlog' }
    })
  })

  it('narrows the cards to a saved view of the space, and refuses a view from elsewhere', async () => {
    await seedTimeline()
    const view = (await ok(
      admin({
        method: 'POST',
        path: '/views',
        body: { name: 'OKR X', scope: 'space', spaceId: prd.id, filter: { labelsAny: ['okr-x'] } }
      }),
      201
    )) as { id: string }

    const narrowed = await run({ kind: 'breakdown', by: 'state', chart: 'bars', viewId: view.id })
    expect(narrowed).toMatchObject({ total: 1, slices: [{ label: 'Backlog', count: 1 }] })

    const elsewhere = await admin({
      method: 'POST',
      path: `/spaces/${req.id}/reports/run`,
      body: { widget: { id: WIDGET, width: 'half', kind: 'cards', viewId: view.id } }
    })
    expect(elsewhere).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } })
  })
})

describe('the dashboard', () => {
  const widgets = [
    { id: WIDGET, kind: 'breakdown', by: 'priority', chart: 'bars', width: 'half', title: 'Por prioridade' }
  ]

  it('shows the default dashboard until an admin saves one, to every reader', async () => {
    const shown = await ok(reader({ method: 'GET', path: `/spaces/${prd.id}/dashboard` }))
    expect(shown).toMatchObject({ isDefault: true, canEdit: false, updatedAt: null })
    expect((shown as { widgets: unknown[] }).widgets).toEqual([...DEFAULT_WIDGETS])
    expect((await ok(admin({ method: 'GET', path: `/spaces/${prd.id}/dashboard` }))) as object).toMatchObject({
      canEdit: true
    })
  })

  it('saves the widgets for everyone, audits the change, and restores the default', async () => {
    clock.advance(60_000)
    const saved = await ok(admin({ method: 'PUT', path: `/spaces/${prd.id}/dashboard`, body: { widgets } }))
    expect(saved).toMatchObject({ isDefault: false, widgets })
    expect(await ok(reader({ method: 'GET', path: `/spaces/${prd.id}/dashboard` }))).toMatchObject({ widgets })

    const history = (await ok(admin({ method: 'GET', path: `/spaces/${prd.id}/history` }))) as {
      items: { entityType: string; action: string }[]
    }
    expect(history.items[0]).toMatchObject({ entityType: 'dashboard', action: 'updated' })

    const restored = await ok(admin({ method: 'DELETE', path: `/spaces/${prd.id}/dashboard` }))
    expect(restored).toMatchObject({ isDefault: true, widgets: [...DEFAULT_WIDGETS] })
  })

  it('lets only the space admins change it, and every reader run its widgets', async () => {
    const refused = await reader({ method: 'PUT', path: `/spaces/${prd.id}/dashboard`, body: { widgets } })
    expect(refused).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } })
    expect(await run({ kind: 'cards' }, reader)).toMatchObject({ kind: 'cards', total: 0 })
  })

  it('refuses a widget narrowed by a personal view, and two widgets with one id', async () => {
    const personal = (await ok(
      admin({
        method: 'POST',
        path: '/views',
        body: { name: 'Minha', scope: 'personal', spaceId: prd.id, filter: {} }
      }),
      201
    )) as { id: string }
    const withPersonal = [{ ...widgets[0], viewId: personal.id }]

    const refused = await admin({ method: 'PUT', path: `/spaces/${prd.id}/dashboard`, body: { widgets: withPersonal } })
    expect(refused).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED' } } })
    const twice = await admin({
      method: 'PUT',
      path: `/spaces/${prd.id}/dashboard`,
      body: { widgets: [...widgets, ...widgets] }
    })
    expect(twice).toMatchObject({ status: 400 })
  })
})
