import type { Clock, IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { CardRepository } from '../cards/card.repository.js'
import type { CardService } from '../cards/card.service.js'
import type { CardGate } from '../cards/card-gate.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import type { Config } from '../config.js'
import type { MemberRepository } from '../members/member.repository.js'
import { SystemActors } from '../members/system-actor.js'
import type { SpaceRepository } from '../spaces/space.repository.js'
import { DevLinkService } from './dev-links.service.js'
import { GitHubRepository } from './github.repository.js'
import { type GitHubApi, HttpGitHubApi, pemOf } from './github-api.js'
import { GitHubConnectService } from './github-connect.service.js'
import { GitHubEventsService } from './github-events.service.js'
import { InstallState } from './signatures.js'

type GitHubDeps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
  cards: CardRepository
  cardGate: CardGate
  spaces: SpaceRepository
  workflows: WorkflowRepository
  moves: Pick<CardService, 'move'>
  config: Config
  /** The suites' GitHub; otherwise the REST API through the shared HTTP client. */
  api?: GitHubApi | undefined
}

/**
 * The GitHub connection (Etapa 9, ADR-0038): installing the App, what GitHub tells of each card's
 * branches and pull requests, and reading it. Without the App's settings it is all wired and inert:
 * status says it is not configured, connecting answers 503, and every delivery is refused.
 */
export const buildGitHub = (deps: GitHubDeps) => {
  const { db, clock, ids, audit, config } = deps
  const logger = createLogger('work', 'github')
  const keys =
    config.GITHUB_APP_ID && config.GITHUB_PRIVATE_KEY
      ? { appId: config.GITHUB_APP_ID, privateKey: pemOf(config.GITHUB_PRIVATE_KEY) }
      : undefined
  const api =
    deps.api ??
    new HttpGitHubApi(createHttpClient({ provider: 'github', logger }), {
      apiUrl: config.GITHUB_API_URL ?? 'https://api.github.com',
      clock,
      keys
    })
  const github = new GitHubRepository(db)
  const system = new SystemActors({ db, clock, ids, audit, members: deps.members })
  const app =
    config.GITHUB_APP_SLUG && config.GITHUB_WEBHOOK_SECRET && keys
      ? { slug: config.GITHUB_APP_SLUG, state: new InstallState(config.GITHUB_WEBHOOK_SECRET) }
      : undefined
  const links = new DevLinkService({ ...deps, github, system, logger })
  return {
    githubConnect: new GitHubConnectService({ ...deps, github, api, app }),
    githubEvents: new GitHubEventsService({
      db,
      clock,
      audit,
      github,
      system,
      links,
      webhookSecret: config.GITHUB_WEBHOOK_SECRET,
      logger
    })
  }
}
