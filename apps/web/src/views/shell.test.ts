import { describe, expect, it } from 'vitest'

import { foldedSections, toggleSection } from './shell'

describe('toggleSection', () => {
  it('folds an open list and opens it again, leaving the others as they were', () => {
    foldedSections.set(['recent'])
    toggleSection('all')
    expect(foldedSections.get()).toEqual(['recent', 'all'])
    toggleSection('all')
    expect(foldedSections.get()).toEqual(['recent'])
  })
})
