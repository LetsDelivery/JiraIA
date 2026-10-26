import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'

import { readConfig } from './config.js'
import { buildService } from './container.js'
import { cloudFormationResponder } from './lambda/deploy.js'
import { invoke, type Trigger, triggerOf } from './lambda/invoke.js'
import { applyMigrations } from './lambda/migrate.js'
import { publishPanel, S3PanelBucket } from './lambda/panel.js'

/**
 * The stack's general Lambda (ADR-0025): the HTTP API's `ANY /{proxy+}`, the WebSocket API of the
 * pages edited together, the domain-event queues, and the deploy itself. The jobs are the scheduler's
 * (`scheduler.ts`).
 *
 * Built at module scope so the cost is paid once per cold start, and so a missing environment
 * variable kills the cold start with a message naming it.
 */
const config = readConfig()
/**
 * How long a statement waits for a paused database (ADR-0035): a person's request or a page's socket
 * not at all — the panel says the data is on its way and asks again; a queue or the deploy as long
 * as the function may run.
 */
const resume = { waitMs: 0 }
const service = buildService(config, { resume: { waitMs: () => resume.waitMs } })
const logger = createLogger('work', 'lambda')
const WAITS_MS: Record<Trigger, number> = { http: 0, websocket: 0, queue: 240_000, deploy: 240_000 }

const deployDeps = {
  migrate: () => applyMigrations(),
  publishPanel: async () => {
    if (!config.PANEL_BUCKET) {
      throw new Error('PANEL_BUCKET is not set, so the deploy has nowhere to publish the panel')
    }
    const bucket = new S3PanelBucket({ bucket: config.PANEL_BUCKET, region: config.AWS_REGION })
    return await publishPanel(`${process.env.LAMBDA_TASK_ROOT}/panel`, bucket, {
      cognitoDomain: config.COGNITO_DOMAIN ?? '',
      cognitoClientId: config.COGNITO_CLIENT_ID ?? '',
      allowedEmailDomains: config.ALLOWED_EMAIL_DOMAINS
    })
  },
  respond: cloudFormationResponder(createHttpClient({ provider: 'cloudformation', logger }))
}

export const handler = async (event: unknown) => {
  resume.waitMs = WAITS_MS[triggerOf(event)]
  return await invoke(service, deployDeps, logger, event)
}
