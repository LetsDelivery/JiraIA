# 21. MCP clients connect by OAuth, as an agent acting for the person who allowed it

Date: 2026-10-19

## Status

Accepted. Etapa 6c. Completes ADR-0020: a token pasted into the client stays possible, and stops being
the only way. Superseded in part by ADR-0022: the application acts as the person, not as an agent;
there is no agent member per application and no `onBehalfOf`.

## Context

Stênio wants connecting a platform to JiraIA to need no technical step: paste the address (or click
"connect"), sign in with Google, allow. That is the authorization flow of the MCP specification —
OAuth 2.1 with PKCE, discovery by well-known documents, and clients registering themselves — which
Claude and the other MCP clients already run. He decided (2026-10-19) that what connects is not the
person: it is an agent, acting for the person who allowed it, and never seeing more than they do.

## Decision

- **`work` is both the protected resource and the authorization server.** The MCP endpoint answers
  401 with `WWW-Authenticate: Bearer resource_metadata="…"`; `/.well-known/oauth-protected-resource`
  names the issuer, and `/.well-known/oauth-authorization-server` lists the endpoints: authorization
  (a page of the panel), token, and registration. The issuer is `API_URL` — the API's public address.
- **Clients register themselves** (RFC 7591, `POST /oauth/register`, no authentication): a name and
  redirect addresses, which must be `https` or a loopback `http` address. They are public clients: no
  secret, PKCE with S256 always.
- **Consent is a page of the panel** (`/oauth/autorizar`), behind the same Google sign-in. It names the
  application and where it sends the person back, and says what it may do: read what they read, and
  propose changes that a person approves. Allowing issues a code bound to the person, the client, the
  redirect, the PKCE challenge and the resource, valid for ten minutes, used once.
- **An application is an agent member.** On first consent the client becomes an agent named after it
  ("Minha Plataforma (app)"), with no role of its own — it reads what every member reads (ADR-0012) and
  writes only by proposals (ADR-0019). Each consent is a **connection**: that agent, for that person.
- **Tokens are opaque and stored as hashes**: an access token for an hour (`jioa_…`), a refresh token for
  30 days (`jior_…`) that rotates on every use; a refresh token used twice revokes the connection. The
  caller a token stands for is the agent, with the person in `onBehalfOf`.
- **A delegated token opens only routes that say they take one** — today the MCP endpoint. It stops
  when the person revokes the connection (**Meu perfil → Aplicativos conectados**), is deactivated, or
  the agent is.
- **Proposals carry the person** (`onBehalfOfId`): the panel shows "Minha Plataforma, por Ana"; the
  person is told when their proposal is decided; through the connection the agent lists and withdraws
  only the proposals made for that person.

## Consequences

- Anyone can register a client, as the protocol expects. A client only becomes an agent when a person
  allows it, and the consent page shows the address it will send them to — what tells an honest
  application from one wearing another's name.
- No client metadata documents (`client_id` as a URL) yet; registration covers the clients in use.
- Rate limits on registration and the token endpoint are later work, with the API's other limits.
