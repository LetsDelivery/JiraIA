import type { Database } from '@jiraia/db'
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, min, or, type SQL, sql } from 'drizzle-orm'

import { members } from '../schema.js'
import { notificationPreferences, notifications } from '../schema-intake.js'
import type { Box, Channel, NotificationRow } from './schemas.js'

export type NotificationWithActor = NotificationRow & { actorName: string }

/** Which of a member's notices a box holds, at `now`: a snooze ends on its own. */
const _box = (box: Box, now: Date): SQL | undefined => {
  if (box === 'archived') {
    return isNotNull(notifications.archivedAt)
  }
  const snoozed = gt(notifications.snoozedUntil, now)
  return and(
    isNull(notifications.archivedAt),
    box === 'snoozed' ? snoozed : or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, now))
  )
}

export class NotificationRepository {
  constructor(private readonly db: Database) {}

  /** A member never gets two notices for one event: the first one written stands. */
  async insert(rows: readonly NotificationRow[]): Promise<void> {
    if (rows.length > 0) {
      await this.db
        .insert(notifications)
        .values([...rows])
        .onConflictDoNothing()
    }
  }

  async list(memberId: string, box: Box, now: Date, limit = 50): Promise<NotificationWithActor[]> {
    const rows = await this.db
      .select({ notification: notifications, actorName: members.name })
      .from(notifications)
      .innerJoin(members, eq(members.id, notifications.actorId))
      .where(and(eq(notifications.memberId, memberId), _box(box, now)))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
    return rows.map((row) => ({ ...row.notification, actorName: row.actorName }))
  }

  async unread(memberId: string, now: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(notifications)
      .where(and(eq(notifications.memberId, memberId), isNull(notifications.readAt), _box('inbox', now)))
    return row?.total ?? 0
  }

  async find(memberId: string, id: string): Promise<NotificationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.memberId, memberId), eq(notifications.id, id)))
    return row
  }

  async update(id: string, fields: Partial<Pick<NotificationRow, 'readAt' | 'archivedAt' | 'snoozedUntil'>>) {
    await this.db.update(notifications).set(fields).where(eq(notifications.id, id))
  }

  async readAll(memberId: string, now: Date): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.memberId, memberId), isNull(notifications.readAt), _box('inbox', now)))
  }

  async preferences(memberIds: readonly string[]): Promise<{ memberId: string; kind: string; channels: unknown }[]> {
    if (memberIds.length === 0) {
      return []
    }
    return await this.db
      .select({
        memberId: notificationPreferences.memberId,
        kind: notificationPreferences.kind,
        channels: notificationPreferences.channels
      })
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.memberId, [...memberIds]))
  }

  async putPreference(memberId: string, kind: string, channels: readonly Channel[], at: Date): Promise<void> {
    await this.db
      .insert(notificationPreferences)
      .values({ memberId, kind, channels, updatedAt: at })
      .onConflictDoUpdate({
        target: [notificationPreferences.memberId, notificationPreferences.kind],
        set: { channels, updatedAt: at }
      })
  }

  /** Unread notices not yet mailed, oldest first: what a daily summary may carry. */
  /**
   * The notices of these kinds nobody has mailed or read yet, oldest first. Each one leaves this list
   * once it is settled — mailed, or marked as not wanted by e-mail — so the batch always moves on.
   */
  async unmailed(kinds: readonly string[], before: Date, limit: number): Promise<NotificationWithActor[]> {
    const rows = await this.db
      .select({ notification: notifications, actorName: members.name })
      .from(notifications)
      .innerJoin(members, eq(members.id, notifications.actorId))
      .where(and(_unmailed(kinds), lte(notifications.createdAt, before)))
      .orderBy(notifications.createdAt)
      .limit(limit)
    return rows.map((row) => ({ ...row.notification, actorName: row.actorName }))
  }

  /** When the oldest notice `unmailed` would find was written: what the mail job is woken by (ADR-0035). */
  async oldestUnmailed(kinds: readonly string[]): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: min(notifications.createdAt) })
      .from(notifications)
      .innerJoin(members, eq(members.id, notifications.actorId))
      .where(_unmailed(kinds))
    return row?.at ?? null
  }

  /** Who already has an unread, unmailed notice of this kind about this page: one is enough. */
  async waitingOn(kind: string, contentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ memberId: notifications.memberId })
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, kind),
          sql`${notifications.data}->>'contentId' = ${contentId}`,
          isNull(notifications.emailedAt),
          isNull(notifications.readAt)
        )
      )
    return rows.map((row) => row.memberId)
  }

  async markEmailed(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length > 0) {
      await this.db
        .update(notifications)
        .set({ emailedAt: at })
        .where(inArray(notifications.id, [...ids]))
    }
  }
}

/** Of these kinds, neither mailed nor read nor archived: what is still to be told by e-mail. */
const _unmailed = (kinds: readonly string[]): SQL | undefined =>
  and(
    inArray(notifications.kind, [...kinds]),
    isNull(notifications.emailedAt),
    isNull(notifications.readAt),
    isNull(notifications.archivedAt)
  )
