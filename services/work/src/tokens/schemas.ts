import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { apiTokens } from '../schema-intake.js'

export type ApiTokenRow = typeof apiTokens.$inferSelect

export const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Days until it stops working; absent means until revoked. */
  expiresInDays: z.number().int().min(1).max(365).optional()
})
export type CreateToken = z.infer<typeof createTokenSchema>

export const tokenViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  hint: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable()
})
export type TokenView = z.infer<typeof tokenViewSchema>
export const tokenListSchema = z.object({ items: z.array(tokenViewSchema) })

/** The one answer that carries the token itself: the screen shows it once and never again. */
export const createdTokenSchema = z.object({ token: tokenViewSchema, value: z.string() })

export const serviceAccountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.string(),
  tokens: z.array(tokenViewSchema)
})
export const serviceAccountListSchema = z.object({ items: z.array(serviceAccountSchema) })
export const createServiceAccountSchema = z.object({ name: z.string().trim().min(1).max(80) })

export const tokenPathSchema = z.object({ tokenId: z.uuid() })
export const serviceAccountPathSchema = z.object({ memberId: z.uuid() })

const iso = (date: Date | null): string | null => (date ? toIso(date) : null)

export const toTokenView = (row: ApiTokenRow): TokenView => ({
  id: row.id,
  name: row.name,
  hint: row.hint,
  createdAt: toIso(row.createdAt),
  lastUsedAt: iso(row.lastUsedAt),
  expiresAt: iso(row.expiresAt),
  revokedAt: iso(row.revokedAt)
})
