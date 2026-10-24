import { toIso } from '@jiraia/core'
import { z } from 'zod'

import { contentNodeSchema, createContentSchema } from '../draw/content.schemas.js'
import type { wikiPages } from '../schema-wiki.js'

export type WikiPageRow = typeof wikiPages.$inferSelect

/** A wiki page is a draft until its collection's owners make it official (ADR-0033). */
export const pageStateSchema = z.enum(['draft', 'official'])
export type PageState = z.infer<typeof pageStateSchema>

/** How early an owner hears that a page's review date is coming. */
export const DUE_SOON_DAYS = 14
const DAY = 24 * 60 * 60 * 1000

/** A page or a folder of a collection; its first content comes from the collection's outline. */
export const createWikiPageSchema = createContentSchema.omit({ draft: true })
export type CreateWikiPage = z.infer<typeof createWikiPageSchema>

export const changeOwnerSchema = z.object({ ownerId: z.uuid() })
export const officialSchema = z.object({ official: z.boolean() })

const personSchema = z.object({ id: z.uuid(), name: z.string() })

export const wikiPageViewSchema = z.object({
  contentId: z.uuid(),
  collectionId: z.uuid(),
  owner: personSchema,
  state: pageStateSchema,
  officialAt: z.iso.datetime().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  reviewDue: z.iso.datetime().nullable(),
  /** Official and past its review date: it still holds, and says it may be out of date. */
  overdue: z.boolean(),
  /** An owner of the collection: makes it official or a draft again, and names its owner. */
  canManage: z.boolean(),
  /** Its owner or an owner of the collection: confirms it still holds. */
  canReview: z.boolean()
})
export type WikiPageView = z.infer<typeof wikiPageViewSchema>

/** One line of a collection's tree, with the page's state for its mark (ADR-0033). */
export const wikiTreeSchema = z.object({
  items: z.array(contentNodeSchema.extend({ state: pageStateSchema, overdue: z.boolean() }))
})

/** A page whose review date is near or past, for its owner. */
export const reviewItemSchema = z.object({
  contentId: z.uuid(),
  title: z.string(),
  collectionId: z.uuid(),
  collectionName: z.string(),
  reviewDue: z.iso.datetime(),
  overdue: z.boolean()
})
export const reviewListSchema = z.object({ items: z.array(reviewItemSchema) })

/** The wiki pages changed last, across collections, for the wiki's home. */
export const recentWikiPagesSchema = z.object({
  items: z.array(
    z.object({
      contentId: z.uuid(),
      title: z.string(),
      collectionId: z.uuid(),
      collectionName: z.string(),
      collectionIcon: z.string(),
      state: pageStateSchema,
      overdue: z.boolean(),
      updatedAt: z.iso.datetime()
    })
  )
})
export const recentQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) })

/** What a page without a row is: a draft owned by whoever created it. */
export const draftOf = (contentId: string, ownerId: string, at: Date): WikiPageRow => ({
  contentId,
  ownerId,
  state: 'draft',
  officialAt: null,
  reviewedAt: null,
  reviewDue: null,
  sourceId: null,
  updatedAt: at
})

export const isOverdue = (row: Pick<WikiPageRow, 'state' | 'reviewDue'> | undefined, now: Date): boolean =>
  row?.state === 'official' && row.reviewDue !== null && row.reviewDue.getTime() < now.getTime()

export const dueAfter = (from: Date, days: number): Date => new Date(from.getTime() + days * DAY)

export const toWikiPageView = (
  row: WikiPageRow,
  context: { collectionId: string; ownerName: string; now: Date; canManage: boolean; canReview: boolean }
): WikiPageView => ({
  contentId: row.contentId,
  collectionId: context.collectionId,
  owner: { id: row.ownerId, name: context.ownerName },
  state: pageStateSchema.parse(row.state),
  officialAt: row.officialAt ? toIso(row.officialAt) : null,
  reviewedAt: row.reviewedAt ? toIso(row.reviewedAt) : null,
  reviewDue: row.reviewDue ? toIso(row.reviewDue) : null,
  overdue: isOverdue(row, context.now),
  canManage: context.canManage,
  canReview: context.canReview
})
