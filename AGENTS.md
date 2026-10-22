# AGENTS.md — JiraIA

Rules for anyone — person or coding agent — changing this repository. They follow
`LetsDelivery/uselets` (docs/adr/0001); where uselets has a rule and this file is silent, uselets'
`AGENTS.md` applies.

## Read first

1. `docs/produto/` — the product specs, in pt-BR. `escopo-mvp.md` items marked **M** are mandatory.
2. `CONTEXT.md` — the domain glossary. Use its words; never invent synonyms.
3. `docs/adr/` — every decision that would surprise a reader of the code.
4. `docs/etapas/<n>.md` — what the current stage delivers and how it is demoed.

## Clean room (non-negotiable)

Never open, clone, read, copy or adapt code, components, icons, illustrations or UI text from
**Plane** (makeplane/plane, AGPL-3.0) or any other copyleft project. Build only from the specs.
Dependencies must be permissive; `bun run check:licenses` fails otherwise. `@uselets/*` and code
copied from uselets are LET'S own and allowed.

## Language

English everywhere — code, comments, commits, ADRs, logs, error messages. Only text a person reads
on screen is pt-BR, chosen by the web app from the error `code`, never the API's message.

## Code

- Relative imports carry a `.js` extension. `bunx tsc --noEmit` must pass.
- No `enum`, no `any`, no `.d.ts`. A zod schema is the type.
- Functions of 4–20 lines, files under 500, at most two levels of indentation.
- Errors name the offending value (`Project "REQ" is archived`), via `@jiraia/core` exceptions.
- Never call local-time `Date` methods. Everything is UTC; the web app formats in America/Sao_Paulo.
- Log with `@jiraia/logger`, never `console` (except `console.error` in scripts).
- Dependencies are wired in each service's `container.ts`, with `overrides` for tests and the local
  harness. Third-party libraries are wrapped behind a type the service owns.
- Every route declares `requires` and `responds`; listings are `{ items }`. Run `bun run contracts`
  after changing a route.
- Authorization is decided in the service from the roles in the database (ADR-0004). Every write
  records an audit event in the same transaction.
- Panel (`apps/web`): plain JavaScript, no framework (ADR-0006). Markup only through the `html`
  template, which escapes; `raw` only for markup the app ships. Visual decisions follow the
  `design-principles` skill and the tokens in `src/styles/tokens.css`; glass only on what floats.
  Mobile first (ADR-0023): check a new screen at 390px and 820px; no screen scrolls the page sideways.
- Schema changes: edit `src/schema.ts`, run `bun run db:generate --name <what>`, commit the migration.
- Infra is one `template.yml` at the root, plain CloudFormation with no SAM (ADR-0025): a general
  Lambda (`services/work/src/index.ts`) behind `ANY /{proxy+}` and a scheduler Lambda
  (`services/work/src/scheduler.ts`). A new queue or job is named the same in the template and in
  `services/work/src/lambda/`; a value that differs per account goes in `Mappings`, a secret in
  Secrets Manager. Sign-in is Google through Cognito (ADR-0026).

## Tests

- `*.unit.test.ts` needs nothing; `*.integration.test.ts` needs `docker compose up`.
- Tests never leave localhost (`packages/testing` refuses). External APIs are mocked with MSW on a
  `.counterparty.test` host. Fakes are named classes (`InMemoryDirectory`).
- Every new function gets a test; every bug fix gets a regression test.
- **A green suite is not a working feature.** Call the route on `bun run local:serve` and read the
  body and the log before calling it done.

## Commits and branches

- Conventional commits with a required module scope (`commitlint.config.cjs`): `feat(work): …`.
- `master` takes changes by pull request only: one approval, green `ci-ok`, squash merge.
- A mechanical rename is reviewed with `git diff --word-diff`.

## Commands

| Command | What it does |
|---|---|
| `bun run up` | Containers, migrations, seed, API on :8280 and panel on :5280 |
| `bun run local:serve` | The API alone; authenticate with `x-local-user: <email>` |
| `bun run local:reset` | Drop the dev database and seed again |
| `bun run test` | Backend tests (needs `docker compose up`) |
| `bun run test:ci` | Everything CI runs, locally |
| `bun run web:e2e` | Playwright against a stack of its own (`postgres-e2e`, API :8290, panel :5290) |
