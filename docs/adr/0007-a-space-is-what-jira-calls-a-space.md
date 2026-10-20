# 7. A space is what Jira calls a space: one level, with a key, a type and a lead

Date: 2026-10-15

## Status

Accepted. Supersedes the two-level model of the first product spec (Organização → Espaço → Projeto)
and the project roles of ADR-0004.

## Context

The spec modelled an area of the company as a space holding projects, each project carrying a key
(REQ, PRD) and, later, the cards. Jira itself renamed its projects to *spaces* in 2025: a Jira space
has a key, a type, a lead and the work items. The management screen Stênio asked for — name, key,
type, lead, last ticket update, URL — is Jira's own space list, and the areas already speak that
language. Keeping two levels would mean explaining to every area that a "space" here is a folder of
what a "space" is in Jira.

No card existed yet and nothing was deployed, so this was the cheapest moment to change.

## Decision

One level. A **space** has a key (unique, permanent, preserved by the Jira migration), a name, a
description, a type (`software`, `business`, `product_discovery`, `service_desk`), a lead (a member;
the creator unless someone else is named) and, from Etapa 2, the cards — `REQ-123` belongs to the
space REQ. The `projects` and `project_members` tables, routes and screens are gone.

- Roles are held per space only: admin manages the space, member reads and writes its cards, reader
  reads, guest reads the cards they are involved in (narrowed by the card service in Etapa 2).
- The panel addresses a space by its key: `/espacos/REQ`. Keys never change, so the link is stable.
- `lastCardActivityAt` is kept on the space and moved by card writes, so the list can show the last
  ticket update without scanning cards.
- Only organization admins create spaces.

## Consequences

- The Jira migration is one to one: a Jira space becomes a JiraIA space with the same key.
- Grouping spaces by area (Produto owns REQ and PRD) is no longer modelled. If the areas ask for it,
  it returns as a label or a category on the space, not as a level above it.
