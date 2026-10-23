import { describe, expect, it } from 'vitest'

import type { Widget } from '@/api/reports'

import {
  bucketLabel,
  countCaption,
  foldSlices,
  formatDays,
  idealLine,
  moveWidget,
  niceScale,
  shiftWidget,
  sliceLabel,
  titleOf,
  unitText
} from './reports'

const widget = (id: string): Widget => ({ id, kind: 'cards', width: 'full' })

describe('reports', () => {
  it('names a widget from what it shows, unless it has a title', () => {
    expect(titleOf({ id: 'a', kind: 'breakdown', by: 'assignee', chart: 'donut', width: 'third' })).toBe(
      'Itens por responsável'
    )
    expect(titleOf({ id: 'a', kind: 'timing', measure: 'cycle', interval: 'week', days: 90, width: 'half' })).toBe(
      'Tempo de ciclo'
    )
    expect(titleOf({ id: 'a', kind: 'cards', width: 'full', title: 'Bugs' })).toBe('Bugs')
  })

  it('says what a number counts', () => {
    expect(countCaption({ id: 'a', kind: 'count', measure: 'completed', days: 7, width: 'quarter' })).toBe(
      'nos últimos 7 dias'
    )
    expect(countCaption({ id: 'a', kind: 'count', measure: 'due_soon', days: 1, width: 'quarter' })).toBe(
      'vencem nos próximos 1 dia'
    )
  })

  it('names a slice: none, a priority, a group, or as the API names it', () => {
    expect(sliceLabel('assignee', { key: null, label: null })).toBe('Sem responsável')
    expect(sliceLabel('priority', { key: 'highest', label: null })).toBe('Altíssima')
    expect(sliceLabel('state_group', { key: 'done', label: null })).toBe('Concluído')
    expect(sliceLabel('state', { key: 'id', label: 'Lançado' })).toBe('Lançado')
  })

  it('folds the smallest slices into Outros past seven', () => {
    const slices = Array.from({ length: 10 }, (_, index) => ({ label: `s${index}`, count: 10 - index }))
    const folded = foldSlices(slices)
    expect(folded).toHaveLength(8)
    expect(folded[7]).toEqual({ label: 'Outros', count: 3 + 2 + 1 })
    expect(foldSlices(slices.slice(0, 8))).toHaveLength(8)
  })

  it('rounds the axis to a step of 1, 2 or 5', () => {
    expect(niceScale(23)).toEqual({ max: 25, ticks: [0, 5, 10, 15, 20, 25] })
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] })
    expect(niceScale(130, 4).max).toBe(150)
  })

  it('names buckets and days in pt-BR', () => {
    expect(bucketLabel('2026-10-05', 'week')).toBe('05/10')
    expect(bucketLabel('2026-10-01', 'month')).toBe('out/26')
    expect(formatDays(3.46)).toBe('3,5 dias')
    expect(formatDays(1)).toBe('1 dia')
    expect(formatDays(null)).toBe('—')
  })

  it('moves a widget before another, to the end, or one step', () => {
    const widgets = ['a', 'b', 'c'].map(widget)
    expect(moveWidget(widgets, 'c', 'a').map((each) => each.id)).toEqual(['c', 'a', 'b'])
    expect(moveWidget(widgets, 'a', null).map((each) => each.id)).toEqual(['b', 'c', 'a'])
    expect(shiftWidget(widgets, 'b', 1).map((each) => each.id)).toEqual(['a', 'c', 'b'])
    expect(shiftWidget(widgets, 'a', -1).map((each) => each.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('the sprint reports (ADR-0029)', () => {
  it('draws the ideal from the first day’s scope to nothing on the last day, and nothing after', () => {
    expect(idealLine(['10-20', '10-21', '10-22'], 8, '10-22')).toEqual([8, 4, 0])
    expect(idealLine(['10-20', '10-21', '10-22', '10-23'], 6, '10-22')).toEqual([6, 3, 0, 0])
  })

  it('says a number in the space’s unit', () => {
    expect(unitText(1, 'points')).toBe('1 ponto')
    expect(unitText(12.5, 'points')).toBe('12,5 pontos')
    expect(unitText(3, 'cards')).toBe('3 cards')
  })
})
