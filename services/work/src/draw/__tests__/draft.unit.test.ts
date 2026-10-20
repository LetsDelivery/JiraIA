import { describe, expect, it } from 'bun:test'

import { boardFromSections } from '../board-draft.js'
import { draftText, inline, markdownToDoc, OfflineDraftWriter } from '../draft.js'

describe('Markdown into the page editor’s document', () => {
  it('reads headings, lists, task lists, quotes, rules and code', () => {
    const doc = markdownToDoc(
      '# Spec\n\nContexto **importante**.\n- um\n- dois\n- [ ] validar\n- [x] feito\n1. primeiro\n> citação\n---\n```\nconst a = 1\n```'
    )
    expect(doc.content.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'taskList',
      'orderedList',
      'blockquote',
      'horizontalRule',
      'codeBlock'
    ])
    const tasks = doc.content[3] as { content: { attrs: { checked: boolean } }[] }
    expect(tasks.content.map((each) => each.attrs.checked)).toEqual([false, true])
  })

  it('marks bold, italic and code inside a line', () => {
    expect(inline('a **b** *c* `d`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'd', marks: [{ type: 'code' }] }
    ])
  })
})

describe('sections into a whiteboard', () => {
  it('lays each section out as a frame of notes, side by side', () => {
    const { elements } = boardFromSections([
      { title: 'Dores', notes: ['Atraso', 'Custo', 'Sem rastreio'] },
      { title: 'Ideias', notes: ['WhatsApp'] }
    ])
    const frames = elements.filter((element) => element.type === 'frame')
    expect(frames.map((frame) => frame.name)).toEqual(['Dores', 'Ideias'])
    expect(elements.filter((element) => element.type === 'rectangle')).toHaveLength(4)
    expect((frames[1]?.x ?? 0) > (frames[0]?.x ?? 0) + (frames[0]?.width ?? 0)).toBe(true)
  })

  it('ties each note and its text both ways, inside the frame of its section', () => {
    const { elements } = boardFromSections([{ title: 'Dores', notes: ['Atraso'] }])
    const [frame, note, text] = elements
    expect(note).toMatchObject({
      type: 'rectangle',
      frameId: frame?.id,
      boundElements: [{ id: text?.id, type: 'text' }]
    })
    expect(text).toMatchObject({ type: 'text', text: 'Atraso', containerId: note?.id, frameId: frame?.id })
  })

  it('keeps the text of a draft for search: the Markdown, or every title and note', () => {
    expect(
      draftText({ kind: 'whiteboard', title: 't', reply: '', markdown: '', sections: [{ title: 'A', notes: ['b'] }] })
    ).toBe('A\nb')
  })
})

describe('the offline stand-in', () => {
  it('outlines a page from the prompt and says it is not the model', async () => {
    const draft = await new OfflineDraftWriter().write({
      kind: 'auto',
      messages: [{ role: 'user', text: 'Processo de devolução de pedidos. Quem aprova e em quanto tempo.' }]
    })
    expect(draft).toMatchObject({ kind: 'page', title: 'Processo de devolução de pedidos' })
    expect(draft.reply).toContain('não está configurada')
  })

  it('picks a whiteboard when the prompt asks for one', async () => {
    const draft = await new OfflineDraftWriter().write({
      kind: 'auto',
      messages: [{ role: 'user', text: 'Um brainstorm de ideias.' }]
    })
    expect(draft.kind).toBe('whiteboard')
  })
})
