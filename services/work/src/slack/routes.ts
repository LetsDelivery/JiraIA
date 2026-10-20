import { defineRoute, type Route } from '@jiraia/http'

import { completeSlackSchema, slackInstallSchema, slackStatusSchema } from './schemas.js'
import type { SlackConnectService } from './slack-connect.service.js'

/** The organization's Slack workspace (Etapa 5e, ADR-0018): its state, connecting and disconnecting it. */
export const slackRoutes = (slack: SlackConnectService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/integrations/slack',
    requires: 'authenticated',
    schemas: {},
    responds: slackStatusSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await slack.status(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/integrations/slack/install',
    requires: 'authenticated',
    schemas: {},
    responds: slackInstallSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await slack.install(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/integrations/slack/complete',
    requires: 'authenticated',
    schemas: { body: completeSlackSchema },
    responds: slackStatusSchema,
    handler: async ({ caller, body }) => ({ statusCode: 200, body: await slack.complete(caller, body) })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/integrations/slack',
    requires: 'authenticated',
    schemas: {},
    responds: slackStatusSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await slack.disconnect(caller) })
  })
]
