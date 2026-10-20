import { type Clock, NotFoundException } from '@jiraia/core'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { NotificationRepository } from './notification.repository.js'
import {
  type Box,
  type Channel,
  channelSchema,
  DEFAULT_CHANNEL,
  type NotificationKind,
  type NotificationRow,
  notificationKindValues,
  toNotificationView,
  type UpdateNotification
} from './schemas.js'

/**
 * A member's own notices and how they want them (escopo-mvp 4.6). Nobody reads or changes another
 * person's inbox; reading, snoozing and archiving are personal, so they leave no audit event.
 */
export class NotificationService {
  constructor(private readonly deps: { clock: Clock; access: AccessResolver; notifications: NotificationRepository }) {}

  async list(caller: Caller, box: Box) {
    const actor = await this.deps.access.actor(caller)
    const now = this.deps.clock.now()
    const [rows, unread] = await Promise.all([
      this.deps.notifications.list(actor.id, box, now),
      this.deps.notifications.unread(actor.id, now)
    ])
    return { items: rows.map((row) => toNotificationView(row, row.actorName)), unread }
  }

  async unread(caller: Caller) {
    const actor = await this.deps.access.actor(caller)
    return { unread: await this.deps.notifications.unread(actor.id, this.deps.clock.now()) }
  }

  /** Read or not, archived or not, snoozed until a moment or back now. */
  async update(caller: Caller, notificationId: string, input: UpdateNotification) {
    const actor = await this.deps.access.actor(caller)
    const row = await this.deps.notifications.find(actor.id, notificationId)
    if (!row) {
      throw new NotFoundException('Notification', notificationId)
    }
    await this.deps.notifications.update(row.id, _changes(row, input, this.deps.clock.now()))
    return await this.unread(caller)
  }

  async readAll(caller: Caller) {
    const actor = await this.deps.access.actor(caller)
    await this.deps.notifications.readAll(actor.id, this.deps.clock.now())
    return { unread: 0 }
  }

  /** Every kind, with the member's choice or the default. */
  async preferences(caller: Caller) {
    const actor = await this.deps.access.actor(caller)
    const chosen = new Map(
      (await this.deps.notifications.preferences([actor.id])).map((each) => [each.kind, each.channel])
    )
    return {
      items: notificationKindValues.map((kind) => ({
        kind,
        channel: channelSchema.catch(DEFAULT_CHANNEL[kind]).parse(chosen.get(kind) ?? DEFAULT_CHANNEL[kind])
      }))
    }
  }

  async setPreference(caller: Caller, kind: NotificationKind, channel: Channel) {
    const actor = await this.deps.access.actor(caller)
    await this.deps.notifications.putPreference(actor.id, kind, channel, this.deps.clock.now())
    return await this.preferences(caller)
  }
}

type StateChanges = Partial<Pick<NotificationRow, 'readAt' | 'archivedAt' | 'snoozedUntil'>>

/** Only what the member sent changes; marking read twice keeps the first time. */
const _changes = (row: NotificationRow, input: UpdateNotification, now: Date): StateChanges => ({
  ..._read(row, input.read, now),
  ...(input.archived === undefined ? {} : { archivedAt: input.archived ? now : null }),
  ..._snooze(input.snoozedUntil)
})

const _read = (row: NotificationRow, read: boolean | undefined, now: Date): StateChanges =>
  read === undefined ? {} : { readAt: read ? (row.readAt ?? now) : null }

const _snooze = (until: string | null | undefined): StateChanges =>
  until === undefined ? {} : { snoozedUntil: until ? new Date(until) : null }
