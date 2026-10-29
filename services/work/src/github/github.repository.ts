import type { Database } from '@jiraia/db'
import { and, desc, eq, lt } from 'drizzle-orm'

import { cardDevLinks, githubDeliveries, githubInstallations } from '../schema-github.js'

export type InstallationRow = typeof githubInstallations.$inferSelect
export type DevLinkRow = typeof cardDevLinks.$inferSelect
/** Where a branch or pull request is: one ref in one repository, named by any number of cards. */
export type RefAt = { organizationId: string; repo: string; kind: 'branch' | 'pull_request'; ref: string }

/** How long a delivery's id is kept to recognise GitHub sending it again. */
const DELIVERY_TTL_MS = 30 * 24 * 3_600_000

/** The organization's GitHub installation, the deliveries already handled, and each card's branches and PRs. */
export class GitHubRepository {
  constructor(private readonly db: Database) {}

  async installation(organizationId: string): Promise<InstallationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.organizationId, organizationId))
    return row
  }

  /** The organization an installation belongs to, for the deliveries GitHub sends. */
  async byInstallation(installationId: string): Promise<InstallationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, installationId))
    return row
  }

  async saveInstallation(tx: Database, row: InstallationRow): Promise<void> {
    const { organizationId, ...rest } = row
    await tx
      .insert(githubInstallations)
      .values(row)
      .onConflictDoUpdate({ target: githubInstallations.organizationId, set: rest })
  }

  /** Disconnecting forgets the installation; what the cards already show of GitHub stays. */
  async removeInstallation(tx: Database, organizationId: string): Promise<void> {
    await tx.delete(githubInstallations).where(eq(githubInstallations.organizationId, organizationId))
  }

  async delivered(deliveryId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: githubDeliveries.deliveryId })
      .from(githubDeliveries)
      .where(eq(githubDeliveries.deliveryId, deliveryId))
    return row !== undefined
  }

  /** Records a handled delivery, and forgets the ones too old for GitHub to send again. */
  async recordDelivery(deliveryId: string, now: Date): Promise<void> {
    await this.db.insert(githubDeliveries).values({ deliveryId, receivedAt: now }).onConflictDoNothing()
    await this.db
      .delete(githubDeliveries)
      .where(lt(githubDeliveries.receivedAt, new Date(now.getTime() - DELIVERY_TTL_MS)))
  }

  async link(cardId: string, at: Omit<RefAt, 'organizationId'>): Promise<DevLinkRow | undefined> {
    const [row] = await this.db
      .select()
      .from(cardDevLinks)
      .where(
        and(
          eq(cardDevLinks.cardId, cardId),
          eq(cardDevLinks.repo, at.repo),
          eq(cardDevLinks.kind, at.kind),
          eq(cardDevLinks.ref, at.ref)
        )
      )
    return row
  }

  /** Every card's link to one branch or pull request. */
  async linksAt(at: RefAt): Promise<DevLinkRow[]> {
    return await this.db
      .select()
      .from(cardDevLinks)
      .where(
        and(
          eq(cardDevLinks.organizationId, at.organizationId),
          eq(cardDevLinks.repo, at.repo),
          eq(cardDevLinks.kind, at.kind),
          eq(cardDevLinks.ref, at.ref)
        )
      )
  }

  /** The pull requests whose head is this commit — what GitHub's checks name. */
  async pullsAtCommit(organizationId: string, repo: string, sha: string): Promise<DevLinkRow[]> {
    return await this.db
      .select()
      .from(cardDevLinks)
      .where(
        and(eq(cardDevLinks.organizationId, organizationId), eq(cardDevLinks.repo, repo), eq(cardDevLinks.headSha, sha))
      )
  }

  async insertLink(tx: Database, row: DevLinkRow): Promise<void> {
    await tx.insert(cardDevLinks).values(row)
  }

  async updateLink(tx: Database, id: string, fields: Partial<DevLinkRow>): Promise<void> {
    await tx.update(cardDevLinks).set(fields).where(eq(cardDevLinks.id, id))
  }

  /** A card's branches and pull requests, the latest news first. */
  async forCard(cardId: string): Promise<DevLinkRow[]> {
    return await this.db
      .select()
      .from(cardDevLinks)
      .where(eq(cardDevLinks.cardId, cardId))
      .orderBy(desc(cardDevLinks.updatedAt))
  }
}
