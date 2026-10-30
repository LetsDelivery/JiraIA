import type { Database } from '@jiraia/db'
import { and, asc, eq } from 'drizzle-orm'

import { members, organizations } from '../schema.js'
import type { MemberRow } from './schemas.js'

export class MemberRepository {
  constructor(private readonly db: Database) {}

  /** The one organization of this deployment, created by `bootstrapOrganization`. */
  async organizationId(): Promise<string | undefined> {
    const [row] = await this.db.select({ id: organizations.id }).from(organizations).limit(1)

    return row?.id
  }

  async findBySubject(subject: string): Promise<MemberRow | undefined> {
    const [row] = await this.db.select().from(members).where(eq(members.subject, subject)).limit(1)

    return row
  }

  async findById(organizationId: string, id: string): Promise<MemberRow | undefined> {
    const [row] = await this.db
      .select()
      .from(members)
      .where(and(eq(members.organizationId, organizationId), eq(members.id, id)))
      .limit(1)

    return row
  }

  async findByEmail(organizationId: string, email: string): Promise<MemberRow | undefined> {
    const [row] = await this.db
      .select()
      .from(members)
      .where(and(eq(members.organizationId, organizationId), eq(members.email, email)))
      .limit(1)

    return row
  }

  async list(organizationId: string): Promise<MemberRow[]> {
    return await this.db
      .select()
      .from(members)
      .where(eq(members.organizationId, organizationId))
      .orderBy(asc(members.name))
  }

  async insert(tx: Database, row: MemberRow): Promise<void> {
    await tx.insert(members).values(row)
  }

  /** Binds an invited member to the Google account that just proved their address. */
  async linkSubject(tx: Database, id: string, subject: string): Promise<void> {
    await tx.update(members).set({ subject }).where(eq(members.id, id))
  }

  async updateProfile(tx: Database, id: string, changes: Pick<MemberRow, 'name' | 'jobTitle'>): Promise<void> {
    await tx.update(members).set(changes).where(eq(members.id, id))
  }

  async setAvatar(tx: Database, id: string, avatarKey: string | null): Promise<void> {
    await tx.update(members).set({ avatarKey }).where(eq(members.id, id))
  }

  async setOrgAdmin(tx: Database, id: string, isOrgAdmin: boolean): Promise<void> {
    await tx.update(members).set({ isOrgAdmin }).where(eq(members.id, id))
  }

  async setSpaceManager(tx: Database, id: string, isSpaceManager: boolean): Promise<void> {
    await tx.update(members).set({ isSpaceManager }).where(eq(members.id, id))
  }

  async setAccessAuditor(tx: Database, id: string, isAccessAuditor: boolean): Promise<void> {
    await tx.update(members).set({ isAccessAuditor }).where(eq(members.id, id))
  }

  async deactivate(tx: Database, id: string, at: Date): Promise<void> {
    await tx.update(members).set({ status: 'inactive', deactivatedAt: at }).where(eq(members.id, id))
  }
}
