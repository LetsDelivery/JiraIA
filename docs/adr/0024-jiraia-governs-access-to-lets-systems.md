# 24. JiraIA governs access to LET’S systems: a catalog, requests with a reason, SLAs and reviews

Date: 2026-10-21

## Status

Proposed. Adds a module; leaves ADR-0012 (access to JiraIA's own spaces) as it is.

## Context

Legal asked that JiraIA be where LET’S manages access control and privileges, to meet ISO/IEC
27001:2022 Annex A — 5.15 access control, 5.16 identity management, 5.18 access rights, 8.2
privileged access rights, 8.3 information access restriction — and ISO/IEC 27701:2019 for who reaches
personal data. Today access to AWS, Google Workspace, GitHub, Slack and the rest is asked for in chat
and granted by hand, with no record of why, who approved, when it was done, or when it was removed.

Four requirements: role-based control, least access by default, a trail of every grant with its
reason, and an SLA for granting and for removing.

Stênio decided (2026-10-21): the module covers every LET’S system, JiraIA included; grants and
removals are carried out by hand in the target system and recorded with evidence (no provisioning
connectors yet); the reader floor of ADR-0012 stays for spaces — a documented business exception —
while the access module itself is closed; the SLAs are the defaults below, configurable per system.

## Decision

**A catalog of systems and profiles.** A *system* is something LET’S grants access to. Each has one
or more *system owners*, who approve, and *operators*, who carry out. A *profile* is a named set of
rights in one system ("AWS — leitura produção"), marked **standard** or **privileged**. Profiles are
the roles of role-based control: access is never granted outside a profile. A system says whether it
holds personal data (27701).

**Least access by default.** A new person holds no profile. A profile reaches a person only through an
approved request — or, for profiles an organization admin marks as the baseline of a group, through a
pre-approved request opened when the person joins that group (it still waits for an operator).
Privileged profiles are time-bound: every grant carries an expiry, 90 days at most, and expires into
a removal request.

**Every change is a request with a reason.** An *entitlement request* asks to grant or to remove one
profile for one person, with a mandatory reason. Its life:
`requested → approved | declined → done | cancelled`. A grant needs a system owner's approval; a
person never approves nor carries out a request that names them, as requester or as beneficiary. An
operator closes it as **done** with evidence (text, optionally a
file). Only then does the *entitlement* exist — or end. Requests and entitlements are never deleted;
each step is an audit event in the same transaction, with actor, time and reason.

**SLAs, measured from the record.** Defaults, per system:

| Clock | Starts | Target |
|---|---|---|
| Grant | approval | 2 business days |
| Removal on request or change of function | request | 1 business day |
| Removal on departure | deactivation of the person | 24 hours |

Business days follow the São Paulo calendar: the national holidays the law lists are computed
(Good Friday from Easter; Carnival and Corpus Christi are optional days off and count as business days), and an organization admin adds LET’S's own days to a table;
deadlines are stored as UTC instants. A request past its deadline is **overdue**: its
operators and owners are notified, and it counts against the system's compliance.

**Departure removes everything.** Deactivating a person (ADR-0012) opens, in the same transaction, a
removal request for each entitlement they hold, already approved, on the 24-hour clock, and cancels
their grants still waiting. Removals the platform opens — departure, expiry — are requested by
"Automação", so no operator is barred from carrying one out for having asked for it.

**Periodic review.** Each quarter for privileged profiles and each semester for the rest, system owners
confirm or remove every entitlement of their systems. Unanswered items after the review window become
removal requests.

**The module is closed.** Unlike spaces, it has no reader floor. A person sees their own requests and
entitlements; owners and operators see their systems; *access auditors* (Legal, Security), named by an
organization admin, read everything and export it. Authorization is decided in the service, as
ADR-0004 says.

## Consequences

- JiraIA becomes the evidence for an ISO audit: who holds what, since when, why, approved by whom,
  carried out when, and how long removals took.
- Records are only as true as the operators' hand. Drift between JiraIA and a system is caught by the
  periodic review; provisioning connectors (Google Workspace, AWS IAM Identity Center, GitHub) can
  later close requests automatically behind the same states.
- Access already held before go-live is loaded once from an inventory, as entitlements with the reason
  "inventário inicial" and the importer as actor, and enters the first review.
- The reader floor on spaces remains a known exception to least access; ADR-0012's per-space switch
  (escopo-mvp 1.8) is the path to close a sensitive space.
- People without a JiraIA account (contractors, partners) are out of scope; they need an identity
  first.
