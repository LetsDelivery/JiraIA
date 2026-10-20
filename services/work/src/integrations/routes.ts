import { defineRoute, type Route } from '@jiraia/http'
import {
  slackChannelInputSchema,
  slackChannelListSchema,
  slackChannelPathSchema,
  slackChannelViewSchema
} from './slack.schemas.js'
import type { SlackService } from './slack.service.js'

export const integrationRoutes = (slack: SlackService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/integrations/slack/channels',
    requires: 'authenticated',
    schemas: {},
    responds: slackChannelListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await slack.list(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/integrations/slack/channels',
    requires: 'authenticated',
    schemas: { body: slackChannelInputSchema },
    responds: slackChannelViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await slack.add(caller, body) })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/integrations/slack/channels/{channelId}',
    requires: 'authenticated',
    schemas: { path: slackChannelPathSchema },
    responds: slackChannelListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await slack.remove(caller, path.channelId) })
  })
]
