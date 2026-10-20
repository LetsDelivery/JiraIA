import { type Role, roleSchema } from '@jiraia/authorization'
import type { Database } from '@jiraia/db'
import { and, asc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm'

import { memberKindSchema } from '../members/schemas.js'
import { members, spaceMembers, spaces } from '../schema.js'
import type { RoleHolder, SpaceRow, SpaceWithLead } from './schemas.js'

type SpaceFields = Partial<Pick<SpaceRow, 'name' | 'description' | 'type' | 'leadId' | 'archivedAt'>>

export class SpaceRepository {
  constructor(private readonly db: Database) {}

  /** Every space read comes with its lead's name, for a list that shows who leads each one. */
  private _select(where: SQL | undefined) {
    return this.db
      .select({ space: spaces, leadName: members.name })
      .from(spaces)
      .leftJoin(members, eq(members.id, spaces.leadId))
      .where(where)
      .orderBy(asc(spaces.name))
  }

  private async _rows(where: SQL | undefined): Promise<SpaceWithLead[]> {
    const rows = await this._select(where)

    return rows.map((row) => ({ ...row.space, leadName: row.leadName }))
  }

  async find(organizationId: string, id: string): Promise<SpaceWithLead | undefined> {
    const [row] = await this._rows(and(eq(spaces.organizationId, organizationId), eq(spaces.id, id)))

    return row
  }

  async findByKey(organizationId: string, key: string): Promise<SpaceRow | undefined> {
    const [row] = await this.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.organizationId, organizationId), eq(spaces.key, key)))
      .limit(1)

    return row
  }

  /** Every space of the organization — all of them are visible to every member (ADR-0012). */
  async listAll(organizationId: string, archived: boolean): Promise<SpaceWithLead[]> {
    return await this._rows(and(eq(spaces.organizationId, organizationId), _archived(archived)))
  }

  async insert(tx: Database, row: SpaceRow): Promise<void> {
    await tx.insert(spaces).values(row)
  }

  async update(tx: Database, id: string, fields: SpaceFields): Promise<void> {
    await tx.update(spaces).set(fields).where(eq(spaces.id, id))
  }

  async roleOf(spaceId: string, memberId: string): Promise<Role | undefined> {
    const [row] = await this.db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.memberId, memberId)))

    return row ? roleSchema.parse(row.role) : undefined
  }

  async listRoles(spaceId: string): Promise<RoleHolder[]> {
    const rows = await this.db
      .select({
        memberId: members.id,
        name: members.name,
        email: members.email,
        kind: members.kind,
        role: spaceMembers.role
      })
      .from(spaceMembers)
      .innerJoin(members, eq(members.id, spaceMembers.memberId))
      .where(eq(spaceMembers.spaceId, spaceId))
      .orderBy(asc(members.name))

    return rows.map((row) => ({ ...row, kind: memberKindSchema.parse(row.kind), role: roleSchema.parse(row.role) }))
  }

  async setRole(tx: Database, input: { spaceId: string; memberId: string; role: Role; at: Date }): Promise<void> {
    await tx
      .insert(spaceMembers)
      .values({ spaceId: input.spaceId, memberId: input.memberId, role: input.role, createdAt: input.at })
      .onConflictDoUpdate({ target: [spaceMembers.spaceId, spaceMembers.memberId], set: { role: input.role } })
  }

  async removeRole(tx: Database, spaceId: string, memberId: string): Promise<void> {
    await tx.delete(spaceMembers).where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.memberId, memberId)))
  }
}

const _archived = (archived: boolean) => (archived ? isNotNull(spaces.archivedAt) : isNull(spaces.archivedAt))
