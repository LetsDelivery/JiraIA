import { cached, forget, invalidate } from '@/lib/cache'
import type { CardFilter } from '@/lib/filters'
import { avatarType } from '@/lib/photo'
import type { Role } from '@/lib/roles'
import type { SpaceType } from '@/lib/space-types'
import { learnFaces } from '@/ui/avatar'

import { api } from './client'
import type { paths } from './schema'

type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type Me = Json<'/work/me', 'get'>
export type Space = Json<'/work/spaces/{spaceId}', 'get'>
export type Member = Json<'/work/members', 'get'>['items'][number]
export type MySpaces = Json<'/work/me/spaces', 'get'>
export type MyCard = Json<'/work/me/cards', 'get'>['items'][number]
export type MyCardTab = NonNullable<paths['/work/me/cards']['get']['parameters']['query']>['tab']
export type SpaceSummary = MySpaces['starred'][number]
export type RoleHolder = Json<'/work/spaces/{spaceId}/members', 'get'>['items'][number]
export type Worklog = Json<'/work/cards/{cardId}/worklogs', 'get'>['items'][number]
export type Workflow = Json<'/work/spaces/{spaceId}/workflow', 'get'>
export type State = Workflow['states'][number]
export type CardType = Workflow['types'][number]
/** How a card type looks: an icon and a colour from the API's closed sets (ADR-0031). */
export type TypeLook = { icon?: CardType['icon']; color?: CardType['color'] }
export type Card = Json<'/work/cards/{cardId}', 'get'>
export type Comment = Json<'/work/cards/{cardId}/comments', 'get'>['items'][number]
export type HistoryEvent = Json<'/work/cards/{cardId}/history', 'get'>['items'][number]
export type Field = Json<'/work/spaces/{spaceId}/fields', 'get'>['items'][number]
export type Label = Json<'/work/spaces/{spaceId}/labels', 'get'>['items'][number]
export type FieldKind = Field['kind']
export type Relations = Json<'/work/cards/{cardId}/relations', 'get'>
export type Link = Relations['links'][number]
export type LinkType = Link['type']
export type CardRef = Relations['children'][number]
export type Attachment = Json<'/work/cards/{cardId}/attachments', 'get'>['items'][number]
export type Watcher = Json<'/work/cards/{cardId}/watchers', 'get'>['items'][number]
export type SavedView = Json<'/work/views/{viewId}', 'get'>
export type SearchResult = Json<'/work/search', 'get'>
export type BulkChanges = NonNullable<
  paths['/work/cards/bulk']['post']['requestBody']
>['content']['application/json']['changes']
export type ViewInput = NonNullable<paths['/work/views']['post']['requestBody']>['content']['application/json']
export type ViewChanges = NonNullable<
  paths['/work/views/{viewId}']['patch']['requestBody']
>['content']['application/json']
export type CardChanges = NonNullable<
  paths['/work/cards/{cardId}']['patch']['requestBody']
>['content']['application/json']

export type SpaceInput = { key: string; name: string; description: string; type: SpaceType; leadId?: string }
export type SpaceChanges = {
  name: string
  description: string
  type: SpaceType
  leadId: string | null
  usesSprints?: boolean
  estimation?: 'tshirt' | 'points'
}

/** `openapi-fetch` answers `{ data, error }`; a screen wants the data or a throw it can explain. */
export const unwrap = async <T>(call: Promise<{ data?: T; error?: unknown }>): Promise<T> => {
  const { data, error } = await call
  if (error !== undefined) {
    throw error
  }
  return data as T
}

/** The bytes, straight to storage at the URL the API signed (2.9, 5.2). */
export const sendFile = async (upload: { url: string; headers: Record<string, string> }, file: Blob): Promise<void> => {
  const sent = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file })
  if (!sent.ok) {
    throw { error: { code: 'DEPENDENCY_UNAVAILABLE', message: `Upload answered ${sent.status}` } }
  }
}

/** Every read of a person's own profile also tells the avatars their photo (ADR-0039). */
const knownFace = (me: Me): Me => {
  learnFaces([me])
  return me
}

/** A cropped photo, announced, sent straight to storage, then confirmed (ADR-0039). */
const sendAvatar = async (photo: Blob): Promise<Me> => {
  const body = { contentType: avatarType(photo.type), size: photo.size }
  const started = await unwrap(api.POST('/work/me/avatar', { body }))
  await sendFile(started.upload, photo)
  return await unwrap(
    api.POST('/work/me/avatar/{avatarId}/complete', { params: { path: { avatarId: started.id } }, body })
  )
}

const listSpaces = (archived: boolean) =>
  unwrap(api.GET('/work/spaces', { params: { query: { archived: archived ? 'true' : 'false' } } }))

/** Reads, cached by key. Every key of a space starts with `space:<id>` so one write clears them all. */
export const read = {
  me: () => cached('me', () => unwrap(api.GET('/work/me')).then(knownFace)),
  mySpaces: () => cached('my-spaces', () => unwrap(api.GET('/work/me/spaces'))),
  members: () =>
    cached('members', () =>
      unwrap(api.GET('/work/members')).then((list) => {
        learnFaces(list.items)
        return list
      })
    ),
  spaces: () => cached('spaces', () => listSpaces(false)),
  archivedSpaces: () => cached('spaces-archived', () => listSpaces(true)),
  space: (spaceId: string) =>
    cached(`space:${spaceId}`, () => unwrap(api.GET('/work/spaces/{spaceId}', { params: { path: { spaceId } } }))),
  workflow: (spaceId: string) =>
    cached(`space:${spaceId}:workflow`, () =>
      unwrap(api.GET('/work/spaces/{spaceId}/workflow', { params: { path: { spaceId } } }))
    ),
  cards: (spaceId: string) =>
    cached(`space:${spaceId}:cards`, () =>
      unwrap(api.GET('/work/spaces/{spaceId}/cards', { params: { path: { spaceId } } }))
    ),
  /** The cards a Lista shows: those done before `doneSince` left out (ADR-0040). */
  recentCards: (spaceId: string, doneSince: string) =>
    cached(`space:${spaceId}:cards:done${doneSince}`, () =>
      unwrap(api.GET('/work/spaces/{spaceId}/cards', { params: { path: { spaceId }, query: { doneSince } } }))
    ),
  /** Under the space's cards: every card write can teach the catalogue a label (ADR-0032). */
  labels: (spaceId: string) =>
    cached(`space:${spaceId}:cards:labels`, () =>
      unwrap(api.GET('/work/spaces/{spaceId}/labels', { params: { path: { spaceId } } }))
    ),
  fields: (spaceId: string) =>
    cached(`space:${spaceId}:fields`, () =>
      unwrap(api.GET('/work/spaces/{spaceId}/fields', { params: { path: { spaceId } } }))
    ),
  /** One space's cards that pass a filter; cached under the space's cards, so every write refreshes it. */
  filteredCards: (spaceId: string, filter: CardFilter) =>
    cached(`space:${spaceId}:cards:${JSON.stringify(filter)}`, () =>
      unwrap(api.POST('/work/cards/search', { body: { filter: { ...filter, spaceIds: [spaceId] }, limit: 500 } }))
    ),
  views: (spaceId: string) =>
    cached(`space:${spaceId}:views`, () => unwrap(api.GET('/work/views', { params: { query: { spaceId } } }))),
  /** Every view the caller may open, across spaces — what the search screen lists. */
  allViews: () => cached('views', () => unwrap(api.GET('/work/views', { params: { query: {} } }))),
  view: (viewId: string) => unwrap(api.GET('/work/views/{viewId}', { params: { path: { viewId } } })),
  viewCards: (viewId: string) => unwrap(api.GET('/work/views/{viewId}/cards', { params: { path: { viewId } } })),
  search: (q: string) => unwrap(api.GET('/work/search', { params: { query: { q, limit: '30' } } })),
  cardByKey: (key: string) => unwrap(api.GET('/work/cards/by-key/{key}', { params: { path: { key } } })),
  /** "Suas tarefas" on Para você: never cached, it changes with every card the caller touches. */
  myCards: (tab: MyCardTab) => unwrap(api.GET('/work/me/cards', { params: { query: { tab } } })),
  spaceRoles: (spaceId: string) =>
    cached(`space:${spaceId}:roles`, () =>
      unwrap(api.GET('/work/spaces/{spaceId}/members', { params: { path: { spaceId } } }))
    )
}

/** The id behind a key, among the spaces the caller can see, active or archived. */
export const spaceIdByKey = async (key: string): Promise<string | undefined> => {
  const [active, archived] = await Promise.all([read.spaces(), read.archivedSpaces()])

  return [...active.items, ...archived.items].find((space) => space.key === key.toUpperCase())?.id
}

/** Writes. Each clears what it changed; the app re-renders what is on screen. */
export const write = {
  createSpace: async (body: SpaceInput) => {
    const space = await unwrap(api.POST('/work/spaces', { body }))
    invalidate('spaces', 'my-spaces')
    return space
  },
  updateSpace: async (spaceId: string, body: SpaceChanges) => {
    await unwrap(api.PATCH('/work/spaces/{spaceId}', { params: { path: { spaceId } }, body }))
    invalidate('spaces', 'my-spaces', `space:${spaceId}`)
  },
  /** Where a card goes when a pull request naming it is merged (ADR-0038); null leaves it where it is. */
  setMergedState: async (spaceId: string, mergedStateId: string | null) => {
    await unwrap(api.PATCH('/work/spaces/{spaceId}', { params: { path: { spaceId } }, body: { mergedStateId } }))
    invalidate('spaces', 'my-spaces', `space:${spaceId}`)
  },
  archiveSpace: async (spaceId: string, archived: boolean) => {
    const path = { params: { path: { spaceId } } }
    await unwrap(
      archived ? api.POST('/work/spaces/{spaceId}/archive', path) : api.POST('/work/spaces/{spaceId}/unarchive', path)
    )
    invalidate('spaces', 'my-spaces', `space:${spaceId}`)
  },
  setSpaceRole: async (spaceId: string, memberId: string, role: Role) => {
    await unwrap(
      api.PUT('/work/spaces/{spaceId}/members/{memberId}', { params: { path: { spaceId, memberId } }, body: { role } })
    )
    invalidate(`space:${spaceId}:roles`)
  },
  removeSpaceRole: async (spaceId: string, memberId: string) => {
    await unwrap(api.DELETE('/work/spaces/{spaceId}/members/{memberId}', { params: { path: { spaceId, memberId } } }))
    invalidate(`space:${spaceId}:roles`)
  },
  createCard: async (
    spaceId: string,
    body: { title: string; stateId?: string; typeId?: string; parentId?: string; sprintId?: string }
  ) => {
    const card = await unwrap(api.POST('/work/spaces/{spaceId}/cards', { params: { path: { spaceId } }, body }))
    invalidate(`space:${spaceId}:cards`, 'spaces')
    return card
  },
  updateCard: async (card: { id: string; spaceId: string }, body: CardChanges) => {
    const updated = await unwrap(api.PATCH('/work/cards/{cardId}', { params: { path: { cardId: card.id } }, body }))
    invalidate(`space:${card.spaceId}:cards`)
    return updated
  },
  moveCard: async (card: { id: string; spaceId: string }, stateId: string, index: number) => {
    await unwrap(
      api.POST('/work/cards/{cardId}/move', { params: { path: { cardId: card.id } }, body: { stateId, index } })
    )
    invalidate(`space:${card.spaceId}:cards`)
  },
  rankInBacklog: async (card: { id: string; spaceId: string }, index: number) => {
    await unwrap(api.POST('/work/cards/{cardId}/backlog', { params: { path: { cardId: card.id } }, body: { index } }))
    invalidate(`space:${card.spaceId}:cards`)
  },
  transferCard: async (card: { id: string; spaceId: string }, spaceId: string) => {
    const moved = await unwrap(
      api.POST('/work/cards/{cardId}/transfer', { params: { path: { cardId: card.id } }, body: { spaceId } })
    )
    invalidate(`space:${card.spaceId}:cards`, `space:${spaceId}:cards`, 'spaces')
    return moved
  },
  comment: (cardId: string, body: string) =>
    unwrap(api.POST('/work/cards/{cardId}/comments', { params: { path: { cardId } }, body: { body } })),
  editComment: (cardId: string, commentId: string, body: string) =>
    unwrap(
      api.PATCH('/work/cards/{cardId}/comments/{commentId}', {
        params: { path: { cardId, commentId } },
        body: { body }
      })
    ),
  react: (cardId: string, commentId: string, emoji: string, on: boolean) =>
    unwrap(
      api.POST('/work/cards/{cardId}/comments/{commentId}/reactions', {
        params: { path: { cardId, commentId } },
        body: { emoji, on }
      })
    ),
  watch: (cardId: string, on: boolean) => {
    const path = { params: { path: { cardId } } }
    return unwrap(on ? api.PUT('/work/cards/{cardId}/watch', path) : api.DELETE('/work/cards/{cardId}/watch', path))
  },
  starCard: (cardId: string, on: boolean) => {
    const path = { params: { path: { cardId } } }
    return unwrap(on ? api.PUT('/work/cards/{cardId}/star', path) : api.DELETE('/work/cards/{cardId}/star', path))
  },
  link: (cardId: string, body: { type: LinkType; direction: 'outward' | 'inward'; key: string }) =>
    unwrap(api.POST('/work/cards/{cardId}/links', { params: { path: { cardId } }, body })),
  unlink: (cardId: string, linkId: string) =>
    unwrap(api.DELETE('/work/cards/{cardId}/links/{linkId}', { params: { path: { cardId, linkId } } })),
  /** Two steps, the bytes straight to storage: ask where, send the file, say it arrived. */
  attach: async (cardId: string, file: File) => {
    const body = { name: file.name, contentType: file.type || 'application/octet-stream', size: file.size }
    const started = await unwrap(api.POST('/work/cards/{cardId}/attachments', { params: { path: { cardId } }, body }))
    await sendFile(started.upload, file)
    return await unwrap(
      api.POST('/work/cards/{cardId}/attachments/{attachmentId}/complete', {
        params: { path: { cardId, attachmentId: started.id } }
      })
    )
  },
  detach: (cardId: string, attachmentId: string) =>
    unwrap(
      api.DELETE('/work/cards/{cardId}/attachments/{attachmentId}', { params: { path: { cardId, attachmentId } } })
    ),
  addField: async (spaceId: string, body: { name: string; kind: FieldKind; options: string[]; typeIds: string[] }) => {
    await unwrap(api.POST('/work/spaces/{spaceId}/fields', { params: { path: { spaceId } }, body }))
    invalidate(`space:${spaceId}:fields`)
  },
  updateField: async (
    spaceId: string,
    fieldId: string,
    body: { name?: string; options?: string[]; typeIds?: string[] }
  ) => {
    await unwrap(api.PATCH('/work/spaces/{spaceId}/fields/{fieldId}', { params: { path: { spaceId, fieldId } }, body }))
    invalidate(`space:${spaceId}:fields`)
  },
  deleteField: async (spaceId: string, fieldId: string) => {
    await unwrap(api.DELETE('/work/spaces/{spaceId}/fields/{fieldId}', { params: { path: { spaceId, fieldId } } }))
    invalidate(`space:${spaceId}:fields`, `space:${spaceId}:cards`)
  },
  addState: async (spaceId: string, name: string, group: string) => {
    const path = { params: { path: { spaceId } } }
    await unwrap(api.POST('/work/spaces/{spaceId}/states', { ...path, body: { name, group: group as State['group'] } }))
    invalidate(`space:${spaceId}:workflow`)
  },
  updateState: async (spaceId: string, stateId: string, body: { name?: string; group?: State['group'] }) => {
    await unwrap(api.PATCH('/work/spaces/{spaceId}/states/{stateId}', { params: { path: { spaceId, stateId } }, body }))
    invalidate(`space:${spaceId}:workflow`)
  },
  orderStates: async (spaceId: string, stateIds: string[]) => {
    await unwrap(api.PUT('/work/spaces/{spaceId}/states/order', { params: { path: { spaceId } }, body: { stateIds } }))
    invalidate(`space:${spaceId}:workflow`)
  },
  deleteState: async (spaceId: string, stateId: string, moveTo?: string) => {
    const query = moveTo ? { moveTo } : {}
    await unwrap(
      api.DELETE('/work/spaces/{spaceId}/states/{stateId}', { params: { path: { spaceId, stateId }, query } })
    )
    invalidate(`space:${spaceId}:workflow`, `space:${spaceId}:cards`)
  },
  addLabel: async (spaceId: string, body: { name: string; color?: Label['color'] }) => {
    await unwrap(api.POST('/work/spaces/{spaceId}/labels', { params: { path: { spaceId } }, body }))
    invalidate(`space:${spaceId}:cards`)
  },
  /** A new name another label has joins the two, on every card (ADR-0032). */
  updateLabel: async (spaceId: string, labelId: string, body: { name?: string; color?: Label['color'] }) => {
    await unwrap(api.PATCH('/work/spaces/{spaceId}/labels/{labelId}', { params: { path: { spaceId, labelId } }, body }))
    invalidate(`space:${spaceId}:cards`)
  },
  deleteLabel: async (spaceId: string, labelId: string) => {
    await unwrap(api.DELETE('/work/spaces/{spaceId}/labels/{labelId}', { params: { path: { spaceId, labelId } } }))
    invalidate(`space:${spaceId}:cards`)
  },
  addType: async (spaceId: string, body: TypeLook & { name: string }) => {
    await unwrap(api.POST('/work/spaces/{spaceId}/types', { params: { path: { spaceId } }, body }))
    invalidate(`space:${spaceId}:workflow`)
  },
  updateType: async (spaceId: string, typeId: string, body: Partial<TypeLook & { name: string }>) => {
    await unwrap(api.PATCH('/work/spaces/{spaceId}/types/{typeId}', { params: { path: { spaceId, typeId } }, body }))
    invalidate(`space:${spaceId}:workflow`)
  },
  orderTypes: async (spaceId: string, typeIds: string[]) => {
    await unwrap(api.PUT('/work/spaces/{spaceId}/types/order', { params: { path: { spaceId } }, body: { typeIds } }))
    invalidate(`space:${spaceId}:workflow`)
  },
  /** Everything of the type becomes of `moveTo` first (ADR-0031). */
  deleteType: async (spaceId: string, typeId: string, moveTo: string) => {
    await unwrap(
      api.DELETE('/work/spaces/{spaceId}/types/{typeId}', { params: { path: { spaceId, typeId }, query: { moveTo } } })
    )
    invalidate(`space:${spaceId}:workflow`, `space:${spaceId}:cards`, `space:${spaceId}:fields`)
  },
  star: async (spaceId: string, starred: boolean) => {
    const path = { params: { path: { spaceId } } }
    await unwrap(
      starred ? api.PUT('/work/spaces/{spaceId}/star', path) : api.DELETE('/work/spaces/{spaceId}/star', path)
    )
    invalidate('my-spaces')
  },
  /** A person's own name and job title (Meu perfil); the frame and every list show the new name. */
  updateProfile: async (body: { name: string; jobTitle: string | null }) => {
    const me = await unwrap(api.PATCH('/work/me', { body }))
    invalidate('me', 'members')
    return me
  },
  setAvatar: async (photo: Blob) => {
    const me = knownFace(await sendAvatar(photo))
    invalidate('me', 'members')
    return me
  },
  removeAvatar: async () => {
    const me = knownFace(await unwrap(api.DELETE('/work/me/avatar')))
    invalidate('me', 'members')
    return me
  },
  invite: async (body: { email: string; name: string; jobTitle: string | null; isOrgAdmin: boolean }) => {
    const member = await unwrap(api.POST('/work/members', { body }))
    invalidate('members')
    return member
  },
  setOrgAdmin: async (memberId: string, isOrgAdmin: boolean) => {
    await unwrap(
      api.POST('/work/members/{memberId}/org-admin', { params: { path: { memberId } }, body: { isOrgAdmin } })
    )
    invalidate('members', 'me')
  },
  /** The same change to many cards (3.8); the API changes all of them or none. */
  bulkEdit: async (spaceId: string, cardIds: string[], changes: BulkChanges) => {
    const edited = await unwrap(api.POST('/work/cards/bulk', { body: { cardIds, changes } }))
    invalidate(`space:${spaceId}:cards`)
    return edited
  },
  createView: async (spaceId: string, body: ViewInput) => {
    const view = await unwrap(api.POST('/work/views', { body }))
    invalidate(`space:${spaceId}:views`, 'views')
    return view
  },
  updateView: async (spaceId: string, viewId: string, body: ViewChanges) => {
    const view = await unwrap(api.PATCH('/work/views/{viewId}', { params: { path: { viewId } }, body }))
    invalidate(`space:${spaceId}:views`, 'views')
    return view
  },
  deleteView: async (spaceId: string, viewId: string) => {
    await unwrap(api.DELETE('/work/views/{viewId}', { params: { path: { viewId } } }))
    invalidate(`space:${spaceId}:views`, 'views')
  },
  deactivate: async (memberId: string) => {
    await unwrap(api.POST('/work/members/{memberId}/deactivate', { params: { path: { memberId } } }))
    invalidate('members')
  }
}

/**
 * Entering a space: reading it is what records the visit on the API, so it is read fresh, and the
 * caller's recent list is refreshed after it.
 */
export const visitSpace = async (spaceId: string): Promise<void> => {
  forget(`space:${spaceId}`)
  await read.space(spaceId)
  invalidate('my-spaces')
}
