import { describe, expect, it } from 'vitest'

import {
  assignableIds,
  conditionCount,
  dueChoice,
  dueRange,
  filterParam,
  hasField,
  isEmpty,
  readFilter,
  sameFilter,
  toggleField,
  toggleValue,
  withoutSpaces,
  withParams
} from './filters'

describe('the filter in the address', () => {
  it('reads ?filtro= and ignores anything that is not an object', () => {
    expect(readFilter('?filtro=%7B%22priorities%22%3A%5B%22high%22%5D%7D')).toEqual({ priorities: ['high'] })
    expect(readFilter('?filtro=nada')).toEqual({})
    expect(readFilter('?filtro=%5B1%5D')).toEqual({})
    expect(readFilter('')).toEqual({})
  })

  it('writes nothing for an empty filter and keeps the other parameters', () => {
    expect(filterParam({ labelsAny: [] })).toBeUndefined()
    expect(withParams('/espacos/PRD?aba=lista&filtro=x', { filtro: undefined })).toBe('/espacos/PRD?aba=lista')
    expect(withParams('/espacos/PRD', { visao: 'v1' })).toBe('/espacos/PRD?visao=v1')
  })
})

describe('editing a filter', () => {
  it('toggles a value on and off, dropping the condition when it empties', () => {
    const on = toggleValue({}, 'stateIds', 's1')
    expect(on).toEqual({ stateIds: ['s1'] })
    expect(toggleValue(on, 'stateIds', 's1')).toEqual({})
  })

  it('toggles a custom field option the same way', () => {
    const on = toggleField({}, 'f1', 'Core')
    expect(hasField(on, 'f1', 'Core')).toBe(true)
    expect(toggleField(on, 'f1', 'Core')).toEqual({})
  })

  it('counts conditions, a custom field once per field', () => {
    expect(conditionCount({ stateIds: ['a', 'b'], fields: [{ fieldId: 'f', anyOf: ['x'] }] })).toBe(2)
    expect(isEmpty({ text: '' })).toBe(true)
  })

  it('turns due choices into ranges and back', () => {
    expect(dueRange('overdue')).toEqual({ to: '-1d' })
    expect(dueChoice({ from: '+0d', to: '+7d' })).toBe('week')
    expect(dueChoice(undefined)).toBe('')
  })
})

describe('comparing filters', () => {
  it('ignores key order and empty conditions', () => {
    expect(
      sameFilter({ stateIds: ['a'], priorities: ['high'] }, { priorities: ['high'], stateIds: ['a'], text: '' })
    ).toBe(true)
    expect(sameFilter({ stateIds: ['a'] }, { stateIds: ['b'] })).toBe(false)
  })

  it('drops the spaces a view looked across', () => {
    expect(withoutSpaces({ spaceIds: ['s'], labelsAny: ['x'] })).toEqual({ labelsAny: ['x'] })
  })
})

describe('assignableIds', () => {
  it('offers role holders and the people cards are assigned to, not the rest of the organization', () => {
    const ids = assignableIds([{ memberId: 'ana' }], [{ assignee: { id: 'bia' } }, { assignee: null }], {})
    expect([...ids].sort()).toEqual(['ana', 'bia'])
  })

  it('keeps someone the filter already names, so the chip can still be turned off', () => {
    expect(assignableIds([], [], { assignees: ['caio'] }).has('caio')).toBe(true)
  })
})
