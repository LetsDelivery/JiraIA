import type { Clock } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { CardRepository } from '../cards/card.repository.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import type { Config } from '../config.js'
import type { MemberRepository } from '../members/member.repository.js'
import { KeySlackSecrets } from './secrets.js'
import { SlackRepository } from './slack.repository.js'
import { HttpSlackApi, type SlackApi } from './slack-api.js'
import { SlackConnectService } from './slack-connect.service.js'
import { SlackDirect } from './slack-direct.js'
import { SlackEventsService } from './slack-events.service.js'

type SlackDeps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
  cards: CardRepository
  workflows: WorkflowRepository
  config: Config
  /** The suites' Slack; otherwise the Web API through the shared HTTP client. */
  api?: SlackApi | undefined
}

/**
 * The Slack connection (Etapa 5e, ADR-0018): connecting the workspace, the notices sent as direct
 * messages, and what Slack tells JiraIA. Without the app's settings it is all wired and inert: status
 * says it is not configured, connecting answers 503, and nothing is sent.
 */
export const buildSlack = ({ db, clock, audit, access, members, cards, workflows, config, api }: SlackDeps) => {
  const secrets = config.SLACK_TOKEN_KEY ? new KeySlackSecrets(config.SLACK_TOKEN_KEY) : undefined
  const webUrl = config.WEB_URL ?? 'http://localhost:5280'
  const slackApi =
    api ??
    new HttpSlackApi(createHttpClient({ provider: 'slack', logger: createLogger('work', 'slack') }), {
      apiUrl: config.SLACK_API_URL ?? 'https://slack.com/api',
      clientId: config.SLACK_CLIENT_ID,
      clientSecret: config.SLACK_CLIENT_SECRET
    })
  const slack = new SlackRepository(db)
  const app =
    config.SLACK_CLIENT_ID && config.SLACK_CLIENT_SECRET && secrets
      ? { clientId: config.SLACK_CLIENT_ID, webUrl, secrets }
      : undefined
  const connect = new SlackConnectService({ db, clock, audit, access, members, slack, api: slackApi, app })
  return {
    slackConnect: connect,
    slackDirect: new SlackDirect({
      slack,
      connect,
      members,
      api: slackApi,
      secrets,
      webUrl,
      logger: createLogger('work', 'slack')
    }),
    slackEvents: new SlackEventsService({
      clock,
      slack,
      cards,
      workflows,
      api: slackApi,
      secrets,
      signingSecret: config.SLACK_SIGNING_SECRET,
      webUrl
    })
  }
}
