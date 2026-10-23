# 28. Each situation has its own e-mail, sent on its own clock

Date: 2026-10-23

## Status

Accepted. Replaces the daily summary of Etapa 5b (`DigestService`, `email-copy.ts`).

## Context

Etapa 5b sent one kind of e-mail: at 08:00, a list of every unread notice a person had chosen to get
by e-mail. A mention waited until the next morning; an access request past its deadline — which ISO
27001 measures in hours (ADR-0024) — waited too. A card's changes said only "moved to Feito", with no
before. LET'S Draw AI sent nothing: a mention in a page comment reached no one.

The summary also had a bug. It read the 2,000 oldest unread notices of every channel and only ever
marked the ones it mailed. Notices kept in the panel never left that list, so once 2,000 of them sat
unread, every summary came out empty, with no error.

Stênio asked on 2026-10-23 for a template per situation, after the e-mails of Jira and Confluence,
in the panel's own look.

## Decision

- **A template per situation**, in `services/work/src/notifications/email/`: a mention, a card's
  changes, Monday's summary, the LET'S Draw AI morning summary, and access (queue, outcome, overdue,
  review, a request to edit a space, an agent's proposal). Tables and inline styles, the panel's tokens
  as hex, the product's name as text (no image to host), times in São Paulo. `bun run
  local:email-preview` renders each with made-up data.
- **Each on its own clock**, from the jobs queue (ADR-0025):
  - `mail`, every minute: a mention and an access notice at once, one message each; a card's notices
    gathered per person and card, sent when the oldest is 10 minutes old.
  - `morning`, 08:00: LET'S Draw AI — pages someone else changed among those the person helped write,
    and mentions in page comments.
  - `weekly`, Mondays 08:00: unanswered mentions of the last 30 days and cards nobody holds in the
    spaces the person worked in.
- **A notice is settled once.** Each pass reads only the kinds it sends, and marks `emailed_at` on what
  it mailed *and* on what its member keeps out of e-mail, or cannot get (gone, no address). The list
  always moves on; turning e-mail on later does not mail the past.
- **Card notices carry before and after** (`data.changes`) for state, assignee, priority and due date.
  A move stays `state_changed`; the other three are a new kind, `card_updated`. There are no sprints in
  JiraIA, so the e-mail has none.
- **Two Draw notices**: `draw_mentioned` from a page comment, and `content_changed` from a version
  saved or restored, for its creator and everyone who saved a version — one unread notice per page and
  person, since the summary names every editor anyway.
- **Every kind goes by e-mail by default**, comments and moves included: the e-mails group, so there
  are few. `weekly_summary` is a preference only — e-mail or nothing — and no notice is written with it.
- **A link never writes.** "Responder" opens the card with the cursor in the comment box
  (`#comentar`); "Atribuir a mim" opens it with the button ringed (`atribuir=eu`). The person still
  clicks.
- **No sender, no tries.** `Mailer.ready` is false without `MAIL_FROM`, and the jobs return at once
  instead of failing every message every minute.

## Consequences

- People hear of a mention or an access request within a minute, and of a card's changes within about
  eleven.
- A person following many busy cards gets an e-mail per card per window; the panel's preferences turn
  any kind down to the panel.
- The `mail` job runs every minute, mostly finding nothing: two indexed reads.
- Slack keeps its one-line sentences, now in `notice-copy.ts`.
- `content_changed` is written on every version, which LET'S Draw AI saves at most every few minutes
  per editor.
