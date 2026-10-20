import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { slackChannels } from '../schema-intake.js'

export type SlackChannelRow = typeof slackChannels.$inferSelect

export const slackChannelInputSchema = z.object({
  /** As people say it: `#product_updates`. */
  name: z
    .string()
    .trim()
    .regex(/^#[a-z0-9][a-z0-9_-]{0,79}$/, 'A channel name such as #product_updates'),
  /** The incoming webhook Slack gives for that channel — a secret: whoever has it can post. */
  webhookUrl: z.url({ protocol: /^https$/ }).max(500)
})
export type SlackChannelInput = z.infer<typeof slackChannelInputSchema>

/** A channel as the API shows it: never the webhook, only enough of it to tell two apart. */
export const slackChannelViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  webhookHint: z.string(),
  createdAt: z.iso.datetime()
})
export const slackChannelListSchema = z.object({ items: z.array(slackChannelViewSchema) })
export const slackChannelPathSchema = z.object({ channelId: z.uuid() })

/**
 * The webhook as a hint: its host and last four characters.
 *
 * @example webhookHint('https://hooks.slack.com/services/T0/B0/abcd1234')   // 'hooks.slack.com/…1234'
 */
export const webhookHint = (url: string): string => `${new URL(url).host}/…${url.slice(-4)}`

export const toSlackChannelView = (row: SlackChannelRow) => ({
  id: row.id,
  name: row.name,
  webhookHint: webhookHint(row.webhookUrl),
  createdAt: toIso(row.createdAt)
})
