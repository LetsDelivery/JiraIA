import { type Role, roleSchema } from '@jiraia/authorization'
import type { Database } from '@jiraia/db'
import { and, asc, count, eq, isNull } from 'drizzle-orm'

import { GRANT_TABLES, type Product } from '../access.js'
import { drawSpaces, groupMembers, groups, members, spaces } from '../schema.js'
import type { GroupGrant, PersonGrant } from './grant.schemas.js'

/** The space a grant is on, in whichever product: enough to name it in an error or a request. */
export type GrantedSpace = { id: string; name: string }

/** The roles given on a space, to people and to groups, in either product's tables (ADR-0012). */
export class GrantRepository {
  constructor(private readonly db: Database) {}

  async space(product: Product, organizationId: string, spaceId: string): Promise<GrantedSpace | undefined> {
    const table = product === 'jiraia' ? spaces : drawSpaces
    const live = product === 'jiraia' ? undefined : isNull(drawSpaces.deletedAt)
    const [row] = await this.db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), eq(table.id, spaceId), live))
    return row
  }

  async people(product: Product, spaceId: string): Promise<PersonGrant[]> {
    const table = GRANT_TABLES[product].direct
    const rows = await this.db
      .select({ memberId: members.id, name: members.name, email: members.email, role: table.role })
      .from(table)
      .innerJoin(members, eq(members.id, table.memberId))
      .where(eq(table.spaceId, spaceId))
      .orderBy(asc(members.name))
    return rows.map((row) => ({ ...row, role: roleSchema.parse(row.role) }))
  }

  async groups(product: Product, spaceId: string): Promise<GroupGrant[]> {
    const table = GRANT_TABLES[product].group
    const rows = await this.db
      .select({ groupId: groups.id, name: groups.name, role: table.role, memberCount: count(groupMembers.memberId) })
      .from(table)
      .innerJoin(groups, eq(groups.id, table.groupId))
      .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .where(and(eq(table.spaceId, spaceId), isNull(groups.deletedAt)))
      .groupBy(groups.id, groups.name, table.role)
      .orderBy(asc(groups.name))
    return rows.map((row) => ({ ...row, role: roleSchema.parse(row.role) }))
  }

  async personRole(product: Product, spaceId: string, memberId: string): Promise<Role | undefined> {
    const table = GRANT_TABLES[product].direct
    const [row] = await this.db
      .select({ role: table.role })
      .from(table)
      .where(and(eq(table.spaceId, spaceId), eq(table.memberId, memberId)))
    return row ? roleSchema.parse(row.role) : undefined
  }

  async groupRole(product: Product, spaceId: string, groupId: string): Promise<Role | undefined> {
    const table = GRANT_TABLES[product].group
    const [row] = await this.db
      .select({ role: table.role })
      .from(table)
      .where(and(eq(table.spaceId, spaceId), eq(table.groupId, groupId)))
    return row ? roleSchema.parse(row.role) : undefined
  }

  async putPerson(
    tx: Database,
    product: Product,
    grant: { spaceId: string; memberId: string; role: Role; createdAt: Date }
  ) {
    const table = GRANT_TABLES[product].direct
    await tx
      .insert(table)
      .values(grant)
      .onConflictDoUpdate({ target: [table.spaceId, table.memberId], set: { role: grant.role } })
  }

  async removePerson(tx: Database, product: Product, spaceId: string, memberId: string) {
    const table = GRANT_TABLES[product].direct
    await tx.delete(table).where(and(eq(table.spaceId, spaceId), eq(table.memberId, memberId)))
  }

  async putGroup(
    tx: Database,
    product: Product,
    grant: { spaceId: string; groupId: string; role: Role; createdAt: Date }
  ) {
    const table = GRANT_TABLES[product].group
    await tx
      .insert(table)
      .values(grant)
      .onConflictDoUpdate({ target: [table.spaceId, table.groupId], set: { role: grant.role } })
  }

  async removeGroup(tx: Database, product: Product, spaceId: string, groupId: string) {
    const table = GRANT_TABLES[product].group
    await tx.delete(table).where(and(eq(table.spaceId, spaceId), eq(table.groupId, groupId)))
  }
}
