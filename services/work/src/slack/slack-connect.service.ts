import { type Clock, DependencyUnavailableException, ForbiddenException, toIso } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { CompleteSlack, SlackStatus } from './schemas.js'
import type { SlackSecrets } from './secrets.js'
import type { SlackRepository, WorkspaceRow } from './slack.repository.js'
import type { SlackApi } from './slack-api.js'

/** What the app may do in the workspace: message people, read who they are by e-mail, preview card links. */
export const SLACK_SCOPES = [
  'chat:write',
  'im:write',
  'users:read',
  'users:read.email',
  'links:read',
  'links:write',
  'channels:history',
  'groups:history'
]

/** How long who someone is in Slack is trusted before it is looked up again. */
const LINK_TTL_MS = 24 * 3_600_000

export type SlackApp = { clientId: string; webUrl: string; secrets: SlackSecrets }

type Deps = {
  db: Database
  clock: Clock
  audit: AuditTrail
  access: AccessResolver
  members: MemberRepository
  slack: SlackRepository
  api: SlackApi
  /** Absent until the Slack app exists (pendência #10): connecting then answers 503. */
  app: SlackApp | undefined
}

/**
 * Connecting the organization's Slack workspace (Etapa 5e, ADR-0018): an organization admin installs
 * the app once, through Slack's OAuth; each person is then found in it by their e-mail, with nothing to
 * sign in to.
 */
export class SlackConnectService {
  constructor(private readonly deps: Deps) {}

  private configured(): SlackApp {
    if (!this.deps.app) {
      throw new DependencyUnavailableException('Slack', 'the Slack app is not configured yet (SLACK_CLIENT_ID)')
    }
    return this.deps.app
  }

  private async admin(caller: Caller): Promise<MemberRow> {
    const actor = await this.deps.access.actor(caller)
    if (!actor.isOrgAdmin) {
      throw new ForbiddenException(`Only an organization admin connects Slack; "${actor.email}" is not one`)
    }
    return actor
  }

  private redirectUri(app: SlackApp): string {
    return `${app.webUrl}/slack/conectar`
  }

  /** Where to send the admin's browser: Slack's consent screen, with a state only they can bring back. */
  async install(caller: Caller): Promise<{ url: string }> {
    const actor = await this.admin(caller)
    const app = this.configured()
    const query = new URLSearchParams({
      client_id: app.clientId,
      scope: SLACK_SCOPES.join(','),
      redirect_uri: this.redirectUri(app),
      state: app.secrets.state(actor.id, this.deps.clock.now())
    })
    return { url: `https://slack.com/oauth/v2/authorize?${query}` }
  }

  /** Slack sent the admin back with a code: it becomes the bot's token, kept sealed. */
  async complete(caller: Caller, input: CompleteSlack): Promise<SlackStatus> {
    const actor = await this.admin(caller)
    const app = this.configured()
    const now = this.deps.clock.now()
    app.secrets.checkState(input.state, actor.id, now)
    const installed = await this.deps.api.exchange(input.code, this.redirectUri(app))
    const row: WorkspaceRow = {
      organizationId: actor.organizationId,
      teamId: installed.teamId,
      teamName: installed.teamName,
      botUserId: installed.botUserId,
      botToken: app.secrets.seal(installed.token),
      installedBy: actor.id,
      installedAt: now
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.slack.saveWorkspace(tx, row)
      await this._audit(tx, actor, 'connected', { teamName: { before: null, after: installed.teamName } })
    })
    return await this.status(caller)
  }

  async disconnect(caller: Caller): Promise<SlackStatus> {
    const actor = await this.admin(caller)
    const workspace = await this.deps.slack.workspace(actor.organizationId)
    if (workspace) {
      await this.deps.db.transaction(async (tx) => {
        await this.deps.slack.removeWorkspace(tx, actor.organizationId)
        await this._audit(tx, actor, 'disconnected', { teamName: { before: workspace.teamName, after: null } })
      })
    }
    return await this.status(caller)
  }

  /** The connection as the caller sees it: the workspace, whether they may change it, and who they are in it. */
  async status(caller: Caller): Promise<SlackStatus> {
    const actor = await this.deps.access.actor(caller)
    const workspace = await this.deps.slack.workspace(actor.organizationId)
    const installer = workspace
      ? await this.deps.members.findById(actor.organizationId, workspace.installedBy)
      : undefined
    return {
      configured: this.deps.app !== undefined,
      canManage: actor.isOrgAdmin,
      workspace: workspace
        ? {
            teamName: workspace.teamName,
            installedBy: installer?.name ?? '',
            installedAt: toIso(workspace.installedAt)
          }
        : null,
      me: workspace ? await this.whoIs(actor, workspace) : null
    }
  }

  /** Who the member is in the workspace, looked up by e-mail at most once a day. */
  async whoIs(member: MemberRow, workspace: WorkspaceRow): Promise<{ found: boolean }> {
    const now = this.deps.clock.now()
    const known = await this.deps.slack.link(member.id)
    if (known && now.getTime() - known.checkedAt.getTime() < LINK_TTL_MS) {
      return { found: known.slackUserId !== null }
    }
    const token = this.configured().secrets.open(workspace.botToken)
    const slackUserId = member.email ? await this.deps.api.userByEmail(token, member.email) : null
    await this.deps.slack.saveLink({
      memberId: member.id,
      organizationId: member.organizationId,
      slackUserId,
      checkedAt: now
    })
    return { found: slackUserId !== null }
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
      entityType: 'slack_workspace',
      entityId: actor.organizationId,
      action,
      changes
    })
  }
}
