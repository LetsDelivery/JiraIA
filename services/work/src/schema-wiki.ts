import { index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { contents, drawSpaces, members, work } from './schema.js'

/**
 * LET’S Wiki's tables (ADR-0033). A collection is a content space whose `area` is `wiki`; these add
 * what makes its pages something to trust — a review period, an owner, a state and a review date.
 */

/** What a wiki collection adds to its space: how long an official page holds, and its page outline. */
export const wikiCollections = work.table('wiki_collections', {
  spaceId: uuid('space_id')
    .primaryKey()
    .references(() => drawSpaces.id),
  /** Days an official page holds once reviewed: 90 unless the collection says otherwise. */
  reviewDays: integer('review_days').notNull(),
  /** `customer` when a new page starts from the customer outline; null for a blank page. */
  outline: text('outline')
})

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
