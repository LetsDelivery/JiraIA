import { toIso, ValidationException } from '@jiraia/core'
import { z } from 'zod'

import type { notifications } from '../schema-intake.js'

/** What a notice is about (escopo-mvp 4.6). The screen words each kind; the API names it. */
export const notificationKindValues = [
  'mentioned',
  'assigned',
  'commented',
  'state_changed',
  'access_requested',
  'access_decided',
  'proposal_received',
  'entitlement_waiting',
  'entitlement_decided',
  'entitlement_overdue',
  'access_review_opened',
  'card_updated',
  'draw_mentioned',
  'content_changed',
  'sprint_overdue',
  /** A preference only: whether the Monday summary comes. No notice is ever written with it. */
  'weekly_summary'
] as const
export const notificationKindSchema = z.enum(notificationKindValues)
export type NotificationKind = z.infer<typeof notificationKindSchema>

/** Where a notice goes: the panel (Etapa 5b), an e-mail (Etapa 5f), a Slack message (Etapa 5e). */
export const channelSchema = z.enum(['in_app', 'email', 'slack'])
export type Channel = z.infer<typeof channelSchema>

/** A person's choice for a kind: any of the channels. The panel comes with the others; none is nowhere. */
export const channelsSchema = z.array(channelSchema)

/** Kinds that are a summary sent by e-mail, never a notice in the panel. */
const SUMMARY_KINDS: ReadonlySet<NotificationKind> = new Set(['weekly_summary'])

/** What a kind can go by: a summary only by e-mail. */
export const channelsOf = (kind: NotificationKind): Channel[] =>
  SUMMARY_KINDS.has(kind) ? ['email'] : channelSchema.options.slice()

/**
 * What a person gets before choosing: everything by e-mail too (Etapa 5f). An e-mail about a card
 * groups a few minutes of changes, and the Draw ones come in one morning summary, so it stays few.
 */
export const defaultChannels = (kind: NotificationKind): Channel[] =>
  SUMMARY_KINDS.has(kind) ? ['email'] : ['in_app', 'email']

/** The channels stored for a kind, or the default when none were chosen or what is kept is unreadable. */
export const chosenChannels = (kind: NotificationKind, stored: unknown): Channel[] =>
  stored === undefined ? defaultChannels(kind) : channelsSchema.catch(defaultChannels(kind)).parse(stored)

/**
 * A choice as it is kept: each channel once, in a fixed order, the panel added to any other. A channel
 * the kind cannot go by is refused, naming it.
 *
 * @example settleChannels('mentioned', ['slack'])   // ['in_app', 'slack']
 */
export const settleChannels = (kind: NotificationKind, channels: readonly Channel[]): Channel[] => {
  const allowed = channelsOf(kind)
  const refused = channels.find((channel) => !allowed.includes(channel))
  if (refused) {
    throw new ValidationException(`Notices of kind "${kind}" do not go by "${refused}"`)
  }
  const wanted = new Set(channels)
  if (wanted.size > 0 && allowed.includes('in_app')) {
    wanted.add('in_app')
  }
  return allowed.filter((channel) => wanted.has(channel))
}

/** A card field that changed, in the words the e-mail shows: "Estado", "Não iniciado" → "Feito". */
export const cardChangeSchema = z.object({
  field: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable()
})
export type CardChange = z.infer<typeof cardChangeSchema>

/** What the notice says, captured when it happened — a card renamed later keeps its old notice. */
export const notificationDataSchema = z.object({
  cardKey: z.string().optional(),
  cardTitle: z.string().optional(),
  stateName: z.string().optional(),
  excerpt: z.string().optional(),
  product: z.enum(['jiraia', 'draw']).optional(),
  spaceName: z.string().optional(),
  spaceKey: z.string().optional(),
  status: z.string().optional(),
  /** The proposal a `proposal_received` notice opens (ADR-0019). */
  proposalId: z.string().optional(),
  /** An entitlement request's notice (ADR-0024): which, for whom, of what. */
  requestId: z.string().optional(),
  requestKind: z.string().optional(),
  systemName: z.string().optional(),
  profileName: z.string().optional(),
  personName: z.string().optional(),
  /** The access review an `access_review_opened` notice opens. */
  reviewId: z.string().optional(),
  itemCount: z.number().int().optional(),
  /** What a card notice changed, oldest value first (Etapa 5f). */
  changes: z.array(cardChangeSchema).optional(),
  /** The page or whiteboard a Draw notice is about. */
  contentId: z.string().optional(),
  contentTitle: z.string().optional(),
  contentKind: z.string().optional(),
  /** The sprint a `sprint_overdue` notice is about, and the day it should have ended (ADR-0029). */
  sprintName: z.string().optional(),
  sprintEndsOn: z.string().optional()
})
export type NotificationData = z.infer<typeof notificationDataSchema>

export const boxSchema = z.enum(['inbox', 'snoozed', 'archived'])
export type Box = z.infer<typeof boxSchema>

export const notificationViewSchema = z.object({
  id: z.uuid(),
  kind: notificationKindSchema,
  actor: z.object({ id: z.uuid(), name: z.string() }),
  cardId: z.uuid().nullable(),
  spaceId: z.uuid().nullable(),
  data: notificationDataSchema,
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  snoozedUntil: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable()
})
export type NotificationView = z.infer<typeof notificationViewSchema>
export const notificationListSchema = z.object({ items: z.array(notificationViewSchema), unread: z.number().int() })
export const unreadCountSchema = z.object({ unread: z.number().int() })

export const listQuerySchema = z.object({ box: boxSchema.default('inbox') })
export const notificationPathSchema = z.object({ notificationId: z.uuid() })

/** One notice's state, as its member changes it. `snoozedUntil: null` brings it back now. */
export const updateNotificationSchema = z
  .object({
    read: z.boolean().optional(),
    archived: z.boolean().optional(),
    snoozedUntil: z.iso.datetime().nullable().optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), { message: 'Send a change' })
export type UpdateNotification = z.infer<typeof updateNotificationSchema>

export const preferencesSchema = z.object({
  items: z.array(z.object({ kind: notificationKindSchema, channels: channelsSchema }))
})
export const preferenceInputSchema = z.object({ kind: notificationKindSchema, channels: channelsSchema })

export type NotificationRow = typeof notifications.$inferSelect

const iso = (date: Date | null): string | null => (date ? toIso(date) : null)

export const toNotificationView = (row: NotificationRow, actorName: string): NotificationView => ({
  id: row.id,
  kind: notificationKindSchema.parse(row.kind),
  actor: { id: row.actorId, name: actorName },
  cardId: row.cardId,
  spaceId: row.spaceId,
  data: notificationDataSchema.parse(row.data),
  createdAt: toIso(row.createdAt),
  readAt: iso(row.readAt),
  snoozedUntil: iso(row.snoozedUntil),
  archivedAt: iso(row.archivedAt)
})
