import { z } from 'zod'

import { spaceViewSchema } from '../spaces/schemas.js'

/** A space as the home screen and the sidebar show it: with the caller's own star and last visit. */
export const spaceSummarySchema = spaceViewSchema.extend({
  starred: z.boolean(),
  lastVisitedAt: z.iso.datetime().nullable()
})
export type SpaceSummary = z.infer<typeof spaceSummarySchema>

/**
 * The caller's spaces, three ways (Para você and the sidebar):
 *
 * - `starred` — the ones they starred, by name;
 * - `recent` — the ones they opened, most recent first;
 * - `recommended` — the ones they hold a role in and did not star, most opened in the last 30 days
 *   first, then by name, so a member who never opened anything still sees where they belong.
 */
export const mySpacesSchema = z.object({
  starred: z.array(spaceSummarySchema),
  recent: z.array(spaceSummarySchema),
  recommended: z.array(spaceSummarySchema)
})
export type MySpaces = z.infer<typeof mySpacesSchema>
