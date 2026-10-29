import { z } from 'zod'

/** The GitHub connection as a person sees it (Etapa 9, ADR-0038). */
export const githubStatusSchema = z.object({
  /** Whether the GitHub App exists; until it does, nobody can connect. */
  configured: z.boolean(),
  /** Whether the caller may connect or disconnect GitHub: an organization admin. */
  canManage: z.boolean(),
  installation: z.object({ account: z.string(), installedBy: z.string(), installedAt: z.iso.datetime() }).nullable()
})
export type GitHubStatus = z.infer<typeof githubStatusSchema>

export const githubInstallSchema = z.object({ url: z.url() })

/** What GitHub hands back to the panel after the App is installed. */
export const completeGitHubSchema = z.object({
  installationId: z.string().regex(/^\d{1,20}$/),
  state: z.string().min(1).max(500)
})
export type CompleteGitHub = z.infer<typeof completeGitHubSchema>

export const devLinkKindSchema = z.enum(['branch', 'pull_request'])
export const devLinkStateSchema = z.enum(['active', 'deleted', 'open', 'draft', 'closed', 'merged'])

/** A branch or a pull request that names the card, as GitHub last told it. */
export const devLinkViewSchema = z.object({
  id: z.uuid(),
  repo: z.string(),
  kind: devLinkKindSchema,
  /** The branch's name, or the pull request's number. */
  ref: z.string(),
  title: z.string(),
  url: z.string(),
  state: devLinkStateSchema,
  review: z.enum(['approved', 'changes_requested']).nullable(),
  checks: z.enum(['pending', 'success', 'failure']).nullable(),
  author: z.string(),
  mergedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime()
})
export type DevLinkView = z.infer<typeof devLinkViewSchema>

export const devLinkListSchema = z.object({ items: z.array(devLinkViewSchema) })
