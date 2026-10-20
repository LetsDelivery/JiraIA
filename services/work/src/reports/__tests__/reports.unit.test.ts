import { describe, expect, it } from 'bun:test'

import { bucketKeys, bucketStart, fillBuckets, windowStart } from '../buckets.js'
import { DEFAULT_WIDGETS } from '../defaults.js'
import { matrixRows, weightedMean } from '../report.service.js'
import { saveDashboardSchema } from '../schemas.js'

const at = (iso: string) => new Date(iso)

describe('buckets', () => {
  it('cuts a day, an ISO week from Monday and a month in UTC', () => {
    expect(bucketStart(at('2026-10-15T23:30:00Z'), 'day').toISOString()).toBe('2026-10-15T00:00:00.000Z')
    expect(bucketStart(at('2026-10-18T10:00:00Z'), 'week').toISOString()).toBe('2026-10-12T00:00:00.000Z')
    expect(bucketStart(at('2026-10-12T00:00:00Z'), 'week').toISOString()).toBe('2026-10-12T00:00:00.000Z')
    expect(bucketStart(at('2026-10-31T12:00:00Z'), 'month').toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('lists every bucket of the window up to the current one', () => {
    expect(bucketKeys(at('2026-10-17T12:00:00Z'), 3, 'day')).toEqual(['2026-10-15', '2026-10-16', '2026-10-17'])
    expect(bucketKeys(at('2026-10-17T12:00:00Z'), 90, 'month')).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01'
    ])
    expect(windowStart(at('2026-10-17T12:00:00Z'), 7, 'week').toISOString()).toBe('2026-10-05T00:00:00.000Z')
  })

  it('crosses a year end month by month', () => {
    expect(bucketKeys(at('2027-01-10T00:00:00Z'), 45, 'month')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01'])
  })

  it('fills a quiet bucket with the empty value', () => {
    expect(fillBuckets(['a', 'b', 'c'], new Map([['b', 2]]), 0)).toEqual([0, 2, 0])
  })
})

describe('summaries', () => {
  it('weights the mean by the cards of each bucket', () => {
    const rows = [
      { count: 1, averageDays: 1 },
      { count: 3, averageDays: 5 },
      { count: 0, averageDays: null }
    ]
    expect(weightedMean(rows)).toBe(4)
    expect(weightedMean([])).toBeNull()
  })

  it('puts a row per key with a count per state, the fullest first', () => {
    const columns = [{ id: 's1' }, { id: 's2' }]
    const rows = matrixRows(columns, [
      { key: 'ana', label: 'Ana', stateId: 's2', count: 1 },
      { key: null, label: null, stateId: 's1', count: 2 },
      { key: null, label: null, stateId: 's2', count: 1 }
    ])
    expect(rows).toEqual([
      { key: null, label: null, counts: [2, 1], total: 3 },
      { key: 'ana', label: 'Ana', counts: [0, 1], total: 1 }
    ])
  })

  it('keeps the default dashboard valid', () => {
    expect(saveDashboardSchema.safeParse({ widgets: DEFAULT_WIDGETS }).success).toBe(true)
  })
})
