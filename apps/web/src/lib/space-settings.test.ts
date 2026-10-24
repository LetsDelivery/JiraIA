import { describe, expect, it } from 'vitest'

import { movedTab, sectionOf, settingsPath } from './space-settings'

describe('space settings', () => {
  it('addresses each section under the space', () => {
    expect(settingsPath('TEC', 'tipos')).toBe('/espacos/TEC/configuracoes/tipos')
    expect(settingsPath('TEC')).toBe('/espacos/TEC/configuracoes/geral')
  })

  it('opens the first section for none or one that does not exist', () => {
    expect(sectionOf(undefined)).toBe('geral')
    expect(sectionOf('nada')).toBe('geral')
    expect(sectionOf('fluxo')).toBe('fluxo')
  })

  it('sends the tabs that moved to their section, and leaves the work tabs alone', () => {
    expect(movedTab('TEC', 'pessoas')).toBe('/espacos/TEC/configuracoes/pessoas')
    expect(movedTab('TEC', 'automacoes')).toBe('/espacos/TEC/configuracoes/automacoes')
    expect(movedTab('TEC', 'lista')).toBeUndefined()
    expect(movedTab('TEC', null)).toBeUndefined()
  })
})
