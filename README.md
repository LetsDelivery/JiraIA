# JiraIA

Let's internal platform for **work management** (replacing Jira) and **knowledge** (replacing
Confluence), native in AI: people and AI agents are members of the same spaces and work on the same
boards. The MVP goes to production by 2026-11-30.

> **Status:** Etapa 1 (foundation) done; Etapa 2 (cards and board) in progress — see
> [`docs/etapas/`](docs/etapas/). Not deployed yet: the AWS accounts are pending
> ([`docs/pendencias-externas.md`](docs/pendencias-externas.md)).

## What it does today

- **Sign-in with Google**, only for verified accounts of the company's Google Workspace domain.
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

### Real Google sign-in (optional)

To see the real "Entrar com Google" button locally, create an OAuth client of type *Web application*
in the company's Google Cloud, with `http://localhost:5280` as an authorised JavaScript origin, and put
its client id in `apps/web/.env.local` (git-ignored):

```sh
VITE_GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
```

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
| API | One router Lambda per bounded context behind API Gateway; zod contracts and generated OpenAPI |
| Data | Aurora PostgreSQL through the RDS Data API, Drizzle ([ADR-0002](docs/adr/0002-postgres-through-the-data-api.md)) |
| Sign-in | Google ID tokens verified by API Gateway; Workspace domain checked by the service ([ADR-0005](docs/adr/0005-google-sign-in-for-the-workspace-domain.md)) |
| Panel | Plain JavaScript, no framework ([ADR-0006](docs/adr/0006-plain-javascript-panel-with-glass-on-what-floats.md)) |
| Infra | SAM/CloudFormation, configuration from SSM at deploy time |

```
services/work       organization, members, spaces, workflow, cards, audit   (Postgres schema `work`)
packages/           core, logger, http · authorization, db, testing
apps/web            the panel
infra/              platform (Aurora, event bus) · local harness · CI gates · contracts · build
docs/               adr/ · etapas/ · produto/ (specs, pt-BR)
```

## Contributing

- Read [`AGENTS.md`](AGENTS.md) and the glossary in [`CONTEXT.md`](CONTEXT.md) first.
- Code, comments, commits and ADRs in English; text on screen in Portuguese.
- Conventional commits with a module scope (`feat(work): …`, `fix(web): …`); `master` takes changes by
  pull request only.
- **Clean room:** never read or copy code from Plane or any copyleft project; dependencies must be
  permissive (`bun run check:licenses`).

## Security

- Never commit `.env`, `.env.local` or any credential. In AWS, configuration comes from SSM and
  secrets from Secrets Manager; nothing secret lives in this repository.
- `x-local-user` exists only in the local harness, which refuses to start against anything but the
  local containers.
- Report a vulnerability to the Tecnologia team privately, not in an issue.
