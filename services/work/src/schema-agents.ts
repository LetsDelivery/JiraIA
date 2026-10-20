import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { members, spaces, work } from './schema.js'

/**
 * Etapa 6's tables — what agents ask for and what a space lets them do — kept beside `schema.ts` and
 * `schema-intake.ts`. Same schema, same rules.
 */

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/**
 * A change an agent wants in one space, applied only when a person approves it (escopo-mvp 6.2,
 * ADR-0019). `status` is `pending`, `applying` (while an approval runs), `applied`, `rejected`,
 * `withdrawn` or `reverted`; a pending proposal past `expiresAt` reads as expired.
 */
export const proposals = work.table(
  'proposals',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => members.id),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    autoApplied: boolean('auto_applied').notNull().default(false),
    decidedBy: uuid('decided_by').references(() => members.id),
    decidedAt: at('decided_at'),
    note: text('note').notNull().default(''),
    revertedBy: uuid('reverted_by').references(() => members.id),
    revertedAt: at('reverted_at'),
    expiresAt: at('expires_at').notNull(),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull()
  },
  (table) => [
    index('proposals_space').on(table.spaceId, table.status, table.createdAt),
    index('proposals_author').on(table.authorId, table.createdAt)
  ]
)

/**
 * One change of a proposal, in the order the agent sent them. `payload` is what the agent asked for and
 * `adjusted` what the approver changed it to; `base` holds, for a field change, each field as it was when
 * proposed, which is how a stale item is told. `result` names what applying made — the card, comment
 * or link — so revert can find it.
 */
export const proposalItems = work.table(
  'proposal_items',
  {
    id: uuid('id').primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    cardId: uuid('card_id'),
    payload: jsonb('payload').notNull(),
    adjusted: jsonb('adjusted'),
    base: jsonb('base').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull(),
    result: jsonb('result'),
    error: text('error')
  },
  (table) => [index('proposal_items_proposal').on(table.proposalId), index('proposal_items_card').on(table.cardId)]
)

/** What agents may apply in a space without a person's approval (ADR-0019). No row: nothing. */
export const proposalPolicies = work.table('proposal_policies', {
  spaceId: uuid('space_id')
    .primaryKey()
    .references(() => spaces.id),
  autoApply: jsonb('auto_apply').notNull().default(sql`'[]'::jsonb`),
  updatedBy: uuid('updated_by')
    .notNull()
    .references(() => members.id),
  updatedAt: at('updated_at').notNull()
})

/**
 * An application that registered itself to connect by OAuth (RFC 7591, ADR-0021): a public client —
 * no secret, PKCE always. It acts as the people who allow it (ADR-0022).
 */
export const oauthClients = work.table('oauth_clients', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  redirectUris: jsonb('redirect_uris').notNull(),
  clientUri: text('client_uri'),
  createdAt: at('created_at').notNull()
})

/** A one-time code from the consent page, kept as its hash, for ten minutes (ADR-0021). */
export const oauthCodes = work.table('oauth_codes', {
  hash: text('hash').primaryKey(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => oauthClients.id),
  personId: uuid('person_id')
    .notNull()
    .references(() => members.id),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  resource: text('resource'),
  scope: text('scope').notNull(),
  expiresAt: at('expires_at').notNull(),
  usedAt: at('used_at')
})

/**
 * A connection: an application acting as one person, from the consent until either ends it (ADR-0021,
 * ADR-0022). Every token hangs from one; revoking it ends them all.
 */
export const oauthConnections = work.table(
  'oauth_connections',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => oauthClients.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => members.id),
    scope: text('scope').notNull(),
    createdAt: at('created_at').notNull(),
    lastUsedAt: at('last_used_at'),
    revokedAt: at('revoked_at')
  },
  (table) => [index('oauth_connections_person').on(table.personId)]
)

/** An access or refresh token of a connection, kept as its hash (ADR-0021). */
export const oauthTokens = work.table(
  'oauth_tokens',
  {
    hash: text('hash').primaryKey(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => oauthConnections.id),
    kind: text('kind').notNull(),
    expiresAt: at('expires_at').notNull(),
    revokedAt: at('revoked_at'),
    createdAt: at('created_at').notNull()
  },
  (table) => [index('oauth_tokens_connection').on(table.connectionId)]
)
