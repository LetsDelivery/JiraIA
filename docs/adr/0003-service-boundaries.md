# 3. Service boundaries: work first

Date: 2026-10-15

## Status

Accepted. Amended by ADR-0005: the `identity` service is gone; Google signs people in Amended by
ADR-0025: the bounded contexts stay in code, but the stack has one general Lambda, one scheduler
Lambda and one HTTP API.

## Context

uselets deploys one router Lambda per bounded context. JiraIA's contexts are visible in the spec:
work (spaces, projects, cards, views), pages, agents and proposals, automation, search, migration —
plus sign-in.

Splitting all of them on day one would mean cross-service calls before there is anything to call.
Cards need the roles that spaces hold; pages will need cards for embeds; agents need everything.

## Decision

Start with two services and split when an etapa brings a context with its own data and its own
reasons to change:

- `work` owns the organization, members, spaces, projects, roles and the audit trail — and, in
  Etapa 2, cards. It also admits people at their first Google sign-in (ADR-0005), because who is a
  member is its decision.

Each service owns one Postgres schema on the shared cluster (ADR-0002) and never reads another's.
`pages` (Etapa 4) and `agents` (Etapa 6) are expected to be the next services.
