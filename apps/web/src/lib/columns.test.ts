import { describe, expect, it } from 'vitest'

import { sortRows, toggleColumn } from './columns'

describe('columns', () => {
  it('toggles a column and keeps the offered order', () => {
    const offered = ['key', 'title', 'state', 'priority']
    expect(toggleColumn(['priority', 'key'], 'title', offered)).toEqual(['key', 'title', 'priority'])
    expect(toggleColumn(['key', 'title'], 'key', offered)).toEqual(['title'])
  })

  it('sorts keys as numbers and keeps blanks last both ways', () => {
    const rows = ['PRD-10', '', 'PRD-9']
    expect(sortRows(rows, (row) => row, false)).toEqual(['PRD-9', 'PRD-10', ''])
    expect(sortRows(rows, (row) => row, true)).toEqual(['PRD-10', 'PRD-9', ''])
  })
})
