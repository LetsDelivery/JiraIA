import { index, integer, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { contents, drawSpaces, members, work } from './schema.js'

/**
 * LET’S Wiki's tables (ADR-0033). A collection is a content space whose `area` is `wiki`; these add
 * what makes its pages something to trust — a review period, an owner, a state and a review date.
 */

/**
 * What a wiki collection adds to its space: how long an official page holds, its page outline, and who
 * reads it (ADR-0034).
 */
export const wikiCollections = work.table(
  'wiki_collections',
  {
    spaceId: uuid('space_id')
      .primaryKey()
      .references(() => drawSpaces.id),
    /** Days an official page holds once reviewed: 90 unless the collection says otherwise. */
    reviewDays: integer('review_days').notNull(),
    /** `customer` when a new page starts from the customer outline; null for a blank page. */
    outline: text('outline'),
    /** `organization` (everyone reads), `restricted` (only who holds a role) or `personal`. */
    access: text('access').notNull().default('organization'),
    /** The member a personal collection belongs to; null for the others. One each. */
    ownerId: uuid('owner_id').references(() => members.id)
  },
  (table) => [uniqueIndex('wiki_collections_owner').on(table.ownerId)]
)

/**
 * A wiki page's owner and state (ADR-0033). A page without a row is a draft owned by whoever created
 * it; the row is written the first time either changes.
 */
export const wikiPages = work.table(
  'wiki_pages',
  {
    contentId: uuid('content_id')
      .primaryKey()
      .references(() => contents.id),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => members.id),
    /** `draft` or `official`. */
    state: text('state').notNull(),
    officialAt: timestamp('official_at', { withTimezone: true, mode: 'date' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    reviewDue: timestamp('review_due', { withTimezone: true, mode: 'date' }),
    /** The Draw page it was published from, if it was (W8). */
    sourceId: uuid('source_id').references(() => contents.id),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [index('wiki_pages_owner_due').on(table.ownerId, table.reviewDue)]
)

/** A page a member starred, to find it under "Favoritas" — their own, so not audited (ADR-0034). */
export const wikiFavorites = work.table(
  'wiki_favorites',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contents.id),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.memberId, table.contentId] })]
)
