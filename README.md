# JiraIA

LET'S internal platform for **work management** (replacing Jira) and **knowledge** (replacing
Confluence), native in AI: people and AI agents are members of the same spaces and work on the same
boards. The MVP goes to production by 2026-11-30.

> **Status:** Etapa 1 (foundation) done; Etapa 2 (cards and board) in progress — see
> [`docs/etapas/`](docs/etapas/). Not deployed yet: the stack and its pipeline are ready for the Max
> accounts; Google sign-in waits on its OAuth client ([`docs/pendencias-externas.md`](docs/pendencias-externas.md) #4).

## What it does today

- **Sign-in with Google** through Cognito, only for verified accounts of the company's Google Workspace
  domains, `uselets.com` and `lets.delivery`.
  The first sign-in creates the member, who reads every space; roles to edit are given afterwards.
- **Spaces** — what Jira now calls a space: a key (`REQ`, `PRD`, `TEC`), a type, a lead, and roles
  per person or group (admin, member, reader) — see ADR-0012.
- **Sidebar** with *Para você* and *Espaços* (starred, recent, all), and a management page with search
  and filters.
- **Board** per space: a configurable workflow, cards numbered `KEY-n`, drag and drop, quick add, and a
  card detail with standard fields, comments and a field-by-field history.
- **Audit trail** of every write: who, what, before and after.
- **Intake, automation and notification** (Etapa 5): intake forms, automations (when → if → then),
  Slack, an inbox with a daily e-mail, outgoing webhooks and API tokens — ADR-0014, ADR-0015.

### The API for programs

Every route also answers under `/v1` with an API token instead of Google sign-in
([ADR-0015](docs/adr/0015-api-tokens-and-outgoing-webhooks.md)):

```sh
curl -H "Authorization: Bearer jia_…" https://<api>/v1/spaces
```

A personal token (panel → your name → *Tokens de API*) acts as you. A service-account token (panel →
*Integrações*, organization admins) acts as that account, with the roles it was given on each space.
The routes and their bodies are in [`infra/contracts/openapi.json`](infra/contracts/openapi.json).

The product specs (in Portuguese) are in [`docs/produto/`](docs/produto/) — start with
`escopo-mvp.md`.

## Run it locally

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| [bun](https://bun.sh) | 1.4.3 (see `.tool-versions`) | `curl -fsSL https://bun.sh/install \| bash -s "bun-v1.4.3"` |
| Docker | any recent | Docker Desktop or OrbStack, running |
| Git | any | |

No cloud account, Google project or API key is needed to run locally.

### First run

```sh
git clone https://github.com/LetsDelivery/jiraIA.git
cd jiraIA
bun install

cp .env.sample .env
# edit .env and set LOCAL_ADMIN_EMAIL to your own corporate address

bun run up
```

`bun run up` starts the Postgres containers, applies the migrations, seeds example data (only when
the database is empty), and serves:

| What | Where |
|---|---|
| Panel | http://localhost:5280 |
| API (`local:serve`) | http://localhost:8280 |

### Signing in locally

There is no Google locally: the sign-in screen asks for an e-mail and enters as it. The domain rule
still applies — an address outside the company domain is refused, exactly as in production.

The seed creates these fictitious accounts, plus `LOCAL_ADMIN_EMAIL` as an organization admin:

| E-mail | Role |
|---|---|
| `admin@uselets.com` | Organization admin |
| `ana@uselets.com` | Space manager; edits REQ, PRD and Draw's Produto through the group Produto |
| `gil@uselets.com` | Edits TEC through the group Tecnologia |
| `rui@uselets.com` | No role: reads everything, and has asked to edit PRD |

Any other address of the domain also gets in, reading every space and editing none yet.

Example spaces: **REQ · Requisições**, **PRD · Discovery Board** (the product flow, with example
opportunities on its board) and **TEC · Delivery Board**, each with the workflow used in Jira today.

The API can be called directly; locally a header stands in for the Google token:

```sh
curl -H 'x-local-user: admin@uselets.com' localhost:8280/work/spaces
```

### Real Google sign-in

Locally there is no Cognito user pool, so the sign-in screen is always the e-mail one. The real "Entrar
com Google" — through the pool, to Google and back — is in the dev account, at the stack's `PanelUrl`
([ADR-0026](docs/adr/0026-google-sign-in-through-cognito.md)).

## Commands

| Command | What it does |
|---|---|
| `bun run up` | Everything: containers, migrations, seed, API and panel |
| `bun run local:reset` | Drops the dev database and seeds it again |
| `bun run local:serve` | The API alone, on :8280 |
| `bun run web:dev` | The panel alone, on :5280 |
| `bun run test` | Backend tests (unit and integration; needs Docker) |
| `bun run web:test` | Panel unit tests |
| `bun run web:e2e` | Browser tests on a stack of their own (database :8220, API :8290, panel :5290) |
| `bun run test:ci` | What CI runs: lint, types, tests, build and every gate |
| `bun run db:generate --name <what>` | A new migration after changing `services/work/src/schema.ts` |
| `bun run contracts` | Regenerates the OpenAPI contract after changing a route |

The end-to-end suite never touches your dev database: it wipes and seeds its own.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bun run up` fails on the containers | Start Docker, then run it again |
| The page loads but nothing appears after a pull | The schema changed: `bun run local:reset` |
| No `+` to create a space | Only organization admins create spaces: set `LOCAL_ADMIN_EMAIL` in `.env`, then `bun run local:reset` |
| Port already in use | Another `bun run up` is running; stop it first |

## How it is built

The stack and conventions follow the team's other AI-native product, `LetsDelivery/uselets`
([ADR-0001](docs/adr/0001-inherit-the-uselets-stack-and-conventions.md)); every deviation is an ADR.

| Layer | Choice |
|---|---|
| Runtime | bun workspaces, TypeScript, Node 24 on AWS Lambda |
| API | A general Lambda behind one API Gateway `ANY /{proxy+}`, routing in code, and a scheduler Lambda for the jobs; zod contracts and generated OpenAPI ([ADR-0025](docs/adr/0025-one-stack-deployed-by-the-lets-pipeline.md)) |
| Data | Aurora PostgreSQL through the RDS Data API, Drizzle ([ADR-0002](docs/adr/0002-postgres-through-the-data-api.md)) |
| Sign-in | Google through a Cognito user pool; its ID token verified by the service, which also checks the Workspace domain ([ADR-0026](docs/adr/0026-google-sign-in-through-cognito.md)) |
| Panel | Plain JavaScript, no framework ([ADR-0006](docs/adr/0006-plain-javascript-panel-with-glass-on-what-floats.md)), on S3 behind CloudFront |
| Infra | One `template.yml` at the root, plain CloudFormation, deployed by the LET'S pipeline through `buildspec.yml` |

```
template.yml        the whole AWS stack: Aurora, bus, queues, Cognito, two Lambdas, APIs, S3 + CloudFront
buildspec.yml       what the LET'S pipeline builds and hands to CloudFormation
services/work       organization, members, spaces, workflow, cards, audit   (Postgres schema `work`)
                    src/index.ts is the general Lambda, src/scheduler.ts the jobs' one
packages/           core, logger, http · authorization, db, testing
apps/web            the panel
infra/              local harness · CI gates · contracts · build (package, layer)
docs/               adr/ · etapas/ · produto/ (specs, pt-BR)
```

## Deploy

There is no deploy command: merging to `master` is the deploy. The LET'S pipeline (`JiraIA` in
`aws-cicd`, stack `jiraia`, as for max-core) runs [`buildspec.yml`](buildspec.yml), which builds the panel and the function's package
and the dependency layer, uploads them, and hands [`template.yml`](template.yml) to CloudFormation:
dev first, then prod after a manual approval. Each deploy applies the migrations and publishes the
panel from inside the stack ([ADR-0025](docs/adr/0025-one-stack-deployed-by-the-lets-pipeline.md)).

What differs between dev and prod is in the template's `Mappings`, by account id. The panel is at the
CloudFront address in the stack's `PanelUrl` output, and the API under `/api/work` on that address.

## Contributing

- Read [`AGENTS.md`](AGENTS.md) and the glossary in [`CONTEXT.md`](CONTEXT.md) first.
- Code, comments, commits and ADRs in English; text on screen in Portuguese.
- Conventional commits with a module scope (`feat(work): …`, `fix(web): …`); `master` takes changes by
  pull request only.
- **Clean room:** never read or copy code from Plane or any copyleft project; dependencies must be
  permissive (`bun run check:licenses`).

## Security

- Never commit `.env`, `.env.local` or any credential. In AWS, what differs per account is in the
  template's `Mappings` and secrets come from Secrets Manager; nothing secret lives in this repository.
- `x-local-user` exists only in the local harness, which refuses to start against anything but the
  local containers.
- Report a vulnerability to the Tecnologia team privately, not in an issue.
