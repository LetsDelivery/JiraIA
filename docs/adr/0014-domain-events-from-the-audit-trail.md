# 14. Domain events come from the audit trail, through the bus, to one queue per consumer

Date: 2026-10-17

## Status

Accepted. Builds on ADR-0001 (EventBridge with one SQS queue per consumer) and ADR-0002 (Aurora
through the Data API).

## Context

Etapa 5 brings the first work that happens *because* something else happened: an automation runs
when a card changes state, a notification goes out when someone is mentioned (5b), a webhook fires
on any change (5c). Each needs the change, reliably, after it committed — never for a write that
rolled back, and never lost because a Lambda died between the commit and the publish.

Every write already records an audit event in its own transaction (`AuditTrail.record`), with the
actor, the entity and every field before and after. That is the fact a consumer needs.

## Decision

- **The audit trail is the outbox.** `audit_events.dispatched_at` is null until the event leaves; a
  partial index finds the pending ones. No write changes: what is audited is published.
- **A scheduled dispatcher publishes.** `consumers/dispatch` runs every minute (one at a time),
  reads pending events oldest first, sends them to the platform bus `jiraia-<env>` as
  `source: jiraia.work`, `detail-type: <entity>.<action>`, `detail: <the event>`, and only then marks
  them. A failed publish leaves them for the next pass.
- **One queue per consumer.** An EventBridge rule per consumer sends the detail-types it reads to
  its own SQS queue, with a dead-letter queue after five attempts and an alarm on the DLQ. The
  consumer Lambda answers with a partial batch response, so one bad message does not hold the rest.
- **At least once, made once.** A consumer records `(consumer, event_id)` in `event_receipts` after
  it handled an event and skips what it has seen. Automations also keep `automation_runs` unique per
  rule and event.
- **The platform acts as "Automação".** One agent member per organization, subject
  `system:automation:<org>` — no Google token carries that subject. Its changes go through the same
  services as a person's and appear in history under its name. Whether a rule may reach a space is
  decided by the rule's owner's access on every run, not by this member.
- **What an automation changes starts no other rule.** The MVP's guard against loops: the
  automation consumer ignores events whose actor is the "Automação" member.
- **Locally there is no bus.** `drain()` dispatches and hands events to the consumers in the same
  process; the harness drains after each write and prints Slack instead of posting. The suites call
  `drain()` and see a rule's effect deterministically.

## Consequences

- A rule's effect shows within about a minute in AWS — accepted for the MVP. If someone needs it
  sooner, the router can trigger a dispatch after a write without changing anything else.
- The history the migration imports (Etapa 8) and every event before this ADR are marked dispatched
  by migration `0007`, so the first pass does not replay the past.
- Consumers must tolerate seeing an event twice and in rare cases out of order across cards; within
  one card, oldest-first dispatch keeps the order.
- Rules cannot chain (an automation's card does not trigger another rule). If the areas need it, a
  depth counter on the event replaces the blanket guard.
