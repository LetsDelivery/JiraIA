# 12. One access model for both products: everyone reads, roles to write, groups, and access requests

Date: 2026-10-16

## Status

Accepted. Amends ADR-0004 (roles were held by people only, and a space was closed to anyone without
one), ADR-0007 and ADR-0009 (the guest role, which saw only its own cards and no pages, is gone) and
ADR-0011 (every member created and edited Let’s Draw AI spaces).

## Context

Roles were given one person and one space at a time. With the nine projects of the cut-over and every
area's people, that is hundreds of grants by hand, repeated for each new hire — who, until then, saw
nothing. Let’s Draw AI went the other way: everyone edited everything, with no way to keep a space's
pages to its team. And the stages ahead — forms, automations, notifications, agents — all need one
answer to "who may do this here".

Stênio decided (2026-10-16): every space of both products is visible to the whole of Let’s; editing
needs a role, and whoever lacks one asks for it from inside the product. Only organization admins and
space managers create spaces, in both products. There is no guest: a person signs in with their
@uselets address and is given access and roles afterwards. Groups are kept by hand for now.

## Decision

**Effective role = the strongest of three sources**, in both products, decided in the service:

1. a role given to the member directly;
2. the roles given to groups the member belongs to;
3. **reader**, for every active member of the organization — the space is visible to all of Let’s.

Ranked admin > member > reader. An organization admin is admin everywhere. **The guest role is
removed**: with reader as the floor it narrowed nothing, and the MVP admits only @uselets accounts.
Rows that held it are dropped by the migration, which leaves those people readers.

- **Groups** (`groups`, `group_members`) belong to the organization: an organization admin creates,
  renames and deletes them and names their owners; owners add and remove members. Kept by hand; a sync
  with Google Groups can come later behind the same tables.
- **Grants to groups** sit beside the grants to people: `space_group_roles` for JiraIA, and for Let’s
  Draw AI `draw_space_members` and `draw_space_group_roles`. Whoever creates a Draw space becomes its
  admin, as in JiraIA.
- **Space managers** (`members.is_space_manager`, set by an organization admin) create spaces of both
  products, as organization admins do. Whoever creates a space becomes its first admin.
- **Access requests** (`access_requests`): a member who may read but not write asks, with an optional
  message; the space's admins approve — the member becomes a member of the space — or decline. One
  open request per member and space. Until notifications arrive (Etapa 5), requests wait in the
  space's "Pessoas e papéis".
- **Why someone has access** is answered by the API, source by source (`GET …/access/{memberId}`), so
  the panel shows it rather than guessing.

Every grant, every change to a group, every request and decision is an audit event.

## Consequences

- A new person reads every space on their first sign-in, and asks for what they need to change.
- Listings no longer filter spaces by role: every space of the organization is listed to every member.
- Closing a space to part of Let’s (escopo-mvp 1.8, O2) becomes a per-space switch that removes the
  reader floor — the sources stay the same.
- No permission schemes, per-field or per-transition rules, or per-card security: none is in the MVP,
  and the four roles plus groups cover what the areas run today.
