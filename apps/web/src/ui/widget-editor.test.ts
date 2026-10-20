import { describe, expect, it } from 'vitest'

import { CATALOG, searchCatalog } from './widget-editor'

describe('the widget catalog', () => {
  it('finds entries by name or description, accents ignored', () => {
    expect(searchCatalog('').length).toBe(CATALOG.length)
    expect(searchCatalog('grafico').map((each) => each.label)).toContain('Gráfico')
    expect(searchCatalog('responsavel').map((each) => each.label)).toEqual([
      'Itens por responsável',
      'Estado por responsável',
      'Lista de itens'
    ])
    expect(searchCatalog('commits')).toEqual([])
  })

  it('makes a fresh widget each time', () => {
    const entry = CATALOG[0]
    expect(entry?.make().id).not.toBe(entry?.make().id)
  })
})
