import type { Clock } from '@jiraia/core'
import type { JiraiaLogger } from '@jiraia/logger'

import type { MemberRepository } from '../members/member.repository.js'
import { summaryEmail, summaryLine } from './email-copy.js'
import type { Mailer } from './mailer.js'
import type { NotificationRepository, NotificationWithActor } from './notification.repository.js'
import { DEFAULT_CHANNEL, type NotificationKind } from './schemas.js'

type Deps = {
  clock: Clock
  logger: JiraiaLogger
  notifications: NotificationRepository
  members: MemberRepository
  mailer: Mailer
  webUrl: string
}

/** How many unmailed notices one run looks at. */
const BATCH = 2_000

/**
 * The daily summary (escopo-mvp 4.6), every morning: each person who chose e-mail for a kind gets one
 * message with what they have not read since the last one. A notice read in the panel first is never
 * mailed; one that failed to send is tried again tomorrow.
 */
export class DigestService {
  constructor(private readonly deps: Deps) {}

  async run(): Promise<{ sent: number; failed: number }> {
    const now = this.deps.clock.now()
    const pending = await this.deps.notifications.unmailed(now, BATCH)
    const wanted = await this._byEmail(pending)
    let sent = 0
    let failed = 0
    for (const [memberId, rows] of wanted) {
      const ok = await this._send(memberId, rows)
      sent += ok ? 1 : 0
      failed += ok ? 0 : 1
    }
    return { sent, failed }
  }

  /** The pending notices each member asked to get by e-mail, grouped by member. */
  private async _byEmail(pending: readonly NotificationWithActor[]): Promise<Map<string, NotificationWithActor[]>> {
    const chosen = new Map(
      (await this.deps.notifications.preferences([...new Set(pending.map((row) => row.memberId))])).map((each) => [
        `${each.memberId}:${each.kind}`,
        each.channel
      ])
    )
    const wanted = new Map<string, NotificationWithActor[]>()
    for (const row of pending) {
      const channel = chosen.get(`${row.memberId}:${row.kind}`) ?? DEFAULT_CHANNEL[row.kind as NotificationKind]
      if (channel === 'email') {
        wanted.set(row.memberId, [...(wanted.get(row.memberId) ?? []), row])
      }
    }
    return wanted
  }

  private async _send(memberId: string, rows: readonly NotificationWithActor[]): Promise<boolean> {
    const member = await this.deps.members.findById(rows[0]?.organizationId ?? '', memberId)
    if (!member?.email || member.status !== 'active') {
      return false
    }
    const email = summaryEmail(
      member.name,
      rows.map((row) => summaryLine(row, this.deps.webUrl)),
      this.deps.webUrl
    )
    try {
      await this.deps.mailer.send({ to: member.email, ...email })
      await this.deps.notifications.markEmailed(
        rows.map((row) => row.id),
        this.deps.clock.now()
      )
      return true
    } catch (error) {
      this.deps.logger.warn('Summary not sent', { memberId, error: String(error) })
      return false
    }
  }
}
