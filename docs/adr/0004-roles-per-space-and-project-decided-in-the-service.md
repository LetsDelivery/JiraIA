# 4. Roles per space and project, read from the database on every request

Date: 2026-10-15

## Status

Accepted. Amended by ADR-0007: there are no projects; roles are held per space only

## Context

uselets carries grants in the Cognito token (`cognito:groups` as `module:level`) and decides in the
service from the claims (uselets ADR-0006). JiraIA's roles are different in kind: a person is admin,
member, guest or reader **per space**, optionally overridden **per project**, across dozens of spaces.
That does not fit in a token, and a role an admin removes must stop working on the next request, not
when a fifteen-minute token expires.

## Decision

The token carries only the identity (Google's `sub` and verified address, ADR-0005). The router proves it (401 without it); the service then
reads the member behind it and their roles from its own schema and decides with the pure matrix in
`packages/authorization`:

- organization admin: everything;
- space `admin`: manages the space, its roles and every project in it;
- `member`: reads and writes every project of the space;
- `guest`: sees only the projects they were added to;
- `reader`: reads every project, writes nothing;
- a project role, when present, replaces the space role inside that project.

A deactivated member is refused everything. A space or project the caller cannot read answers 404,
not 403, so ids cannot be probed. Agents (Etapa 6) are members and go through the same function.
