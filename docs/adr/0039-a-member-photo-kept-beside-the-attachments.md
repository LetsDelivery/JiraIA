# 39. A member's photo, kept beside the attachments and shown by a signed URL

Date: 2026-10-30

## Status

Accepted. Follows escopo-mvp 2.9 (attachments) for how the bytes travel, and ADR-0006 for the panel.

## Context

Everywhere the panel shows a person — a card's assignee, a comment, the history, a notice, the wiki's
owners, the account button — it drew their initials in a circle. People asked to put their photo on
their profile and see it in those places instead.

The API is reached with a bearer token, so an `<img>` cannot ask the API for a photo itself; and the
panel draws most people from lists that carry only `{ id, name }`, from many routes.

## Decision

- **A person sets their own photo in Editar perfil** (Meu perfil), and removes it there; the photo
  changes at once, apart from the dialog's Salvar. Only a person: an agent or a
  service account has none. Setting and removing are audited on the member (`avatar_changed`,
  `avatar_removed`).
- **The panel crops and scales the picture** to a 256 px square (WebP where the browser encodes it,
  JPEG otherwise) before sending it, so the file is a few kilobytes whatever the camera took. The API
  accepts WebP, JPEG or PNG up to 2 MB.
- **The bytes go straight to storage, as an attachment's do**: `POST /me/avatar` announces type and
  size and answers a pre-signed upload URL; `POST /me/avatar/{id}/complete` checks the stored size
  and puts the photo on the member, deleting the previous one; `DELETE /me/avatar` takes it off. The
  object lives in the attachments bucket under `<organization>/avatars/<member>/<id>.<ext>`, a prefix
  of the member's own, so one person's upload can never become another's photo.
- **`/me` and `/members` carry `avatarUrl`**, a GET signed for 12 hours (`FileStore.viewUrl`), or
  `null`. The panel learns each member's photo by id from those lists — read once at start-up and
  cached — and draws every person through one helper: the photo over the initials when there is one.
- **A photo that fails to load is taken off**, leaving the initials underneath, and the members are read
  again for fresh URLs — at most every ten minutes, so a missing file never loops. A signed URL can
  die before its 12 hours when the Lambda's own credentials rotate; this is what covers it.

## Consequences

- No route that lists people changed: the photo is looked up by the person's id the route already
  sends. A place that names a person without an id shows initials.
- The bucket stays private; a photo's URL works for hours and then only by asking the API again.
  Photos are not public links, so emails and Slack messages keep showing names, not faces.
- Presence avatars on a page being edited together (ADR-0009) keep their coloured initial: they come
  from the realtime awareness, not from the members list.
