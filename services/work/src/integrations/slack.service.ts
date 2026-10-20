import { type Clock, ConflictException, ForbiddenException, type IdGenerator, NotFoundException } from '@jiraia/core'
import type { Database } from '@jiraia/db'
import type { Caller } from '@jiraia/http'

import type { AccessResolver } from '../access.js'
import type { AuditTrail } from '../audit/audit.js'
import type { MemberRow } from '../members/schemas.js'
import type { SlackChannelRepository } from './slack.repository.js'
import { type SlackChannelInput, toSlackChannelView } from './slack.schemas.js'
import type { SlackNotifier } from './slack-notifier.js'

type Deps = {
  db: Database
  clock: Clock
  ids: IdGenerator
  audit: AuditTrail
  access: AccessResolver
  channels: SlackChannelRepository
  notifier: SlackNotifier
}

/**
 * The Slack channels the organization posts to (escopo-mvp 4.5). Every member sees their names — an
 * automation picks one — and only organization admins add or remove them, since the webhook speaks
 * for the whole company in that channel.
 */
export class SlackService {
  constructor(private readonly deps: Deps) {}

  async list(caller: Caller) {
    const actor = await this.deps.access.actor(caller)
    const rows = await this.deps.channels.list(actor.organizationId)
    return { items: rows.map(toSlackChannelView) }
  }

  async add(caller: Caller, input: SlackChannelInput) {
    const actor = await this._admin(caller)
    const taken = (await this.deps.channels.list(actor.organizationId)).some((row) => row.name === input.name)
    if (taken) {
      throw new ConflictException(`Slack channel "${input.name}" is already connected`, { name: input.name })
    }
    const row = {
      id: this.deps.ids.next(),
      organizationId: actor.organizationId,
      ...input,
      createdAt: this.deps.clock.now()
    }
    await this.deps.db.transaction(async (tx) => {
      await this.deps.channels.insert(tx, row)
      await this._audit(tx, actor, row.id, 'created', { name: { before: null, after: row.name } })
    })
    return toSlackChannelView(row)
  }

  async remove(caller: Caller, channelId: string) {
    const actor = await this._admin(caller)
    const row = await this._find(actor, channelId)
    await this.deps.db.transaction(async (tx) => {
      await this.deps.channels.delete(tx, row.id)
      await this._audit(tx, actor, row.id, 'deleted', { name: { before: row.name, after: null } })
    })
    return await this.list(caller)
  }

  /** What an automation calls: the channel must be one of the organization's. */
  async post(organizationId: string, channelId: string, text: string): Promise<void> {
    const row = await this.deps.channels.find(organizationId, channelId)
    if (!row) {
      throw new NotFoundException('Slack channel', channelId)
    }
    await this.deps.notifier.post(row.webhookUrl, text)
  }

  private async _admin(caller: Caller): Promise<MemberRow> {
    const actor = await this.deps.access.actor(caller)
    if (!actor.isOrgAdmin) {
      throw new ForbiddenException('Only organization admins connect Slack channels', { memberId: actor.id })
    }
    return actor
  }

  private async _find(actor: MemberRow, channelId: string) {
    const row = await this.deps.channels.find(actor.organizationId, channelId)
    if (!row) {
      throw new NotFoundException('Slack channel', channelId)
    }
    return row
  }

  private async _audit(
    tx: Database,
    actor: MemberRow,
    id: string,
    action: string,
    changes: Record<string, { before: unknown; after: unknown }>
  ) {
    await this.deps.audit.record(tx, {
      organizationId: actor.organizationId,
      spaceId: null,
      actorId: actor.id,
      entityType: 'slack_channel',
      entityId: id,
      action,
      changes
    })
  }
}
