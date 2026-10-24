import { describe, expect, it } from 'bun:test'

import { lookOf, swapId } from '../card-type.schemas.js'

describe('lookOf', () => {
  it('gives the usual types their icon and colour, whatever the case', () => {
    expect(lookOf('Bug')).toEqual({ icon: 'bug', color: 'red' })
    expect(lookOf(' história ')).toEqual({ icon: 'bookmark', color: 'green' })
    expect(lookOf('Protótipo')).toEqual({ icon: 'palette', color: 'pink' })
  })

  it('starts any other name plain', () => {
    expect(lookOf('Contrato')).toEqual({ icon: 'checkbox', color: 'gray' })
  })
})

describe('swapId', () => {
  it('turns the id into the other wherever it is, and keeps lists without repeats', () => {
    const rule = {
      conditions: [{ type: 'type_is', typeIds: ['old', 'kept', 'new'] }],
      actions: [{ type: 'create_card', typeId: 'old' }]
    }
    expect(swapId(rule, 'old', 'new')).toEqual({
      conditions: [{ type: 'type_is', typeIds: ['new', 'kept'] }],
      actions: [{ type: 'create_card', typeId: 'new' }]
    })
  })

  it('leaves what does not name the id as it was', () => {
    expect(swapId({ typeIds: [], labels: ['old-ish'], count: 2 }, 'old', 'new')).toEqual({
      typeIds: [],
      labels: ['old-ish'],
      count: 2
    })
  })
})
