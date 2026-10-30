import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { members } from '../schema.js'

export type MemberRow = typeof members.$inferSelect

export const memberKindSchema = z.enum(['person', 'agent'])
export const memberStatusSchema = z.enum(['active', 'inactive'])

export const memberViewSchema = z.object({
  id: z.uuid(),
  kind: memberKindSchema,
  email: z.string().nullable(),
  name: z.string(),
  /** What the person does at LET'S, beside their name — never inside it. */
  jobTitle: z.string().nullable(),
  /** Shows the person's photo for the next hours (ADR-0039); `null` draws their initials instead. */
  avatarUrl: z.string().nullable(),
  isOrgAdmin: z.boolean(),
  /** Creates JiraIA spaces without being an organization admin (ADR-0012). */
  isSpaceManager: z.boolean(),
  /** Reads and exports everything in access governance (ADR-0024). */
  isAccessAuditor: z.boolean(),
  status: memberStatusSchema,
  /** The platform's own "Automação" (ADR-0014): it acts, but holds no role and is chosen for nothing. */
  isSystem: z.boolean(),
  createdAt: z.iso.datetime(),
  deactivatedAt: z.iso.datetime().nullable()
})
export type MemberView = z.infer<typeof memberViewSchema>

export const memberListSchema = z.object({ items: z.array(memberViewSchema) })

const nameSchema = z.string().trim().min(1).max(120)
/** A blank job title is no job title. */
const jobTitleSchema = z
  .string()
  .trim()
  .max(80)
  .nullable()
  .transform((title) => title || null)

/** Invitations are by corporate email. The address is stored lowercased, as Cognito matches it. */
export const inviteMemberSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  name: nameSchema,
  jobTitle: jobTitleSchema.default(null),
  isOrgAdmin: z.boolean().default(false)
})
export type InviteMember = z.infer<typeof inviteMemberSchema>

/** What a person changes about themselves on Meu perfil. The e-mail is Google's, never theirs to edit. */
export const updateProfileSchema = z
  .object({ name: nameSchema, jobTitle: jobTitleSchema })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, 'Nothing to change')
export type UpdateProfile = z.infer<typeof updateProfileSchema>

export const memberPathSchema = z.object({ memberId: z.uuid() })

/** What a photo may be: the panel sends a small square it cropped itself, so this is generous. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
export const AVATAR_EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } as const

/** The photo announced before its bytes go to storage, and announced again once they arrived. */
export const avatarFileSchema = z.object({
  contentType: z.enum(['image/webp', 'image/jpeg', 'image/png']),
  size: z.number().int().min(1).max(MAX_AVATAR_BYTES)
})
export type AvatarFile = z.infer<typeof avatarFileSchema>

export const avatarPathSchema = z.object({ avatarId: z.uuid() })

export const toMemberView = (row: MemberRow, avatarUrl: string | null): MemberView => ({
  id: row.id,
  kind: memberKindSchema.parse(row.kind),
  email: row.email,
  name: row.name,
  jobTitle: row.jobTitle,
  avatarUrl,
  isOrgAdmin: row.isOrgAdmin,
  isSpaceManager: row.isSpaceManager,
  isAccessAuditor: row.isAccessAuditor,
  status: memberStatusSchema.parse(row.status),
  isSystem: row.subject?.startsWith('system:') ?? false,
  createdAt: toIso(row.createdAt),
  deactivatedAt: row.deactivatedAt ? toIso(row.deactivatedAt) : null
})
