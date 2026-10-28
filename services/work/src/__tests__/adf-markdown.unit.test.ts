import { describe, expect, it } from 'bun:test'

import { type AdfNode, adfToMarkdown } from '../import/adf-markdown.js'

/** Etapa 8c: Jira's and Confluence's documents become the Markdown a card description holds (ADR-0030). */
const ANA = '712020:00000000-0000-4000-8000-00000000000a'
const options = { mention: (id: string) => (id === ANA ? '<@member-ana>' : undefined) }
const doc = (...content: AdfNode[]) => ({ type: 'doc', version: 1, content })
const p = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content })
const t = (text: string, ...marks: string[]): AdfNode => ({
  type: 'text',
  text,
  marks: marks.map((type) => ({ type }))
})

describe('ADF to Markdown', () => {
  it('writes headings, marks, links and line breaks', () => {
    const markdown = adfToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [t('Contexto')] },
        p(t('Hoje '), t('não', 'strong'), t(' há '), t('rastreio', 'em'), { type: 'hardBreak' }, t('fim')),
        p(
          { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://uselets.com' } }] },
          t(' e '),
          t('a_b', 'code')
        )
      ),
      options
    )

    expect(markdown).toBe('## Contexto\n\nHoje **não** há *rastreio*  \nfim\n\n[site](https://uselets.com) e `a_b`')
  })

  it('nests bullet, numbered and task lists', () => {
    const item = (...content: AdfNode[]): AdfNode => ({ type: 'listItem', content })
    const markdown = adfToMarkdown(
      doc(
        {
          type: 'bulletList',
          content: [
            item(p(t('um')), { type: 'orderedList', attrs: { order: 3 }, content: [item(p(t('três')))] }),
            item(p(t('dois')))
          ]
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { state: 'DONE' }, content: [t('feito')] },
            { type: 'taskItem', attrs: { state: 'TODO' }, content: [t('falta')] }
          ]
        }
      ),
      options
    )

    expect(markdown).toBe('- um\n\n  3. três\n- dois\n\n- [x] feito\n- [ ] falta')
  })

  it('resolves a member’s mention and keeps anyone else’s name', () => {
    const markdown = adfToMarkdown(
      doc(
        p({ type: 'mention', attrs: { id: ANA, text: '@Ana' } }, t(' e '), {
          type: 'mention',
          attrs: { id: 'x', text: '@Lia' }
        })
      ),
      options
    )

    expect(markdown).toBe('<@member-ana> e @Lia')
  })

  it('draws a table with its header row and keeps pipes in cells', () => {
    const cellOf = (type: string, text: string): AdfNode => ({ type, content: [p(t(text))] })
    const markdown = adfToMarkdown(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cellOf('tableHeader', 'Canal'), cellOf('tableHeader', 'SLA')] },
          { type: 'tableRow', content: [cellOf('tableCell', 'iFood | Rappi'), cellOf('tableCell', '24h')] }
        ]
      }),
      options
    )

    expect(markdown).toBe('| Canal | SLA |\n| --- | --- |\n| iFood \\| Rappi | 24h |')
  })

  it('keeps the words of what Markdown cannot carry', () => {
    const markdown = adfToMarkdown(
      doc(
        { type: 'panel', attrs: { panelType: 'warning' }, content: [p(t('Atenção'))] },
        p({ type: 'status', attrs: { text: 'EM PRODUÇÃO' } }, t(' em '), {
          type: 'date',
          attrs: { timestamp: '1793145600000' }
        }),
        { type: 'codeBlock', attrs: { language: 'sql' }, content: [{ type: 'text', text: 'select 1' }] },
        { type: 'mediaSingle', content: [{ type: 'media', attrs: { alt: 'tela.png' } }] },
        { type: 'rule' }
      ),
      options
    )

    expect(markdown).toBe('> ⚠️ Atenção\n\n`EM PRODUÇÃO` em 2026-10-28\n\n```sql\nselect 1\n```\n\n📎 tela.png\n\n---')
  })

  it('escapes what would turn plain text into Markdown, and takes plain text and nothing as they are', () => {
    expect(adfToMarkdown(doc(p(t('2*3 e [x] <y>'))), options)).toBe('2\\*3 e \\[x\\] \\<y\\>')
    expect(adfToMarkdown('texto antigo', options)).toBe('texto antigo')
    expect(adfToMarkdown(null, options)).toBe('')
  })
})
