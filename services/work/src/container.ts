import Anthropic from '@anthropic-ai/sdk'
import { type Clock, type IdGenerator, systemClock, uuidGenerator } from '@jiraia/core'
import type { Database, ResumePolicy } from '@jiraia/db'
import { cognitoIdentity, createRouter, type HttpClient, type Route } from '@jiraia/http'
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
import { cardTypeRoutes } from './cards/card-type.routes.js'
import { CardTypeService } from './cards/card-type.service.js'
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
import { buildWake, connectSignalled } from './container-wake.js'
import { buildWiki } from './container-wiki.js'
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
import { AccessClock } from './governance/access-clock.js'
import { CatalogRepository } from './governance/catalog.repository.js'
import { CatalogService } from './governance/catalog.service.js'
import { HolidayRepository, HolidayService, SlaClock } from './governance/holidays.js'
import { InventoryImport } from './governance/inventory.js'
import { Removals } from './governance/removals.js'
import { AccessReport } from './governance/report.js'
import { EntitlementRequestRepository } from './governance/request.repository.js'
import { EntitlementRequestService } from './governance/request.service.js'
import { ReviewRepository } from './governance/review.repository.js'
import { ReviewService } from './governance/review.service.js'
import { auditRoutes, catalogRoutes, entitlementRoutes, holidayRoutes, reviewRoutes } from './governance/routes.js'
import { GrantRepository } from './grants/grant.repository.js'
import { GrantService } from './grants/grant.service.js'
import { grantRoutes } from './grants/routes.js'
import { GroupRepository } from './groups/group.repository.js'
import { GroupService } from './groups/group.service.js'
import { groupRoutes } from './groups/routes.js'
import { integrationRoutes } from './integrations/routes.js'
import type { SlackNotifier } from './integrations/slack-notifier.js'
import { LabelRepository } from './labels/label.repository.js'
import { LabelService } from './labels/label.service.js'
import { labelRoutes } from './labels/routes.js'
import { buildMcp } from './mcp/build.js'
import { mcpRoutes } from './mcp/routes.js'
import { MemberAdmission } from './members/admission.js'
import { MemberRepository } from './members/member.repository.js'
import { MemberService } from './members/member.service.js'
import { SystemActors } from './members/system-actor.js'
import type { Mailer } from './notifications/mailer.js'
import { notificationRoutes } from './notifications/routes.js'
import { buildOAuth } from './oauth/build.js'
import { mcpChallenge, publicBase } from './oauth/metadata.js'
import { OAuthTokens } from './oauth/oauth-tokens.js'
import { oauthRoutes } from './oauth/routes.js'
import { MyCardsRepository } from './personal/my-cards.repository.js'
import { myCardRoutes } from './personal/my-cards.routes.js'
import { MyCardsService } from './personal/my-cards.service.js'
import { PersonalRepository } from './personal/personal.repository.js'
import { PersonalService } from './personal/personal.service.js'
import { buildProposals } from './proposals/build.js'
import { proposalRoutes } from './proposals/routes.js'
import { DashboardRepository } from './reports/dashboard.repository.js'
import { DashboardService } from './reports/dashboard.service.js'
import { ReportRepository } from './reports/report.repository.js'
import { ReportService } from './reports/report.service.js'
import { reportRoutes } from './reports/routes.js'
import { SprintReportRepository } from './reports/sprint-report.repository.js'
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
import { sprintRoutes } from './sprints/routes.js'
import { SprintRepository } from './sprints/sprint.repository.js'
import { SprintService } from './sprints/sprint.service.js'
import { tokenRoutes } from './tokens/routes.js'
import { viewRoutes } from './views/routes.js'
import { ViewRepository } from './views/view.repository.js'
import { ViewService } from './views/view.service.js'
import type { WakeTransport } from './wake/waker.js'
import { webhookRoutes } from './webhooks/routes.js'
import { collectionPageRoutes, collectionRoutes, libraryRoutes, wikiPageRoutes } from './wiki/routes.js'

/**
 * Wires the service together — the only place in `work` that constructs anything.
 *
 * `overrides` is what the integration suite and the local harness use: they hand in the database, a
 * fixed clock and the file store, while the repositories, services and router are the real thing (the
 * same line uselets draws).
 */
export type Overrides = {
  db?: Database
  /** How long a statement waits for a paused database; the general function sets it per trigger (ADR-0035). */
  resume?: ResumePolicy
  /** How a job is woken: the harness runs it in its process; the suites read what was asked. */
  wakes?: WakeTransport
  clock?: Clock
  ids?: IdGenerator
  files?: FileStore
  broadcaster?: Broadcaster
  /** Who drafts from a prompt: the suite's fake, the harness's offline stand-in, or Claude. */
  writer?: DraftWriter
  /** Where committed events go (ADR-0014): EventBridge in AWS; the suites may hold them instead. */
  publisher?: EventPublisher
  /** Who sends the e-mails: SES in AWS, a folder locally, a list in the suites. */
  mailer?: Mailer
  /** How long a card's changes gather before their e-mail goes; the harness and the suites pass 0. */
  mailWindowMs?: number
  /** Who delivers outgoing webhooks: the shared client, the harness's printer, or MSW in the suites. */
  webhookHttp?: HttpClient
  /** Who posts to Slack: incoming webhooks through the shared client, or a suite's own. */
  slack?: SlackNotifier
  /** Slack's Web API for the workspace connection (Etapa 5e); the suites hand in their own. */
  slackApi?: SlackApi
}

export const buildService = (config: Config, overrides: Overrides = {}) => {
  const { db, commits } = connectSignalled(config, overrides)
  const clock = overrides.clock ?? systemClock
  const ids = overrides.ids ?? uuidGenerator
  const files = overrides.files ?? new S3FileStore({ bucket: config.ATTACHMENTS_BUCKET, region: config.AWS_REGION })

  const members = new MemberRepository(db)
  const spaces = new SpaceRepository(db)
  const personal = new PersonalRepository(db)
  const workflows = new WorkflowRepository(db)
  const cards = new CardRepository(db)
  const audit = new AuditTrail({ db, clock, ids })
  const allowedDomains = config.ALLOWED_EMAIL_DOMAINS
  const admission = new MemberAdmission({ db, clock, ids, audit, members, allowedDomains })
  const access = new AccessResolver({ db, admission })
  const shared = { db, clock, ids, access, audit }
  const gate = new SpaceGate({ access, spaces })
  const cardGate = new CardGate({ gate, cards, access })
  const fields = new FieldRepository(db)
  const watchers = new WatcherRepository(db)
  const sprintRows = new SprintRepository(db)
  const rules = new CardRules({
    cards,
    fields,
    groups: new GroupRepository(db),
    members,
    workflows,
    sprints: sprintRows
  })
  const onCards = { db, clock, ids, audit, cardGate, cards }
  const accessParts = buildAccess({ db, clock, ids, audit, access, members })
  const draw = buildDraw({ db, clock, ids, audit, access, members, config, overrides, files })
  const search = new SearchService({
    clock,
    access,
    cards,
    search: new SearchRepository(db),
    wikiReadable: async (actor) => (await draw.wikiCollections.readable(actor)).map((each) => each.space.id)
  })
  const cardService = new CardService({ ...onCards, gate, rules, workflows, watchers })
  const links = new LinkService({ ...onCards, links: new LinkRepository(db) })
  const viewRows = new ViewRepository(db)
  const comments = new CommentService({ ...onCards, comments: new CommentRepository(db), watchers, members })

  const services = {
    members: new MemberService({ ...shared, members, allowedDomains, departures: accessParts.accessClock }),
    spaces: new SpaceService({ ...shared, spaces, members, personal, workflows }),
    workflows: new WorkflowService({ db, clock, ids, audit, gate, workflows }),
    cardTypes: new CardTypeService({ db, clock, ids, audit, gate, workflows }),
    labels: new LabelService({ db, clock, ids, audit, gate, labels: new LabelRepository(db) }),
    sprints: new SprintService({
      db,
      clock,
      ids,
      audit,
      gate,
      sprints: sprintRows,
      system: new SystemActors({ db, clock, ids, audit, members })
    }),
    fields: new FieldService({ db, clock, ids, audit, gate, fields, workflows }),
    cards: cardService,
    links,
    comments,
    watchers: new WatcherService({ db, clock, cardGate, watchers }),
    attachments: new AttachmentService({ ...onCards, attachments: new AttachmentRepository(db), files }),
    personal: new PersonalService({ clock, access, spaces, personal }),
    myCards: new MyCardsService({ clock, access, cardGate, myCards: new MyCardsRepository(db) }),
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
    reports: new ReportService({
      clock,
      gate,
      reports: new ReportRepository(db),
      views: viewRows,
      sprints: sprintRows,
      sprintReports: new SprintReportRepository(db)
    }),
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
    ...cardTypeRoutes(services.cardTypes),
    ...labelRoutes(services.labels),
    ...sprintRoutes(services.sprints),
    ...fieldRoutes(services.fields),
    ...cardRoutes(services.cards),
    ...linkRoutes(services.links),
    ...conversationRoutes(services.comments, services.watchers),
    ...myCardRoutes(services.myCards),
    ...attachmentRoutes(services.attachments),
    ...searchRoutes(services.search, services.bulk),
    ...viewRoutes(services.views),
    ...reportRoutes(services.dashboards, services.reports),
    ...groupRoutes(services.groups),
    ...grantRoutes(services.grants),
    ...accessRequestRoutes(services.accessRequests),
    ...catalogRoutes(services.catalog),
    ...entitlementRoutes(services.entitlementRequests),
    ...holidayRoutes(services.holidays),
    ...reviewRoutes(services.reviews),
    ...auditRoutes(services.accessReport, services.inventory),
    ...drawSpaceRoutes(services.drawSpaces, services.drafts),
    ...contentRoutes(services.contents),
    ...documentRoutes(services.documents, services.realtime),
    ...contentTalkRoutes(services.contentComments, services.realtime),
    ...contentFileRoutes(services.contentFiles),
    ...collectionRoutes(services.wikiCollections),
    ...collectionPageRoutes(services.wikiPages, services.wikiContent),
    ...libraryRoutes(services.wikiLibrary),
    ...wikiPageRoutes(services.wikiPages),
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

  const jobs = { ...services, ...intake, mail: notices.mail, webhookSender: outward.sender }
  return {
    db,
    clock,
    commits,
    ...buildWake({ config, clock, ids, transport: overrides.wakes, jobs }),
    routes,
    ...services,
    ...intake,
    notifications: notices.notifications,
    mail: notices.mail,
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
      challenge: (path, headers) => (path === '/mcp' ? mcpChallenge(publicBase(config.API_URL, headers)) : undefined),
      // The Cognito ID token of a Google sign-in, verified here: the API has no authorizer (ADR-0025, ADR-0026).
      ...(config.COGNITO_ISSUER && config.COGNITO_CLIENT_ID
        ? { identity: cognitoIdentity({ issuer: config.COGNITO_ISSUER, audience: config.COGNITO_CLIENT_ID }) }
        : {})
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

/**
 * Groups, the roles given to people and groups on a space, and access requests (ADR-0012); the
 * governance of access to LET’S systems (ADR-0024).
 */
const buildAccess = ({ db, clock, ids, audit, access, members }: AccessDeps) => {
  const groupRows = new GroupRepository(db)
  const catalog = new CatalogRepository(db)
  const holidays = new HolidayRepository(db)
  const sla = new SlaClock(holidays)
  const entitlementRows = new EntitlementRequestRepository(db)
  const system = new SystemActors({ db, clock, ids, audit, members })
  const removals = new Removals({ ids, audit, requests: entitlementRows })
  const grantRows = new GrantRepository(db)
  const grants = new GrantService({ db, clock, audit, access, grants: grantRows, groups: groupRows, members })
  const requests = new AccessRequestRepository(db)
  return {
    groups: new GroupService({ db, clock, ids, audit, access, groups: groupRows, members }),
    grants,
    accessRequests: new AccessRequestService({ db, clock, ids, audit, access, grants, grantRows, requests }),
    catalog: new CatalogService({ db, clock, ids, audit, access, catalog, members }),
    entitlementRequests: new EntitlementRequestService({
      db,
      clock,
      ids,
      audit,
      access,
      catalog,
      requests: entitlementRows,
      groups: groupRows,
      members,
      sla
    }),
    holidays: new HolidayService({ db, clock, audit, access, holidays }),
    accessClock: new AccessClock({ db, clock, catalog, requests: entitlementRows, sla, system, removals }),
    accessReport: new AccessReport({ db, clock, access, catalog }),
    inventory: new InventoryImport({ db, clock, ids, audit, access, catalog, requests: entitlementRows, members }),
    reviews: new ReviewService({
      db,
      clock,
      ids,
      audit,
      access,
      catalog,
      requests: entitlementRows,
      reviews: new ReviewRepository(db),
      holidays,
      sla,
      removals,
      system
    })
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
 * comments, files and the realtime relay — and LET’S Wiki's collections and pages, on the same content
 * engine (ADR-0033).
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
  const contentService = new ContentService({ db, clock, ids, audit, drawGate, contents, members })
  const wiki = buildWiki({ db, clock, ids, audit, drawGate, spaces, contents, contentService, members })
  return {
    drawSpaces: new DrawSpaceService({ db, clock, ids, audit, drawGate, spaces }),
    drafts: new DraftService({ drawGate, writer: overrides.writer ?? _writer(config) }),
    contents: contentService,
    ...wiki.services,
    documents,
    contentFiles: new ContentFileService({
      db,
      clock,
      ids,
      drawGate,
      files,
      sourceOf: async (contentId) => (await wiki.pages.find(contentId))?.sourceId ?? undefined
    }),
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
