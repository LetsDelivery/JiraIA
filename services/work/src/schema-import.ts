import { primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { work } from './schema.js'

/**
 * Etapa 8's table (ADR-0036): which JiraIA row each Atlassian record became, so every run of the
 * importer is an upsert — a record seen again updates its row, an unchanged one (same `contentHash`)
 * is skipped — and an old Jira link can be answered (7.6).
 *
 * `source` is `jira` or `confluence`; `entity` names the kind of record (`card`, `comment`, `account`,
 * `space`, `state`, `type`, `field`, `sprint`), since an id is only unique within its kind.
 */
export const importRefs = work.table(
  'import_refs',
  {
    organizationId: uuid('organization_id').notNull(),
    source: text('source').notNull(),
    entity: text('entity').notNull(),
    sourceId: text('source_id').notNull(),
    targetId: uuid('target_id').notNull(),
    contentHash: text('content_hash').notNull(),
    runId: text('run_id').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.source, table.entity, table.sourceId] })]
)
