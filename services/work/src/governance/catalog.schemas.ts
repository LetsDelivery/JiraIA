import { toIso } from '@jiraia/core'
import { z } from 'zod'

import type { accessProfiles, accessSystems } from '../schema-governance.js'

export type SystemRow = typeof accessSystems.$inferSelect
export type ProfileRow = typeof accessProfiles.$inferSelect

/** An owner approves and reviews; an operator carries out (ADR-0024). */
export const dutySchema = z.enum(['owner', 'operator'])
export type Duty = z.infer<typeof dutySchema>
export const privilegeSchema = z.enum(['standard', 'privileged'])

const nameSchema = z.string().trim().min(1).max(80)
const descriptionSchema = z.string().trim().max(500)
/** SLA bounds (ADR-0024): defaults 2 business days to grant, 1 to remove, 24 h after a departure. */
const grantDaysSchema = z.number().int().min(1).max(30)
const removalDaysSchema = z.number().int().min(1).max(30)
const departureHoursSchema = z.number().int().min(1).max(168)
const atLeastOne = (input: Record<string, unknown>) => Object.values(input).some((value) => value !== undefined)

export const createSystemSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.default(''),
  holdsPersonalData: z.boolean().default(false),
  grantSlaDays: grantDaysSchema.default(2),
  removalSlaDays: removalDaysSchema.default(1),
  departureSlaHours: departureHoursSchema.default(24)
})
export type CreateSystem = z.infer<typeof createSystemSchema>
export const updateSystemSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    holdsPersonalData: z.boolean().optional(),
    grantSlaDays: grantDaysSchema.optional(),
    removalSlaDays: removalDaysSchema.optional(),
    departureSlaHours: departureHoursSchema.optional(),
    archived: z.boolean().optional()
  })
  .refine(atLeastOne, { message: 'Nothing to change' })
export type UpdateSystem = z.infer<typeof updateSystemSchema>

export const createProfileSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.default(''),
  privilege: privilegeSchema
})
export type CreateProfile = z.infer<typeof createProfileSchema>
export const updateProfileSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    privilege: privilegeSchema.optional(),
    archived: z.boolean().optional()
  })
  .refine(atLeastOne, { message: 'Nothing to change' })
export type UpdateProfile = z.infer<typeof updateProfileSchema>

export const systemPathSchema = z.object({ systemId: z.uuid() })
export const profilePathSchema = z.object({ profileId: z.uuid() })
export const staffPathSchema = z.object({ systemId: z.uuid(), duty: dutySchema, memberId: z.uuid() })

export const profileViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  privilege: privilegeSchema,
  archived: z.boolean()
})
export const staffViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  duty: dutySchema
})
export type StaffRow = { systemId: string; memberId: string; name: string; email: string | null; duty: string }

export const systemViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  holdsPersonalData: z.boolean(),
  /** How long each kind of request may take here (ADR-0024). */
  sla: z.object({ grantDays: z.number().int(), removalDays: z.number().int(), departureHours: z.number().int() }),
  archived: z.boolean(),
  profiles: z.array(profileViewSchema),
  staff: z.array(staffViewSchema),
  /** What the caller answers for here. */
  duties: z.array(dutySchema),
  /** Whether the caller may edit the system and name its staff: an organization admin. */
  canManage: z.boolean(),
  /** Whether the caller may add and change its profiles: an owner, or an organization admin. */
  canEditProfiles: z.boolean(),
  updatedAt: z.iso.datetime()
})
export type SystemView = z.infer<typeof systemViewSchema>
export const systemListSchema = z.object({ items: z.array(systemViewSchema) })

const toProfileView = (row: ProfileRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  privilege: privilegeSchema.parse(row.privilege),
  archived: row.archivedAt !== null
})

export const toSystemView = (
  row: SystemRow,
  profiles: readonly ProfileRow[],
  staff: readonly StaffRow[],
  actor: { id: string; isOrgAdmin: boolean }
): SystemView => {
  const own = staff.filter((each) => each.systemId === row.id)
  const duties = own.filter((each) => each.memberId === actor.id).map((each) => dutySchema.parse(each.duty))
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    holdsPersonalData: row.holdsPersonalData,
    sla: { grantDays: row.grantSlaDays, removalDays: row.removalSlaDays, departureHours: row.departureSlaHours },
    archived: row.archivedAt !== null,
    profiles: profiles.filter((each) => each.systemId === row.id).map(toProfileView),
    staff: own.map((each) => ({
      id: each.memberId,
      name: each.name,
      email: each.email,
      duty: dutySchema.parse(each.duty)
    })),
    duties,
    canManage: actor.isOrgAdmin,
    canEditProfiles: actor.isOrgAdmin || duties.includes('owner'),
    updatedAt: toIso(row.updatedAt)
  }
}
