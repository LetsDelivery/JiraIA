import type { Database } from '@jiraia/db'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { drawSpaceGroupRoles, drawSpaces, groupMembers, groups, members, spaceGroupRoles, spaces } from '../schema.js'
import type { GroupGrantRow, GroupMemberRow, GroupRow } from './group.schemas.js'

export class GroupRepository {
  constructor(private readonly db: Database) {}

  async list(organizationId: string): Promise<GroupRow[]> {
    return await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.organizationId, organizationId), isNull(groups.deletedAt)))
      .orderBy(asc(groups.name))
  }

  async find(organizationId: string, id: string): Promise<GroupRow | undefined> {
    const [row] = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.organizationId, organizationId), eq(groups.id, id), isNull(groups.deletedAt)))
    return row
  }

  async findByName(organizationId: string, name: string): Promise<GroupRow | undefined> {
    const rows = await this.list(organizationId)
    return rows.find((row) => row.name.toLowerCase() === name.toLowerCase())
  }

  /** Who is in these groups, by name, owners first. */
  async membersOf(groupIds: readonly string[]): Promise<GroupMemberRow[]> {
    if (groupIds.length === 0) {
      return []
    }
    return await this.db
      .select({
        groupId: groupMembers.groupId,
        memberId: groupMembers.memberId,
        name: members.name,
        email: members.email,
        isOwner: groupMembers.isOwner
      })
      .from(groupMembers)
      .innerJoin(members, eq(members.id, groupMembers.memberId))
      .where(inArray(groupMembers.groupId, [...groupIds]))
      .orderBy(asc(members.name))
  }

  /** Where these groups hold a role, in both products: JiraIA spaces by key, then Draw spaces by name. */
  async grantsOf(groupIds: readonly string[]): Promise<GroupGrantRow[]> {
    if (groupIds.length === 0) {
      return []
    }
    const ids = [...groupIds]
    const [jiraia, draw] = await Promise.all([
      this.db
        .select({
          groupId: spaceGroupRoles.groupId,
          spaceId: spaces.id,
          key: spaces.key,
          name: spaces.name,
          role: spaceGroupRoles.role
        })
        .from(spaceGroupRoles)
        .innerJoin(spaces, eq(spaces.id, spaceGroupRoles.spaceId))
        .where(inArray(spaceGroupRoles.groupId, ids))
        .orderBy(asc(spaces.key)),
      this.db
        .select({
          groupId: drawSpaceGroupRoles.groupId,
          spaceId: drawSpaces.id,
          name: drawSpaces.name,
          icon: drawSpaces.icon,
          role: drawSpaceGroupRoles.role
        })
        .from(drawSpaceGroupRoles)
        .innerJoin(drawSpaces, eq(drawSpaces.id, drawSpaceGroupRoles.spaceId))
        .where(and(inArray(drawSpaceGroupRoles.groupId, ids), isNull(drawSpaces.deletedAt)))
        .orderBy(asc(drawSpaces.name))
    ])
    return [
      ...jiraia.map(({ key, ...row }) => ({ ...row, product: 'jiraia' as const, label: key })),
      ...draw.map(({ icon, ...row }) => ({ ...row, product: 'draw' as const, label: icon }))
    ]
  }

  /** The groups a member is in — what their roles through groups are read from. */
  async groupIdsOf(memberId: string): Promise<string[]> {
    const rows = await this.db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.memberId, memberId), isNull(groups.deletedAt)))
    return rows.map((row) => row.groupId)
  }

  async insert(tx: Database, row: GroupRow): Promise<void> {
    await tx.insert(groups).values(row)
  }

  async update(
    tx: Database,
    id: string,
    fields: Partial<Pick<GroupRow, 'name' | 'description' | 'deletedAt'>>,
    at: Date
  ) {
    await tx
      .update(groups)
      .set({ ...fields, updatedAt: at })
      .where(eq(groups.id, id))
  }

  async putMember(tx: Database, row: typeof groupMembers.$inferInsert): Promise<void> {
    await tx
      .insert(groupMembers)
      .values(row)
      .onConflictDoUpdate({
        target: [groupMembers.groupId, groupMembers.memberId],
        set: { isOwner: row.isOwner ?? false }
      })
  }

  async removeMember(tx: Database, groupId: string, memberId: string): Promise<void> {
    await tx.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.memberId, memberId)))
  }
}
