import type { Clock } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { JiraiaLogger } from '@jiraia/logger'
import type { z } from 'zod'

import type { AuditTrail } from '../audit/audit.js'
import type { SystemActors } from '../members/system-actor.js'
import type { DevLinkService } from './dev-links.service.js'
import type { GitHubRepository } from './github.repository.js'
import {
  checkSuiteEventSchema,
  installationEventSchema,
  pullRequestEventSchema,
  refEventSchema,
  reviewEventSchema
} from './payloads.js'
import { fromGitHub } from './signatures.js'

/** A delivery from GitHub as it arrived: the raw body (the signature is over it) and the headers. */
export type GitHubRequest = { body: string; headers: Record<string, string | undefined> }
export type GitHubReply = { statusCode: number; body: string }

type Deps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  github: GitHubRepository
  system: SystemActors
  links: DevLinkService
  /** The App's webhook secret; without it every delivery is refused. */
  webhookSecret: string | undefined
  logger: JiraiaLogger
}

type Handler = (organizationId: string, payload: unknown) => Promise<void>

const ok: GitHubReply = { statusCode: 200, body: '' }

/**
 * What GitHub tells JiraIA (Etapa 9, ADR-0038): branches created and deleted, pull requests, their
 * reviews and checks, and the App uninstalled. Every delivery is checked against the webhook secret
 * first, and a delivery GitHub sends again is answered without acting twice.
 */
export class GitHubEventsService {
  private readonly handlers: Record<string, Handler>

  constructor(private readonly deps: Deps) {
    const { links } = deps
    this.handlers = {
      create: (org, payload) => this._branch(payload, (event) => links.branchCreated(org, event)),
      delete: (org, payload) => this._branch(payload, (event) => links.branchDeleted(org, event)),
      pull_request: (org, payload) => links.pullRequest(org, pullRequestEventSchema.parse(payload)),
      pull_request_review: (org, payload) => links.review(org, reviewEventSchema.parse(payload)),
      check_suite: (org, payload) => links.checks(org, checkSuiteEventSchema.parse(payload)),
      installation: (org, payload) => this._installation(org, payload)
    }
  }

  async handle(request: GitHubRequest): Promise<GitHubReply> {
    const secret = this.deps.webhookSecret
    if (!secret || !fromGitHub(secret, request.body, request.headers['x-hub-signature-256'])) {
      return { statusCode: 401, body: 'invalid signature' }
    }
    const delivery = request.headers['x-github-delivery'] ?? ''
    if (delivery && (await this.deps.github.delivered(delivery))) {
      return ok
    }
    await this._dispatch(request.headers['x-github-event'] ?? '', JSON.parse(request.body) as unknown)
    if (delivery) {
      await this.deps.github.recordDelivery(delivery, this.deps.clock.now())
    }
    return ok
  }

  /** An event JiraIA does not read, or from an installation no organization connected, is acknowledged and dropped. */
  private async _dispatch(name: string, payload: unknown): Promise<void> {
    const handler = this.handlers[name]
    const parsed = installationEventSchema.shape.installation.safeParse(
      (payload as { installation?: unknown } | null)?.installation
    )
    const installation = parsed.success ? await this.deps.github.byInstallation(String(parsed.data.id)) : undefined
    if (!handler || !installation) {
      this.deps.logger.info('A GitHub delivery was ignored', { event: name, installed: installation !== undefined })
      return
    }
    await handler(installation.organizationId, payload)
  }

  private async _branch(payload: unknown, then: (event: z.infer<typeof refEventSchema>) => Promise<void>) {
    const event = refEventSchema.parse(payload)
    if (event.ref_type === 'branch') {
      await then(event)
    }
  }

  /** The App removed on GitHub: the organization is no longer connected, as if an admin disconnected. */
  private async _installation(organizationId: string, payload: unknown): Promise<void> {
    const event = installationEventSchema.parse(payload)
    if (event.action !== 'deleted') {
      return
    }
    const { member } = await this.deps.system.github(organizationId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.github.removeInstallation(tx, organizationId)
      await this.deps.audit.record(tx, {
        organizationId,
        spaceId: null,
        actorId: member.id,
        entityType: 'github_installation',
        entityId: organizationId,
        action: 'disconnected',
        changes: { installation: { before: String(event.installation.id), after: null } }
      })
    })
  }
}
