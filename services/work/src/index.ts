import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'

import { readConfig } from './config.js'
import { buildService } from './container.js'
import { cloudFormationResponder } from './lambda/deploy.js'
import { invoke } from './lambda/invoke.js'
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
const service = buildService(config)
const logger = createLogger('work', 'lambda')

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

export const handler = async (event: unknown) => await invoke(service, deployDeps, logger, event)
