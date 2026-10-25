import { describe, expect, it } from 'vitest'

import { productOf, splash } from './splash'

describe('splash', () => {
  it('shows JiraIA outside LET’S Draw AI', () => {
    const markup = splash('/espacos').value
    expect(markup).toContain('Jira<span>IA</span>')
    expect(markup).toContain('Carregando…')
  })

  it('shows LET’S Draw AI on its home and inside it', () => {
    expect(splash('/draw').value).toContain('LET’S Draw <span>AI</span>')
    expect(splash('/draw/abc/def').value).toContain('LET’S Draw <span>AI</span>')
  })

  it('does not take a path that only starts with the word for LET’S Draw AI', () => {
    expect(splash('/drawings').value).toContain('Jira<span>IA</span>')
  })

  it('shows LET’S Wiki on its home and inside it', () => {
    expect(splash('/wiki').value).toContain('LET’S <span>Wiki</span>')
    expect(splash('/wiki/colecoes').value).toContain('LET’S <span>Wiki</span>')
    expect(splash('/wikipedia').value).toContain('Jira<span>IA</span>')
  })

  it('tells which product a path belongs to', () => {
    expect(['/', '/draw/a', '/wiki/c/p'].map(productOf)).toEqual(['jiraia', 'draw', 'wiki'])
  })
})
