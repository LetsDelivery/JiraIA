import { type Clock, DependencyUnavailableException, ForbiddenException, toIso } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { CardGate } from '../cards/card-gate.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { GitHubRepository } from './github.repository.js'
import type { GitHubApi } from './github-api.js'
import { type CompleteGitHub, type DevLinkView, devLinkViewSchema, type GitHubStatus } from './schemas.js'
import type { InstallState } from './signatures.js'

/** The App as the panel needs it: its public name on GitHub, and the state signer. */
export type GitHubApp = { slug: string; state: InstallState }

type Deps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
  cardGate: CardGate
  github: GitHubRepository
  api: GitHubApi
  /** Absent until the GitHub App exists: connecting then answers 503. */
  app: GitHubApp | undefined
}

/**
 * Connecting the organization's GitHub (Etapa 9, ADR-0038): an organization admin installs the JiraIA
 * App on the GitHub account, on every repository, and GitHub sends them back with the installation's
 * id. Also reads what GitHub told of a card.
 */
export class GitHubConnectService {
  constructor(private readonly deps: Deps) {}

  private configured(): GitHubApp {
    if (!this.deps.app) {
      throw new DependencyUnavailableException('GitHub', 'the GitHub App is not configured yet (GITHUB_APP_ID)')
    }
    return this.deps.app
  }

  private async admin(caller: Caller): Promise<MemberRow> {
    const actor = await this.deps.access.actor(caller)
    if (!actor.isOrgAdmin) {
      throw new ForbiddenException(`Only an organization admin connects GitHub; "${actor.email}" is not one`)
    }
    return actor
  }

  /** Where to send the admin's browser: the App's installation page, with a state only they can bring back. */
  async install(caller: Caller): Promise<{ url: string }> {
    const actor = await this.admin(caller)
    const app = this.configured()
    const state = app.state.issue(actor.id, this.deps.clock.now())
    return { url: `https://github.com/apps/${app.slug}/installations/new?${new URLSearchParams({ state })}` }
  }

  /** GitHub sent the admin back: the installation, proved by asking GitHub as the App, becomes the organization's. */
  async complete(caller: Caller, input: CompleteGitHub): Promise<GitHubStatus> {
    const actor = await this.admin(caller)
    const now = this.deps.clock.now()
    this.configured().state.check(input.state, actor.id, now)
    const installed = await this.deps.api.installation(input.installationId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.github.saveInstallation(tx, {
        organizationId: actor.organizationId,
        installationId: installed.id,
        accountLogin: installed.account,
        installedBy: actor.id,
        installedAt: now
      })
      await this._audit(tx, actor, 'connected', { account: { before: null, after: installed.account } })
    })
    return await this.status(caller)
  }

  async disconnect(caller: Caller): Promise<GitHubStatus> {
    const actor = await this.admin(caller)
    const installation = await this.deps.github.installation(actor.organizationId)
    if (installation) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.github.removeInstallation(tx, actor.organizationId)
        await this._audit(tx, actor, 'disconnected', { account: { before: installation.accountLogin, after: null } })
      })
    }
    return await this.status(caller)
  }

  async status(caller: Caller): Promise<GitHubStatus> {
    const actor = await this.deps.access.actor(caller)
    const installation = await this.deps.github.installation(actor.organizationId)
    const installer = installation
      ? await this.deps.members.findById(actor.organizationId, installation.installedBy)
      : undefined
    return {
      configured: this.deps.app !== undefined,
      canManage: actor.isOrgAdmin,
      installation: installation
        ? {
            account: installation.accountLogin,
            installedBy: installer?.name ?? '',
            installedAt: toIso(installation.installedAt)
          }
        : null
    }
  }

  /** A card's branches and pull requests, for whoever reads the card. */
  async development(caller: Caller, cardId: string): Promise<{ items: DevLinkView[] }> {
    const { card } = await this.deps.cardGate.open(caller, cardId, 'space:read')
    const rows = await this.deps.github.forCard(card.id)
    return {
      items: rows.map((row) =>
        devLinkViewSchema.parse({
          ...row,
          mergedAt: row.mergedAt ? toIso(row.mergedAt) : null,
          updatedAt: toIso(row.updatedAt)
        })
      )
    }
  }

  private async _audit(
    tx: Database,
    actor: MemberRow,
    action: string,
    changes: Record<string, { before: unknown; after: unknown }>
  ) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: null,
      actorId: actor.id,
      entityType: 'github_installation',
      entityId: actor.organizationId,
      action,
      changes
    })
  }
}
