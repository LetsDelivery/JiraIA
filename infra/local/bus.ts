import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { HttpClient, OutboundRequest, OutboundResponse } from '@jiraia/http'

import type { SlackNotifier } from '../../services/work/src/integrations/slack-notifier.js'
import type { Email, Mailer } from '../../services/work/src/notifications/mailer.js'

/**
 * Stand-ins for what runs behind the bus in AWS (ADR-0014).
 *
 * There is no EventBridge here: after each write the harness drains the outbox in its own process,
 * so a rule's effect shows a moment after the change that set it off — in AWS, within a minute.
 */
export const drainAfterWrites = (drain: () => Promise<number>) => {
  let running = Promise.resolve()
  return (method: string): void => {
    if (method === 'GET' || method === 'OPTIONS') {
      return
    }
    // One drain at a time: two at once would deliver the same events twice before the receipts land.
    running = running
      .then(async () => {
        await drain()
      })
      .catch((error: unknown) => console.error('  drain failed:', error))
  }
}

/**
 * Slack, printed. A webhook pasted into the local panel is not called unless `LOCAL_SLACK=1`, so
 * trying out an automation never posts into a real channel by accident.
 */
export class PrintedSlack implements SlackNotifier {
  constructor(private readonly real?: SlackNotifier) {}

  async post(webhookUrl: string, text: string): Promise<void> {
    console.error(`  slack → ${new URL(webhookUrl).host}: ${text}`)
    await this.real?.post(webhookUrl, text)
  }
}

/**
 * E-mail, as files: each summary lands in `LOCAL_MAIL_DIR` as an `.html` to open in the browser, and
 * the console says where. No message leaves the machine.
 */
export class LocalMailbox implements Mailer {
  constructor(private readonly dir: string) {}

  async send(email: Email): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const file = join(this.dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${email.to}.html`)
    await writeFile(file, `<!-- To: ${email.to} -->\n<!-- Subject: ${email.subject} -->\n${email.html}`)
    console.error(`  mail → ${email.to}: ${email.subject} (${file})`)
  }
}

/**
 * Outgoing webhooks, printed: each delivery is shown with its event and signature and answered 200,
 * so the panel lists it as delivered. `LOCAL_WEBHOOKS=1` sends them for real instead.
 */
export class PrintedWebhooks implements HttpClient {
  async send(request: OutboundRequest): Promise<OutboundResponse> {
    const headers = request.headers ?? {}
    console.error(
      `  webhook → ${request.url} ${headers['x-jiraia-event'] ?? ''} (${(request.body ?? '').length} bytes, ${headers['x-jiraia-signature']?.slice(0, 18) ?? ''}…)`
    )
    return { status: 200, body: 'printed by the local harness' }
  }
}
