# JiraIA

LET'S internal platform that replaces **Jira** (work management) and **Confluence** (knowledge, as
**LET'S Draw AI**), native in AI: people and AI agents are members of the same spaces and work on the
same boards. The MVP goes to production by 2026-11-30.

This README is the practical guide: run it, change it, ship it, operate it. The rules for changing the
code are in [`AGENTS.md`](AGENTS.md); read it before your first pull request.

> **Status (2026-10-22):** Etapas 1 to 7c delivered ([`docs/etapas/`](docs/etapas/)). Dev is live at
> https://dev-jiraia.uselets.com with Google sign-in. Prod waits on its Google OAuth client and the
> other items in [`docs/pendencias-externas.md`](docs/pendencias-externas.md). Next: Etapa 8, the import
> from Jira and Confluence.

## Contents

1. [What it does](#what-it-does)
2. [Run it locally](#run-it-locally)
3. [Day-to-day workflow](#day-to-day-workflow)
4. [Recipes](#recipes)
5. [Tests](#tests)
6. [Deploy](#deploy)
7. [Operate](#operate)
8. [Troubleshooting](#troubleshooting)
9. [How it is built](#how-it-is-built)
10. [Where to read more](#where-to-read-more)

## What it does

**JiraIA (work).** Spaces with roles per person or group (everyone reads, roles to edit; ADR-0012).
Each space has a configurable workflow, a board, a list and a backlog. Cards are numbered `KEY-n`, with
sections, fields, comments, links and a field-by-field history. Also: structured filters, search, bulk
actions and space reports.

**Intake and automation.** Intake forms, automations (when, if, then), notifications with a daily
e-mail, outgoing webhooks, API tokens and Slack (ADR-0014, 0015, 0018).

**AI.** Agents propose changes that a person approves (ADR-0019). An MCP server (ADR-0020) serves
clients that connect by OAuth (ADR-0021, 0022), and the assistant acts as the person.

**LET'S Draw AI (knowledge).** Spaces of folders, pages and whiteboards, edited together in real time
over Yjs (ADR-0009, 0011, 0017). Comments and versions on each item. "Criar com IA" drafts content
from a prompt.

**Access governance (ISO 27001).** A catalog of LET'S systems and their profiles. Access requests are
approved by the system owner, with an SLA, offboarding, privileged access with an expiry, periodic
reviews and an audit report (ADR-0024).

**Every write** is recorded in the audit trail: who, what, before and after.

### The API for programs

Every route also answers under `/v1` with an API token instead of Google sign-in (ADR-0015):

```sh
curl -H "Authorization: Bearer jia_…" https://dev-jiraia.uselets.com/api/work/v1/spaces
```

To get a token:

- **Personal token:** panel → your name → *Tokens de API*. It acts as you.
- **Service-account token:** panel → *Integrações* (organization admins only). It acts as that
  account, with the roles it was given on each space.

Routes and bodies are in [`infra/contracts/openapi.json`](infra/contracts/openapi.json).

## Run it locally

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| [bun](https://bun.sh) | 1.4.3 (`.tool-versions`) | `curl -fsSL https://bun.sh/install \| bash -s "bun-v1.4.3"` |
| Node | 24.18 (`.tool-versions`) | asdf, mise or nvm |
| Docker | recent | Docker Desktop or OrbStack, running |

No cloud account, Google project or API key is needed to run locally.

### First run

```sh
git clone https://github.com/LetsDelivery/jiraIA.git && cd jiraIA
bun install                      # also installs the git hooks (husky)
cp .env.sample .env              # set LOCAL_ADMIN_EMAIL to your corporate address
bun run up
```

`bun run up` does the following:

1. Starts the three Postgres containers.
2. Applies the migrations.
3. Seeds example data, only when the database is empty.
4. Serves the panel and the API.

| What | Where |
|---|---|
| Panel | http://localhost:5280 |
| API | http://localhost:8280 |
| Dev database | `postgres://jiraia:jiraia@127.0.0.1:8200/jiraia` |
| Test database / e2e database | :8210 / :8220 (never touch your dev data) |
| E-mails "sent" (`bun run local:email-preview` renders every template) / attachments | `.local-mail/` / `.local-files/` |

### Signing in locally

There is no Google locally. The sign-in screen asks for an e-mail and signs you in with it. The domain
rule still applies: only `uselets.com` and `lets.delivery` addresses get in. The seed creates
`LOCAL_ADMIN_EMAIL` as organization admin, plus these accounts:

| E-mail | Role |
|---|---|
| `admin@uselets.com` | Organization admin |
| `ana@uselets.com` | Space manager; edits REQ, PRD and Draw's Produto through the group Produto |
| `gil@uselets.com` | Edits TEC through the group Tecnologia |
| `rui@uselets.com` | No role: reads everything, and has asked to edit PRD |

The seeded spaces are **REQ · Requisições**, **PRD · Discovery Board** and **TEC · Delivery Board**,
plus the Draw space **Produto**.

To call the API directly, a header stands in for the Google token:

```sh
curl -H 'x-local-user: admin@uselets.com' localhost:8280/work/spaces
```

Locally, Slack messages are printed by the harness and "Criar com IA" needs `ANTHROPIC_API_KEY` in
`.env`.

## Day-to-day workflow

1. **Branch from `master`:** `git switch -c fix/<what>` or `feat/<what>`.
2. **Read before you write.** Use the spec in `docs/produto/`, the glossary in `CONTEXT.md` (use its
   words) and the ADR that covers the area.
3. **Change the code and add a test.** Every new function gets a test; every bug fix gets a
   regression test.
4. **See it working.** A green suite is not a working feature. Call the route on `bun run up` or
   `local:serve`, read the body and the log, and click through the screen at 390px and 820px.
5. **Run what CI runs:** `bun run test:ci`, plus `bun run web:test` if you touched `apps/web`.
6. **Commit.** Use a conventional commit with a scope:
   `feat(work): …`, `fix(web): …`, `chore(deps): …`.
   - Scopes: `work`, `core`, `logger`, `http`, `authorization`, `db`, `testing`, `web`, `platform`,
     `layer`, `deploy`, `local`, `contracts`, `ci`, `docs`, `repo`, `deps`.
   - The hooks run Biome, `tsc` and commitlint.
7. **Open a pull request.** Its title becomes the squash commit on `master`, so it follows the same
   rule. You need one approval and a green `ci-ok`. Merging deploys (see [Deploy](#deploy)).

## Recipes

| I want to… | Do this |
|---|---|
| Add or change a route | Declare it with `requires` and `responds` in the service's `routes.ts` (listings answer `{ items }`), then `bun run contracts` and commit `infra/contracts/openapi.json`. The panel's types regenerate on `web:dev`/`web:test`. |
| Change the database | Edit `services/work/src/schema.ts`, run `bun run db:generate --name <what>`, and commit the migration in `services/work/drizzle/`. Migrations are forward-only and run on deploy. |
| Add a write | Decide authorization in the service from the roles in the database (ADR-0004), and record an audit event in the same transaction. |
| Add a dependency to a service | Wire it in that service's `container.ts`, behind a type the service owns, with an override for tests. |
| Add a queue, schedule or job | Name it the same in `template.yml` and in `services/work/src/lambda/`. `infra/ci/__tests__/template.unit.test.ts` holds them together. |
| Add a per-account value | Add it to `Mappings.EnvConfig` in `template.yml`, keyed by account id. A secret goes in Secrets Manager, read by a dynamic reference. |
| Add a screen | Write plain JavaScript in `apps/web/src/views/`. Build markup with the `html` template only, use the tokens in `src/styles/tokens.css`, and keep it mobile first (ADR-0006, 0023). Give the view a `skeleton` (`list`, `board`, `table` or `document`; `list` if omitted) for while it loads. |
| Add a button that calls the API | Wrap the call in `busy(button, () => …)` from `ui/busy.ts`: the button is disabled and shows a spinner until the API answers. Dialogs from `openFormDialog` already do this. |
| Add a third-party package | It must be permissive: `bun run check:licenses`. Never copy from Plane or any copyleft project (clean room). |
| Record a surprising decision | Add a new ADR in `docs/adr/` (next number). Amend older ones by reference, never by editing them. |

## Tests

| Command | What it runs | Needs |
|---|---|---|
| `bun run test` | All backend tests (`*.unit.test.ts` and `*.integration.test.ts`) | Docker (`postgres-test` on :8210) |
| `bun run test:unit` | Backend unit tests only | nothing |
| `bun test <path>` | One file; run it **from the repository root** (migrations are found from there) | Docker for integration |
| `bun run web:test` | Panel unit tests (vitest) | nothing |
| `bun run web:e2e` | Playwright on a stack of its own (DB :8220, API :8290, panel :5290) | Docker |
| `bun run test:ci` | Lint, types, backend tests, build and every CI gate | Docker |

Tests never leave localhost (`packages/testing` refuses). External APIs are mocked with MSW on a
`.counterparty.test` host.

**Local Postgres is not the Data API.** The local driver accepts what AWS refuses in two ways:

- **Result size:** AWS refuses results over 1 MiB, and the local driver refuses them too, so this one
  is caught locally.
- **Parameter types:** the local driver does **not** reproduce how the Data API types parameters. A JS
  number is bound as `bigint`, so cast numeric parameters in raw `sql` (`${n}::int`). See ADR-0027.

## Deploy

### How a change reaches AWS

There is no deploy command: **merging to `master` is the deploy.**

```
PR merged → CI on master → pipeline "JiraIA" (aws-cicd) → buildspec.yml
          → change set on stack "jiraia" in dev → manual approval → same change set in prod
```

- [`buildspec.yml`](buildspec.yml) builds the panel and `app.zip` (`bun run build`) and the
  dependency layer (`bun run build:layer`). It uploads both, versioned, and writes their versions to
  `config.json`.
- CloudFormation applies [`template.yml`](template.yml). That is the whole stack, plain CloudFormation
  with no SAM (ADR-0025).
- The stack's `Custom::Deploy` resource runs inside the function on every new package. It **applies
  the migrations** and **publishes the panel** to S3. If it fails, the stack rolls back.
- To approve prod, open the `JiraIA` pipeline in CodePipeline in the `aws-cicd` account and approve the
  manual step after you have checked dev (see [Check a deploy](#check-a-deploy)).

| | Dev | Prod |
|---|---|---|
| Account | 761817249596 (`lets-dev`) | 009485101578 (`lets-prd`) |
| Panel | https://dev-jiraia.uselets.com | https://jiraia.uselets.com (when live) |
| API | `<panel>/api/work` | `<panel>/api/work` |
| Functions | `jiraia`, `jiraia-scheduler` | same |

The stack outputs are `PanelUrl`, `ApiUrl`, `RealtimeUrl`, `SignInUrl`, `FunctionName` and
`SchedulerFunctionName`:

```sh
aws cloudformation describe-stacks --profile lets-dev --stack-name jiraia --query 'Stacks[0].Outputs'
```

### Check a deploy

Run these against dev before you approve prod:

```sh
# 1. The stack finished
aws cloudformation describe-stacks --profile lets-dev --stack-name jiraia \
  --query 'Stacks[0].[StackStatus,LastUpdatedTime]' --output text

# 2. No errors since the deploy (the general function; use jiraia-scheduler for jobs)
aws logs tail /aws/lambda/jiraia --profile lets-dev --since 30m --filter-pattern '?ERROR ?WARN'
```

3. Open the panel and exercise the change.

### Roll back

- **Code:** revert the pull request on `master`. The pipeline deploys the previous code, and that
  package republishes its own panel.
- **Migrations:** they are forward-only. The old code runs against the new schema. Make schema changes
  additive (new column or table first, drop later) so a revert is safe.
- **Failed stack update:** CloudFormation rolls back by itself. Read the stack events for the cause.

### First deploy to a new account

1. Add the account under `Mappings.EnvConfig` in `template.yml`: domains, Google client id, alarm
   e-mail, SES sender, Slack client id, Aurora capacity, deletion protection, log retention, domain and
   ACM certificate (us-east-1).
2. Create the secrets the template reads in that account's Secrets Manager:

   | Secret | Keys | When |
   |---|---|---|
   | `jiraia/google` | `client_secret` | `GoogleClientId` is set. The Google client redirects to `<SignInUrl>/oauth2/idpresponse` (ADR-0026). |
   | `jiraia/slack` | `client_secret`, `signing_secret`, `token_key` | `SlackClientId` is set (ADR-0018) |

3. Merge, and let the pipeline create the stack.
4. Create the organization and its first admin, **once** (the script refuses a second run):

   ```sh
   CLUSTER=$(aws cloudformation describe-stack-resource --profile lets-dev --stack-name jiraia \
     --logical-resource-id DatabaseCluster --query StackResourceDetail.PhysicalResourceId --output text)
   SECRET=$(aws cloudformation describe-stack-resource --profile lets-dev --stack-name jiraia \
     --logical-resource-id DatabaseSecret --query StackResourceDetail.PhysicalResourceId --output text)
   AWS_PROFILE=lets-dev AWS_REGION=us-east-1 \
   DB_CLUSTER_ARN=arn:aws:rds:us-east-1:761817249596:cluster:$CLUSTER DB_SECRET_ARN=$SECRET \
   bun run aws:bootstrap --admin-email nome.sobrenome@uselets.com --admin-name "Nome Sobrenome"
   ```

5. Point the domain's DNS at the CloudFront distribution. Until then the panel answers on its
   `*.cloudfront.net` name.

## Operate

| Need | Where |
|---|---|
| Request, WebSocket and queue logs | CloudWatch `/aws/lambda/jiraia` |
| Scheduled job logs (dispatch, daily summary, webhook retries, access clock) | `/aws/lambda/jiraia-scheduler` |
| Failed events | The DLQ of each queue (automation, notifications, webhooks, jobs). Each DLQ raises the critical alarm, sent to `AlarmEmail`. |
| Database | Aurora PostgreSQL Serverless v2, reached through the RDS Data API (query editor in the console). Dev pauses at 0 ACU, so the first request after idle is slow. |
| Logs as JSON | Filter by field, for example `--filter-pattern '{ $.statusCode = 500 }'` |

Data API limits to keep in mind (ADR-0002, ADR-0027):

- An answer over 1 MiB fails. Never select `work.contents.document` in a listing. Large columns are
  read in pieces.
- Numeric parameters arrive as `bigint`. Cast them where a function expects `int`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bun run up` fails on the containers | Start Docker, then run it again |
| Page loads empty after a pull | The schema changed: `bun run local:reset` |
| No `+` to create a space | Only admins and space managers create spaces. Set `LOCAL_ADMIN_EMAIL` in `.env`, then `bun run local:reset` |
| Port already in use | Another `bun run up` is running; stop it |
| `Can't find meta/_journal.json file` in a test | Run `bun test` from the repository root |
| Draw page or whiteboard stuck on "Conectando…" and not editable | The document failed to load. Read `/aws/lambda/jiraia` for `GET …/document` errors |
| "Criar com IA" answers 503 | No `ANTHROPIC_API_KEY` (locally in `.env`; in AWS, pendência #8) |
| Commit refused | Read the commitlint message: the scope is missing or not in the list above |

## How it is built

The stack and conventions follow `LetsDelivery/uselets` (ADR-0001); every deviation is an ADR.

| Layer | Choice |
|---|---|
| Runtime | bun workspaces, TypeScript, Node 24 on AWS Lambda |
| API | One general Lambda behind API Gateway `ANY /{proxy+}` (routing in code), a WebSocket API for real time, and a scheduler Lambda fed by a FIFO queue (ADR-0025) |
| Data | Aurora PostgreSQL + pgvector through the RDS Data API, Drizzle (ADR-0002) |
| Events | EventBridge bus → SQS queues with DLQs per consumer (ADR-0014) |
| Sign-in | Google through a Cognito user pool, with the Workspace domain checked in the service (ADR-0026) |
| Real time | Yjs over the WebSocket API; state merged and garbage-collected on the server (ADR-0009, 0027) |
| Panel | Plain JavaScript, no framework (ADR-0006), on S3 behind CloudFront. The API is under `/api/work` on the same origin, with no CORS |
| AI | Anthropic SDK (drafts) and an MCP server as a route of `work` (ADR-0020) |

```
template.yml        the whole AWS stack (Aurora, bus, queues, Cognito, Lambdas, APIs, S3 + CloudFront)
buildspec.yml       what the LET'S pipeline builds and hands to CloudFormation
services/work       the one service: members, spaces, cards, Draw, access, automation, MCP (schema `work`)
                    src/index.ts the general Lambda · src/scheduler.ts the jobs · src/lambda/ triggers
packages/           core, logger, http, authorization, db, testing
apps/web            the panel (src/views screens, src/editor + src/whiteboard Draw, playwright/ e2e)
infra/local         the local harness (up, server, seed, realtime, bus, mail)
infra/ci            the gates CI runs (licenses, contracts, handlers, timezone, zod, http, prose, audit)
infra/build         the package · infra/layers the dependency layer · infra/aws bootstrap
infra/contracts     the generated OpenAPI
docs/               adr/ · etapas/ · produto/ (specs, pt-BR) · pendencias-externas.md
```

## Where to read more

| Read | For |
|---|---|
| [`AGENTS.md`](AGENTS.md) | The rules for changing the code (people and agents) |
| [`CONTEXT.md`](CONTEXT.md) | The domain glossary |
| [`docs/produto/`](docs/produto/) | The product specs (pt-BR); start with `escopo-mvp.md` |
| [`docs/etapas/`](docs/etapas/) | What each stage delivered and how it is demoed |
| [`docs/adr/`](docs/adr/) | Every decision that would surprise a reader of the code |
| [`docs/pendencias-externas.md`](docs/pendencias-externas.md) | What waits on access or decisions outside the code |

## Security

- Never commit `.env`, `.env.local` or any credential. gitleaks runs in CI. In AWS, per-account values
  are in `Mappings` and secrets are in Secrets Manager.
- `x-local-user` exists only in the local harness, which refuses to start against anything but the
  local containers.
- Report a vulnerability to the Tecnologia team privately, not in an issue.
