import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core'

/**
 * The `work` service's tables, all inside its own Postgres schema (ADR-0003).
 *
 * No other service reads or writes this schema. Kinds, statuses and roles are `text` validated by
 * zod at the edge rather than Postgres enums: adding a role must not need an `ALTER TYPE` that cannot
 * run inside a transaction.
 */
export const work = pgSchema('work')

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull()

export const organizations = work.table('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: createdAt()
})

/**
 * A person or an agent — the same row, because both hold roles and both appear in history.
 *
 * `subject` is the Cognito `sub` for a person. An agent signs in another way (Etapa 6) and has none
 * yet. `email` is stored lowercased; it is how an invitation is matched and never how a request is
 * authenticated.
 */
export const members = work.table(
  'members',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').notNull(),
    subject: text('subject').unique(),
    email: text('email'),
    name: text('name').notNull(),
    /** What the person does at LET'S ("Engenheira de software"), set by them on their profile. */
    jobTitle: text('job_title'),
    isOrgAdmin: boolean('is_org_admin').notNull().default(false),
    /** Creates JiraIA spaces without being an organization admin (ADR-0012). */
    isSpaceManager: boolean('is_space_manager').notNull().default(false),
    /** Reads and exports everything in access governance; never approves nor carries out (ADR-0024). */
    isAccessAuditor: boolean('is_access_auditor').notNull().default(false),
    status: text('status').notNull(),
    createdAt: createdAt(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [uniqueIndex('members_email_unique').on(table.organizationId, table.email)]
)

/**
 * A space — the unit Jira itself now calls a space (ADR-0007): it has a key, a type, a lead and, from
 * Etapa 2, the cards.
 *
 * `key` is the prefix of every card number (`REQ` in `REQ-123`): unique in the organization, never
 * changed, and preserved by the migration from Jira so every existing link keeps working.
 * `nextCardNumber` is the counter Etapa 2 draws from; `lastCardActivityAt` is moved by card writes.
 */
export const spaces = work.table(
  'spaces',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    type: text('type').notNull(),
    leadId: uuid('lead_id').references(() => members.id),
    nextCardNumber: integer('next_card_number').notNull().default(1),
    lastCardActivityAt: timestamp('last_card_activity_at', { withTimezone: true, mode: 'date' }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt()
  },
  (table) => [uniqueIndex('spaces_key_unique').on(table.organizationId, table.key)]
)

export const spaceMembers = work.table(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    role: text('role').notNull(),
    createdAt: createdAt()
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.memberId] }),
    index('space_members_member').on(table.memberId)
  ]
)

/**
 * Every write, as it happened: who, what, before and after (escopo-mvp 1.6).
 *
 * Append-only. `spaceId` scopes the trail so a space admin reads their space's history without a
 * join through every entity type. `changes` maps a field to `{ before, after }`.
 */
export const auditEvents = work.table(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    spaceId: uuid('space_id'),
    actorId: uuid('actor_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    changes: jsonb('changes').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** When the event left for the bus (ADR-0014); null until the dispatcher publishes it. */
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true, mode: 'date' }),
    /** The proposal this write applied or reverted (ADR-0019); null for a write made directly. */
    proposalId: uuid('proposal_id'),
    /** The application a person wrote through, by its name then (ADR-0022): "via Laís". */
    via: text('via')
  },
  (table) => [
    index('audit_events_entity').on(table.entityType, table.entityId, table.occurredAt),
    index('audit_events_space').on(table.spaceId, table.occurredAt),
    index('audit_events_pending').on(table.occurredAt).where(sql`dispatched_at IS NULL`)
  ]
)

/**
 * A member's star on a space — personal, so it is not audited: it changes nobody's data but theirs.
 */
export const spaceStars = work.table(
  'space_stars',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    createdAt: createdAt()
  },
  (table) => [primaryKey({ columns: [table.memberId, table.spaceId] })]
)

/**
 * How often a member opened a space, one row per UTC day.
 *
 * A row per day rather than per visit keeps the table small (members × spaces × days) and still
 * answers both questions the home screen asks: "most opened in the last 30 days" (the sum of
 * `count`) and "most recent" (the latest `lastVisitedAt`).
 */
export const spaceVisits = work.table(
  'space_visits',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    day: date('day', { mode: 'string' }).notNull(),
    count: integer('count').notNull().default(1),
    lastVisitedAt: timestamp('last_visited_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.spaceId, table.day] }),
    index('space_visits_member_recent').on(table.memberId, table.lastVisitedAt)
  ]
)

/**
 * A space's workflow: its states, in board order (escopo-mvp 2.2, 2.3).
 *
 * The name is free — emoji included, as REQ's "🚨 Itens priorizados" — and the group is what reports
 * across spaces read: not started, in progress, done, cancelled. Transitions are free (2.3).
 */
export const workflowStates = work.table(
  'workflow_states',
  {
    id: uuid('id').primaryKey(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    name: text('name').notNull(),
    group: text('group').notNull(),
    position: integer('position').notNull(),
    createdAt: createdAt()
  },
  (table) => [uniqueIndex('workflow_states_name_unique').on(table.spaceId, table.name)]
)

/** The kinds of card a space holds — Oportunidade in PRD, História or Bug in TEC (2.1). */
export const cardTypes = work.table(
  'card_types',
  {
    id: uuid('id').primaryKey(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    createdAt: createdAt()
  },
  (table) => [uniqueIndex('card_types_name_unique').on(table.spaceId, table.name)]
)

/**
 * A card: `KEY-number`, its standard fields (2.4) and its place on the board.
 *
 * `rank` orders the cards of one state; a move takes the midpoint between its new neighbours, so it
 * writes one row. `backlogRank` is the same idea across the whole backlog (3.3). `labels` is a JSON
 * array of strings, as Jira stores them. `parentId` makes the hierarchy Epic → História → Subtarefa
 * (2.6), inside one space. `customFields` maps a custom field's id to its value (2.5). `groupId` is
 * the group — the area or team — that owns the card; the screen calls it the card's squad.
 */
export const cards = work.table(
  'cards',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    number: integer('number').notNull(),
    typeId: uuid('type_id')
      .notNull()
      .references(() => cardTypes.id),
    stateId: uuid('state_id')
      .notNull()
      .references(() => workflowStates.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    assigneeId: uuid('assignee_id').references(() => members.id),
    groupId: uuid('group_id').references(() => groups.id),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => members.id),
    priority: text('priority').notNull(),
    labels: jsonb('labels').notNull().default(sql`'[]'::jsonb`),
    dueDate: date('due_date', { mode: 'string' }),
    estimate: text('estimate'),
    parentId: uuid('parent_id').references((): AnyPgColumn => cards.id),
    customFields: jsonb('custom_fields').notNull().default(sql`'{}'::jsonb`),
    rank: doublePrecision('rank').notNull(),
    backlogRank: doublePrecision('backlog_rank').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [
    uniqueIndex('cards_number_unique').on(table.spaceId, table.number),
    index('cards_board').on(table.spaceId, table.stateId, table.rank),
    index('cards_parent').on(table.parentId)
  ]
)

/**
 * A comment on a card (2.8). Edited in place; the edit time is kept. A mention is written in the body as
 * `<@memberId>`; `mentions` holds those ids, so "where was I mentioned" needs no text search.
 */
export const cardComments = work.table(
  'card_comments',
  {
    id: uuid('id').primaryKey(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => members.id),
    body: text('body').notNull(),
    mentions: jsonb('mentions').notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [index('card_comments_card').on(table.cardId, table.createdAt)]
)

/** A reaction to a comment: one emoji per member per comment. Personal, like a star, so not audited. */
export const commentReactions = work.table(
  'comment_reactions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => cardComments.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    emoji: text('emoji').notNull(),
    createdAt: createdAt()
  },
  (table) => [primaryKey({ columns: [table.commentId, table.memberId, table.emoji] })]
)

/**
 * A typed link between two cards of any spaces (2.7), stored once, from the card that "does" it:
 * `from` blocks, duplicates or delivers `to`. "Relates" reads the same both ways.
 */
export const cardLinks = work.table(
  'card_links',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    type: text('type').notNull(),
    fromCardId: uuid('from_card_id')
      .notNull()
      .references(() => cards.id),
    toCardId: uuid('to_card_id')
      .notNull()
      .references(() => cards.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => members.id),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex('card_links_unique').on(table.type, table.fromCardId, table.toCardId),
    index('card_links_to').on(table.toCardId)
  ]
)

/**
 * A field a space adds to its cards (2.5): its kind, the options of a selection, and the card types
 * it shows on. An empty `typeIds` means every type of the space.
 */
export const customFields = work.table(
  'custom_fields',
  {
    id: uuid('id').primaryKey(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    options: jsonb('options').notNull().default(sql`'[]'::jsonb`),
    typeIds: jsonb('type_ids').notNull().default(sql`'[]'::jsonb`),
    position: integer('position').notNull(),
    createdAt: createdAt()
  },
  (table) => [uniqueIndex('custom_fields_name_unique').on(table.spaceId, table.name)]
)

/** Who follows a card (2.11). Personal, like a star, so not audited; notifications read it (Etapa 5). */
export const cardWatchers = work.table(
  'card_watchers',
  {
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    createdAt: createdAt()
  },
  (table) => [primaryKey({ columns: [table.cardId, table.memberId] }), index('card_watchers_member').on(table.memberId)]
)

/**
 * A file on a card (2.9). The bytes live in object storage under `objectKey`; the row is written when
 * the upload is asked for and becomes `ready` once the file is there.
 */
export const cardAttachments = work.table(
  'card_attachments',
  {
    id: uuid('id').primaryKey(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status').notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => members.id),
    createdAt: createdAt()
  },
  (table) => [index('card_attachments_card').on(table.cardId, table.createdAt)]
)

/**
 * A key a card answered to before it moved to another space (2.14), so `REQ-12` still opens the card
 * that is now `PRD-40` — in links, specs and Slack.
 */
export const cardKeyAliases = work.table(
  'card_key_aliases',
  {
    organizationId: uuid('organization_id').notNull(),
    spaceKey: text('space_key').notNull(),
    number: integer('number').notNull(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    createdAt: createdAt()
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.spaceKey, table.number] })]
)

/**
 * A saved view (escopo-mvp 3.5): a filter, its order and how its cards are drawn — the replacement for
 * a saved JQL. A personal one is its owner's alone; a space's is for everyone who reads the space.
 * Either may look across spaces (Jira's `project in (REQ, PRD)`): each reader still sees only the
 * cards they may open. `filter` and `order` are JSON validated by zod on the way in and out.
 */
export const savedViews = work.table(
  'saved_views',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => members.id),
    spaceId: uuid('space_id').references(() => spaces.id),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    filter: jsonb('filter').notNull().default(sql`'{}'::jsonb`),
    order: jsonb('order').notNull(),
    layout: text('layout').notNull(),
    lanes: text('lanes').notNull().default('none'),
    columns: jsonb('columns').notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [index('saved_views_space').on(table.spaceId), index('saved_views_owner').on(table.ownerId)]
)

/**
 * A space of LET’S Draw AI (ADR-0011): where people keep pages and whiteboards, created as a team
 * needs one — apart from JiraIA's spaces. Open to every member of the organization; whoever created it,
 * or an organization admin, changes and deletes it. `icon` is an emoji.
 */
export const drawSpaces = work.table(
  'draw_spaces',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => members.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [index('draw_spaces_organization').on(table.organizationId)]
)

/** A member's star or follow on a LET’S Draw AI space — personal, so not audited, as a JiraIA star. */
export const drawSpaceMarks = work.table(
  'draw_space_marks',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => drawSpaces.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    /** `star` or `follow`. */
    mark: text('mark').notNull(),
    createdAt: createdAt()
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.memberId, table.mark] })]
)

/**
 * The content of a LET’S Draw AI space (escopo-mvp 5.1, ADR-0011): a tree of folders, pages and
 * whiteboards, each under a parent or at the top, ordered among its siblings by `position`. A page or
 * a whiteboard keeps its merged Yjs state in `document` and the changes since in `content_updates`
 * (ADR-0009); `contentJson` and `contentText` are what its editor derives, for reading, search and
 * versions. A folder holds only other content. A deleted one keeps its row and history.
 */
export const contents = work.table(
  'contents',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => drawSpaces.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => contents.id),
    /** `folder`, `page` or `whiteboard`. */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    position: doublePrecision('position').notNull(),
    document: text('document').notNull().default(''),
    contentJson: jsonb('content_json').notNull().default(sql`'{}'::jsonb`),
    contentText: text('content_text').notNull().default(''),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => members.id),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => members.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [index('contents_tree').on(table.spaceId, table.parentId, table.position)]
)

/** A Yjs update not yet merged into `contents.document` (ADR-0009). Order does not matter to Yjs. */
export const contentUpdates = work.table(
  'content_updates',
  {
    id: uuid('id').primaryKey(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contents.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    update: text('update').notNull(),
    createdAt: createdAt()
  },
  (table) => [index('content_updates_content').on(table.contentId, table.createdAt)]
)

/** A page or whiteboard as it was (5.4): numbered per content, with the Yjs state of that moment. */
export const contentVersions = work.table(
  'content_versions',
  {
    id: uuid('id').primaryKey(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contents.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    contentJson: jsonb('content_json').notNull(),
    contentText: text('content_text').notNull(),
    document: text('document').notNull(),
    /** `auto`, `manual`, or `restore` (then `restoredFrom` names the version brought back). */
    reason: text('reason').notNull(),
    /** What a person called a version they saved by hand (Etapa 4d-c); null for the others. */
    name: text('name'),
    restoredFrom: integer('restored_from'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => members.id),
    createdAt: createdAt()
  },
  (table) => [uniqueIndex('content_versions_number').on(table.contentId, table.number)]
)

/**
 * A comment on a page or whiteboard (5.7). A thread starts with a comment without `parentId`; one
 * anchored to a stretch of text carries `anchorId`, the id of the mark the editor put on it, and `quote`.
 */
export const contentComments = work.table(
  'content_comments',
  {
    id: uuid('id').primaryKey(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contents.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => contentComments.id),
    anchorId: text('anchor_id'),
    quote: text('quote'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => members.id),
    body: text('body').notNull(),
    mentions: jsonb('mentions').notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    resolvedBy: uuid('resolved_by').references(() => members.id)
  },
  (table) => [index('content_comments_content').on(table.contentId, table.createdAt)]
)

/** A one-use pass to open the realtime WebSocket of a page or whiteboard, for 60 seconds (ADR-0009). */
export const realtimeTickets = work.table('realtime_tickets', {
  token: text('token').primaryKey(),
  contentId: uuid('content_id')
    .notNull()
    .references(() => contents.id),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id),
  canWrite: boolean('can_write').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
})

/** A browser connected to a page's or whiteboard's WebSocket, so a change reaches the others. */
export const contentConnections = work.table(
  'content_connections',
  {
    connectionId: text('connection_id').primaryKey(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contents.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    canWrite: boolean('can_write').notNull(),
    connectedAt: timestamp('connected_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [index('content_connections_content').on(table.contentId)]
)

/**
 * An image or file put in a page (5.2). The page holds only its id: an `<img>` cannot send a token, so
 * the editor asks the API for a short-lived download URL each time it draws one.
 */
export const contentFiles = work.table(
  'content_files',
  {
    id: uuid('id').primaryKey(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contents.id),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status').notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => members.id),
    createdAt: createdAt()
  },
  (table) => [index('content_files_content').on(table.contentId)]
)

/**
 * A group of members — an area or a team, kept by hand (ADR-0012). Roles given to a group reach every
 * member in it. An organization admin creates and names its owners; owners add and remove members.
 */
export const groups = work.table(
  'groups',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [index('groups_organization').on(table.organizationId)]
)

export const groupMembers = work.table(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    isOwner: boolean('is_owner').notNull().default(false),
    createdAt: createdAt()
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.memberId] }),
    index('group_members_member').on(table.memberId)
  ]
)

/** A role a group holds on a JiraIA space; its members hold it too (ADR-0012). */
export const spaceGroupRoles = work.table(
  'space_group_roles',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    role: text('role').notNull(),
    createdAt: createdAt()
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.groupId] })]
)

/** A role a member holds on a LET’S Draw AI space — given, or taken by creating it (ADR-0012). */
export const drawSpaceMembers = work.table(
  'draw_space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => drawSpaces.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    role: text('role').notNull(),
    createdAt: createdAt()
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.memberId] }),
    index('draw_space_members_member').on(table.memberId)
  ]
)

/** A role a group holds on a LET’S Draw AI space (ADR-0012). */
export const drawSpaceGroupRoles = work.table(
  'draw_space_group_roles',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => drawSpaces.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    role: text('role').notNull(),
    createdAt: createdAt()
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.groupId] })]
)

/**
 * A member who may read a space asking to edit it (ADR-0012). `product` says whose space — `jiraia` or
 * `draw` — so `spaceId` points at `spaces` or `draw_spaces`. One open request per member and space.
 */
export const accessRequests = work.table(
  'access_requests',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    product: text('product').notNull(),
    spaceId: uuid('space_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    message: text('message').notNull().default(''),
    /** `pending`, `approved` or `declined`. */
    status: text('status').notNull(),
    decidedBy: uuid('decided_by').references(() => members.id),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt()
  },
  (table) => [
    index('access_requests_space').on(table.product, table.spaceId, table.status),
    uniqueIndex('access_requests_open').on(table.product, table.spaceId, table.memberId).where(sql`status = 'pending'`)
  ]
)
