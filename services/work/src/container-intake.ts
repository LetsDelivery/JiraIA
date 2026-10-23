import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import type { AccessResolver } from './access.js'
import type { AuditTrail } from './audit/audit.js'
import { ActionRunner } from './automations/actions.js'
import { AutomationRepository } from './automations/automation.repository.js'
import { AutomationService } from './automations/automation.service.js'
import { AutomationEngine } from './automations/engine.js'
import type { CardRepository } from './cards/card.repository.js'
import type { CardService } from './cards/card.service.js'
import type { CardRules } from './cards/card-rules.js'
import { CommentRepository } from './cards/comment.repository.js'
import type { CommentService } from './cards/comment.service.js'
import type { FieldRepository } from './cards/field.repository.js'
import type { LinkService } from './cards/link.service.js'
import type { WatcherRepository } from './cards/watcher.repository.js'
import type { WorkflowRepository } from './cards/workflow.repository.js'
import type { Config } from './config.js'
import type { Overrides } from './container.js'
import { ContentRepository } from './draw/content.repository.js'
import { ContentCommentRepository } from './draw/content-comment.repository.js'
import { DrawSpaceRepository } from './draw/draw-space.repository.js'
import { VersionRepository } from './draw/version.repository.js'
import { Dispatcher } from './events/dispatcher.js'
import type { Consumer, EventPublisher } from './events/event.js'
import { EventBridgePublisher, eventBridgeClient } from './events/eventbridge-publisher.js'
import { OutboxRepository } from './events/outbox.js'
import { DirectPublisher, Receipts } from './events/receipts.js'
import { FormRepository } from './forms/form.repository.js'
import { FormService } from './forms/form.service.js'
import { CatalogRepository } from './governance/catalog.repository.js'
import { EntitlementNotices } from './governance/notices.js'
import { EntitlementRequestRepository } from './governance/request.repository.js'
import { ReviewRepository } from './governance/review.repository.js'
import { GrantRepository } from './grants/grant.repository.js'
import { GroupRepository } from './groups/group.repository.js'
import { SlackChannelRepository } from './integrations/slack.repository.js'
import { SlackService } from './integrations/slack.service.js'
import { WebhookSlackNotifier } from './integrations/slack-notifier.js'
import type { MemberRepository } from './members/member.repository.js'
import { SystemActors } from './members/system-actor.js'
import { DrawNotices } from './notifications/draw-notices.js'
import { NotificationFanout } from './notifications/fanout.js'
import { MailService } from './notifications/mail.service.js'
import { type Mailer, SesMailer, sesClient, UnavailableMailer } from './notifications/mailer.js'
import { NotificationRepository } from './notifications/notification.repository.js'
import { NotificationService } from './notifications/notification.service.js'
import { WeeklyRepository } from './notifications/weekly.repository.js'
import { ProposalRepository } from './proposals/proposal.repository.js'
import { AccessRequestRepository } from './requests/request.repository.js'
import type { SlackDirect } from './slack/slack-direct.js'
import { SpaceRepository } from './spaces/space.repository.js'
import type { SpaceGate } from './spaces/space-gate.js'
import { SprintRepository } from './sprints/sprint.repository.js'
import { TokenRepository } from './tokens/token.repository.js'
import { TokenService } from './tokens/token.service.js'
import { WebhookSender } from './webhooks/sender.js'
import { WebhookRepository } from './webhooks/webhook.repository.js'
import { WebhookService } from './webhooks/webhook.service.js'

/**
 * Etapa 5's part of the wiring (ADR-0014): intake forms, automations and Slack; notifications and the
 * daily e-mail; API tokens and webhooks. Kept beside `container.ts`, which calls each builder once.
 */

type IntakeDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  gate: SpaceGate
  rules: CardRules
  fields: FieldRepository
  cards: CardRepository
  workflows: WorkflowRepository
  members: MemberRepository
  config: Config
  overrides: Overrides
  services: { cards: CardService; links: LinkService; comments: CommentService }
  /** The other consumers — notifications, webhooks — run beside the automations on the same events. */
  others: Consumer[]
}

/**
 * Etapa 5: intake forms, automations and Slack, and the events that carry changes to them (ADR-0014).
 *
 * `dispatcher` is what the dispatch job runs; `consumers` read the queues (ADR-0025). `drain` runs
 * both in this process until nothing is left — the local harness after each write, and the suites,
 * which want to see a rule's effect without a bus.
 */
export const buildIntake = (deps: IntakeDeps) => {
  const { db, clock, ids, audit, config, overrides } = deps
  const slack = new SlackService({
    db,
    clock,
    ids,
    audit,
    access: deps.access,
    channels: new SlackChannelRepository(db),
    notifier:
      overrides.slack ??
      new WebhookSlackNotifier(createHttpClient({ provider: 'slack', logger: createLogger('work', 'slack') }))
  })
  const automationRows = new AutomationRepository(db)
  const system = new SystemActors({ db, clock, ids, audit, members: deps.members })
  const engine = new AutomationEngine({
    clock,
    ids,
    logger: createLogger('work', 'automation'),
    automations: automationRows,
    cards: deps.cards,
    workflows: deps.workflows,
    members: deps.members,
    access: deps.access,
    system,
    actions: new ActionRunner({
      ...deps.services,
      slack,
      webUrl: (config.WEB_URL ?? 'http://localhost:5280').replace(/\/$/, '')
    })
  })
  const consumers: Consumer[] = [engine, ...deps.others]
  const receipts = new Receipts({ db, clock })
  const outbox = new OutboxRepository(db)
  const direct = new DirectPublisher({ receipts, consumers: () => consumers })
  const local = new Dispatcher({ clock, outbox, publisher: direct })
  return {
    slack,
    forms: new FormService({
      db,
      clock,
      ids,
      audit,
      gate: deps.gate,
      rules: deps.rules,
      fields: deps.fields,
      cards: deps.services.cards,
      forms: new FormRepository(db)
    }),
    automations: new AutomationService({
      db,
      clock,
      ids,
      audit,
      gate: deps.gate,
      rules: deps.rules,
      slack,
      automations: automationRows
    }),
    consumers,
    receipts,
    dispatcher: new Dispatcher({ clock, outbox, publisher: overrides.publisher ?? _publisher(config, direct) }),
    drain: () => _drain(local)
  }
}

/** EventBridge when the bus is configured; otherwise the consumers run where the dispatcher runs. */
const _publisher = (config: Config, direct: EventPublisher): EventPublisher =>
  config.EVENT_BUS_NAME
    ? new EventBridgePublisher({ client: eventBridgeClient(config.AWS_REGION), busName: config.EVENT_BUS_NAME })
    : direct

/** Passes until the outbox is empty; what a rule writes is a new event, so it may take more than one. */
const _drain = async (dispatcher: Dispatcher): Promise<number> => {
  let total = 0
  for (let pass = 0; pass < 20; pass += 1) {
    const sent = await dispatcher.dispatch()
    total += sent
    if (sent === 0) {
      break
    }
  }
  return total
}

type NoticeDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  access: AccessResolver
  members: MemberRepository
  cards: CardRepository
  workflows: WorkflowRepository
  watchers: WatcherRepository
  config: Config
  overrides: Overrides
  /** Notices a person asked to get in Slack (Etapa 5e). */
  slackDirect: SlackDirect
}

/** Etapas 5b and 5f (escopo-mvp 4.6): each member's notices, the consumer that writes them and the e-mails. */
export const buildNotifications = ({
  db,
  clock,
  ids,
  access,
  members,
  cards,
  workflows,
  watchers,
  config,
  overrides,
  slackDirect
}: NoticeDeps) => {
  const rows = new NotificationRepository(db)
  const versions = new VersionRepository(db)
  return {
    notifications: new NotificationService({ clock, access, notifications: rows }),
    fanout: new NotificationFanout({
      clock,
      ids,
      notifications: rows,
      members,
      cards,
      workflows,
      watchers,
      comments: new CommentRepository(db),
      requests: new AccessRequestRepository(db),
      spaces: new SpaceRepository(db),
      grants: new GrantRepository(db),
      groups: new GroupRepository(db),
      proposals: new ProposalRepository(db),
      sprints: new SprintRepository(db),
      entitlements: new EntitlementNotices({
        requests: new EntitlementRequestRepository(db),
        catalog: new CatalogRepository(db),
        reviews: new ReviewRepository(db)
      }),
      draw: new DrawNotices({
        contents: new ContentRepository(db),
        comments: new ContentCommentRepository(db),
        versions,
        spaces: new DrawSpaceRepository(db),
        notifications: rows,
        members
      }),
      slack: slackDirect
    }),
    mail: new MailService({
      clock,
      logger: createLogger('work', 'mail'),
      notifications: rows,
      members,
      versions,
      weekly: new WeeklyRepository(db),
      mailer: overrides.mailer ?? _mailer(config),
      webUrl: (config.WEB_URL ?? 'http://localhost:5280').replace(/\/$/, ''),
      windowMs: overrides.mailWindowMs ?? MAIL_WINDOW_MS
    })
  }
}

/** How long a card's changes gather before their e-mail goes (Etapa 5f). */
const MAIL_WINDOW_MS = 10 * 60_000

/** SES from the verified sender when there is one; until then the e-mails wait (pendência #11). */
const _mailer = (config: Config): Mailer =>
  config.MAIL_FROM
    ? new SesMailer({ client: sesClient(config.AWS_REGION), from: config.MAIL_FROM })
    : new UnavailableMailer()

type OutwardDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  gate: SpaceGate
  members: MemberRepository
  cards: CardRepository
  overrides: Overrides
}

/** Etapa 5c (escopo-mvp 4.7, 4.8): API tokens, and the webhooks that carry changes out. */
export const buildOutward = ({ db, clock, ids, audit, access, gate, members, cards, overrides }: OutwardDeps) => {
  const rows = new WebhookRepository(db)
  const sender = new WebhookSender({
    clock,
    ids,
    logger: createLogger('work', 'webhooks'),
    http: overrides.webhookHttp ?? createHttpClient({ provider: 'webhook', logger: createLogger('work', 'webhooks') }),
    webhooks: rows,
    cards,
    members,
    proposals: new ProposalRepository(db)
  })
  return {
    sender,
    webhooks: new WebhookService({ db, clock, ids, audit, gate, webhooks: rows, sender }),
    tokens: new TokenService({ db, clock, ids, audit, access, members, tokens: new TokenRepository(db) })
  }
}
