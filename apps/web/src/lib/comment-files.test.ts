import { describe, expect, it } from 'vitest'

import { citations, pastedName } from './comment-files'

const file = (name: string, createdAt = '2026-06-22T22:11:00.000Z') => ({ name, createdAt })

describe('files cited in a comment', () => {
  it('finds each `📎 name` the card has a file for', () => {
    const files = [file('image-20260622-221103.png'), file('image-20260622-221412.png')]
    const text = 'veja 📎 image-20260622-221103.png e 📎 image-20260622-221412.png'
    expect(
      citations(text, files, '2026-06-22T22:19:00.000Z').map((each) => [each.start, each.end, each.file.name])
    ).toEqual([
      [5, 33, 'image-20260622-221103.png'],
      [36, 64, 'image-20260622-221412.png']
    ])
  })

  it('leaves a citation alone when the card has no such file', () => {
    expect(citations('📎 apagado.pdf', [file('outro.pdf')], '2026-06-22T22:19:00.000Z')).toEqual([])
  })

  it('takes the longest name, and of one name the file sent nearest the comment', () => {
    const files = [file('tela.png'), file('tela.png.zip'), file('a b.png', '2026-01-01T00:00:00.000Z'), file('a b.png')]
    expect(citations('📎 tela.png.zip', files, '2026-06-22T22:19:00.000Z')[0]?.file.name).toBe('tela.png.zip')
    expect(citations('📎 a b.png', files, '2026-06-22T22:19:00.000Z')[0]?.file).toBe(files[3])
  })
})

describe('the name of a pasted file', () => {
  const now = new Date('2026-10-31T17:42:10.000Z')

  it('carries the moment it was pasted, as Jira names screenshots', () => {
    expect(pastedName({ name: 'image.png', type: 'image/png' }, now, new Set())).toBe('image-20261031-174210.png')
  })

  it('never repeats a name the card already has', () => {
    const taken = new Set(['image-20261031-174210.png'])
    expect(pastedName({ name: 'image.png', type: 'image/png' }, now, taken)).toBe('image-20261031-174210-2.png')
  })

  it('keeps a name of its own the card does not have yet', () => {
    expect(pastedName({ name: 'contrato.pdf', type: 'application/pdf' }, now, new Set())).toBe('contrato.pdf')
    expect(pastedName({ name: 'contrato.pdf', type: 'application/pdf' }, now, new Set(['contrato.pdf']))).toBe(
      'contrato-20261031-174210.pdf'
    )
  })

  it('takes the extension from the type when the name has none', () => {
    expect(pastedName({ name: '', type: 'image/jpeg' }, now, new Set())).toBe('arquivo-20261031-174210.jpeg')
  })
})
