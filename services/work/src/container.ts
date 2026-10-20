import Anthropic from '@anthropic-ai/sdk'
import { type Clock, type IdGenerator, systemClock, uuidGenerator } from '@jiraia/core'
import { connectDatabase, type Database } from '@jiraia/db'
import { createRouter, type HttpClient, type Route } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import { AccessResolver } from './access.js'
import { AuditTrail } from './audit/audit.js'
import { automationRoutes } from './automations/routes.js'
import { AttachmentRepository } from './cards/attachment.repository.js'
import { AttachmentService } from './cards/attachment.service.js'
import { BulkEditService } from './cards/bulk.service.js'
import { CardRepository } from './cards/card.repository.js'
import { CardService } from './cards/card.service.js'
import { CardGate } from './cards/card-gate.js'
import { CardRules } from './cards/card-rules.js'
import { CommentRepository } from './cards/comment.repository.js'
import { CommentService } from './cards/comment.service.js'
import { attachmentRoutes, conversationRoutes } from './cards/conversation.routes.js'
import { FieldRepository } from './cards/field.repository.js'
import { FieldService } from './cards/field.service.js'
import { LinkRepository } from './cards/link.repository.js'
import { LinkService } from './cards/link.service.js'
import { fieldRoutes, linkRoutes } from './cards/relation.routes.js'
import { cardRoutes, workflowRoutes } from './cards/routes.js'
import { WatcherRepository } from './cards/watcher.repository.js'
import { WatcherService } from './cards/watcher.service.js'
import { WorkflowRepository } from './cards/workflow.repository.js'
import { WorkflowService } from './cards/workflow.service.js'
import type { Config } from './config.js'
import { buildIntake, buildNotifications, buildOutward } from './container-intake.js'
import { AnthropicDraftWriter } from './draw/anthropic-writer.js'
import { ApiGatewayBroadcaster, type Broadcaster } from './draw/broadcaster.js'
import { ContentRepository } from './draw/content.repository.js'
import { ContentService } from './draw/content.service.js'
import { ContentCommentRepository } from './draw/content-comment.repository.js'
import { ContentCommentService } from './draw/content-comment.service.js'
import { ContentFileService } from './draw/content-file.service.js'
import { DocumentService } from './draw/document.service.js'
import { type DraftWriter, UnavailableDraftWriter } from './draw/draft.js'
import { DraftService } from './draw/draft.service.js'
import { DrawGate } from './draw/draw-gate.js'
import { DrawSpaceRepository } from './draw/draw-space.repository.js'
import { DrawSpaceService } from './draw/draw-space.service.js'
import { RealtimeRepository } from './draw/realtime.repository.js'
import { RealtimeService } from './draw/realtime.service.js'
import { contentFileRoutes, contentRoutes, contentTalkRoutes, documentRoutes } from './draw/routes.js'
import { drawSpaceRoutes } from './draw/space.routes.js'
import { VersionRepository } from './draw/version.repository.js'
import type { EventPublisher } from './events/event.js'
import type { FileStore } from './files/file-store.js'
import { S3FileStore } from './files/s3-file-store.js'
import { formRoutes } from './forms/routes.js'
import { GrantRepository } from './grants/grant.repository.js'
import { GrantService } from './grants/grant.service.js'
import { grantRoutes } from './grants/routes.js'
import { GroupRepository } from './groups/group.repository.js'
import { GroupService } from './groups/group.service.js'
import { groupRoutes } from './groups/routes.js'
import { integrationRoutes } from './integrations/routes.js'
import type { SlackNotifier } from './integrations/slack-notifier.js'
import { buildMcp } from './mcp/build.js'
import { mcpRoutes } from './mcp/routes.js'
import { MemberAdmission } from './members/admission.js'
import { MemberRepository } from './members/member.repository.js'
import { MemberService } from './members/member.service.js'
import type { Mailer } from './notifications/mailer.js'
import { notificationRoutes } from './notifications/routes.js'
import { buildOAuth } from './oauth/build.js'
import { mcpChallenge, publicBase } from './oauth/metadata.js'
import { OAuthTokens } from './oauth/oauth-tokens.js'
import { oauthRoutes } from './oauth/routes.js'
import { PersonalRepository } from './personal/personal.repository.js'
import { PersonalService } from './personal/personal.service.js'
import { buildProposals } from './proposals/build.js'
import { proposalRoutes } from './proposals/routes.js'
import { DashboardRepository } from './reports/dashboard.repository.js'
import { DashboardService } from './reports/dashboard.service.js'
import { ReportRepository } from './reports/report.repository.js'
import { ReportService } from './reports/report.service.js'
import { reportRoutes } from './reports/routes.js'
import { AccessRequestRepository } from './requests/request.repository.js'
import { AccessRequestService } from './requests/request.service.js'
import { accessRequestRoutes } from './requests/routes.js'
import { workRoutes } from './routes.js'
import { searchRoutes } from './search/routes.js'
import { SearchRepository } from './search/search.repository.js'
import { SearchService } from './search/search.service.js'
import { buildSlack } from './slack/build.js'
import { slackRoutes } from './slack/routes.js'
import type { SlackApi } from './slack/slack-api.js'
import { SpaceRepository } from './spaces/space.repository.js'
import { SpaceService } from './spaces/space.service.js'
import { SpaceGate } from './spaces/space-gate.js'
import { tokenRoutes } from './tokens/routes.js'
import { viewRoutes } from './views/routes.js'
import { ViewRepository } from './views/view.repository.js'
import { ViewService } from './views/view.service.js'
import { webhookRoutes } from './webhooks/routes.js'

/**
 * Wires the service together — the only place in `work` that constructs anything.
 *
 * `overrides` is what the integration suite and the local harness use: they hand in the database, a
 * fixed clock and the file store, while the repositories, services and router are the real thing (the
 * same line uselets draws).
 */
export type Overrides = {
  db?: Database
  clock?: Clock
  ids?: IdGenerator
  files?: FileStore
  broadcaster?: Broadcaster
  /** Who drafts from a prompt: the suite's fake, the harness's offline stand-in, or Claude. */
  writer?: DraftWriter
  /** Where committed events go (ADR-0014): EventBridge in AWS; the suites may hold them instead. */
  publisher?: EventPublisher
  /** Who sends the daily summary: SES in AWS, a folder locally, a list in the suites. */
  mailer?: Mailer
  /** Who delivers outgoing webhooks: the shared client, the harness's printer, or MSW in the suites. */
  webhookHttp?: HttpClient
  /** Who posts to Slack: incoming webhooks through the shared client, or a suite's own. */
  slack?: SlackNotifier
  /** Slack's Web API for the workspace connection (Etapa 5e); the suites hand in their own. */
  slackApi?: SlackApi
}

export const buildService = (config: Config, overrides: Overrides = {}) => {
  const db = overrides.db ?? connectDatabase(config)
  const clock = overrides.clock ?? systemClock
  const ids = overrides.ids ?? uuidGenerator
  const files = overrides.files ?? new S3FileStore({ bucket: config.ATTACHMENTS_BUCKET, region: config.AWS_REGION })

  const members = new MemberRepository(db)
  const spaces = new SpaceRepository(db)
  const personal = new PersonalRepository(db)
  const workflows = new WorkflowRepository(db)
  const cards = new CardRepository(db)
  const audit = new AuditTrail({ db, clock, ids })
  const allowedDomain = config.ALLOWED_EMAIL_DOMAIN
  const admission = new MemberAdmission({ db, clock, ids, audit, members, allowedDomain })
  const access = new AccessResolver({ db, admission })
  const shared = { db, clock, ids, access, audit }
  const gate = new SpaceGate({ access, spaces })
  const cardGate = new CardGate({ gate, cards, access })
  const fields = new FieldRepository(db)
  const watchers = new WatcherRepository(db)
  const rules = new CardRules({ cards, fields, groups: new GroupRepository(db), members, workflows })
  const onCards = { db, clock, ids, audit, cardGate, cards }
  const search = new SearchService({ clock, access, cards, search: new SearchRepository(db) })
  const accessParts = buildAccess({ db, clock, ids, audit, access, members })
  const draw = buildDraw({ db, clock, ids, audit, access, members, config, overrides, files })
  const cardService = new CardService({ ...onCards, gate, rules, workflows, watchers })
  const links = new LinkService({ ...onCards, links: new LinkRepository(db) })
  const viewRows = new ViewRepository(db)
  const comments = new CommentService({ ...onCards, comments: new CommentRepository(db), watchers, members })

  const services = {
    members: new MemberService({ ...shared, members, allowedDomain }),
    spaces: new SpaceService({ ...shared, spaces, members, personal, workflows }),
    workflows: new WorkflowService({ db, clock, ids, audit, gate, workflows }),
    fields: new FieldService({ db, clock, ids, audit, gate, fields, workflows }),
    cards: cardService,
    links,
    comments,
    watchers: new WatcherService({ db, clock, cardGate, watchers }),
    attachments: new AttachmentService({ ...onCards, attachments: new AttachmentRepository(db), files }),
    personal: new PersonalService({ clock, access, spaces, personal }),
    search,
    bulk: new BulkEditService({ db, clock, audit, cardGate, rules, cards, watchers }),
    views: new ViewService({ db, clock, ids, audit, access, gate, views: viewRows, search }),
    dashboards: new DashboardService({
      db,
      clock,
      audit,
      gate,
      dashboards: new DashboardRepository(db),
      views: viewRows
    }),
    reports: new ReportService({ clock, gate, reports: new ReportRepository(db), views: viewRows }),
    ...accessParts,
    ...draw
  }
  const proposals = buildProposals({
    ...onCards,
    access,
    gate,
    fields,
    workflows,
    members,
    services: { cards: cardService, links, comments }
  })
  const webUrl = config.WEB_URL ?? 'http://localhost:5280'
  const mcp = buildMcp({ ...services, access, spaceRows: spaces, proposals, webUrl })
  const oauth = buildOAuth({ db, clock, ids, audit, access, members })
  const slack = buildSlack({ db, clock, audit, access, members, cards, workflows, config, api: overrides.slackApi })
  const notices = buildNotifications({
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
    slackDirect: slack.slackDirect
  })
  const outward = buildOutward({ db, clock, ids, audit, access, gate, members, cards, overrides })
  const intake = buildIntake({
    db,
    clock,
    ids,
    audit,
    access,
    others: [notices.fanout, outward.sender],
    gate,
    rules,
    fields,
    cards,
    workflows,
    members,
    config,
    overrides,
    services: { cards: cardService, links, comments }
  })
  const routes: Route[] = [
    ...workRoutes(services),
    ...workflowRoutes(services.workflows),
    ...fieldRoutes(services.fields),
    ...cardRoutes(services.cards),
    ...linkRoutes(services.links),
    ...conversationRoutes(services.comments, services.watchers),
    ...attachmentRoutes(services.attachments),
    ...searchRoutes(services.search, services.bulk),
    ...viewRoutes(services.views),
    ...reportRoutes(services.dashboards, services.reports),
    ...groupRoutes(services.groups),
    ...grantRoutes(services.grants),
    ...accessRequestRoutes(services.accessRequests),
    ...drawSpaceRoutes(services.drawSpaces, services.drafts),
    ...contentRoutes(services.contents),
    ...documentRoutes(services.documents, services.realtime),
    ...contentTalkRoutes(services.contentComments, services.realtime),
    ...contentFileRoutes(services.contentFiles),
    ...formRoutes(intake.forms),
    ...automationRoutes(intake.automations),
    ...integrationRoutes(intake.slack),
    ...notificationRoutes(notices.notifications),
    ...tokenRoutes(outward.tokens),
    ...webhookRoutes(outward.webhooks),
    ...slackRoutes(slack.slackConnect),
    ...proposalRoutes(proposals),
    ...mcpRoutes(mcp),
    ...oauthRoutes({ server: oauth.server, tokens: oauth.tokens, apiUrl: config.API_URL, webUrl })
  ]

  return {
    db,
    routes,
    ...services,
    ...intake,
    notifications: notices.notifications,
    digest: notices.digest,
    tokens: outward.tokens,
    webhooks: outward.webhooks,
    webhookSender: outward.sender,
    ...slack,
    proposals,
    oauth,
    router: createRouter({
      routes,
      logger: createLogger('work', 'router'),
      // An application's OAuth token (ADR-0021) or an API token (ADR-0015), told apart by their prefix.
      tokens: {
        verify: (value) => (OAuthTokens.owns(value) ? oauth.tokens.verify(value) : outward.tokens.verify(value))
      },
      challenge: (path, headers) => (path === '/mcp' ? mcpChallenge(publicBase(config.API_URL, headers)) : undefined)
    })
  }
}

type AccessDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
}

/** Groups, the roles given to people and groups on a space, and access requests (ADR-0012). */
const buildAccess = ({ db, clock, ids, audit, access, members }: AccessDeps) => {
  const groupRows = new GroupRepository(db)
  const grantRows = new GrantRepository(db)
  const grants = new GrantService({ db, clock, audit, access, grants: grantRows, groups: groupRows, members })
  const requests = new AccessRequestRepository(db)
  return {
    groups: new GroupService({ db, clock, ids, audit, access, groups: groupRows, members }),
    grants,
    accessRequests: new AccessRequestService({ db, clock, ids, audit, access, grants, grantRows, requests })
  }
}

type DrawDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
  config: Config
  overrides: Overrides
  files: FileStore
}

/**
 * LET’S Draw AI (Etapa 4, ADR-0009–0011): its spaces, the content tree, the documents edited together,
 * comments, files and the realtime relay.
 */
const buildDraw = ({ db, clock, ids, audit, access, members, config, overrides, files }: DrawDeps) => {
  const contents = new ContentRepository(db)
  const spaces = new DrawSpaceRepository(db)
  const drawGate = new DrawGate({ access, spaces, contents })
  const broadcaster =
    overrides.broadcaster ?? new ApiGatewayBroadcaster({ url: config.REALTIME_URL, region: config.AWS_REGION })
  const documents = new DocumentService({
    db,
    clock,
    ids,
    audit,
    drawGate,
    contents,
    versions: new VersionRepository(db)
  })
  const comments = new ContentCommentRepository(db)
  return {
    drawSpaces: new DrawSpaceService({ db, clock, ids, audit, drawGate, spaces }),
    drafts: new DraftService({ drawGate, writer: overrides.writer ?? _writer(config) }),
    contents: new ContentService({ db, clock, ids, audit, drawGate, contents, members }),
    documents,
    contentFiles: new ContentFileService({ db, clock, ids, drawGate, files }),
    contentComments: new ContentCommentService({ db, clock, ids, audit, drawGate, comments, members }),
    realtime: new RealtimeService({
      clock,
      drawGate,
      realtime: new RealtimeRepository(db),
      documents,
      broadcaster,
      url: config.REALTIME_URL
    })
  }
}

/** Claude when the key is configured; otherwise a writer that says the AI is not set up yet. */
const _writer = (config: Config): DraftWriter =>
  config.ANTHROPIC_API_KEY
    ? new AnthropicDraftWriter(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }))
    : new UnavailableDraftWriter()
