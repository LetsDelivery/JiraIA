import { readEnv } from '@jiraia/core'
import { dbConfigSchema } from '@jiraia/db'
import { z } from 'zod'

/**
 * Every environment variable this service reads, validated at cold start.
 *
 * The database is either a `DATABASE_URL` (local and tests) or the Aurora cluster, secret and
 * database name the Data API needs (AWS) — ADR-0002. `ALLOWED_EMAIL_DOMAINS` are the Google
 * Workspace domains whose people may sign in, comma-separated (ADR-0005, ADR-0026). `ATTACHMENTS_BUCKET` is the private S3 bucket
 * that holds the files on cards (escopo-mvp 2.9). `REALTIME_URL` is the WebSocket API pages are edited
 * through together (ADR-0009): the router hands it to browsers, the realtime Lambda posts back to it.
 * `ANTHROPIC_API_KEY` lets LET’S Draw AI draft from a prompt (pendência #8 until it exists).
 * `WEB_URL` is the panel's address, for links written into comments and Slack. `EVENT_BUS_NAME` is the
 * platform's EventBridge bus (ADR-0014); without it the dispatcher hands events to the consumers in
 * its own process, as the local harness does. `COGNITO_ISSUER` and `COGNITO_CLIENT_ID` are the user
 * pool and the panel's app client a sign-in token must come from, verified by the router itself
 * (ADR-0025, ADR-0026); `COGNITO_DOMAIN` is where the panel sends people to sign in, and
 * `PANEL_BUCKET` is where the deploy publishes the panel.
 */
const configSchema = z.intersection(
  dbConfigSchema,
  z.object({
    AWS_REGION: z.string().min(1),
    /** `uselets.com,lets.delivery`: LET'S has two Workspace domains, and either signs in. */
    ALLOWED_EMAIL_DOMAINS: z
      .string()
      .min(3)
      .transform((list) =>
        list
          .split(',')
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean)
      )
      .pipe(z.array(z.string().min(3)).min(1)),
    ATTACHMENTS_BUCKET: z.string().min(3),
    REALTIME_URL: z.string().regex(/^wss?:\/\//),
    /** Claude, for "Criar com IA" (ADR-0011). Without it the draft route answers 503 in AWS. */
    ANTHROPIC_API_KEY: z.string().min(10).optional(),
    WEB_URL: z.url().optional(),
    /** The user pool's `iss`. Without it and the client, no sign-in token is proved: every one is a 401. */
    COGNITO_ISSUER: z.url().optional(),
    /** The panel's app client in the pool: the audience of the ID tokens the API accepts. */
    COGNITO_CLIENT_ID: z.string().min(1).optional(),
    /** The pool's hosted sign-in, `https://<prefix>.auth.<region>.amazoncognito.com`; the panel reads it. */
    COGNITO_DOMAIN: z.url().optional(),
    /** The bucket CloudFront serves the panel from; only the deploy writes to it. */
    PANEL_BUCKET: z.string().min(3).optional(),
    /**
     * The API's public address, as clients reach it — the OAuth issuer and the MCP resource (ADR-0021).
     * Without it, the address is read from the request's Host.
     */
    API_URL: z.url().optional(),
    EVENT_BUS_NAME: z.string().min(1).optional(),
    /** The verified sender of the daily summary, `JiraIA <jiraia@uselets.com>` (pendência #11). */
    MAIL_FROM: z.string().min(3).optional(),
    /** The Slack app (Etapa 5e, ADR-0018, pendência #10): without these, connecting answers 503. */
    SLACK_CLIENT_ID: z.string().min(1).optional(),
    SLACK_CLIENT_SECRET: z.string().min(1).optional(),
    SLACK_SIGNING_SECRET: z.string().min(1).optional(),
    /** 32 bytes, base64: encrypts the bot token at rest and signs the OAuth state. */
    SLACK_TOKEN_KEY: z.string().min(40).optional(),
    /** Slack's Web API; the suites point it at a mocked host. */
    SLACK_API_URL: z.url().optional(),
    /**
     * What wakes the jobs (ADR-0035): the FIFO jobs queue, and the role and group of the one-time
     * schedules for later. Without them, wakes are held and no job runs.
     */
    JOBS_QUEUE_URL: z.url().optional(),
    JOBS_QUEUE_ARN: z.string().startsWith('arn:').optional(),
    WAKE_ROLE_ARN: z.string().startsWith('arn:').optional(),
    WAKE_SCHEDULE_GROUP: z.string().min(1).optional()
  })
)

export type Config = z.infer<typeof configSchema>

export const readConfig = (source: NodeJS.ProcessEnv = process.env): Config => readEnv(configSchema, source)
