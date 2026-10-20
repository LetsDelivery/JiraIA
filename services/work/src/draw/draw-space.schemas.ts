import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { drawSpaces } from '../schema.js'

export type DrawSpaceRow = typeof drawSpaces.$inferSelect

/** Starred spaces lead the list; followed ones will tell their followers what changed (Etapa 5). */
export const drawMarkSchema = z.enum(['star', 'follow'])
export type DrawMark = z.infer<typeof drawMarkSchema>

const nameSchema = z.string().trim().min(1).max(80)
const iconSchema = z.string().trim().min(1).max(8)

export const createDrawSpaceSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).default(''),
  icon: iconSchema.default('📘')
})
export type CreateDrawSpace = z.infer<typeof createDrawSpaceSchema>

export const updateDrawSpaceSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().max(500).optional(),
    icon: iconSchema.optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), { message: 'Send at least one field' })
export type UpdateDrawSpace = z.infer<typeof updateDrawSpaceSchema>

export const drawSpacePathSchema = z.object({ spaceId: z.uuid() })
export const drawMarkPathSchema = z.object({ spaceId: z.uuid(), mark: drawMarkSchema })

export const drawSpaceViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  createdBy: z.object({ id: z.uuid(), name: z.string() }),
  starred: z.boolean(),
  following: z.boolean(),
  /** Whether the caller may create and edit its contents: a member or admin of it (ADR-0012). */
  canWrite: z.boolean(),
  /** Whether the caller may change or delete it and give roles in it: an admin of it. */
  canManage: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type DrawSpaceView = z.infer<typeof drawSpaceViewSchema>
export const drawSpaceListSchema = z.object({ items: z.array(drawSpaceViewSchema) })

export type DrawSpaceWithCreator = DrawSpaceRow & { creatorName: string }

export const toDrawSpaceView = (
  row: DrawSpaceWithCreator,
  marks: ReadonlySet<DrawMark>,
  { canWrite, canManage }: { canWrite: boolean; canManage: boolean }
): DrawSpaceView => ({
  id: row.id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  createdBy: { id: row.createdBy, name: row.creatorName },
  starred: marks.has('star'),
  following: marks.has('follow'),
  canWrite,
  canManage,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt)
})
