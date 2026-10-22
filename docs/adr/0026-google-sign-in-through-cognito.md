# 26. Google sign-in through Cognito

Date: 2026-10-21

## Status

Accepted. Supersedes the "without Cognito" part of ADR-0005: people still sign in with their Google
Workspace account, and the service still decides who of the domain gets in.

## Context

ADR-0005 had the panel sign in with Google Identity Services and the API verify Google's own ID
token. That token lives an hour and cannot be renewed without Google's One Tap prompting again, the
sign-in depended on a Google script in the page, and identity sat outside the AWS account the rest of
JiraIA lives in. uselets already signs people in through Cognito; JiraIA does too (decided 2026-10-21).

## Decision

**A Cognito user pool, federated with Google, holding no passwords.** `template.yml` creates the pool,
Google as its only identity provider, a hosted sign-in domain (`jiraia-<account>`), and one app client
for the panel. Nobody signs up to the pool and nobody is created in it by hand
(`AllowAdminCreateUserOnly`); a Google sign-in creates its own profile, and the panel's client offers
Google alone. Google's OAuth client id is in `Mappings`, its secret in Secrets Manager
(`jiraia/google`).

**The panel uses the code flow with PKCE** (`apps/web/src/lib/cognito.ts`). "Entrar com Google" goes
to the pool's `/oauth2/authorize` with `identity_provider=Google`, which sends the person straight on
to Google and back to `/entrar` with a code. The panel exchanges it for an ID token and a refresh
token, and renews the ID token before it lapses, so a session lasts the refresh token's thirty days.
"Sair" ends the pool's session too. The panel is a public client: there is no secret to keep.

**The API verifies the pool's ID token** (`packages/http/identity.ts`, with `jose`): signature against
the pool's keys, issuer, audience (the panel's client), expiry, and `token_use` = `id`. There is no
authorizer in front (ADR-0025). The caller's `sub` is the pool's.

**The domain rule stays the service's** (ADR-0005), for both of LET'S Workspace domains, `uselets.com`
and `lets.delivery` (`ALLOWED_EMAIL_DOMAINS`). The provider maps Google's `hd` into the pool's
`custom:hd`, which the ID token carries; admission requires a verified address of one of the domains,
and an `hd` that is one of them too — Google may name the organization's primary domain there for an
address of the other. Locally there is no pool: `x-local-user` stands in, as before.

## Consequences

- Google's OAuth client lists the pool's `/oauth2/idpresponse` as its redirect URI (pendência #4),
  not the panel's origin.
- Until `GoogleClientId` is set for an account, nobody signs in there: the pool has no provider.
- The ID tokens of the pool and of Google differ in `sub`. JiraIA is not deployed yet, so no member
  is keyed by a Google `sub` in AWS.
- To confirm on the first sign-in in dev: that `AllowAdminCreateUserOnly` lets a federated profile be
  created, and that `custom:hd` arrives in the ID token. Either failing shows as a refused sign-in,
  never as an admitted stranger: the service checks the domain on every request.
