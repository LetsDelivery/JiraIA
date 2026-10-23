import { connectDatabase } from '@jiraia/db'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { buildService as buildWork } from '../../services/work/src/container.js'
import { OfflineDraftWriter } from '../../services/work/src/draw/draft.js'
import { WebhookSlackNotifier } from '../../services/work/src/integrations/slack-notifier.js'
import { drainAfterWrites, LocalMailbox, PrintedSlack, PrintedWebhooks } from './bus.js'
import {
  ALLOWED_EMAIL_DOMAIN,
  ALLOWED_EMAIL_DOMAINS,
  assertDevDatabase,
  DEV_DATABASE_URL,
  LOCAL_FILES_DIR,
  LOCAL_MAIL_DIR,
  LOCAL_PORT,
  localClaims
} from './config.js'
import { LocalFileStore } from './files.js'
import { LocalBroadcaster, realtimeSockets, type SocketData, upgrade } from './realtime.js'
import { LocalSlackApi, localSlackConfig } from './slack.js'

/**
 * The whole API, on one port, driven by hand (the uselets `local:serve`, for JiraIA).
 *
 *     bun run local:serve
 *     curl -H 'x-local-user: admin@uselets.com' localhost:8280/work/spaces
 *
 * Each service answers under its own prefix and runs its **real** router, services and repositories
 * against the dev database. Two things are stand-ins. **Google is a header:** `x-local-user: <email>`
 * becomes the claims of a verified Google ID token for that address (`localClaims`), and from there
 * the service admits or refuses exactly as it does in AWS. That is safe for one reason only:
 * `assertDevDatabase` refuses to start against anything but the dev container. **S3 is a folder:**
 * attachments go to `LOCAL_FILES_DIR`, uploaded and downloaded through `/files` (`LocalFileStore`).
 * **The WebSocket API is Bun's:** `/realtime` runs the realtime handler (`realtime.ts`, ADR-0009).
 * **The bus is this process:** each write drains the outbox into the consumers, and Slack is printed
 * (`bus.ts`, ADR-0014).
 */
const url = process.env.DATABASE_URL ?? DEV_DATABASE_URL
assertDevDatabase(url)

const db = connectDatabase({ DATABASE_URL: url })
const config = {
  DATABASE_URL: url,
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAINS,
  ATTACHMENTS_BUCKET: 'local',
  REALTIME_URL: `ws://localhost:${LOCAL_PORT}/realtime`,
  WEB_URL: process.env.LOCAL_WEB_URL ?? 'http://localhost:5280',
  // The OAuth issuer and the MCP resource (ADR-0021): here the service sits under `/work`.
  API_URL: `http://localhost:${LOCAL_PORT}/work`,
  ...localSlackConfig(process.env)
}
const files = new LocalFileStore(LOCAL_FILES_DIR)
const broadcaster = new LocalBroadcaster()
// Without a key, drafts come from the offline stand-in, which says so in its reply (ADR-0011).
const anthropic = process.env.ANTHROPIC_API_KEY
const work = buildWork(anthropic ? { ...config, ANTHROPIC_API_KEY: anthropic } : config, {
  db,
  files,
  broadcaster,
  mailer: new LocalMailbox(LOCAL_MAIL_DIR),
  // A card's changes gather for a minute here, not ten, so a demo does not wait (Etapa 5f).
  mailWindowMs: 60_000,
  ...(process.env.LOCAL_WEBHOOKS === '1' ? {} : { webhookHttp: new PrintedWebhooks() }),
  slack: new PrintedSlack(
    process.env.LOCAL_SLACK === '1'
      ? new WebhookSlackNotifier(createHttpClient({ provider: 'slack', logger: createLogger('local', 'slack') }))
      : undefined
  ),
  ...(anthropic ? {} : { writer: new OfflineDraftWriter() }),
  // A real Slack app's settings in the environment talk to Slack; otherwise the stand-in prints.
  ...(process.env.SLACK_CLIENT_ID ? {} : { slackApi: new LocalSlackApi() })
})
const afterWrite = drainAfterWrites(work.drain)
// Access governance's own clock (ADR-0024): expiries and overdue requests, as its job runs in AWS.
setInterval(
  () =>
    void work.accessClock
      .sweep()
      .then(() => work.reviews.sweep())
      .then(() => afterWrite('POST'))
      .catch((error: unknown) => console.error('  access clock failed:', error)),
  60_000
)
// The e-mails that are due, as the mail job runs in AWS; the summaries wait for `bun run local:digest`.
setInterval(() => void work.mail.sendDue().catch((error: unknown) => console.error('  mail failed:', error)), 60_000)
// The webhook retry sweep, as its job runs in AWS.
setInterval(
  () => void work.webhookSender.retryDue().catch((error: unknown) => console.error('  webhook retry failed:', error)),
  60_000
)
const routers: Record<string, (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>> = {
  work: work.router
}

const _event = (
  request: Request,
  path: string,
  body: string | undefined,
  claims: Record<string, string> | undefined
) => {
  const search = new URL(request.url).searchParams

  return {
    version: '2.0',
    routeKey: `${request.method} ${path}`,
    rawPath: path,
    rawQueryString: search.toString(),
    headers: Object.fromEntries(request.headers.entries()),
    queryStringParameters: Object.fromEntries(search.entries()),
    requestContext: {
      http: { method: request.method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'local' },
      requestId: crypto.randomUUID(),
      stage: '$default',
      ...(claims ? { authorizer: { jwt: { claims, scopes: [] } } } : {})
    },
    ...(body ? { body } : {}),
    isBase64Encoded: false
  } as unknown as APIGatewayProxyEventV2
}

/** A Lambda result, turned into an HTTP response the way API Gateway turns one — gzip included. */
const _answer = (result: APIGatewayProxyStructuredResultV2): Response => {
  const headers = Object.fromEntries(Object.entries(result.headers ?? {}).map(([name, value]) => [name, String(value)]))
  const body =
    result.body === undefined ? undefined : result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body

  return new Response(body, { status: result.statusCode ?? 200, headers })
}

const _route = async (request: Request): Promise<Response> => {
  const [first = '', ...after] = new URL(request.url).pathname.split('/').filter(Boolean)
  // OAuth discovery looks at the host's root (RFC 8414, RFC 9728); in AWS `work` owns its API's root.
  const [prefix, rest] = first === '.well-known' ? ['work', [first, ...after]] : [first, after]
  const router = routers[prefix]

  if (prefix === 'files') {
    return await files.serve(request, rest.join('/'))
  }
  // Slack's events skip the router, as the function does in AWS (ADR-0018, ADR-0025).
  if (prefix === 'work' && rest.join('/') === 'slack/events' && request.method === 'POST') {
    const reply = await work.slackEvents.handle({
      body: await request.text(),
      headers: Object.fromEntries(request.headers.entries())
    })
    return new Response(reply.body, { status: reply.statusCode, headers: { 'content-type': 'application/json' } })
  }
  if (!router) {
    return Response.json(
      { message: `no service is mounted at /${prefix}`, mounted: Object.keys(routers) },
      { status: 404 }
    )
  }

  const body = request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.text()
  const header = request.headers.get('x-local-user')
  const claims = header ? localClaims(header) : undefined

  const result = await router(_event(request, `/${rest.join('/')}`, body, claims))
  afterWrite(request.method)
  return _answer(result)
}

Bun.serve<SocketData>({
  port: LOCAL_PORT,
  idleTimeout: 120,
  fetch: async (request, server) => (upgrade(request, server) ? undefined : await _route(request)),
  websocket: realtimeSockets(work.realtime, broadcaster)
})

console.error('')
console.error(`  JiraIA local  →  http://localhost:${LOCAL_PORT}   (services: ${Object.keys(routers).join(', ')})`)
console.error(`  Google sign-in is a header; only ${ALLOWED_EMAIL_DOMAINS.join(' and ')} addresses are admitted:`)
console.error(`    curl -H 'x-local-user: admin@${ALLOWED_EMAIL_DOMAIN}' localhost:${LOCAL_PORT}/work/spaces`)
console.error('')
