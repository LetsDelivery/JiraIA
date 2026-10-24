# 32. A space keeps a catalogue of its labels, each with a colour

Date: 2026-10-23

## Status

Accepted. Stage 2 of ADR-0031.

## Context

A card's labels were free text in `cards.labels` (jsonb). A space had no list of its labels: nothing
showed which existed, a label could not be renamed or removed across cards, and a label had no colour
to tell it apart on the board. Stênio chose a catalogue with colours, managed in the space settings.

Labels reach a card by many roads: the card itself, bulk edits, intake forms, automations, agents'
proposals, MCP tools and, later, the Jira import.

## Decision

- **`work.labels`**: one row per name per space, with a colour from the card types' set
  (`typeColorValues`). A card still keeps its labels by name, so the API, the MCP tools, filters and
  automations are unchanged.
- **The catalogue is always complete**: `CardRepository.insert` and `update` register, in the same
  transaction, every name the card carries that its space lacks. Every road above goes through
  them, so no caller has to remember it.
- **A label starts in the colour its name gives** (`colorOf`: the first 7 hex digits of its md5,
  modulo eight colours), computed alike in TypeScript and in SQL (`labelColorSql`), so a name looks the
  same whichever road brought it. Grey is left for names the screen has not read from the catalogue yet.
- **Everyone who reads the space reads its labels; its admins create, colour, rename and remove
  them** (`/spaces/{id}/labels`), audited as `label`. A rename rewrites every card that has the label;
  a name another label already has joins the two, each card keeping it once. A removal takes it off
  every card. Each card changed this way records the change in its own history.
- The migration fills the catalogue from the labels cards already carry.

## Consequences

- A label exists once some card carries it or an admin creates it; nothing removes a label a card
  stops using, so the catalogue may list labels with no cards — the settings show the count.
- Labels are told apart by exact name: "OKR" and "okr" are two labels, as before.
- An intake form's labels join the catalogue when its first answer becomes a card.
