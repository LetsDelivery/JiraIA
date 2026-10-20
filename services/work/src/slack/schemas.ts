import { z } from 'zod'

/** The Slack connection as a person sees it (Etapa 5e, ADR-0018). */
export const slackStatusSchema = z.object({
  /** Whether the Slack app exists (pendência #10); until it does, nobody can connect. */
  configured: z.boolean(),
  /** Whether the caller may connect or disconnect the workspace: an organization admin. */
  canManage: z.boolean(),
  workspace: z.object({ teamName: z.string(), installedBy: z.string(), installedAt: z.iso.datetime() }).nullable(),
  /** Whether the caller was found in the workspace by their e-mail; null with no workspace. */
  me: z.object({ found: z.boolean() }).nullable()
})
export type SlackStatus = z.infer<typeof slackStatusSchema>

export const slackInstallSchema = z.object({ url: z.url() })

/** What Slack hands back to the panel after the consent screen. */
export const completeSlackSchema = z.object({ code: z.string().min(1).max(500), state: z.string().min(1).max(500) })
export type CompleteSlack = z.infer<typeof completeSlackSchema>
