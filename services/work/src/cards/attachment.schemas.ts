import { z } from 'zod'

import type { cardAttachments } from '../schema.js'

export type AttachmentRow = typeof cardAttachments.$inferSelect

/** Large enough for a recorded demo; anything bigger belongs in a drive, linked from the card. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

export const attachmentViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  uploadedBy: z.object({ id: z.uuid(), name: z.string() }),
  createdAt: z.iso.datetime(),
  /** Downloads the file for the next few minutes; read the list again for a fresh one. */
  url: z.string()
})
export type AttachmentView = z.infer<typeof attachmentViewSchema>
export const attachmentListSchema = z.object({ items: z.array(attachmentViewSchema) })

export const createAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  contentType: z
    .string()
    .trim()
    .regex(/^[\w.+-]+\/[\w.+-]+$/)
    .max(120),
  size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES)
})
export type CreateAttachment = z.infer<typeof createAttachmentSchema>

/** The attachment, still pending, and where to send its bytes. */
export const uploadViewSchema = z.object({
  id: z.uuid(),
  upload: z.object({ url: z.string(), headers: z.record(z.string(), z.string()) })
})

export const attachmentPathSchema = z.object({ cardId: z.uuid(), attachmentId: z.uuid() })
