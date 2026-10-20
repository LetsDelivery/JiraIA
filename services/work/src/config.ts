import { readEnv } from '@jiraia/core'
import { dbConfigSchema } from '@jiraia/db'
import { z } from 'zod'

/**
 * Every environment variable this service reads, validated at cold start.
 *
 * The database is either a `DATABASE_URL` (local and tests) or the Aurora cluster, secret and
 * database name the Data API needs (AWS) — ADR-0002. `ALLOWED_EMAIL_DOMAIN` is the one Google
 * Workspace domain whose people may sign in (ADR-0005). `ATTACHMENTS_BUCKET` is the private S3 bucket
 * that holds the files on cards (escopo-mvp 2.9). `REALTIME_URL` is the WebSocket API pages are edited
 * through together (ADR-0009): the router hands it to browsers, the realtime Lambda posts back to it.
 * `ANTHROPIC_API_KEY` lets Let’s Draw AI draft from a prompt (pendência #8 until it exists).
 * `WEB_URL` is the panel's address, for links written into comments and Slack. `EVENT_BUS_NAME` is the
 * platform's EventBridge bus (ADR-0014); without it the dispatcher hands events to the consumers in
 * its own process, as the local harness does.
 */
const configSchema = z.intersection(
  dbConfigSchema,
  z.object({
    AWS_REGION: z.string().min(1),
    ALLOWED_EMAIL_DOMAIN: z
      .string()
      .min(3)
      .transform((domain) => domain.toLowerCase()),
    ATTACHMENTS_BUCKET: z.string().min(3),
    REALTIME_URL: z.string().regex(/^wss?:\/\//),
    /** Claude, for "Criar com IA" (ADR-0011). Without it the draft route answers 503 in AWS. */
    ANTHROPIC_API_KEY: z.string().min(10).optional(),
    WEB_URL: z.url().optional(),
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
    SLACK_API_URL: z.url().optional()
  })
)

export type Config = z.infer<typeof configSchema>

export const readConfig = (source: NodeJS.ProcessEnv = process.env): Config => readEnv(configSchema, source)
