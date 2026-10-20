import { type Clock, type IdGenerator, toIso } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { and, asc, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'

import { currentProposalId } from '../proposals/delegation.js'
import { auditEvents } from '../schema.js'
import { currentApplication } from './via.js'

/** One field as it was and as it became. `null` means "had no value". */
export type FieldChange = { before: unknown; after: unknown }
export type Changes = Record<string, FieldChange>

export type AuditInput = {
  organizationId: string
  spaceId: string | null
  actorId: string
  entityType:
    | 'member'
    | 'space'
    | 'space_member'
    | 'space_group'
    | 'draw_space_member'
    | 'workflow_state'
    | 'custom_field'
    | 'card'
    | 'card_comment'
    | 'saved_view'
    | 'draw_space'
    | 'group'
    | 'access_request'
    | 'content'
    | 'content_comment'
    | 'form'
    | 'automation'
    | 'slack_channel'
    | 'api_token'
    | 'webhook'
    | 'dashboard'
    | 'slack_workspace'
    | 'proposal'
    | 'proposal_policy'
    | 'oauth_connection'
  entityId: string
  action: string
  changes: Changes
}

export const auditEventViewSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  entityType: z.string(),
  entityId: z.uuid(),
  action: z.string(),
  changes: z.record(z.string(), z.object({ before: z.unknown(), after: z.unknown() })),
  occurredAt: z.iso.datetime(),
  /** The proposal the write applied or reverted (ADR-0019); null when made directly. */
  proposalId: z.uuid().nullable(),
  /** The application a person wrote through (ADR-0022), e.g. "Laís"; null when they wrote themselves. */
  via: z.string().nullable()
})
export type AuditEventView = z.infer<typeof auditEventViewSchema>

/**
 * The fields that differ between two versions of a row, as `{ before, after }`.
 *
 * @example diff({ name: 'A', description: '' }, { name: 'B', description: '' })   // { name: { before: 'A', after: 'B' } }
 */
export const diff = <T extends Record<string, unknown>>(before: Partial<T>, after: Partial<T>): Changes => {
  const changes: Changes = {}

  for (const field of Object.keys(after)) {
    if (before[field] !== after[field]) {
      changes[field] = { before: before[field] ?? null, after: after[field] ?? null }
    }
  }

  return changes
}

/**
 * The append-only trail every write leaves (escopo-mvp 1.6).
 *
 * `record` takes the transaction the write runs in, so the event and the change commit together or
 * not at all — a change with no event is history that silently lies.
 */
export class AuditTrail {
  constructor(private readonly deps: { db: Database; clock: Clock; ids: IdGenerator }) {}

  async record(tx: Database, input: AuditInput): Promise<void> {
    await tx.insert(auditEvents).values({
      id: this.deps.ids.next(),
      occurredAt: this.deps.clock.now(),
      proposalId: currentProposalId() ?? null,
      via: currentApplication() ?? null,
      ...input
    })
  }

  /** One entity's trail, oldest first — a card's history (escopo-mvp 2.10). */
  async listForEntity(entityType: AuditInput['entityType'], entityId: string): Promise<AuditEventView[]> {
    const rows = await this.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
      .orderBy(asc(auditEvents.occurredAt))

    return rows.map((row) => ({ ...row, changes: row.changes as Changes, occurredAt: toIso(row.occurredAt) }))
  }

  /** Newest first. `before` is the `occurredAt` of the last event of the previous page. */
  async listForSpace(spaceId: string, limit: number, before?: Date): Promise<AuditEventView[]> {
    const rows = await this.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.spaceId, spaceId), before ? lt(auditEvents.occurredAt, before) : undefined))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(limit)

    return rows.map((row) => ({ ...row, changes: row.changes as Changes, occurredAt: toIso(row.occurredAt) }))
  }
}
