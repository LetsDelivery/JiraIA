# 13. A card names the group that owns it, shown on screen as its squad

Date: 2026-10-17

## Status

Accepted. Builds on ADR-0012 (groups).

## Context

At Let’s, a Jira issue carries a "Squad" field — "Squad Max (OMS, TMS)" — saying which team owns the
work. JiraIA already has that team as a **Group** (ADR-0012), kept by hand, with its members. A custom
field per space would repeat the list of teams in every space, drift from the groups, and give
reports nothing to join on.

Stênio decided (2026-10-17) that the card's squad is a link to a group, and that the card detail shows
it as its own section, "Squad", right under the description.

## Decision

- `work.cards.group_id` references `work.groups.id`, nullable. `PATCH /cards/{cardId}` takes
  `groupId` (`null` clears it); the card view carries `group: { id, name } | null`.
- The service accepts only a group of the caller's organization that is not deleted
  (`CardRules.activeGroup`); any other id is a `NotFoundException` naming it.
- The change is a `groupId` line of the card's history, like any other field, in the same transaction.
- Moving a card to another space keeps its group: groups belong to the organization, not to a space.
- In code and in the glossary the word stays **group**. Only the screen says "Squad", the word people
  at Let’s already use for the team that owns a card.

## Consequences

- Filters, lanes and reports can group cards by team later without a migration.
- A group is deleted softly (`deleted_at`), so a card keeps its link and keeps showing the group's
  name; the card's history, which names groups from the live list, says "grupo removido". Whether
  deleting a group should clear it from its cards is left to a later stage.
