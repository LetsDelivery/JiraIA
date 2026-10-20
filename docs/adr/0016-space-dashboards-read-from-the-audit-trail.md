# 16. Space dashboards, with times read from the audit trail

Date: 2026-10-17

## Status

Accepted. Moves "custom dashboards" from out of scope (escopo-mvp) into the MVP. Builds on ADR-0008
(structured filter) and ADR-0012 (access).

## Context

Teams moving from Jira read their spaces through dashboards: how many items were done this week, where
the items sit, who holds them, how long they take. Stênio asked for a **Reports** tab in every space,
with widgets its admins add, edit, reorder and remove.

Cards carry no completion date and no "started" date. The audit trail (ADR-0004) records every state
change with its time, so both dates can be read from it.

## Decision

- **One dashboard per space**, stored as one row in `space_dashboards` with the widgets as a JSON list.
  A space with no row shows the **default dashboard**, defined in code; nothing is backfilled. Saving
  replaces the whole list, so the panel edits a draft and saves once. Last write wins.
- **Who:** every reader of the space sees it; its admins (`space:manage`) save and restore it. Saving
  and restoring are audited as `dashboard.updated`, with the space as the entity.
- **A widget is a zod discriminated union** on `kind`: `count`, `breakdown`, `trend`, `timing`,
  `matrix`, `cards`. Each has a width (quarter, third, half, full) and, optionally, a saved view of the
  same space (scope `space`) whose filter narrows its cards. The title is optional; without one the
  panel names the widget from its configuration, so the API holds no screen text.
- **Data comes from one read route** that takes a widget, saved or still in the editor, and answers its
  data. The panel calls it once per widget in parallel, so a slow or broken widget does not hold up the
  others.
- **Times from the trail:** the completion date is the last entry into a state of group `done`; the
  start is the first entry into a state of group `in_progress`. Lead time runs from creation to
  completion; cycle time from start to completion. A card never in progress has no cycle time.
- **Buckets are UTC** days, ISO weeks and months, filled with zeros on the server.
- **Charts are hand-written SVG** in the panel (ADR-0006), with the categorical palette of the dataviz
  skill. A breakdown keeps the seven largest slices and folds the rest into "Outros".

## Consequences

- No new column on `cards` and no backfill. The cost is an aggregate over `audit_events` for times,
  which the `audit_events_entity` index serves. Measured in Etapa 9 against the 20,000-card seed.
- A state moved into the `done` group later changes past completion dates: the trail says when a card
  entered the state, and the state's group is read now. This is the same rule as Jira's status
  categories.
- A day near midnight in São Paulo may fall on the next UTC day.
- Widgets that need Git (commits, deployments, pull requests) stay out, with integrations other than
  Slack.
