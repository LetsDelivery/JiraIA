# 38. GitHub tells each card its branches and pull requests; a merge moves the card

Date: 2026-10-29

## Status

Accepted. Amends escopo-mvp, which listed GitHub among the integrations left out of the MVP. Follows
ADR-0018 (Slack) for how an organization connects a third party, and ADR-0025 for how its deliveries
reach the general function.

## Context

The development team names branches after the Jira issue (`feat/TEC-1343-…`) and Jira's GitHub app
shows, on the issue, the branches, the pull requests, whether they were reviewed and merged. Moving to
JiraIA without it means people open GitHub to know where a card's work is. Stênio asked for the same:
the team keeps naming branches by the card's key, and JiraIA follows from there. The only change made
on the team's behalf: **when the pull request is merged, the card moves to review.**

## Decision

- **A GitHub App, installed once** on the organization's GitHub account, on every repository, by an
  organization admin, from the **GitHub** page (account menu). The panel sends them to the App's
  installation page with a `state` signed for them, valid for ten minutes; GitHub sends them back to
  `/github/conectar` with the installation's id, and the API asks GitHub, as the App (a JWT signed
  with its private key), whose installation that is before keeping it. Installing and disconnecting
  are audited; uninstalling on GitHub disconnects too.
- **The App's id and name are in `Mappings`**; its private key and webhook secret in the secret
  `jiraia/github`. Without them everything is wired and inert: the page says the App does not exist
  yet, connecting answers 503, every delivery is refused.
- **Deliveries reach `/github/events` on the general function**, past the router, like Slack's events:
  first the `X-Hub-Signature-256` over the raw body is checked; a delivery id already handled
  (`github_deliveries`, kept a month) is answered without acting twice.
- **A card's key in a branch's name or a pull request's title links them** (`card_dev_links`), at most
  five keys each. Read events: branch created and deleted, pull request opened, edited, drafted,
  synchronised, closed and merged, reviews (approved, changes requested, dismissed) and check suites. A
  link stays when its key leaves the title. Only metadata is kept: no code, no diff, no commit message.
- **What changes in a link's state, review or checks is an audit event** (`dev_link`), by an agent
  member named **GitHub**, created per organization like "Automação". No consumer reads these events
  yet: no notice, no outgoing webhook.
- **The one automatic change: a pull request merged into the repository's default branch moves each
  of its cards to the state the space chose** (`spaces.merged_state_id`, in Configurações › Fluxo), as
  the GitHub agent, through the same move a person makes — so the space's automation rules react to
  it. No state chosen: nothing moves. A card already in a done or cancelled state stays. A merge into
  another branch moves nothing.
- **The card shows a "Desenvolvimento" section** — pull requests with state, review and checks, then
  branches — and a **Copiar nome da branch** button: `feat/` (`fix/` for a type that looks like a bug,
  ADR-0031), the key, the title in lower case.

## Consequences

- A card moved by a merge lands in a state, not a column (ADR-0037). In TEC, REVISAR is drawn inside
  the EM PROGRESSO column, so the card stays in that column, marked REVISAR.
- Branches and pull requests made before the App was installed are not seen. Reading them back
  (open and recently merged pull requests of every repository) needs the App's installation token and
  is later work.
- Commits are not followed, nor deploys: GitHub knows of a deploy only if the pipeline tells it, and
  LET'S deploys through CodePipeline. Showing "in production" waits for each pipeline to report.
- The private key travels as an environment variable of the general function, resolved at deploy;
  with the others it stays under Lambda's 4 KB. A larger key would have to be read from Secrets
  Manager at run time instead.
- Whoever can name a card's key in a branch of the organization links to it. Every member of LET'S
  reads every card (ADR-0012), so this tells nobody anything new; it only adds noise if a key is
  written by mistake.
