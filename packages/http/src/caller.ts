import { UnauthenticatedException } from '@jiraia/core'
import { z } from 'zod'

/**
 * Who is making the request, as far as the Google ID token can say (ADR-0005).
 *
 * Only the identity travels in the token — never a role. A JiraIA role is held per space and per
 * project and must take effect on the next request, so each service resolves the member behind
 * `subject` and decides the role from its own store (ADR-0004).
 *
 * `email`, `emailVerified` and `hostedDomain` are what the service needs to admit a person it has
 * not seen before: the organization's rule is "a verified address of our Google Workspace domain",
 * and only the token can prove that.
 */
export type Caller = {
  /** Google's `sub`: stable for the life of the Google account; an email is not. */
  subject: string
  email?: string
  emailVerified: boolean
  /** Google's `hd` claim: the Workspace domain the account belongs to. Absent for a consumer account. */
  hostedDomain?: string
  /** The person's display name, which names a member created at their first sign-in. */
  name?: string
  /**
   * Set only when an API token proved the caller (ADR-0015): the member the token belongs to. The
   * router sets it after the service verified the token; a Google token never carries it.
   */
  memberId?: string
  /**
   * Set only for an OAuth token (ADR-0022): the name of the application acting as the person in
   * `memberId`. Such a caller reaches only the routes that declare `delegated`.
   */
  via?: string
}

/**
 * The claims of a sign-in token. Anything else is ignored.
 *
 * A Cognito ID token (ADR-0026) carries Google's Workspace domain as `custom:hd`, the attribute the
 * user pool maps Google's `hd` into, and `email_verified` as a boolean. An API Gateway JWT authorizer
 * flattens every claim to a string, so it arrives as `"true"`, and the local harness and the tests send
 * that shape with Google's own `hd`. All of it is read.
 */
const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().optional(),
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  hd: z.string().optional(),
  'custom:hd': z.string().optional(),
  name: z.string().optional()
})

export const callerFromClaims = (claims: unknown): Caller => {
  const parsed = claimsSchema.safeParse(claims)

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new UnauthenticatedException(`The token is missing required claims — ${issues}`)
  }

  const { sub, email, email_verified: verified, name } = parsed.data
  const hd = parsed.data.hd ?? parsed.data['custom:hd']

  return {
    subject: sub,
    emailVerified: verified === true || verified === 'true',
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(hd ? { hostedDomain: hd.toLowerCase() } : {}),
    ...(name ? { name } : {})
  }
}

/** The caller used for a `public` route: identified as nobody. */
export const anonymousCaller: Caller = { subject: 'anonymous', emailVerified: false }
