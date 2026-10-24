# 31. A space's settings live in one place; card types have a look and are managed there

Date: 2026-10-23

## Status

Accepted. Stage 1 of 2: the settings area and card types. Stage 2 adds a label catalogue with colours.

## Context

What configures a space was spread over the panel: "Editar" in the space header (name, lead, sprints,
estimate), "Configurar fluxo" and "Campos" in the board's toolbar, and Formulários, Automações,
Webhooks, Agentes and Pessoas e papéis as tabs beside Board, Lista and Backlog. Card types (escopo-mvp
2.1) came from the space's template and could not be changed: no screen, no route, and a type was only
a name. Tecnologia's Jira space has Bug, Tarefa, História, Spike, Protótipo and Data, each told apart
by its icon and colour.

## Decision

- **One "Configurações" per space**, at `/espacos/{key}/configuracoes/{section}`, reached by a gear in
  the space header. Sections: Geral, Tipos de card, Fluxo, Campos, Formulários, Automações, Webhooks,
  Agentes, Pessoas e papéis. The space's tabs keep only the work: Board, Lista, Backlog, Relatórios.
- **Everyone who reads the space sees its settings**, read-only unless they manage it — the reader
  floor of ADR-0012 applies to how a space is set up, too. Webhooks and Agentes stay with the space's
  admins, as before.
- **The old `?aba=` addresses of the moved tabs redirect** to their section, so links in e-mails,
  notifications and Slack keep working.
- **A card type has an icon and a colour** (`card_types.icon`, `card_types.color`), each from a closed
  set of names (`cards/card-type.schemas.ts`); the panel draws them with its Tabler icons and with
  tones defined for both themes. No pictures or markup travel through the API. Existing and new types
  take the look their name suggests (`lookOf`: Bug → bug, red); any other name starts plain.
- **Space admins add, rename, restyle, reorder and remove types** (`/spaces/{id}/types`), audited as
  `card_type`. Removing a type always names another (`moveTo`): its cards and intake forms move there,
  and the fields, automations and saved views that name it are rewritten to name the other — nothing
  is left pointing at a type that is gone, and a field limited to the removed type does not silently
  start showing on every type. The last type of a space stays.

## Consequences

- A type's name is no longer fixed by the template, so code must not find types by name. The one
  place that does — the subtask composer looking for "Subtarefa" — keeps working while the name
  exists, and falls back to the first type otherwise.
- The Jira import (Etapa 8) maps Jira's issue types onto types with a look from `lookOf`, or plain.
- Stage 2 (ADR-0032) adds a catalogue of labels per space with a colour, managed in the same settings.
