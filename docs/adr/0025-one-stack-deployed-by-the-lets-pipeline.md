# 25. One stack, a general function and a scheduler, deployed by the LET'S pipeline

Date: 2026-10-21

## Status

Accepted. Amends ADR-0001 (SAM and SSM), ADR-0002 (where the migrations run), ADR-0003 (a Lambda and
an HTTP API per bounded context), ADR-0009, ADR-0014, ADR-0015 and ADR-0018 (a Lambda per entry
point). Sign-in is ADR-0026.
Amended by ADR-0035: wakes fill the jobs queue instead of schedules, and prod's database starts at
zero capacity.

## Context

JiraIA had inherited uselets' delivery: SAM templates per stack (`infra/platform`,
`services/work`), a layer published by hand and pointed at through SSM, a migration function someone
had to invoke, and ten functions in `work` — the router, the realtime relay, Slack's events, three
queue consumers, four schedules and the migrations. Nothing deployed it, and the panel had no
infrastructure at all.

Every other LET'S product (max-core, inteli-tracker, logistics-auction) ships the same way: one
`template.yml` at the repository root in plain CloudFormation, a `buildspec.yml` that uploads a
versioned `app.zip` and writes the stack's parameters into `config.json`, and the shared pipeline
(`aws-cicd`) that creates a change set in dev and, after a manual approval, in prod. JiraIA follows
that standard (decided 2026-10-21): one general Lambda behind one API Gateway `ANY /{proxy+}`, and one
Lambda for the scheduled jobs. Its pipeline already exists in `aws-cicd` (`JiraIA`, stack `jiraia`).

## Decision

**One stack, at the root, in plain CloudFormation.** `template.yml` holds everything: Aurora and its
secret, the event bus, the queues and their alarms, the Cognito user pool, the attachments bucket,
the panel's bucket and CloudFront distribution, the APIs and the functions. No `Transform`. What
differs between dev and prod is a non-secret `Mappings` entry keyed by account id (761817249596 dev,
009485101578 prod, the Max accounts); secrets stay in Secrets Manager, read by dynamic reference.

**Two functions, one package.** Both run `work`'s `app.zip`, with their own role and log group.

- **The general function** (`services/work/src/index.ts`) tells its trigger by the event's shape
  (`lambda/invoke.ts`):
  - **HTTP:** one HTTP API (payload v2, which the router already spoke) with one route, `ANY
    /{proxy+}`, and **no authorizer**: the router verifies the sign-in token itself (ADR-0026), and
    `/v1` and the public routes were already decided there. Slack's events are a path the function
    hands to the Slack service before the router (ADR-0018).
  - **WebSocket:** pages edited together need a WebSocket API (ADR-0009); it is the stack's second
    API, and it invokes the same function. An HTTP route cannot carry a WebSocket.
  - **Queues:** the three domain-event consumers keep their own queue and DLQ (ADR-0014); the
    function knows a batch by the queue name in its ARN (`lambda/queues.ts`).
  - **Deploy:** a `Custom::Deploy` resource whose properties carry the package version, so every
    deploy of new code updates it. The function then applies the migrations (ADR-0002) and publishes
    the panel. A failure answers FAILED and the stack rolls back.
- **The scheduler function** (`services/work/src/scheduler.ts`) runs the four jobs — dispatch, the
  daily summary, webhook retries, the access clock — apart from requests, with only the permissions
  jobs need (the bus, SES). Each job used to have its own function with a reserved concurrency of
  one, so two passes never overlapped. Reserving one for the whole scheduler would make the minute's
  dispatch wait behind the daily summary, so each schedule puts a message in one **FIFO queue**,
  grouped by job: a FIFO group is read one message at a time, which keeps the guarantee per job and
  lets the jobs run beside each other (`lambda/jobs.ts`).

**The panel ships inside the package.** `bun run build` builds `apps/web` and
`infra/build/package.ts` copies it into `app.zip` under `panel/`; the deploy puts it in the panel
bucket. One artifact carries the API and the panel that speaks to it, so the accounts never run
mismatched versions. What differs per account (the user pool, the domain) is written by the deploy
into `config.js`, which the panel reads before it starts: one build serves dev and prod.

**CloudFront serves the API on the panel's origin.** `/api/work/*` goes to the HTTP API with the
prefix removed (a CloudFront Function), `/.well-known/*` too (ADR-0021); everything else is the
bucket, with screens rewritten to `index.html`. The panel already called `/api/work` locally, so its
code does not change, and the API needs no CORS.

**The layer is a resource.** `infra/layers/build.ts` still builds `jiraia-deps.zip`; `buildspec.yml`
uploads it beside `app.zip` and the stack publishes it as `AWS::Lambda::LayerVersion`, so the
package stays small enough for the console editor (ADR-0010).

## Consequences

- Deploying is merging to master; this repository provides `template.yml` and `buildspec.yml`.
- `cfn-lint` runs in CI, and `infra/ci/__tests__/template.unit.test.ts` holds the template and the
  functions to the same queue and job names, the one agreement neither `tsc` nor CloudFormation sees.
- The general function's timeout is what the migrations may need (300 s); API Gateway still cuts a
  request at 30 s.
- A failing job blocks its own FIFO group until it succeeds or reaches the DLQ after three tries;
  the other jobs carry on. The DLQ raises the critical alarm.
- On a rollback the previous package republishes its own panel; the migrations are forward-only,
  so the previous code runs against a schema it may not know, as before.
- The custom domain (pendência #3) is a later change to the distribution; until then the panel and the
  API answer on the distribution's `*.cloudfront.net` name.
