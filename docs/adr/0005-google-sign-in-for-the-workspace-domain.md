# 5. Google sign-in for the Workspace domain, without Cognito

Date: 2026-10-15

## Status

Accepted. Supersedes the Cognito part of ADR-0001 and the `identity` service of ADR-0003.

## Context

ADR-0001 inherited uselets' Cognito with emailed one-time codes. uselets needs a user pool: its users
are merchants, partners and integrators from outside the company. JiraIA's users are only Let's
people, who already hold a Google Workspace account at `uselets.com`. A pool would be a second
directory to keep in step with the first, and an emailed code a worse login than the one they use
every day.

## Decision

People sign in with Google (Google Identity Services in the panel). The panel receives Google's **ID
token** and sends it as the bearer. There is no Cognito, no `identity` service and no session of ours.

- **API Gateway verifies the token** with a JWT authorizer: issuer `https://accounts.google.com`,
  audience = JiraIA's OAuth client id (`/jiraia/<env>/google/client-id` in SSM), Google's published
  keys, expiry.
- **The service decides who gets in** (`MemberAdmission`): a **verified** address whose token
  carries `hd` equal to the allowed Workspace domain (`ALLOWED_EMAIL_DOMAIN`, `uselets.com`) and
  ends in it. `hd` is what proves the account belongs to the Workspace; an address alone does not,
  since anyone can open a consumer Google account for an address of any domain. The `hd` hint the
  sign-in button sends only narrows Google's account chooser.
- **Anyone of the domain gets in.** A first sign-in either binds an invited member (matched by
  address) to the Google `sub`, or creates a member with no roles, who sees nothing until someone
  adds them to a space. Both are audited (`linked`, `joined`). Invitations still exist, to give roles
  before a person's first sign-in, and only accept addresses of the domain.
- Deactivation is the member's `status`, checked on every request; there is no account to disable.
- Locally there is no Google: `x-local-user: <email>` becomes the claims of a verified token for that
  address (`infra/local/config.ts`), so the same admission code runs and `@gmail.com` is refused.

## Consequences

- A Google ID token lives one hour and Google Identity Services gives the browser no refresh token.
  When it expires the API answers 401 and the panel returns to the sign-in screen, where One Tap
  (`auto_select`) signs a returning person back in, usually without a click.
- Agents (Etapa 6) cannot hold Google tokens; they will need their own credential, decided then.
- The OAuth client is created in Let's Google Cloud, with the panel's origins authorised
  (`docs/pendencias-externas.md`).
