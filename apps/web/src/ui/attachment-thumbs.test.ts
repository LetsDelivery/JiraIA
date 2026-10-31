import { describe, expect, it } from 'vitest'

import type { Attachment } from '@/api/requests'

import { thumb } from './attachment-thumbs'

const file = (name: string, contentType: string, size = 1000): Attachment => ({
  id: `id-${name}`,
  name,
  contentType,
  size,
  uploadedBy: { id: 'u1', name: 'Ana' },
  createdAt: '2026-10-31T12:00:00.000Z',
  url: `/files/${name}?download`,
  previewUrl: `/files/${name}?inline`
})

describe('attachment tiles', () => {
  it('shows a picture or a video frame at once', () => {
    expect(thumb(file('fluxo.png', 'image/png')).value).toContain(
      '<img class="attachment-thumb" src="/files/fluxo.png?inline"'
    )
    expect(thumb(file('demo.mp4', 'video/mp4')).value).toContain('src="/files/demo.mp4?inline#t=0.5"')
  })

  it('leaves a PDF and a small text to be drawn after the tile shows', () => {
    expect(thumb(file('exames.pdf', 'application/pdf')).value).toContain('data-thumb="id-exames.pdf"')
    expect(thumb(file('notas.md', 'application/octet-stream')).value).toContain('data-thumb="id-notas.md"')
  })

  it('keeps the glyph for what is too big to fetch or cannot be drawn', () => {
    expect(thumb(file('enorme.pdf', 'application/pdf', 50 * 1024 * 1024)).value).not.toContain('data-thumb')
    expect(thumb(file('log.txt', 'text/plain', 1024 * 1024)).value).not.toContain('data-thumb')
    expect(thumb(file('planilha.xlsx', 'application/vnd.ms-excel')).value).not.toContain('data-thumb')
  })
})
