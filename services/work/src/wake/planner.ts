import type { Dispatcher } from '../events/dispatcher.js'
import type { AccessClock } from '../governance/access-clock.js'
import type { ReviewService } from '../governance/review.service.js'
import type { JobName } from '../lambda/jobs.js'
import type { MailService } from '../notifications/mail.service.js'
import type { SprintService } from '../sprints/sprint.service.js'
import type { WebhookSender } from '../webhooks/sender.js'
import { earliestOf } from './times.js'

type Deps = {
  dispatcher: Pick<Dispatcher, 'nextDue'>
  mail: Pick<MailService, 'nextDue'>
  sprints: Pick<SprintService, 'nextLate'>
  webhookSender: Pick<WebhookSender, 'nextDue'>
  accessClock: Pick<AccessClock, 'nextDue'>
  reviews: Pick<ReviewService, 'nextDue'>
}

/**
 * When each job next has work, read from the work itself (ADR-0035): the outbox, the notices not yet
 * mailed, the webhook retries, the grants and reviews running out, the sprints ending. A job with
 * nothing pending is left out, so nothing wakes the database for it. Monday's summary is not here:
 * it keeps its weekly schedule.
 *
 * @example await planner.plan()   // Map { 'mail' => 2026-10-25T15:40:00Z, 'access-clock' => 2026-11-02T03:00:00Z }
 */
export class WakePlanner {
  constructor(private readonly deps: Deps) {}

  async plan(): Promise<Map<JobName, Date>> {
    const mail = await this.deps.mail.nextDue()
    const due: [JobName, Date | null][] = [
      ['dispatch', await this.deps.dispatcher.nextDue()],
      ['mail', mail.mail],
      ['morning', earliestOf(mail.morning, await this.deps.sprints.nextLate())],
      ['webhook-retry', await this.deps.webhookSender.nextDue()],
      ['access-clock', earliestOf(await this.deps.accessClock.nextDue(), await this.deps.reviews.nextDue())]
    ]
    return new Map(due.flatMap(([job, at]) => (at ? [[job, at] as const] : [])))
  }
}
