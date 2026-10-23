# 29. Sprints belong to a space, are planned in its backlog, and end by hand

Date: 2026-10-23

## Status

Accepted. Brings sprints into the MVP (escopo-mvp 3.11), out of "Fora do MVP".

## Context

The MVP left sprints out until someone confirmed whether Tecnologia used them in Jira. On 2026-10-23
Stênio confirmed it does, and that the development team plans its deliveries by sprint. Jira shows:

- Only TEC uses sprints: three cards elsewhere carry one.
- One board, sprints of about three weeks: Sprint 15 (08-17 to 09-04), 16 (09-09 to 09-27), 17
  (09-28 to 10-16). No future sprint is planned ahead; the next one is created at the turn.
- Sprint 17 was still active a week after its end date, with over 100 cards, 39 of them not done. The
  team closes a sprint when it decides to, not on a date.
- 57% of the cards carry story points (1, 2, 3, 5, 8, 13), mostly 1 and 2. JiraIA only had an estimate
  of P/M/G.
- 8% of recent cards went through more than one sprint.

## Decision

- **A sprint belongs to a space** (`work.sprints`): a number per space, a name ("Sprint 18", or the name
  imported from Jira), a goal, start and end dates, and a state — `planned`, `active`, `closed`. At
  most one active sprint per space, held by a partial unique index.
- **A card is in at most one sprint at a time** (`cards.sprint_id`). Moving it is a card change like any
  other: audited, so its history, the e-mail of its changes and the reports read it.
- **A space switches sprints on** ("Usa sprints", in its settings), on by default for software spaces. A
  space without them works as before.
- **A space chooses how it estimates**: P/M/G (today's `estimate`) or story points (a new
  `cards.points`, a number). Burndown and velocity add points where the space uses them, and count
  cards where it does not.
- **Whoever edits the space runs its sprints**: members and admins create, start and close them, and
  move cards in and out. Each of those is an audited write, decided in the service (ADR-0004).
- **A sprint ends by hand.** Past its end date it shows as late on the board and its space's lead gets
  a notice, but only a person closes it. Closing asks where the open cards go — the next planned
  sprint, a new one, or the backlog — and keeps a summary of the sprint: committed, completed and
  carried over, in cards and in points, as they were at that moment.
- **Burndown and velocity read the audit trail**, as the space's reports do (ADR-0016): the cards and
  points in the sprint at its start, what was added and removed, and what reached a done state, day
  by day. Velocity reads the closed sprints' summaries.
- **The backlog is where sprints are planned**: a section per active and planned sprint above the
  backlog, cards dragged between them. The board shows the active sprint, with a picker for the others.

## Consequences

- The Jira import (Etapa 8) has somewhere to put sprints and points, so this comes before it. Each
  card keeps its last sprint; closed sprints come in with their dates and are summarised from the
  imported history.
- A space switching sprints off keeps its sprints and the cards' links to them, hidden, so switching
  back on loses nothing.
- Jira's parallel sprints and cross-space boards are left out: TEC uses neither.
- A card carried over leaves its trace only in the history and in the closed sprint's summary; there
  is no list of every sprint a card was ever in.
