# 1. Inherit the uselets stack and conventions

Date: 2026-10-15

## Status

Accepted. Cognito, originally inherited here, was replaced by Google sign-in (ADR-0005), and the
React panel by plain JavaScript (ADR-0006)

## Context

JiraIA replaces Jira and Confluence inside Let's by 2026-11-30. The first product spec proposed its
own TypeScript stack (pnpm + Turborepo, Fastify, Redis + BullMQ, Hocuspocus, generic OIDC). Let's
already runs another AI-native product, `LetsDelivery/uselets`, whose stack and conventions the
development team has validated in production: 117 ADRs, a CI with its own gates, a deploy pipeline.

A second stack would mean a second set of habits for the same team, under a six-week deadline.

## Decision

JiraIA follows uselets wherever uselets has an answer, and deviates only where the JiraIA spec needs
something uselets does not have. Each deviation is its own ADR.

Inherited as is: bun workspaces, Node 24 (`nodejs24.x`), TypeScript transpiled to one `.js` per file
(uselets ADR-0010), Biome, husky, commitlint with a module scope, gitleaks, one router Lambda per
bounded context behind an HTTP API (uselets ADR-0001), zod 4 with a generated OpenAPI contract,
authorization decided inside the service (uselets ADR-0006), EventBridge with
one SQS queue per consumer, SAM/CloudFormation with configuration read from SSM at deploy time,
Powertools logging, `bun test`
with `.unit`/`.integration` naming and a localhost-only guard, and the `test:ci` gates.

Copied, with a provenance note: `packages/core` (exceptions, clock, ids, env), `packages/logger`,
`packages/http` (router, matching, responses), the CI gates, the build and the layer scripts. They are
Let's own code, so the clean-room decision (`docs/produto/decisao-clean-room.md`) does not apply.

Rewritten rather than copied: `Caller` and `packages/authorization`, because uselets' grants are
about merchants and JiraIA's roles are about spaces and projects (ADR-0004).

Added by JiraIA, because uselets has no equivalent: Postgres (ADR-0002), real-time page editing
(Etapa 4), the Anthropic SDK and an MCP server (Etapa 6), Slack (Etapa 5), and a license gate.
