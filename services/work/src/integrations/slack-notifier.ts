import { DependencyUnavailableException } from '@jiraia/core'
import type { HttpClient } from '@jiraia/http'

/**
 * Posts a message to a Slack channel (escopo-mvp 4.5). The service owns this type; Slack's incoming
 * webhook is one way to do it, and the suites hand in their own.
 */
export type SlackNotifier = { post(webhookUrl: string, text: string): Promise<void> }

/** Slack's incoming webhooks: a POST of `{ text }` in mrkdwn, `<url|label>` for links. */
export class WebhookSlackNotifier implements SlackNotifier {
  constructor(private readonly http: HttpClient) {}

  async post(webhookUrl: string, text: string): Promise<void> {
    const response = await this.http.send({
      method: 'POST',
      url: webhookUrl,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
    if (response.status < 200 || response.status >= 300) {
      throw new DependencyUnavailableException(
        'Slack',
        `the webhook answered ${response.status}: ${response.body.slice(0, 200)}`
      )
    }
  }
}
