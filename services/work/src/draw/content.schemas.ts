import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { contentComments, contents, contentVersions } from '../schema.js'

/**
 * A content or a version as it is read: never its Yjs `document`, which may pass the Data API's 1 MiB
 * on its own and is read apart, in pieces (ADR-0009). Written whole, as the `New…` rows.
 */
export type ContentRow = Omit<typeof contents.$inferSelect, 'document'>
export type NewContentRow = typeof contents.$inferInsert
export type VersionRow = Omit<typeof contentVersions.$inferSelect, 'document'>
export type NewVersionRow = typeof contentVersions.$inferInsert
export type ContentCommentRow = typeof contentComments.$inferSelect

const titleSchema = z.string().trim().min(1).max(255)
/** A Yjs update or state, base64 — at most 1 MB once decoded. */
export const yjsBase64Schema = z
  .string()
  .max(1_400_000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
const personSchema = z.object({ id: z.uuid(), name: z.string() })

export const contentPathSchema = z.object({ contentId: z.uuid() })
export const versionPathSchema = z.object({ contentId: z.uuid(), number: z.coerce.number().int().min(1) })
export const contentCommentPathSchema = z.object({ contentId: z.uuid(), commentId: z.uuid() })

/** What a LET’S Draw AI space holds (ADR-0011): folders, and the pages and whiteboards in them. */
export const contentKindSchema = z.enum(['folder', 'page', 'whiteboard'])
export type ContentKind = z.infer<typeof contentKindSchema>
/** The kinds that are documents — edited together, versioned, commented. A folder only holds. */
export const isDocument = (kind: string): boolean => kind === 'page' || kind === 'whiteboard'

export const createContentSchema = z.object({
  kind: contentKindSchema.default('page'),
  title: titleSchema.default('Sem título'),
  parentId: z.uuid().optional(),
  /** An emoji before the title (ADR-0034). */
  icon: z.string().trim().min(1).max(8).optional(),
  /** A first content, for a page made from a prompt (5.2): ProseMirror JSON or whiteboard elements (ADR-0017). */
  draft: z.object({ json: z.record(z.string(), z.unknown()), text: z.string().max(500_000) }).optional()
})
export type CreateContent = z.infer<typeof createContentSchema>
export const renameContentSchema = z.object({ title: titleSchema })
/** An emoji before the title, or `null` for the kind's own icon (ADR-0034). */
export const contentIconSchema = z.object({ icon: z.string().trim().min(1).max(8).nullable() })
/** Under a folder or a page, or at the top (`null`), at a position among its siblings (0 = first). */
export const moveContentSchema = z.object({ parentId: z.uuid().nullable(), index: z.number().int().min(0) })
export type MoveContent = z.infer<typeof moveContentSchema>

/** What the editor derives from the Yjs state: the page as ProseMirror JSON and as text (ADR-0009). */
export const derivedContentSchema = z.object({
  json: z.record(z.string(), z.unknown()),
  text: z.string().max(500_000)
})
export type DerivedContent = z.infer<typeof derivedContentSchema>
export const applyUpdateSchema = z.object({ update: yjsBase64Schema.min(1) })
/** A version saved by hand may be named (Etapa 4d-c). */
export const saveVersionSchema = z.object({ name: z.string().trim().min(1).max(120).optional() }).default({})
export type SaveVersion = z.infer<typeof saveVersionSchema>

/** One line of a space's content tree (5.1). */
export const contentNodeSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kind: contentKindSchema,
  title: z.string(),
  icon: z.string().nullable(),
  position: z.number(),
  updatedAt: z.iso.datetime()
})
export const contentTreeSchema = z.object({ items: z.array(contentNodeSchema) })

/** The pages and whiteboards changed last, across spaces: LET’S Draw AI's home (ADR-0010). */
export const recentContentsSchema = z.object({
  items: z.array(contentNodeSchema.extend({ spaceId: z.uuid(), spaceName: z.string(), spaceIcon: z.string() }))
})
export const recentContentsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) })

export const contentViewSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  parentId: z.uuid().nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  position: z.number(),
  kind: contentKindSchema,
  contentJson: z.record(z.string(), z.unknown()),
  createdBy: personSchema,
  updatedBy: personSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Every member edits LET’S Draw AI content (ADR-0011); kept so a read-only reason can return. */
  canWrite: z.boolean()
})
export type ContentView = z.infer<typeof contentViewSchema>

export const documentSchema = z.object({ state: yjsBase64Schema })

export const versionSummarySchema = z.object({
  number: z.number().int(),
  title: z.string(),
  reason: z.enum(['auto', 'manual', 'restore']),
  name: z.string().nullable(),
  restoredFrom: z.number().int().nullable(),
  createdBy: personSchema,
  createdAt: z.iso.datetime()
})
export const versionListSchema = z.object({ items: z.array(versionSummarySchema) })
export const versionSchema = versionSummarySchema.extend({
  contentJson: z.record(z.string(), z.unknown()),
  contentText: z.string()
})
export type VersionView = z.infer<typeof versionSchema>

/** The address and the one-use ticket that open the page's realtime connection (ADR-0009). */
export const realtimeTicketSchema = z.object({ url: z.string(), ticket: z.string(), expiresAt: z.iso.datetime() })

export const createContentCommentSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  parentId: z.uuid().optional(),
  /** The id of the comment mark the editor put on the stretch of text, for an inline thread. */
  anchorId: z.string().min(1).max(64).optional(),
  quote: z.string().max(1000).optional()
})
export type CreateContentComment = z.infer<typeof createContentCommentSchema>
export const editContentCommentSchema = z.object({ body: z.string().trim().min(1).max(20_000) })
export const resolveContentCommentSchema = z.object({ resolved: z.boolean() })

export const contentCommentViewSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  anchorId: z.string().nullable(),
  quote: z.string().nullable(),
  author: personSchema,
  body: z.string(),
  mentions: z.array(personSchema),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable()
})
export type ContentCommentView = z.infer<typeof contentCommentViewSchema>
export const contentCommentListSchema = z.object({ items: z.array(contentCommentViewSchema) })

export const toContentNode = (
  row: Pick<ContentRow, 'id' | 'parentId' | 'kind' | 'title' | 'icon' | 'position' | 'updatedAt'>
) => ({
  id: row.id,
  parentId: row.parentId,
  kind: contentKindSchema.parse(row.kind),
  title: row.title,
  icon: row.icon,
  position: row.position,
  updatedAt: toIso(row.updatedAt)
})

export type VersionWithAuthor = VersionRow & { authorName: string }

export const toVersionSummary = (row: VersionWithAuthor) => ({
  number: row.number,
  title: row.title,
  reason: z.enum(['auto', 'manual', 'restore']).parse(row.reason),
  name: row.name,
  restoredFrom: row.restoredFrom,
  createdBy: { id: row.createdBy, name: row.authorName },
  createdAt: toIso(row.createdAt)
})

export const toVersionView = (row: VersionWithAuthor): VersionView => ({
  ...toVersionSummary(row),
  contentJson: z.record(z.string(), z.unknown()).parse(row.contentJson),
  contentText: row.contentText
})
