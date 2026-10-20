# 15. API tokens on /v1, and outgoing webhooks signed and retried

Date: 2026-10-17

## Status

Accepted. Builds on ADR-0004 (authorization in the service), ADR-0005 (Google sign-in) and ADR-0014
(events).

## Context

Etapa 5c closes escopo-mvp 4.7 and 4.8. Two kinds of programs need JiraIA:

- Programs that **call** JiraIA: this repository's routines, n8n flows, the MCP server and the agents
  of Etapa 6. They cannot sign in with Google.
- Programs JiraIA **calls**: an ERP, a spreadsheet or a flow that wants each card change as it
  happens.

The HTTP API sits behind a JWT authorizer that only accepts Google ID tokens, and that authorizer is
the default on every route.

## Decision

**API tokens**
- A token is `jia_` plus 32 random bytes (base64url). It is shown once. Only its SHA-256 is stored,
  with its first 12 characters as a hint, its owner, an optional expiry, the last use and a revocation.
- **Personal token:** acts as its person. **Service account:** an agent member (subject `service:<id>`)
  created by an organization admin. It gets roles on spaces like anyone else, and its tokens act as it.
  Authorization does not change: the token becomes a member, and the service decides from that member's
  roles (ADR-0004).
- **Where it is accepted:** API Gateway sends `/v1/{proxy+}` to the same router, with no authorizer.
  There the router accepts only `Authorization: Bearer jia_…`, verified by the service through an
  injected `TokenVerifier`. Google claims never count on `/v1`. Outside `/v1` a token is never
  accepted, because the JWT authorizer refuses it before the router runs.
- **Refused with 401:** an unknown, revoked or expired token, or one whose member is inactive.
- **Tokens are made and revoked only from the panel.** A token cannot mint another, so a leaked one
  cannot multiply. Creating and revoking a token are audited.

**Outgoing webhooks**
- **Who:** the space's admins manage them; the address and the deliveries say where the space's data
  goes. A webhook names the card events it wants (created, updated, moved, commented).
- **Who sends:** a consumer of its own on the bus (ADR-0014) records one delivery per webhook and event
  (unique, so a repeated event does not send twice) and tries it at once.
- **Body:** JSON with the event, the card as it is now, the actor and the changes.
- **Signature:** `x-jiraia-signature: t=<unix seconds>,v1=<HMAC-SHA256 of "t.body">`, with the webhook's
  secret. The secret is shown when the webhook is made or rotated, and never again.
- **Retries:** a scheduled sweep retries a failed delivery after 1, 5, 30, 120 and 360 minutes. After
  the fifth retry the delivery fails. **Reenviar** tries one again at any time.
- **Address:** only public `https` is accepted — no credentials in the URL, no internal names, no
  private, loopback or link-local IPv4, no IPv6 literal. This keeps a webhook from probing the network
  JiraIA runs in.

## Consequences

- The MCP server and the agents (Etapa 6) authenticate with service-account tokens. Nothing new is
  needed for that.
- **No scopes in the MVP:** a token has all of its owner's access. Read-only tokens and rate limits are
  later work.
- **Residual risk:** a public hostname that resolves to a private address is not caught, because names
  are checked as written. The Lambdas run outside any VPC (ADR-0002), which keeps the private surface
  small.
- **Duplicates are possible:** a receiver may get the same delivery twice if a retry overlaps a slow
  2xx. Receivers should dedupe on `x-jiraia-delivery`.
