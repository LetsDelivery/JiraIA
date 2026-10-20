import type { Database } from '@jiraia/db'
import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm'

import { proposalItems, proposalPolicies, proposals } from '../schema-agents.js'
import type { ProposalItemRow, ProposalPolicyRow, ProposalRow, ProposalStatus } from './schemas.js'

/** How many proposals one listing reads, newest first. */
const PAGE = 100

export type ProposalWithItems = ProposalRow & { items: ProposalItemRow[] }

export class ProposalRepository {
  constructor(private readonly db: Database) {}

  async insert(tx: Database, row: ProposalRow, items: readonly ProposalItemRow[]): Promise<void> {
    await tx.insert(proposals).values(row)
    await tx.insert(proposalItems).values([...items])
  }

  async find(organizationId: string, id: string): Promise<ProposalWithItems | undefined> {
    const [row] = await this.db
      .select()
      .from(proposals)
      .where(and(eq(proposals.organizationId, organizationId), eq(proposals.id, id)))
    return row ? (await this._withItems([row]))[0] : undefined
  }

  /** Pending (`open`) or decided proposals of the organization, of one space or author when named. */
  async list(
    organizationId: string,
    filter: {
      open: boolean
      spaceId?: string | undefined
      authorId?: string | undefined
    }
  ): Promise<ProposalWithItems[]> {
    const open: ProposalStatus[] = ['pending', 'applying']
    const rows = await this.db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.organizationId, organizationId),
          filter.open ? inArray(proposals.status, open) : notInArray(proposals.status, open),
          filter.spaceId ? eq(proposals.spaceId, filter.spaceId) : undefined,
          filter.authorId ? eq(proposals.authorId, filter.authorId) : undefined
        )
      )
      .orderBy(desc(proposals.createdAt))
      .limit(PAGE)
    return await this._withItems(rows)
  }

  /** Pending proposals with an item about this card. */
  async pendingForCard(cardId: string): Promise<ProposalWithItems[]> {
    const rows = await this.db
      .selectDistinct({ proposal: proposals })
      .from(proposals)
      .innerJoin(proposalItems, eq(proposalItems.proposalId, proposals.id))
      .where(and(eq(proposalItems.cardId, cardId), eq(proposals.status, 'pending')))
    return await this._withItems(rows.map((row) => row.proposal))
  }

  /**
   * Moves a proposal from one status to another only if it is still in the first — what keeps two
   * approvers from applying it twice. Whether it moved is the answer.
   */
  async transition(id: string, from: ProposalStatus, fields: Partial<ProposalRow>): Promise<boolean> {
    const moved = await this.db
      .update(proposals)
      .set(fields)
      .where(and(eq(proposals.id, id), eq(proposals.status, from)))
      .returning({ id: proposals.id })
    return moved.length > 0
  }

  async update(tx: Database, id: string, fields: Partial<ProposalRow>): Promise<void> {
    await tx.update(proposals).set(fields).where(eq(proposals.id, id))
  }

  async updateItem(id: string, fields: Partial<ProposalItemRow>): Promise<void> {
    await this.db.update(proposalItems).set(fields).where(eq(proposalItems.id, id))
  }

  async policy(spaceId: string): Promise<ProposalPolicyRow | undefined> {
    const [row] = await this.db.select().from(proposalPolicies).where(eq(proposalPolicies.spaceId, spaceId))
    return row
  }

  async putPolicy(tx: Database, row: ProposalPolicyRow): Promise<void> {
    await tx
      .insert(proposalPolicies)
      .values(row)
      .onConflictDoUpdate({
        target: proposalPolicies.spaceId,
        set: { autoApply: row.autoApply, updatedBy: row.updatedBy, updatedAt: row.updatedAt }
      })
  }

  private async _withItems(rows: readonly ProposalRow[]): Promise<ProposalWithItems[]> {
    if (rows.length === 0) {
      return []
    }
    const items = await this.db
      .select()
      .from(proposalItems)
      .where(
        inArray(
          proposalItems.proposalId,
          rows.map((row) => row.id)
        )
      )
      .orderBy(asc(proposalItems.position))
    return rows.map((row) => ({ ...row, items: items.filter((item) => item.proposalId === row.id) }))
  }
}
