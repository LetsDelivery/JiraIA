import { describe, expect, it } from 'bun:test'
import type { Database } from '@jiraia/db'
import { drizzle } from 'drizzle-orm/aws-data-api/pg'

import { registerLabels } from '../cards/card.repository.js'
import { MyCardsRepository } from '../personal/my-cards.repository.js'
import type { MyCardTab } from '../personal/my-cards.schemas.js'

type Parameter = { name: string; value: { stringValue?: string }; typeHint?: string }

/**
 * An RDS Data API that answers nothing and keeps each statement's parameters. Local Postgres guesses
 * a parameter's type; the Data API does not, and refuses `uuid = text` (ADR-0002).
 */
class RecordingDataApi {
  readonly parameters: Parameter[] = []

  async send(command: { input: { parameters?: Parameter[] } }) {
    this.parameters.push(...(command.input.parameters ?? []))
    return { records: [], columnMetadata: [] }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ME = '1831f6f8-8d4e-4713-8b2e-fab699072f34'
const ORGANIZATION = '13b4d4cd-ca11-4efc-aa46-3a0075d1db90'

const recording = () => {
  const api = new RecordingDataApi()
  const db = drizzle(api as never, { resourceArn: 'arn', secretArn: 'arn', database: 'jiraia' })
  return { api, db: db as unknown as Database }
}

/** Every parameter holding a uuid, and the type the Data API is told it has. */
const uuidHints = (api: RecordingDataApi) =>
  api.parameters.filter(({ value }) => UUID.test(value.stringValue ?? '')).map(({ typeHint }) => typeHint)

describe('queries over the Data API', () => {
  it.each(['assigned', 'starred', 'recommended'] satisfies MyCardTab[])(
    'types every uuid of the %s tab',
    async (tab) => {
      const { api, db } = recording()
      await new MyCardsRepository(db).list(tab, { organizationId: ORGANIZATION, meId: ME })
      expect(uuidHints(api).length).toBeGreaterThan(0)
      expect(uuidHints(api).every((hint) => hint === 'UUID')).toBe(true)
    }
  )

  it("types the card's id when its labels are registered", async () => {
    const { api, db } = recording()
    await registerLabels(db, ME)
    expect(uuidHints(api)).toEqual(['UUID'])
  })
})
