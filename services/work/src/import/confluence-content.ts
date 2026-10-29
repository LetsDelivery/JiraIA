import { gunzipSync } from 'node:zlib'

import type { AdfNode } from './adf-markdown.js'
import { adfToProseMirror, type PageFile, type PmNode, type ProseMirrorOptions } from './adf-prosemirror.js'
import type { Raw } from './atlassian-source.js'
import type { TreeRow } from './confluence-raw-copy.js'

/**
 * Etapa 8e (ADR-0036): what a Confluence node becomes in LET'S Draw, apart from the database writes —
 * its kind, its place among its siblings, its dates, and the document a page, a database or an embed
 * opens as. Pure, so the suite checks it without a database.
 */
export type DrawKind = 'folder' | 'page' | 'whiteboard'

/** A whiteboard or a database from the site backup, by Confluence content id. */
export type BackupDocument = { documentType: string; doc: unknown }

/** Pages, live docs, databases and embeds are pages in Draw; folders and whiteboards keep their kind. */
export const kindOf = (type: string): DrawKind =>
  type === 'folder' ? 'folder' : type === 'whiteboard' ? 'whiteboard' : 'page'

/** Confluence writes a date as ISO text or, on whiteboards and databases, as epoch milliseconds. */
export const dateOf = (value: unknown, fallback: Date): Date => {
  const parsed = new Date(typeof value === 'number' ? value : String(value))
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

/** The page's title emoji (`emoji-title-published`, code points in hex), or none. */
export const emojiOf = (node: Raw): string | null => {
  const results = ((node.properties as { results?: Raw[] } | undefined)?.results ?? []) as Raw[]
  const hex = String(results.find((property) => property.key === 'emoji-title-published')?.value ?? '')
  const points = hex.split('-').map((part) => Number.parseInt(part, 16))
  return hex && points.every((point) => Number.isInteger(point) && point > 0 && point <= 0x10ffff)
    ? String.fromCodePoint(...points)
    : null
}

/** A page's body: Atlassian's document, kept by Confluence as a JSON string. */
export const bodyOf = (node: Raw): unknown => {
  const value = (node.body as { atlas_doc_format?: { value?: unknown } } | undefined)?.atlas_doc_format?.value
  if (typeof value !== 'string' || value === '') {
    return { type: 'doc', content: [] }
  }
  return JSON.parse(value)
}

/**
 * Each node's position among its siblings, 1..n in Confluence's order. Archived pages, which Confluence
 * keeps out of the tree, go under one folder at the end of the space — `archiveId` — with what hangs on them.
 */
export const placeTree = (
  rows: TreeRow[],
  nodes: Map<string, Raw>,
  archiveId: string
): Map<string, { parentId: string | null; position: number }> => {
  const archived = new Set(rows.filter((row) => nodes.get(row.id)?.status === 'archived').map((row) => row.id))
  const parentOf = (row: TreeRow): string | null =>
    archived.has(row.id) && !archived.has(row.parentId ?? '') ? archiveId : row.parentId
  const siblings = Map.groupBy(rows, parentOf)
  const placed = new Map<string, { parentId: string | null; position: number }>()
  for (const [parentId, group] of siblings) {
    const ordered = [...group].sort(
      (a, b) =>
        Number(nodes.get(a.id)?.position ?? 0) - Number(nodes.get(b.id)?.position ?? 0) ||
        String(nodes.get(a.id)?.title ?? '').localeCompare(String(nodes.get(b.id)?.title ?? ''))
    )
    for (const [index, row] of ordered.entries()) {
      placed.set(row.id, { parentId, position: index + 1 })
    }
  }
  return placed
}

const text = (value: string, marks?: PmNode['marks']): PmNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {})
})
const paragraph = (content: PmNode[] = []): PmNode => ({ type: 'paragraph', ...(content.length ? { content } : {}) })

/** A cell's words, each line on its own line. */
const cellOf = (type: 'tableHeader' | 'tableCell', words: string): PmNode => {
  const lines = words
    .split('\n')
    .flatMap((line, index) => [...(index > 0 ? [{ type: 'hardBreak' }] : []), ...(line ? [text(line)] : [])])
  return { type, attrs: { colspan: 1, rowspan: 1 }, content: [paragraph(lines)] }
}

const valueText = (value: unknown): string => {
  const raw = (value ?? {}) as { value?: unknown }
  const inner = raw.value as Record<string, unknown> | string | undefined
  if (inner === undefined || inner === null) {
    return ''
  }
  if (typeof inner !== 'object') {
    return String(inner)
  }
  return String(inner.plain ?? inner.text ?? inner.date ?? inner.value ?? JSON.stringify(inner))
}

/** A Confluence database as a table: a header with its fields, then one row per entry. */
export const databaseDoc = (database: unknown): PmNode => {
  const raw = (database ?? {}) as Raw
  const fieldIds = (Array.isArray(raw.fields) ? raw.fields : []) as string[]
  const fields = (raw.fieldsById ?? {}) as Record<string, { name?: string }>
  const entries = ((Array.isArray(raw.entries) ? raw.entries : []) as string[]).map(
    (id) => ((raw.entriesById ?? {}) as Record<string, { values?: Record<string, unknown> }>)[id]?.values ?? {}
  )
  if (fieldIds.length === 0) {
    return { type: 'doc', content: [paragraph([text('Base de dados vazia no Confluence.')])] }
  }
  const header = { type: 'tableRow', content: fieldIds.map((id) => cellOf('tableHeader', fields[id]?.name ?? '')) }
  const rows = entries.map((values) => ({
    type: 'tableRow',
    content: fieldIds.map((id) => cellOf('tableCell', valueText(values[id])))
  }))
  return { type: 'doc', content: [{ type: 'table', content: [header, ...rows] }] }
}

/** An embed — a Google Slides deck, a Figma file — as a page with its link. */
export const embedDoc = (node: Raw): PmNode => {
  const url = String(node.embedUrl ?? '')
  return {
    type: 'doc',
    content: [
      paragraph([text('Conteúdo incorporado no Confluence:', [{ type: 'italic' }])]),
      paragraph(url ? [text(url, [{ type: 'link', attrs: { href: url } }])] : [text('(sem endereço)')])
    ]
  }
}

/**
 * A page's attachments its body does not show, listed at its end — Confluence lists them in a panel of
 * their own, and Draw keeps a page's files only where the page shows them.
 */
export const withAttachments = (doc: PmNode, files: PageFile[]): PmNode => {
  if (files.length === 0) {
    return doc
  }
  const nodes = files.map((file) => ({
    type: file.image ? 'pageImage' : 'pageFile',
    attrs: { fileId: file.fileId, name: file.name, size: file.size }
  }))
  const heading = { type: 'heading', attrs: { level: 3 }, content: [text('Anexos')] }
  return { ...doc, content: [...(doc.content ?? []), { type: 'horizontalRule' }, heading, ...nodes] }
}

/** Every media node of a body, by id, with what it says of itself. */
export const mediaNodes = (document: unknown, found = new Map<string, Raw>()): Map<string, Raw> => {
  const node = document as AdfNode | undefined
  if ((node?.type === 'media' || node?.type === 'mediaInline') && typeof node.attrs?.id === 'string') {
    found.set(node.attrs.id, node.attrs)
  }
  for (const child of node?.content ?? []) {
    mediaNodes(child, found)
  }
  return found
}

/** A page's document in Draw: its body, converted, with its unshown attachments at the end. */
export const pageDoc = (
  document: unknown,
  options: ProseMirrorOptions,
  attachments: (PageFile & { mediaId: string })[]
): PmNode => {
  const shown = mediaNodes(document)
  const rest = attachments.filter((file) => !shown.has(file.mediaId))
  return withAttachments(adfToProseMirror(document, options), rest)
}

/**
 * The backup's whiteboard export: CSV rows of `contentId, documentId, spaceId, documentType, data`.
 * A whiteboard's data is a version byte (2) and a gzip of its JSON; a database's is the JSON itself.
 */
export const parseBackup = (csv: string): Map<string, BackupDocument> => {
  const found = new Map<string, BackupDocument>()
  const [head, ...lines] = csv.split('\n').filter((line) => line.trim())
  const columns = (head ?? '').split(',')
  for (const line of lines) {
    const cells = line.split(',')
    if (cells.length < columns.length) {
      continue
    }
    const at = (name: string) => (cells[columns.indexOf(name)] ?? '').replace(/^"|"$/g, '')
    const bytes = Buffer.from(at('data'), 'base64')
    const json = bytes[0] === 2 ? gunzipSync(bytes.subarray(1)).toString('utf8') : bytes.toString('utf8')
    found.set(at('contentId'), { documentType: at('documentType'), doc: JSON.parse(json) })
  }
  return found
}
