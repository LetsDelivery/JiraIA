import type { JiraiaLogger } from '@jiraia/logger'

import type { MemberRepository } from '../members/member.repository.js'
import type { NotificationWithActor } from '../notifications/notification.repository.js'
import type { SlackSecrets } from './secrets.js'
import type { SlackRepository } from './slack.repository.js'
import type { SlackApi } from './slack-api.js'
import type { SlackConnectService } from './slack-connect.service.js'
import { noticeMessage } from './slack-copy.js'

type Deps = {
  slack: SlackRepository
  connect: SlackConnectService
  members: MemberRepository
  api: SlackApi
  secrets: SlackSecrets | undefined
  webUrl: string
  logger: JiraiaLogger
}

/**
 * The notices a person asked to get in Slack (Etapa 5e), sent as a direct message from the app. A
 * person not found in the workspace, or a Slack that does not answer, costs that message only: the
 * notice is already in the panel, so nothing is retried and nothing else fails.
 */
export class SlackDirect {
  constructor(private readonly deps: Deps) {}

  async deliver(organizationId: string, notices: readonly NotificationWithActor[]): Promise<void> {
    await this.sendAll(organizationId, notices).catch((error: unknown) =>
      this.deps.logger.warn('Slack messages were not sent', { organizationId, error: String(error) })
    )
  }

  private async sendAll(organizationId: string, notices: readonly NotificationWithActor[]): Promise<void> {
    const workspace = notices.length && this.deps.secrets ? await this.deps.slack.workspace(organizationId) : undefined
    if (!workspace || !this.deps.secrets) {
      return
    }
    const token = this.deps.secrets.open(workspace.botToken)
    for (const notice of notices) {
      await this.send(token, workspace, notice).catch((error: unknown) =>
        this.deps.logger.warn('A Slack message was not sent', { notificationId: notice.id, error: String(error) })
      )
    }
  }

  private async send(
    token: string,
    workspace: Parameters<SlackConnectService['whoIs']>[1],
    notice: NotificationWithActor
  ) {
    const member = await this.deps.members.findById(notice.organizationId, notice.memberId)
    if (!member) {
      return
    }
    await this.deps.connect.whoIs(member, workspace)
    const link = await this.deps.slack.link(member.id)
    if (link?.slackUserId) {
      await this.deps.api.post(token, { channel: link.slackUserId, ...noticeMessage(notice, this.deps.webUrl) })
    }
  }
}
