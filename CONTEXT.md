# JiraIA

LET'S internal platform for work management and knowledge, native in AI: people and agents work on
the same board. It replaces Jira and Confluence. Product specs: `docs/produto/`.

## Language

**Organization**:
The company. One per deployment; created once by `bootstrapOrganization`.
_Avoid_: tenant, company, workspace

**Member**:
Anyone who holds roles and appears in history — a person or an agent.
_Avoid_: user, account

**Person**:
A member who signs in with a one-time code to their corporate email.
_Avoid_: human, user

**Job title**:
What a person does at LET'S ("Gerente de produto"), shown beside their name — never inside it. The
person sets it on Meu perfil; an admin may give one when inviting. Screen word: "Cargo".
_Avoid_: role (that is a space role), position, department

**Agent**:
A member that is an AI. Proposes changes that a person approves (Etapa 6).
_Avoid_: bot, assistant

**Organization admin**:
A member who invites and deactivates people and creates spaces. Holds every role everywhere.
_Avoid_: superuser, root

**Space**:
The unit of work, as Jira now calls it: a key, a type, a lead, its cards and its pages (ADR-0007).
_Avoid_: project, workspace, board

**Key**:
The short prefix of a space's card numbers (`REQ` in `REQ-123`) and of its address (`/espacos/REQ`).
Unique, permanent, preserved from Jira.
_Avoid_: code, prefix, slug

**Space type**:
What kind of work a space holds: software, business, product discovery or service desk.

**Lead**:
The member responsible for a space. One per space.
_Avoid_: owner, manager

**Card**:
One unit of work in a space, numbered `KEY-N` (Etapa 2).
_Avoid_: issue, ticket, task (a task is one card type)

**Page**:
Content of a Draw space written in the rich editor, edited together (Etapa 4).
_Avoid_: doc, wiki page, article

**Role**:
What a member may do in a space: admin, member or reader (ADR-0012).
_Avoid_: permission, grant, access level

**Reader**:
A space role that reads everything in the space and writes nothing — what every member of the
organization holds on every space, in both products (ADR-0012).
_Avoid_: guest, viewer (there is no guest role: everyone at LET’S reads)

**Effective role**:
The strongest of a member's roles on a space: given to them, given to a group they are in, and the
reader every member holds (ADR-0012).
_Avoid_: permission level, access

**Group**:
Members of the organization gathered by hand — an area or a team — so a role given to it reaches all
of them. An organization admin creates it and names its owners; owners add and remove members
(ADR-0012).
_Avoid_: team (Jira's "Equipes"), squad, role

**Space manager**:
A member an organization admin allows to create spaces, in JiraIA and in LET’S Draw AI (ADR-0012).
_Avoid_: project admin, creator

**Access request**:
A reader's request to edit a space, with an optional message; the space's admins approve it — the
member becomes a member of the space — or decline it (ADR-0012).
_Avoid_: invite, permission request, ticket

**Proposal**:
A change an autonomous agent wants to make in one space — one or more items, with a reason — applied
only when a person who writes the space approves it, whole, in part or adjusted; applied as the agent,
and revertible (ADR-0019). A person's assistant does not propose: it writes as the person (ADR-0022).
_Avoid_: suggestion, draft, pull request

**Proposal item**:
One change of a proposal: a new card, field changes, a comment or a link. A field change keeps the
values the agent saw, so a card that moved on since reads as stale (ADR-0019).
_Avoid_: change set, step

**Proposal policy**:
What a space's admins let agents apply there without approval — some kinds of item, nothing by
default (ADR-0019).
_Avoid_: auto-approve, execute mode setting

**Application**:
A program a person connects to JiraIA by OAuth — an MCP client such as an assistant. It acts as that
person, with their roles, and the trail marks what it did "via" it (ADR-0022).
_Avoid_: integration (a service account), app user, bot

**Connection**:
An application acting as one person, from their consent until either ends it; every OAuth token
belongs to one (ADR-0021, ADR-0022).
_Avoid_: session, grant, link

**Audit event**:
One recorded write: actor, entity, action, and each changed field's before and after.
_Avoid_: log, activity

**Filter**:
The structured equivalent of a JQL query: conditions on a card's fields, all of which must hold
(ADR-0008).
_Avoid_: query, JQL, search string

**Saved view**:
A filter kept with a name, an order and a layout — personal, or shared with a space (Etapa 3).
_Avoid_: saved filter, saved search, board (a board is one layout)

**Version**:
A page as it was at one moment — numbered, with its author — compared with the page now or restored
(Etapa 4, ADR-0009).
_Avoid_: revision, snapshot, history (a card's history is its audit events)

**LET’S Draw AI**:
The product for pages and whiteboards — what Confluence is to Jira — under `/draw`, beside JiraIA's
cards (ADR-0010).
_Avoid_: wiki, Confluence, docs

**Draw space**:
A space of LET’S Draw AI, created as a team needs one — not a JiraIA space (ADR-0011). The whole
organization reads it; its members and admins edit it. Organization admins and space managers create
it, and its creator is its first admin (ADR-0012).
_Avoid_: wiki space, workspace

**Content**:
What a Draw space holds, as a tree: a folder, a page or a whiteboard (ADR-0011).
_Avoid_: item, node, document (a document is a page's or a whiteboard's Yjs state)

**Whiteboard**:
Content drawn as notes, shapes, frames and arrows, edited together like a page (ADR-0011).
_Avoid_: board (a board is JiraIA's kanban), canvas

**Draft**:
What "Criar com IA" proposes from a conversation — a page or a whiteboard not yet created (ADR-0011).
_Avoid_: proposal (an agent's change, Etapa 6), suggestion

## LET’S Wiki (ADR-0033, proposed)

**LET’S Wiki**:
The product for what is true about LET’S and its customers — official pages, each with an owner and a
review date — under `/wiki`, beside JiraIA and LET’S Draw AI. Draw is where people draft; the wiki is
what they trust.
_Avoid_: knowledge base, docs, Confluence

**Collection**:
A subject of the wiki (Empresa, Operação, Clientes…) holding its pages, created in the wiki. It
shares the content engine with Draw's spaces but is never seen in Draw. Its admins are its owners.
Screen word: "Coleção".
_Avoid_: wiki space, category, section

**Official page**:
A wiki page its collection's owners stand behind, until its review date. Otherwise a wiki page is a
draft. Screen words: "Oficial", "Rascunho".
_Avoid_: verified, approved, published page

**Review date**:
Until when an official page holds; its owner confirms it to move it on. Past it, the page stays
official and shows "Revisão vencida".
_Avoid_: expiry, validity (a privileged entitlement's), deadline

**Customer**:
A company that hires LET’S. Its knowledge lives in the Clientes collection; its contracts and prices
stay in Google Drive; no personal data is written about anyone.
_Avoid_: client (an OAuth client), account, consumer

## Access governance (ADR-0024)

**System**:
Something LET’S grants access to — AWS, Google Workspace, GitHub, JiraIA itself — with its owners,
operators and SLAs. Says whether it holds personal data. Screen word: "Sistema".
_Avoid_: application (an OAuth client), integration, tool

**Profile**:
A named set of rights in one system ("AWS — leitura produção"), standard or privileged. Access exists
only through a profile. Screen word: "Perfil".
_Avoid_: role (a space role), permission, group

**Privileged profile**:
A profile that administers a system or reaches beyond one person's work. Every grant of it expires,
90 days at most.
_Avoid_: admin access, elevated role

**Entitlement**:
A person holding a profile, from the request that granted it to the one that removed it. Never
deleted. Screen word: "Acesso".
_Avoid_: grant, permission, access (alone)

**Entitlement request**:
A request to grant or remove one profile for one person, with a mandatory reason: requested,
approved or declined, then done with evidence or cancelled. Screen word: "Solicitação".
_Avoid_: access request (a reader asking to edit a space), ticket

**System owner**:
Approves requests and reviews the entitlements of a system.
_Avoid_: lead (a space's), approver, manager

**Operator**:
Carries out approved requests in the system and records the evidence.
_Avoid_: admin, executor, provisioner

**Access auditor**:
Reads and exports everything in access governance; never approves or carries out.
_Avoid_: compliance user, viewer

**Access review**:
A periodic campaign in which system owners confirm or remove each entitlement of their systems.
_Avoid_: recertification, audit
