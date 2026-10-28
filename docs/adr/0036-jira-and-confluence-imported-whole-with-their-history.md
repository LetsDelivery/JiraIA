# 36. Jira and Confluence are imported whole, with their history, by a re-runnable importer

Date: 2026-10-28

## Status

Proposed. Spec: `docs/produto/escopo-mvp.md` §7 (7.1–7.6), `docs/produto/plano.md` (waves and cutover),
`docs/produto/arquitetura.md` ("Migração"). Builds on ADR-0007 (a space keeps Jira's key), ADR-0011
(Draw's tree), ADR-0014 (events from the audit trail) and ADR-0022 (`via`).

## Context

JiraIA replaces Jira and Confluence. Stênio decided (2026-10-28) that nothing is left behind: every
card with its comments, attachments, worklogs, links, labels and the full history of its changes; every
Confluence page with its tree, files, comments and versions. The requirement is that no trace of who did
what, and when, is lost.

Inventory of 2026-10-28, through the Atlassian connector:

- **Jira:** 14 projects, 4,795 cards (both the projects' own count and JQL agree): TEC 3,230,
  MARKETING 620, PRD 270, ORQ 198, TASK 121, PERF 119, JUR 115, SDDEC 38, REQ 37, OLS 22, MS 17, LP 4,
  FIB 2, GB 2. All are team-managed; FIB, GB, LP and MS are Product Discovery, SDDEC is a software
  project used as a service desk. 535 cards have attachments, 447 have links, 1,602 have a parent,
  2,323 were in a sprint, 18 have worklogs; none uses an issue security level. The oldest card is from
  2024-05-21.
- **Keys have moved.** TEC-216 was `LD-17` in "LET'S Delivery - TASKS" until 2025-11-12; the `LD`
  project no longer appears and returns no cards. Keys skip numbers (TEC's highest is 3,538 for 3,230
  cards; MARKETING 632/620, PRD 283/270, ORQ 208/198): moved and deleted cards. Each move is a `Key`
  item in the card's changelog. `LD` was discontinued and is not imported; its keys survive only as
  aliases of the cards that left it.
- **People:** the changelog shows e-mails on three domains (`lets.delivery`, `parceiro.lets.delivery`,
  `uselets.com`), hides others behind profile privacy, and carries deactivated accounts as authors.
- **Confluence:** 8 team spaces migrate — Tech (BA), Produto, LET'S Delivery (LD), CS, CSB, DEMO, UX
  and PERF (PERF is a collaboration space, CS a knowledge base). The LD space stays although the Jira
  project with the same key does not. They hold 131 pages (BA 78, Produto 37,
  LD 5, CSB 3, DEMO 3, UX 2, PERF 2, CS 1), 2 live docs, 1 archived page, **65 whiteboards** (Produto
  54, BA 9, CS 1, LD 1), 45 folders, 1 database (BA, message templates), 6 embeds (links to outside
  content: CS 4, BA 2) and no blog posts; about 199 attachments (mostly PNG; SQL, PDF, XLSX, MOV, one
  draw.io). Bodies carry mentions (214), status lozenges (117), smart links (98, several to Jira
  cards), emoji and dates. The connector reads a whiteboard as SVG, which is the fallback image.
- **Out for now:** the 81 personal spaces (and 42 archived ones). Nothing goes to LET’S Wiki; the "Publicar na Wiki" shortcut
  (ADR-0033) moves pages later, one by one.

The connector acts as the person who authorized it — it sees only what they see — and cannot download
attachments. It is fit for inventory and reconciliation, not for the import.

## Decision

- **The importer reads Atlassian's REST APIs as Stênio, with a token scoped to reading only.** He is
  Jira and Confluence admin but not organization admin, and creating a service account needs one; a
  scoped token cannot write whatever the account could. The token lives in Secrets Manager, with an
  expiry after the cutover. It sees what Stênio sees: the dry run's counts against the inventory show
  any project, space or restricted page he lacks, and he grants himself read access before the cutover.
  A service account can replace the token later without changing the importer. Atlassian's types are wrapped
  behind the importer's own (`AtlassianSource`), faked in tests (`InMemoryAtlassian`).
- **Before anything is converted, the source is kept raw.** Each issue, page, comment and changelog is
  written as fetched to S3 (`import/<run>/<kind>/<id>.json`), and the site's own backup and the spaces'
  XML exports are kept beside it. Whatever has no home in JiraIA is still there, and so is the answer to
  "what did Jira say".
- **One mapping table, `import_refs`** (source, source id, entity type, JiraIA id, content hash, run,
  imported at), makes every run an upsert: running twice changes nothing, a changed source updates its
  row, and the cutover's delta (`updated >= last run`) is the same code as the first run. It also
  answers old links (7.6).
- **Keys are kept**: `REQ-123` is card 123 of space `REQ`; a space's next number starts after the
  highest imported. Every earlier key in the changelog (`LD-17` for `TEC-216`) goes to
  `card_key_aliases`, so old links still resolve.
- **People are matched by corporate e-mail** (7.3). Whoever is active in Atlassian becomes a member,
  invited if they never signed in. Whoever left is not a member: their name, as Atlassian still
  returns it with `active: false`, is written on the card, comment or event they authored — never
  "anonymous". Atlassian may hide e-mails behind profile privacy; the export of active users is the
  source of the mapping, and an active account with no e-mail is listed for a decision, not guessed. One person often has
  several Atlassian accounts (`parceiro.lets.delivery`, `lets.delivery`, `uselets.com`): a reviewed
  table merges them into one member, keyed by the `uselets.com` address the person signs in with
  (ADR-0005).
- **History becomes audit events, with the original date and author** (`occurred_at`, `actor_id`),
  `via: 'Jira'` or `via: 'Confluence'`. They are written already dispatched (`dispatched_at` set at
  import), so no notice, e-mail, webhook or Slack message leaves for the past; reports and dashboards
  that read the trail (ADR-0016) see it whole. The import itself is audited once per run.
- **Everything a card had comes with it**: description and comments in Markdown (ADR-0030) with their
  authors and dates, attachments to object storage, typed links, labels, sprints, parents, custom fields
  (Product Discovery's included) into `custom_fields`. **Worklogs**, outside the MVP's scope, are kept in
  a table of their own (`card_worklogs`) and shown read-only on the card; tracking time is not added.
- **Confluence goes to Draw** (ADR-0011): a space per Confluence space, folders as folders, pages as
  pages, live docs as pages, whiteboards as whiteboards with the exported image when their shapes
  cannot be read, the database as a table page, embeds as links to their target. Every
  version becomes a `content_versions` row with its author and date; footer comments become threads,
  inline comments anchored ones (`anchor_id`, `quote`), resolved ones resolved. Mentions name members, a
  link to a migrated page or card points to it in JiraIA, and a macro with no equivalent is kept as a
  marked block that links to the original.
- **A run ends with a reconciliation report** (7.4): per project and per space, counts on both sides
  (cards, comments, attachments and their bytes, links, worklogs, changes, pages, versions, files) and a
  hash of titles and bodies. A difference is listed by id; the cutover waits for zero, or for a
  difference each area signed off.
- **The cutover**: a full rehearsal in homologation, sampled by the areas; then a short freeze, the
  delta, and Jira and Confluence read-only for 30 days, reopened if the plan to go back is needed
  (`plano.md`). Licences are cancelled only after that.

## Consequences

- Nothing a person did in Jira or Confluence is lost to JiraIA or to the archive: what JiraIA cannot
  show yet is in the raw copy and can be imported later from it, without asking Atlassian again.
- The importer can be run as often as needed before the cutover; each run is a rehearsal.
- The audit trail grows by the whole history of every card; its indexes are by entity and by space, so
  a card's timeline stays one read.
- Worklogs add one table and one read-only block on the card, outside the MVP's scope, so that nothing
  is lost.
- The importer depends on Stênio's account and its token, outside the repository; the steps are in
  `docs/migracao-atlassian-acesso.md`. If he leaves or loses access, the token stops and a service
  account takes its place. The
  connector's newer server (Atlassian MCP) reads Jira; the older one still answers 403.
- Comment counts, custom field definitions and archived or trashed projects (`LD`) cannot be read
  through the connector; the first dry run measures them.
- Product Discovery and service desk projects are imported with their data; how they are worked in
  JiraIA is still wave 2 (`plano.md`).
