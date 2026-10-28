import { beforeEach, describe, expect, it } from 'bun:test'

import { systemClock, uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { eq } from 'drizzle-orm'

import { buildService } from '../container.js'
import { bootstrapOrganization } from '../members/bootstrap.js'
import { boardColumns, workflowStates } from '../schema.js'

/** A space's board columns (ADR-0037): several states in one column, and states kept off the board. */
const db = await testDatabase('services/work/drizzle')
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS: ['uselets.com'],
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

type Workflow = {
  states: { id: string; name: string; columnId: string | null }[]
  columns: { id: string; name: string; position: number }[]
}

let service: ReturnType<typeof buildService>
let spaceId: string

const admin = async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims('admin@uselets.com') })))
const workflow = async () => (await admin({ method: 'GET', path: `/spaces/${spaceId}/workflow` })).body as Workflow

beforeEach(async () => {
  await truncateSchema(db, 'work')
  service = buildService(config, { db })
  await bootstrapOrganization(
    { db, clock: systemClock, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  spaceId = (
    (await admin({ method: 'POST', path: '/spaces', body: { key: 'TEC', name: 'Delivery Board', type: 'software' } }))
      .body as { id: string }
  ).id
})

describe('board columns', () => {
  it('are none for a new space, which draws one column per state', async () => {
    const view = await workflow()

    expect(view.columns).toEqual([])
    expect(view.states.every((state) => state.columnId === null)).toBe(true)
  })

  it('answer with the workflow, each state naming the column it shows in', async () => {
    const [first, second] = (await workflow()).states
    const columnId = uuidGenerator.next()
    await db
      .insert(boardColumns)
      .values({ id: columnId, spaceId, name: 'EM PROGRESSO', position: 0, createdAt: systemClock.now() })
    await db
      .update(workflowStates)
      .set({ columnId })
      .where(eq(workflowStates.id, String(first?.id)))

    const view = await workflow()

    expect(view.columns).toEqual([{ id: columnId, name: 'EM PROGRESSO', position: 0 }])
    expect(view.states.find((state) => state.id === first?.id)?.columnId).toBe(columnId)
    expect(view.states.find((state) => state.id === second?.id)?.columnId).toBeNull()
  })

  it('give a state added in a space with columns a column of its own, so it stays on the board', async () => {
    await db
      .insert(boardColumns)
      .values({ id: uuidGenerator.next(), spaceId, name: 'A FAZER', position: 0, createdAt: systemClock.now() })

    const view = (
      await admin({
        method: 'POST',
        path: `/spaces/${spaceId}/states`,
        body: { name: 'REVISAR', group: 'in_progress' }
      })
    ).body as Workflow
    const added = view.states.find((state) => state.name === 'REVISAR')

    expect(view.columns.map((column) => [column.name, column.position])).toEqual([
      ['A FAZER', 0],
      ['REVISAR', 1]
    ])
    expect(added?.columnId).toBe(view.columns[1]?.id ?? '')
  })
})
