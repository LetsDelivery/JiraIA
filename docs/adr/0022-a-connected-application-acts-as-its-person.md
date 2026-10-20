# 22. A connected application acts as its person; proposals are for autonomous agents

Date: 2026-10-19

## Status

Accepted. Supersedes ADR-0021 where it made the application an agent, and narrows ADR-0019 and
ADR-0020: proposals are no longer how a person's assistant writes.

## Context

With 6a–6c, everything an MCP client wrote became a proposal someone had to approve. Stênio, looking at
how Jira works with Claude: once connected, the user's assistant creates and changes issues as the
user, with no approval afterwards. The person already decided when they asked their assistant ("Laís,
create a task in PRD with this specification"); asking a second person to approve it is a bottleneck,
not a safeguard.

Proposals still fit one case: an agent acting on its own — a service account's routine, the
triggered and scheduled agents of Etapa 6 — where no person asked for the change.

## Decision

- **An OAuth token acts as the person who allowed it**, with exactly their roles: it writes where they
  write and nowhere else. It is still limited to the routes that take an application's token (MCP).
- **The trail names the application.** Every write made through it records `audit_events.via` with the
  application's name, and the card's history reads "Stênio criou o card (via Laís)".
- **No agent member per application** any more. A connection is an application for a person.
- **MCP tools follow who is behind the token:**
  - a person (OAuth, or a personal API token) gets direct writes — `create_card`, `update_card`,
    `comment_on_card`, `link_cards` — that run through the same services as the panel;
  - an agent (a service account) gets `propose_changes`, `list_proposals`, `get_proposal` and
    `withdraw_proposal`: its changes still wait for a person, or for the space's policy.
- Proposals keep everything ADR-0019 built, for agents. `onBehalfOfId` and the `proposal_decided`
  notice, which existed only for applications, are dropped.

## Consequences

- An assistant is exactly as powerful as its person in JiraIA — no more, and no review step. A
  person who should not create cards in a space cannot have their assistant do it.
- The consent page says so: the application will read and write as them.
- `docs/produto/arquitetura.md`'s second principle ("agentes propõem, pessoas aprovam") now holds
  for autonomous agents only; recorded in the product diary.
