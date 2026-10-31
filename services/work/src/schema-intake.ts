import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { cards, cardTypes, contents, members, spaces, work, workflowStates } from './schema.js'

/**
 * Etapa 5's tables — what comes in (forms), what reacts (automations) and where it is told (Slack) —
 * kept beside `schema.ts`, which already holds every table before them. Same schema, same rules.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull()
const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull()

/**
 * Which domain events a consumer has already handled (ADR-0014). The bus delivers at least once; a
 * consumer looks here before acting and writes here after, so a redelivery does nothing twice.
 */
export const eventReceipts = work.table(
  'event_receipts',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    handledAt: timestamp('handled_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.consumer, table.eventId] })]
)

/**
 * An intake form of a space (escopo-mvp 4.1): whoever can read the space fills it in, and the answer
 * becomes a card of `typeId`, in `stateId` (the first state when null), with `labels` added.
 *
 * `fields` is the form's questions in order, each mapped to a field of the card (`forms/schemas.ts`).
 */
export const forms = work.table(
  'forms',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    typeId: uuid('type_id')
      .notNull()
      .references(() => cardTypes.id),
    stateId: uuid('state_id').references(() => workflowStates.id),
    labels: jsonb('labels').notNull().default(sql`'[]'::jsonb`),
    fields: jsonb('fields').notNull().default(sql`'[]'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [index('forms_space').on(table.spaceId)]
)

/**
 * A rule of a space (escopo-mvp 4.2): when `trigger` happens to one of its cards and every condition
 * holds, the actions run in order. The three parts are JSON validated by zod (`automations/schemas.ts`).
 *
 * `ownerId` is who made it: the actions may only reach a space where the owner can write, checked again
 * on every run, so a rule never outlives its owner's access.
 */
export const automations = work.table(
  'automations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => members.id),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    trigger: jsonb('trigger').notNull(),
    conditions: jsonb('conditions').notNull().default(sql`'[]'::jsonb`),
    actions: jsonb('actions').notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [index('automations_space').on(table.spaceId, table.enabled)]
)

/** One time a rule ran for an event: what each action did, or why it stopped. */
export const automationRuns = work.table(
  'automation_runs',
  {
    id: uuid('id').primaryKey(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id),
    eventId: uuid('event_id').notNull(),
    cardId: uuid('card_id').notNull(),
    /** `succeeded`, `failed` or `skipped`. */
    status: text('status').notNull(),
    steps: jsonb('steps').notNull().default(sql`'[]'::jsonb`),
    error: text('error'),
    durationMs: integer('duration_ms').notNull().default(0),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [
    index('automation_runs_automation').on(table.automationId, table.occurredAt),
    uniqueIndex('automation_runs_once').on(table.automationId, table.eventId)
  ]
)

/**
 * A Slack channel the organization posts to (escopo-mvp 4.5), through an incoming webhook. The URL is a
 * secret — whoever has it can post — so the API never returns it whole.
 */
export const slackChannels = work.table(
  'slack_channels',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    webhookUrl: text('webhook_url').notNull(),
    createdAt: createdAt()
  },
  (table) => [uniqueIndex('slack_channels_name').on(table.organizationId, table.name)]
)

/**
 * A notice for one member (escopo-mvp 4.6): someone mentioned them, gave them a card, commented on
 * or moved a card they follow, asked to edit a space they run, or answered their request.
 *
 * Personal state — read, snoozed, archived — is the member's own and leaves no audit event, like a
 * star. `data` holds what the notice says (card key, title, state…) as it was when it happened.
 * `emailedAt` marks it as sent in a daily summary, so no notice is mailed twice.
 */
export const notifications = work.table(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    kind: text('kind').notNull(),
    eventId: uuid('event_id').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => members.id),
    cardId: uuid('card_id'),
    spaceId: uuid('space_id'),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true, mode: 'date' }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    emailedAt: timestamp('emailed_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    uniqueIndex('notifications_once').on(table.memberId, table.eventId),
    index('notifications_inbox').on(table.memberId, table.archivedAt, table.createdAt),
    index('notifications_digest').on(table.emailedAt).where(sql`emailed_at IS NULL AND read_at IS NULL`)
  ]
)

/**
 * Where a member wants each kind of notice: a JSON list of `in_app`, `email`, `slack`. The panel comes
 * with any other; an empty list is nowhere.
 */
export const notificationPreferences = work.table(
  'notification_preferences',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    kind: text('kind').notNull(),
    channels: jsonb('channels').notNull().default(sql`'[]'::jsonb`),
    updatedAt: updatedAt()
  },
  (table) => [primaryKey({ columns: [table.memberId, table.kind] })]
)

/**
 * An API token (escopo-mvp 4.8, ADR-0015). It acts as `memberId` — a person, for a personal token,
 * or a service account, an agent member with roles of its own. Only the SHA-256 of the value is kept;
 * `hint` is its first characters, to tell two tokens apart on screen.
 */
export const apiTokens = work.table(
  'api_tokens',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => members.id),
    name: text('name').notNull(),
    hint: text('hint').notNull(),
    hash: text('hash').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [uniqueIndex('api_tokens_hash').on(table.hash), index('api_tokens_member').on(table.memberId)]
)

/**
 * An outgoing webhook of a space (escopo-mvp 4.7): the card events it names are POSTed to `url`,
 * signed with `secret` (HMAC-SHA256) so the receiver can tell they came from JiraIA.
 */
export const webhooks = work.table(
  'webhooks',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    name: text('name').notNull(),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: jsonb('events').notNull().default(sql`'[]'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [index('webhooks_space').on(table.spaceId, table.enabled)]
)

/**
 * One event sent to one webhook, and every try at it: `pending` until the receiver answers 2xx
 * (`delivered`) or the last try fails (`failed`). `nextAttemptAt` is when the retry sweep tries again.
 */
export const webhookDeliveries = work.table(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('webhook_deliveries_once').on(table.webhookId, table.eventId),
    index('webhook_deliveries_recent').on(table.webhookId, table.createdAt),
    index('webhook_deliveries_due').on(table.nextAttemptAt).where(sql`status = 'pending'`)
  ]
)

/**
 * A space's dashboard (Etapa 5d, ADR-0016): its widgets, in order, as one JSON list. A space with no
 * row shows the default dashboard, which lives in code — so nothing is backfilled.
 */
export const spaceDashboards = work.table('space_dashboards', {
  spaceId: uuid('space_id')
    .primaryKey()
    .references(() => spaces.id),
  organizationId: uuid('organization_id').notNull(),
  widgets: jsonb('widgets').notNull().default(sql`'[]'::jsonb`),
  updatedBy: uuid('updated_by')
    .notNull()
    .references(() => members.id),
  updatedAt: updatedAt()
})

/**
 * The last time a member opened a page or a whiteboard of LET’S Draw AI (Etapa 4d-c): what "Abertos por
 * você" lists. Personal, like a star, so not audited; one row per member and content.
 */
export const contentVisits = work.table(
  'content_visits',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contents.id),
    visitedAt: timestamp('visited_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.contentId] }),
    index('content_visits_recent').on(table.memberId, table.visitedAt)
  ]
)

/**
 * A member's star on a card: what "Marcados com estrela" on Para você lists. Personal, like a star on a
 * space, so not audited.
 */
export const cardStars = work.table(
  'card_stars',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    createdAt: createdAt()
  },
  (table) => [primaryKey({ columns: [table.memberId, table.cardId] })]
)

/**
 * The Slack workspace the organization connected (Etapa 5e, ADR-0018): one per organization. The bot's
 * token is kept encrypted (AES-GCM, key from the environment); nothing but the Slack client reads it.
 */
export const slackWorkspaces = work.table('slack_workspaces', {
  organizationId: uuid('organization_id').primaryKey(),
  teamId: text('team_id').notNull(),
  teamName: text('team_name').notNull(),
  botUserId: text('bot_user_id').notNull(),
  botToken: text('bot_token').notNull(),
  installedBy: uuid('installed_by')
    .notNull()
    .references(() => members.id),
  installedAt: timestamp('installed_at', { withTimezone: true, mode: 'date' }).notNull()
})

/**
 * Who a member is in the connected Slack workspace, found by their e-mail (Etapa 5e). `slackUserId` is
 * null when the workspace has nobody with that address; `checkedAt` says when that was looked up.
 */
export const slackLinks = work.table('slack_links', {
  memberId: uuid('member_id')
    .primaryKey()
    .references(() => members.id),
  organizationId: uuid('organization_id').notNull(),
  slackUserId: text('slack_user_id'),
  checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' }).notNull()
})
