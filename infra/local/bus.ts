import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { HttpClient, OutboundRequest, OutboundResponse } from '@jiraia/http'

import type { SlackNotifier } from '../../services/work/src/integrations/slack-notifier.js'
import type { Asked, JobName } from '../../services/work/src/lambda/jobs.js'
import type { Email, Mailer } from '../../services/work/src/notifications/mailer.js'
import type { Wake, WakeTransport } from '../../services/work/src/wake/waker.js'

/**
 * Stand-ins for what runs behind the bus and the jobs queue in AWS (ADR-0014, ADR-0035).
 *
 * The jobs' wakes stay in this process: one due now runs at once, one due later on a timer — the
 * plan AWS follows with its queue and one-time schedules. With no bus here, the dispatch hands each
 * event to the consumers itself, so a rule's effect shows a moment after the change that set it off.
 */
export class LocalWakes implements WakeTransport {
  private run: ((asked: Asked[]) => Promise<void>) | undefined
  private running = Promise.resolve()
  private readonly timers = new Map<JobName, { at: number; timer: ReturnType<typeof setTimeout> }>()

  /** What runs a pass: `runWakes` on the service these wakes were handed to. */
  bind(run: (asked: Asked[]) => Promise<void>): void {
    this.run = run
  }

  async now(wake: Wake): Promise<void> {
    this._pass(wake)
  }

  /** One timer per job, the earliest: a later wake would only find the work done. */
  async later(wake: Wake): Promise<void> {
    const kept = this.timers.get(wake.job)
    if (kept && kept.at <= wake.at.getTime()) {
      return
    }
    if (kept) {
      clearTimeout(kept.timer)
    }
    const timer = setTimeout(() => {
      this.timers.delete(wake.job)
      this._pass(wake)
    }, wake.at.getTime() - Date.now())
    this.timers.set(wake.job, { at: wake.at.getTime(), timer })
  }

  /** One pass at a time, as a FIFO group reads its messages: two would deliver an event twice. */
  private _pass(wake: Wake): void {
    this.running = this.running
      .then(() => this.run?.([{ job: wake.job, retry: wake.retry }]))
      .catch((error: unknown) => console.error(`  ${wake.job} failed:`, error))
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
  readonly ready = true

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
