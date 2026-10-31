import { can } from '@jiraia/authorization'
import type { Clock } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'

import type { AccessResolver } from '../access.js'
import type { VersionRepository } from '../draw/version.repository.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import { nextMorning } from '../sprints/days.js'
import { earliestOf } from '../wake/times.js'
import type { WikiPageRepository } from '../wiki/page.repository.js'
import { DUE_SOON_DAYS, dueAfter } from '../wiki/page.schemas.js'
import { ACCESS_KINDS, accessEmail } from './email/access-emails.js'
import { mentionEmail, updatesEmail } from './email/card-emails.js'
import type { Message } from './email/kit.js'
import { drawDailyEmail, weeklyEmail } from './email/summary-emails.js'
import { cardRef, changedOf, commentOf, drawMentionOf, openOf, reviewOf, updatesOf, waitingOf } from './mail-views.js'
import type { Mailer } from './mailer.js'
import type { NotificationRepository, NotificationWithActor } from './notification.repository.js'
import { chosenChannels, type NotificationKind } from './schemas.js'
import type { WeeklyRepository } from './weekly.repository.js'

type Deps = {
  clock: Clock
  logger: JiraiaLogger
  notifications: NotificationRepository
  members: MemberRepository
  versions: VersionRepository
  weekly: WeeklyRepository
  /** Whose wiki pages wait for review, for Monday's message (ADR-0033). */
  wikiPages: WikiPageRepository
  /** Whether the member still reads a page's collection: a closed one is never named (ADR-0034). */
  access: AccessResolver
  mailer: Mailer
  webUrl: string
  /** How long a card's changes gather before their e-mail goes; the local harness passes 0. */
  windowMs: number
}

/** One message per notice, as it happens: a mention, and anything about access (it runs on a deadline). */
const NOW_KINDS = ['mentioned', ...ACCESS_KINDS]
/** Gathered per card for `windowMs`, then one message. */
const CARD_KINDS = ['assigned', 'commented', 'state_changed', 'card_updated']
/** Kept for the LET’S Draw AI morning summary. */
const MORNING_KINDS = ['draw_mentioned', 'content_changed']

/** How many notices one pass looks at; settled ones leave the list, so the next pass moves on. */
const BATCH = 2_000
const DAY_MS = 86_400_000
/** How far back Monday's summary looks for mentions and for the spaces someone worked in. */
const WEEKLY_REACH_MS = 30 * DAY_MS
/**
 * How old a notice may be and still be mailed: news, not history. An older one — written while there
 * was no sender, or before Etapa 5f — is settled unsent, so the first pass with a sender is not a flood.
 */
const STALE_MS = 2 * DAY_MS

export type MailResult = { sent: number; failed: number }

type Outgoing = { member: MemberRow; rows: readonly NotificationWithActor[]; message: Message }

/**
 * Every e-mail JiraIA sends (Etapa 5f). Each notice is mailed once, or settled as not wanted by
 * e-mail when its member chose otherwise; one that failed to send is tried on the next pass.
 */
export class MailService {
  constructor(private readonly deps: Deps) {}

  /**
   * When there is mail to send (ADR-0035): a mention or an access notice at once, a card's changes when
   * the window of its oldest has passed, the LET’S Draw AI summary the next morning. With no sender,
   * nothing is ever due.
   */
  async nextDue(): Promise<{ mail: Date | null; morning: Date | null }> {
    if (!this.deps.mailer.ready) {
      return { mail: null, morning: null }
    }
    const single = await this.deps.notifications.oldestUnmailed(NOW_KINDS)
    const grouped = await this.deps.notifications.oldestUnmailed(CARD_KINDS)
    const morning = await this.deps.notifications.oldestUnmailed(MORNING_KINDS)
    return {
      mail: earliestOf(single, grouped && new Date(grouped.getTime() + this.deps.windowMs)),
      morning: morning && nextMorning(this.deps.clock.now())
    }
  }

  /** Mentions and access notices now, a card's changes once the window has passed. */
  async sendDue(): Promise<MailResult> {
    if (!this._ready()) {
      return { sent: 0, failed: 0 }
    }
    const now = this.deps.clock.now()
    const single = await this._wanted(await this.deps.notifications.unmailed(NOW_KINDS, now, BATCH))
    const grouped = await this._wanted(await this.deps.notifications.unmailed(CARD_KINDS, now, BATCH))
    const cutoff = now.getTime() - this.deps.windowMs
    const due = [..._byCard(grouped).values()].filter((rows) => (rows[0]?.createdAt.getTime() ?? 0) <= cutoff)
    return await this._sendAll([
      ...(await this._compose(single, (row, member) => this._single(row, member))),
      ...(await this._compose(due, (rows, member) => this._updates(rows, member)))
    ])
  }

  /** At 08:00 in São Paulo: the LET’S Draw AI summary, for whoever has something in it. */
  async morning(): Promise<MailResult> {
    if (!this._ready()) {
      return { sent: 0, failed: 0 }
    }
    const now = this.deps.clock.now()
    const rows = await this._wanted(await this.deps.notifications.unmailed(MORNING_KINDS, now, BATCH))
    const byMember = [..._group(rows, (row) => row.memberId).values()]
    const outgoing = await this._compose(byMember, (mine, member) => this._drawDaily(mine, member, now))
    return await this._sendAll(outgoing)
  }

  /** Monday at 08:00: each person's unanswered mentions, the cards nobody took where they work, and their wiki pages to review. */
  async weekly(): Promise<MailResult> {
    const organizationId = this._ready() ? await this.deps.members.organizationId() : undefined
    if (!organizationId) {
      return { sent: 0, failed: 0 }
    }
    const people = (await this.deps.members.list(organizationId)).filter(
      (each) => each.kind === 'person' && each.status === 'active'
    )
    const wanted = await this._wantsWeekly(people.map((person) => person.id))
    const outgoing: Outgoing[] = []
    for (const member of people.filter((person) => wanted.has(person.id))) {
      const message = await this._weekly(member)
      outgoing.push(...(message ? [{ member, rows: [], message }] : []))
    }
    return await this._sendAll(outgoing)
  }

  private _ready(): boolean {
    if (!this.deps.mailer.ready) {
      this.deps.logger.info('No sender is configured; e-mails wait')
    }
    return this.deps.mailer.ready
  }

  private _single(row: NotificationWithActor, member: MemberRow): Message {
    if (row.kind !== 'mentioned') {
      return accessEmail(row, this.deps.webUrl)
    }
    return mentionEmail({
      readerName: member.name,
      card: cardRef(row, this.deps.webUrl),
      comment: commentOf(row, this.deps.webUrl),
      webUrl: this.deps.webUrl
    })
  }

  private _updates(rows: readonly NotificationWithActor[], member: MemberRow): Message {
    const card = cardRef(rows[rows.length - 1] as NotificationWithActor, this.deps.webUrl)
    return updatesEmail({ card, updates: updatesOf(rows, member.name), webUrl: this.deps.webUrl })
  }

  private async _drawDaily(rows: readonly NotificationWithActor[], member: MemberRow, now: Date): Promise<Message> {
    const changed = rows.filter((row) => row.kind === 'content_changed')
    const since = new Date(Math.min(...changed.map((row) => row.createdAt.getTime()), now.getTime()) - 1_000)
    const editors = await this.deps.versions.editorsSince(changed.map(_contentId), since)
    const namesOf = (row: NotificationWithActor) =>
      editors
        .filter((each) => each.contentId === _contentId(row) && each.memberId !== member.id)
        .map((each) => each.name)
    return drawDailyEmail({
      readerName: member.name,
      now,
      changed: changed.map((row) => changedOf(row, namesOf(row), this.deps.webUrl)),
      mentions: rows.filter((row) => row.kind === 'draw_mentioned').map((row) => drawMentionOf(row, this.deps.webUrl)),
      webUrl: this.deps.webUrl
    })
  }

  private async _weekly(member: MemberRow): Promise<Message | undefined> {
    const now = this.deps.clock.now()
    const since = new Date(now.getTime() - WEEKLY_REACH_MS)
    const [mentions, spaceIds, due] = await Promise.all([
      this.deps.weekly.mentionsWaiting(member.id, since),
      this.deps.weekly.spacesWorked(member.id, since),
      this._due(member, now)
    ])
    const open = await this.deps.weekly.openCards(spaceIds)
    if (mentions.length === 0 && open.length === 0 && due.length === 0) {
      return undefined
    }
    return weeklyEmail({
      readerName: member.name,
      now,
      mentions: mentions.slice(0, 3).map((each) => waitingOf(each, this.deps.webUrl)),
      mentionTotal: mentions.length,
      open: open.slice(0, 4).map((card) => openOf(card, this.deps.webUrl)),
      openTotal: open.length,
      reviews: due.map((page) => reviewOf(page, this.deps.webUrl, now)),
      webUrl: this.deps.webUrl
    })
  }

  /** The member's wiki pages to review, in collections they still read. */
  private async _due(member: MemberRow, now: Date) {
    const rows = await this.deps.wikiPages.dueFor(member.id, dueAfter(now, DUE_SOON_DAYS))
    const reads = await Promise.all(
      rows.map(async (row) => can(await this.deps.access.forSpace(member, row.collectionId, 'draw'), 'space:read'))
    )
    return rows.filter((_, index) => reads[index])
  }

  /** The fresh notices whose member wants them by e-mail; the rest are settled now, never looked at again. */
  private async _wanted(rows: readonly NotificationWithActor[]): Promise<NotificationWithActor[]> {
    const chosen = await this._channels(rows.map((row) => row.memberId))
    const fresh = this.deps.clock.now().getTime() - STALE_MS
    const wants = (row: NotificationWithActor) =>
      row.createdAt.getTime() >= fresh &&
      chosenChannels(row.kind as NotificationKind, chosen.get(`${row.memberId}:${row.kind}`)).includes('email')
    const unwanted = rows.filter((row) => !wants(row))
    await this.deps.notifications.markEmailed(
      unwanted.map((row) => row.id),
      this.deps.clock.now()
    )
    return rows.filter(wants)
  }

  private async _wantsWeekly(memberIds: readonly string[]): Promise<Set<string>> {
    const chosen = await this._channels(memberIds)
    return new Set(
      memberIds.filter((id) => chosenChannels('weekly_summary', chosen.get(`${id}:weekly_summary`)).includes('email'))
    )
  }

  private async _channels(memberIds: readonly string[]): Promise<Map<string, unknown>> {
    const preferences = await this.deps.notifications.preferences([...new Set(memberIds)])
    return new Map(preferences.map((each) => [`${each.memberId}:${each.kind}`, each.channels]))
  }

  /**
   * Pairs each group of notices with its member and its message. A member gone or without an e-mail
   * gets nothing, and their notices are settled so they are not looked at again.
   */
  private async _compose<T extends NotificationWithActor | readonly NotificationWithActor[]>(
    groups: readonly T[],
    build: (group: T, member: MemberRow) => Message | Promise<Message>
  ): Promise<Outgoing[]> {
    const outgoing: Outgoing[] = []
    for (const group of groups) {
      const rows: readonly NotificationWithActor[] = Array.isArray(group) ? group : [group as NotificationWithActor]
      const member = await this._member(rows)
      outgoing.push(...(member ? [{ member, rows, message: await build(group, member) }] : []))
    }
    return outgoing
  }

  private async _member(rows: readonly NotificationWithActor[]): Promise<MemberRow | undefined> {
    const first = rows[0]
    const member = first ? await this.deps.members.findById(first.organizationId, first.memberId) : undefined
    if (member?.email && member.status === 'active') {
      return member
    }
    await this.deps.notifications.markEmailed(
      rows.map((row) => row.id),
      this.deps.clock.now()
    )
    return undefined
  }

  private async _sendAll(outgoing: readonly Outgoing[]): Promise<MailResult> {
    let sent = 0
    for (const each of outgoing) {
      sent += (await this._send(each)) ? 1 : 0
    }
    return { sent, failed: outgoing.length - sent }
  }

  private async _send({ member, rows, message }: Outgoing): Promise<boolean> {
    try {
      await this.deps.mailer.send({ to: member.email ?? '', ...message })
      await this.deps.notifications.markEmailed(
        rows.map((row) => row.id),
        this.deps.clock.now()
      )
      return true
    } catch (error) {
      this.deps.logger.warn('E-mail not sent', { memberId: member.id, subject: message.subject, error: String(error) })
      return false
    }
  }
}

const _group = <T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
  }
  return groups
}

/** A member's notices about one card, oldest first — the order `unmailed` reads them in. */
const _byCard = (rows: readonly NotificationWithActor[]) => _group(rows, (row) => `${row.memberId}:${row.cardId}`)

const _contentId = (row: NotificationWithActor): string => String((row.data as { contentId?: string }).contentId ?? '')
