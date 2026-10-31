import { describe, expect, it } from 'vitest'

import { extensionOf, previewKind, typeLabel } from './attachments'

describe('attachment previews', () => {
  it('goes by the type the browser sent', () => {
    expect(previewKind('a', 'image/png')).toBe('image')
    expect(previewKind('a', 'application/pdf')).toBe('pdf')
    expect(previewKind('a', 'video/mp4')).toBe('video')
    expect(previewKind('a', 'audio/mpeg')).toBe('audio')
    expect(previewKind('a', 'text/plain')).toBe('text')
    expect(previewKind('a', 'application/json')).toBe('text')
  })

  it('falls back on the extension when the type says nothing', () => {
    expect(previewKind('jadlog-integration.md', 'application/octet-stream')).toBe('text')
    expect(previewKind('contrato.PDF', 'application/octet-stream')).toBe('pdf')
    expect(previewKind('tela.jpeg', '')).toBe('image')
  })

  it('shows nothing it cannot draw itself', () => {
    expect(previewKind('planilha.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      'none'
    )
    expect(previewKind('pacote.zip', 'application/zip')).toBe('none')
    expect(previewKind('LEIAME', 'application/octet-stream')).toBe('none')
  })

  it('reads the extension after the last dot', () => {
    expect(extensionOf('relatorio.final.PDF')).toBe('pdf')
    expect(extensionOf('.env')).toBe('')
    expect(typeLabel('notas.md')).toBe('MD')
    expect(typeLabel('LEIAME')).toBe('ARQUIVO')
  })
})
