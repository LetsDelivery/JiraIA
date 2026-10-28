import { describe, expect, it } from 'bun:test'

import { currentSprintOf, type JiraSprint } from '../import/jira-mapping.js'

/** Etapa 8c: which sprint a Jira card is in now, whatever order Jira lists its sprints in. */
const sprint = (id: number, state: string, completeDate?: string): JiraSprint => ({
  id,
  name: `quadro Sprint ${id}`,
  state,
  startDate: '2026-01-01T12:00:00.000Z',
  ...(completeDate ? { completeDate } : {})
})

describe('the current sprint of a card', () => {
  it('is the active one, even when Jira lists a closed one after it', () => {
    const listed = [
      sprint(16, 'closed', '2026-09-26T12:00:00.000Z'),
      sprint(18, 'active'),
      sprint(17, 'closed', '2026-10-24T12:00:00.000Z')
    ]

    expect(currentSprintOf(listed)?.id).toBe(18)
  })

  it('is a future one before any closed one, and otherwise the closed one that ended last', () => {
    expect(currentSprintOf([sprint(17, 'closed', '2026-10-24T12:00:00.000Z'), sprint(19, 'future')])?.id).toBe(19)
    expect(
      currentSprintOf([
        sprint(17, 'closed', '2026-10-24T12:00:00.000Z'),
        sprint(16, 'closed', '2026-09-26T12:00:00.000Z')
      ])?.id
    ).toBe(17)
    expect(currentSprintOf([])).toBeUndefined()
  })
})
