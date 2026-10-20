import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { DependencyUnavailableException } from '@jiraia/core'

export type Email = { to: string; subject: string; html: string; text: string }

/** Sends one e-mail. The service owns this type; SES is one way to do it (escopo-mvp 4.6). */
export type Mailer = { send(email: Email): Promise<void> }

/** SES v2 from the address the domain verified (`MAIL_FROM`, pendência #11). */
export class SesMailer implements Mailer {
  constructor(private readonly deps: { client: SESv2Client; from: string }) {}

  async send(email: Email): Promise<void> {
    try {
      await this.deps.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.deps.from,
          Destination: { ToAddresses: [email.to] },
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: 'UTF-8' },
              Body: { Html: { Data: email.html, Charset: 'UTF-8' }, Text: { Data: email.text, Charset: 'UTF-8' } }
            }
          }
        })
      )
    } catch (error) {
      throw new DependencyUnavailableException('SES', error instanceof Error ? error.message : String(error))
    }
  }
}

/** Without a sender address the summaries wait: notices stay unmailed until one is configured. */
export class UnavailableMailer implements Mailer {
  async send(email: Email): Promise<void> {
    throw new DependencyUnavailableException('SES', `no MAIL_FROM is configured; the summary for ${email.to} waits`)
  }
}

/** What the suites read instead of an inbox. */
export class InMemoryMailer implements Mailer {
  readonly sent: Email[] = []

  async send(email: Email): Promise<void> {
    this.sent.push(email)
  }
}

export const sesClient = (region: string): SESv2Client => new SESv2Client({ region })
