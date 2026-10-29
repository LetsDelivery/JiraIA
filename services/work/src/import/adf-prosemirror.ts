import type { AdfNode } from './adf-markdown.js'

/**
 * Atlassian's document format (ADF) — a Confluence page — as the TipTap document LET'S Draw's editor
 * opens (`apps/web/src/editor/editor.ts`, ADR-0036). Only nodes and marks that editor knows are
 * written: one it does not know would stop the page from opening. What Draw has no node for keeps its
 * words — a status as highlighted text, a layout's columns one after another, a macro as a note.
 */
export type PmNode = {
  type: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: PmNode[]
  text?: string
}

/** A file the page shows, already imported as one of the page's files. */
export type PageFile = { fileId: string; name: string; size: number; image: boolean }

export type ProseMirrorOptions = {
  /** A member's id and name for an `@mention`; none keeps the name as text. */
  mention: (accountId: string) => { id: string; label: string } | undefined
  /** The page file a Confluence media id became; none keeps the file's name as text. */
  file: (mediaId: string) => PageFile | undefined
  /** An inline comment still open: its anchor in the page. Resolved ones leave no mark (as the app). */
  anchor: (annotationId: string) => string | undefined
}

const str = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value))
const text = (value: string, marks?: PmNode['marks']): PmNode => ({
  type: 'text',
  text: value,
  ...(marks?.length ? { marks } : {})
})
const paragraph = (content: PmNode[] = []): PmNode => ({ type: 'paragraph', ...(content.length ? { content } : {}) })

type MarkMap = (mark: { type: string; attrs?: Record<string, unknown> }, options: ProseMirrorOptions) => PmNode['marks']

const MARKS: Record<string, MarkMap> = {
  strong: () => [{ type: 'bold' }],
  em: () => [{ type: 'italic' }],
  strike: () => [{ type: 'strike' }],
  code: () => [{ type: 'code' }],
  underline: () => [{ type: 'underline' }],
  link: (mark) => [{ type: 'link', attrs: { href: str(mark.attrs?.href) } }],
  textColor: (mark) => [{ type: 'textStyle', attrs: { color: str(mark.attrs?.color) } }],
  backgroundColor: (mark) => [{ type: 'highlight', attrs: { color: str(mark.attrs?.color) } }],
  annotation: (mark, options) => {
    const id = options.anchor(str(mark.attrs?.id))
    return id ? [{ type: 'comment', attrs: { id } }] : []
  }
}

/** A text's marks, in Draw's names; `code` stands alone, as the editor allows. */
const marksOf = (node: AdfNode, options: ProseMirrorOptions): PmNode['marks'] => {
  const marks = (node.marks ?? []).flatMap((mark) => MARKS[mark.type]?.(mark, options) ?? [])
  return marks.some((mark) => mark.type === 'code')
    ? marks.filter((mark) => ['code', 'comment', 'link'].includes(mark.type))
    : marks
}

const formatDate = (timestamp: unknown): string => {
  const at = new Date(Number(timestamp))
  return Number.isNaN(at.getTime())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(at)
}

const INLINE: Record<string, (node: AdfNode, options: ProseMirrorOptions) => PmNode[]> = {
  text: (node, options) => (node.text ? [text(node.text, marksOf(node, options))] : []),
  hardBreak: () => [{ type: 'hardBreak' }],
  mention: (node, options) => {
    const member = options.mention(str(node.attrs?.id))
    return member ? [{ type: 'mention', attrs: member }] : [text(str(node.attrs?.text) || '@?')]
  },
  emoji: (node) => [text(str(node.attrs?.text) || str(node.attrs?.shortName))].filter((each) => each.text),
  date: (node) => [text(formatDate(node.attrs?.timestamp))].filter((each) => each.text),
  status: (node) => [
    text(str(node.attrs?.text).toUpperCase() || 'STATUS', [
      { type: 'bold' },
      { type: 'highlight', attrs: { color: '#dfe1e6' } }
    ])
  ],
  inlineCard: (node) => {
    const url = str(node.attrs?.url)
    return url ? [text(url, [{ type: 'link', attrs: { href: url } }])] : []
  },
  mediaInline: (node, options) => [text(`📎 ${options.file(str(node.attrs?.id))?.name ?? 'anexo'}`)],
  inlineExtension: (node) => [text(`[${str(node.attrs?.extensionKey) || 'macro'}]`, [{ type: 'italic' }])],
  placeholder: () => []
}

/** A run of inline nodes, as Draw's inline nodes. */
export const inline = (nodes: AdfNode[] | undefined, options: ProseMirrorOptions): PmNode[] =>
  (nodes ?? []).flatMap((node) => INLINE[node.type]?.(node, options) ?? inline(node.content, options))

const alignOf = (node: AdfNode): Record<string, unknown> => {
  const align = node.marks?.find((mark) => mark.type === 'alignment')?.attrs?.align
  return align === 'center' || align === 'end' ? { textAlign: align === 'end' ? 'right' : 'center' } : {}
}

/** Blocks that must hold at least one: a list item, a cell, a quote, a callout. */
const atLeastOne = (blocks: PmNode[]): PmNode[] => (blocks.length ? blocks : [paragraph()])

const listItem = (node: AdfNode, options: ProseMirrorOptions): PmNode => {
  const content = blocks(node.content, options)
  const first = content[0]?.type === 'paragraph' ? content : [paragraph(), ...content]
  return { type: 'listItem', content: first }
}

const taskItems = (node: AdfNode, options: ProseMirrorOptions): PmNode[] =>
  (node.content ?? []).flatMap((item) =>
    item.type === 'taskList' || item.type === 'decisionList'
      ? []
      : [
          {
            type: 'taskItem',
            attrs: { checked: item.attrs?.state === 'DONE' || item.attrs?.state === 'DECIDED' },
            content: [paragraph(inline(item.content, options))]
          }
        ]
  )

const cell = (node: AdfNode, options: ProseMirrorOptions): PmNode => ({
  type: node.type === 'tableHeader' ? 'tableHeader' : 'tableCell',
  attrs: { colspan: Number(node.attrs?.colspan) || 1, rowspan: Number(node.attrs?.rowspan) || 1 },
  content: atLeastOne(blocks(node.content, options))
})

const media = (node: AdfNode, options: ProseMirrorOptions): PmNode[] =>
  (node.content ?? [])
    .filter((child) => child.type === 'media')
    .map((child) => {
      const file = options.file(str(child.attrs?.id))
      if (!file) {
        return paragraph([text(`📎 ${str(child.attrs?.alt) || 'anexo'}`)])
      }
      return {
        type: file.image ? 'pageImage' : 'pageFile',
        attrs: { fileId: file.fileId, name: file.name, size: file.size }
      }
    })

type BlockMap = (node: AdfNode, options: ProseMirrorOptions) => PmNode[]

const BLOCKS: Record<string, BlockMap> = {
  paragraph: (node, options) => [
    {
      ...paragraph(inline(node.content, options)),
      ...(Object.keys(alignOf(node)).length ? { attrs: alignOf(node) } : {})
    }
  ],
  heading: (node, options) => [
    {
      type: 'heading',
      attrs: { level: Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)), ...alignOf(node) },
      content: inline(node.content, options)
    }
  ],
  bulletList: (node, options) => [
    { type: 'bulletList', content: (node.content ?? []).map((item) => listItem(item, options)) }
  ],
  orderedList: (node, options) => [
    {
      type: 'orderedList',
      attrs: { start: Number(node.attrs?.order) || 1 },
      content: (node.content ?? []).map((item) => listItem(item, options))
    }
  ],
  taskList: (node, options) => [{ type: 'taskList', content: taskItems(node, options) }],
  decisionList: (node, options) => [{ type: 'taskList', content: taskItems(node, options) }],
  blockquote: (node, options) => [{ type: 'blockquote', content: atLeastOne(blocks(node.content, options)) }],
  panel: (node, options) => [{ type: 'callout', content: atLeastOne(blocks(node.content, options)) }],
  codeBlock: (node) => {
    const code = (node.content ?? []).map((child) => str(child.text)).join('')
    return [
      {
        type: 'codeBlock',
        attrs: { language: str(node.attrs?.language) || null },
        ...(code ? { content: [text(code)] } : {})
      }
    ]
  },
  rule: () => [{ type: 'horizontalRule' }],
  table: (node, options) => [
    {
      type: 'table',
      content: (node.content ?? []).map((row) => ({
        type: 'tableRow',
        content: (row.content ?? []).map((each) => cell(each, options))
      }))
    }
  ],
  expand: (node, options) => [
    paragraph([text(str(node.attrs?.title) || 'Detalhes', [{ type: 'bold' }])]),
    ...blocks(node.content, options)
  ],
  mediaSingle: media,
  mediaGroup: media,
  blockCard: (node) => INLINE.inlineCard?.(node, {} as ProseMirrorOptions).map((each) => paragraph([each])) ?? [],
  embedCard: (node) => INLINE.inlineCard?.(node, {} as ProseMirrorOptions).map((each) => paragraph([each])) ?? [],
  extension: (node) => [
    paragraph([text(`[Macro do Confluence: ${str(node.attrs?.extensionKey) || 'macro'}]`, [{ type: 'italic' }])])
  ],
  caption: (node, options) => [
    paragraph(
      inline(node.content, options).map((each) => ({ ...each, marks: [...(each.marks ?? []), { type: 'italic' }] }))
    )
  ]
}
BLOCKS.nestedExpand = BLOCKS.expand as BlockMap

/**
 * A run of blocks. A node Draw has no block for keeps what it holds: a layout's columns, a bodied
 * macro's body; text found loose at block level goes in a paragraph.
 */
export function blocks(nodes: AdfNode[] | undefined, options: ProseMirrorOptions): PmNode[] {
  return (nodes ?? []).flatMap((node) => {
    const known = BLOCKS[node.type]
    if (known) {
      return known(node, options)
    }
    if (INLINE[node.type]) {
      return [paragraph(INLINE[node.type]?.(node, options))]
    }
    return blocks(node.content, options)
  })
}

/** A whole Confluence body, as Draw's document. */
export const adfToProseMirror = (document: unknown, options: ProseMirrorOptions): PmNode => {
  const root = (document ?? {}) as AdfNode
  return { type: 'doc', content: atLeastOne(blocks(root.content, options)) }
}

/** The words of a Draw document, as search and the version list read them (`content_text`). */
export const textOf = (node: PmNode): string => {
  if (node.type === 'text') {
    return node.text ?? ''
  }
  if (node.type === 'mention') {
    return `@${str(node.attrs?.label)}`
  }
  const inner = (node.content ?? []).map(textOf)
  return [
    'doc',
    'bulletList',
    'orderedList',
    'taskList',
    'table',
    'tableRow',
    'listItem',
    'callout',
    'blockquote'
  ].includes(node.type)
    ? inner.filter(Boolean).join('\n')
    : inner.join('')
}
