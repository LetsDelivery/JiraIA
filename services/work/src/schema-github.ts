import { index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { cards, members, work } from './schema.js'

/**
 * Etapa 9's tables (ADR-0038): the organization's GitHub App installation, the deliveries GitHub has
 * already sent, and what of each card's development GitHub has told — its branches and pull requests.
 */

/**
 * The JiraIA App installed on the organization's GitHub account. One per organization. GitHub's ids
 * are kept as text: they are numbers that only GitHub gives meaning to.
 */
export const githubInstallations = work.table('github_installations', {
  organizationId: uuid('organization_id').primaryKey(),
  installationId: text('installation_id').notNull().unique(),
  /** The GitHub account the App is installed on, `LetsDelivery`. */
  accountLogin: text('account_login').notNull(),
  installedBy: uuid('installed_by')
    .notNull()
    .references(() => members.id),
  installedAt: timestamp('installed_at', { withTimezone: true, mode: 'date' }).notNull()
})

/**
 * Each delivery GitHub sent (`X-GitHub-Delivery`), so a redelivery does nothing twice. GitHub keeps
 * redelivering for days at most; rows older than a month are swept.
 */
export const githubDeliveries = work.table('github_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).notNull()
})

/**
 * A branch or a pull request that names a card (ADR-0038), as GitHub last told it. Only metadata: no
 * code, no diff. `ref` is the branch's name or the pull request's number; `state` is `active` or
 * `deleted` for a branch, and `open`, `draft`, `closed` or `merged` for a pull request. `review` and
 * `checks` are a pull request's: `approved` or `changes_requested`, and `pending`, `success` or
 * `failure`.
 */
export const cardDevLinks = work.table(
  'card_dev_links',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    repo: text('repo').notNull(),
    kind: text('kind').notNull(),
    ref: text('ref').notNull(),
    title: text('title').notNull().default(''),
    url: text('url').notNull(),
    state: text('state').notNull(),
    review: text('review'),
    checks: text('checks'),
    /** The GitHub login of who opened it. */
    author: text('author').notNull().default(''),
    /** A pull request's head commit, which is what GitHub's checks name. */
    headSha: text('head_sha'),
    mergedAt: timestamp('merged_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [
    uniqueIndex('card_dev_links_unique').on(table.cardId, table.repo, table.kind, table.ref),
    index('card_dev_links_ref').on(table.organizationId, table.repo, table.kind, table.ref),
    index('card_dev_links_sha').on(table.organizationId, table.repo, table.headSha)
  ]
)
