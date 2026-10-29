import type { Changes } from '../audit/audit.js'
import type { Raw } from './atlassian-source.js'
import type { AuditInsert } from './confluence.repository.js'
import type { BackupDocument } from './confluence-content.js'
import type { TreeRow } from './confluence-raw-copy.js'
import type { Ref } from './import.repository.js'
import type { People } from './import-members.js'

/** A node as the raw copy keeps it: the node, and for a page its versions, comments and attachments. */
export type NodeFile = {
  node: Raw
  versions?: Raw[]
  footerComments?: Raw[]
  inlineComments?: Raw[]
  attachments?: Raw[]
}
export type LoadedSpace = { space: Raw; rows: TreeRow[]; nodes: Map<string, NodeFile> }

/** What every space of a run shares: who is who, the backup's boards, every attachment by file id. */
export type ImportContext = {
  organizationId: string
  actorId: string
  run: string
  at: Date
  people: People
  names: Map<string, string>
  active: string[]
  backup: Map<string, BackupDocument>
  attachments: Map<string, Raw>
  refs: Record<RefEntity, Map<string, Ref>>
}
export type RefEntity = 'space' | 'content' | 'file' | 'version' | 'comment'

/** The member an Atlassian account became; the importer for an account the run does not know. */
export const whoOf =
  (context: ImportContext) =>
  (accountId: unknown): string =>
    (typeof accountId === 'string' && context.people.memberOf(accountId)) || context.actorId

export const refRow = (context: ImportContext, entity: RefEntity, sourceId: string, targetId: string, hash = '') => ({
  organizationId: context.organizationId,
  source: 'confluence',
  entity,
  sourceId,
  targetId,
  contentHash: hash,
  runId: context.run,
  importedAt: context.at
})

type EventInput = {
  spaceId: string
  entityType: string
  entityId: string
  action: string
  actorId: string
  at: Date
  changes: Changes
}

/** An event of the space's past, already dispatched: nobody is notified about it (ADR-0036). */
export const auditEvent = (context: ImportContext, id: string, event: EventInput): AuditInsert => ({
  id,
  organizationId: context.organizationId,
  spaceId: event.spaceId,
  actorId: event.actorId,
  entityType: event.entityType,
  entityId: event.entityId,
  action: event.action,
  changes: event.changes,
  occurredAt: event.at,
  dispatchedAt: context.at,
  via: 'Confluence'
})
