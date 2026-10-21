# 18. The Slack workspace is connected once, by OAuth; people are found by e-mail

Date: 2026-10-17

## Status

Accepted. Extends the Slack of Etapa 5a (incoming webhooks for automations, escopo-mvp 4.5), which
stays as it is. Amended by ADR-0025: Slack's events are a path of the general function, handed to
the Slack service before the router.

## Context

Stênio asked for what Jira's Slack app gives its users: their notices in Slack, and a preview of a card
when its link is shared. That needs a Slack app installed in the LET’S workspace, which an incoming
webhook cannot be.

## Decision

- **An organization admin connects the workspace** from **Slack** (the account menu): the panel sends
  them to Slack's consent screen with a `state` signed for them, valid for ten minutes; Slack sends them
  back to the panel (`/slack/conectar`), which hands the code to the API. The API exchanges it for the
  bot's token. One workspace per organization; connecting and disconnecting are audited.
- **The bot token is sealed at rest** with AES-256-GCM. The key (`SLACK_TOKEN_KEY`) also signs the
  OAuth state. It comes from Secrets Manager, beside the client secret and the signing secret.
- **People are found by e-mail** (`users.lookupByEmail`), at most once a day, with no second sign-in.
  Everyone at LET’S is in Slack with their @uselets.com address.
- **Notices:** "JiraIA e Slack" is one more channel in the notification preferences, per kind. The
  notifications consumer writes the notice as before and then sends it as a direct message. A failed
  message is logged and dropped: the notice is already in the panel.
- **Previews:** Slack's events reach their own Lambda, on a route with no authorizer, whose first step
  is to check Slack's signature over the raw body and refuse requests older than five minutes. A shared
  JiraIA link to a card is unfurled; a card key written in a message gets the preview as a reply in its
  thread, at most three per message. Retries Slack sends are acknowledged without acting twice.
- **Without the app** (pendência #10) everything is wired and inert: the page says the app does not
  exist yet, connecting answers 503. Locally, a stand-in installs into "LET’S (local)" and prints.

## Consequences

- Previews show a card to everyone in the channel. Every member of LET’S reads every card (ADR-0012),
  so this shows nothing new to them; a channel shared with another company (Slack Connect) would see
  it too. Restricting previews to internal channels is later work if that becomes a concern.
- A person with a different e-mail in Slack is not reached; the Slack page tells them.
- Slack text is pt-BR, built by the service, like the daily e-mail.
