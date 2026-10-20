import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/**
 * Who may do what (ADR-0012): groups, the roles given on a space to people and to groups, why someone
 * holds the access they do, and requests to edit. The same calls serve both products.
 */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type Product = 'jiraia' | 'draw'
export type Group = Json<'/work/groups/{groupId}', 'get'>
export type Grants = Json<'/work/spaces/{spaceId}/grants', 'get'>
export type AccessView = Json<'/work/spaces/{spaceId}/access/{memberId}', 'get'>
export type AccessSource = AccessView['sources'][number]
export type AccessRequest = Json<'/work/access-requests', 'get'>['items'][number]
export type GrantRole = 'admin' | 'member' | 'reader'

const space = (spaceId: string) => ({ params: { path: { spaceId } } })
const onGroup = (spaceId: string, groupId: string) => ({ params: { path: { spaceId, groupId } } })
const onMember = (spaceId: string, memberId: string) => ({ params: { path: { spaceId, memberId } } })

/** Everything about a space's access is cached under `access:<product>:<space>`, cleared together. */
const key = (product: Product, spaceId: string, what: string) => `access:${product}:${spaceId}:${what}`

const _grants = (product: Product, spaceId: string) =>
  unwrap(
    product === 'jiraia'
      ? api.GET('/work/spaces/{spaceId}/grants', space(spaceId))
      : api.GET('/work/draw/spaces/{spaceId}/grants', space(spaceId))
  )

const _access = (product: Product, spaceId: string, memberId: string) =>
  unwrap(
    product === 'jiraia'
      ? api.GET('/work/spaces/{spaceId}/access/{memberId}', onMember(spaceId, memberId))
      : api.GET('/work/draw/spaces/{spaceId}/access/{memberId}', onMember(spaceId, memberId))
  )

export const accessRead = {
  groups: () => cached('groups', () => unwrap(api.GET('/work/groups'))),
  grants: (product: Product, spaceId: string) =>
    cached(key(product, spaceId, 'grants'), () => _grants(product, spaceId)),
  /** What the caller may do on the space — whether to show what edits it, or the request button. */
  mine: (product: Product, spaceId: string) =>
    cached(key(product, spaceId, 'me'), () => _access(product, spaceId, 'me')),
  explain: (product: Product, spaceId: string, memberId: string) => _access(product, spaceId, memberId),
  requests: (product: Product, spaceId: string) =>
    cached(key(product, spaceId, 'requests'), () =>
      unwrap(api.GET('/work/access-requests', { params: { query: { product, spaceId } } }))
    ),
  myRequests: () =>
    cached('access-requests:mine', () => unwrap(api.GET('/work/access-requests', { params: { query: {} } })))
}

const _cleared = (product: Product, spaceId: string) => {
  invalidate(`access:${product}:${spaceId}`, 'access-requests:mine', product === 'draw' ? 'draw:spaces' : 'spaces')
}

export const accessWrite = {
  createGroup: async (name: string, description: string) => {
    const group = await unwrap(api.POST('/work/groups', { body: { name, description } }))
    invalidate('groups')
    return group
  },
  renameGroup: async (groupId: string, name: string) => {
    const group = await unwrap(api.PATCH('/work/groups/{groupId}', { params: { path: { groupId } }, body: { name } }))
    invalidate('groups')
    return group
  },
  deleteGroup: async (groupId: string) => {
    await unwrap(api.DELETE('/work/groups/{groupId}', { params: { path: { groupId } } }))
    invalidate('groups', 'access:')
  },
  putGroupMember: async (groupId: string, memberId: string, isOwner: boolean) => {
    const path = { params: { path: { groupId, memberId } } }
    await unwrap(api.PUT('/work/groups/{groupId}/members/{memberId}', { ...path, body: { isOwner } }))
    invalidate('groups', 'access:')
  },
  removeGroupMember: async (groupId: string, memberId: string) => {
    await unwrap(api.DELETE('/work/groups/{groupId}/members/{memberId}', { params: { path: { groupId, memberId } } }))
    invalidate('groups', 'access:')
  },
  putGroupRole: async (product: Product, spaceId: string, groupId: string, role: GrantRole) => {
    const call = { ...onGroup(spaceId, groupId), body: { role } }
    await unwrap(
      product === 'jiraia'
        ? api.PUT('/work/spaces/{spaceId}/groups/{groupId}', call)
        : api.PUT('/work/draw/spaces/{spaceId}/groups/{groupId}', call)
    )
    _cleared(product, spaceId)
  },
  removeGroupRole: async (product: Product, spaceId: string, groupId: string) => {
    await unwrap(
      product === 'jiraia'
        ? api.DELETE('/work/spaces/{spaceId}/groups/{groupId}', onGroup(spaceId, groupId))
        : api.DELETE('/work/draw/spaces/{spaceId}/groups/{groupId}', onGroup(spaceId, groupId))
    )
    _cleared(product, spaceId)
  },
  /** A person's role: JiraIA keeps its own route, LET’S Draw AI answers under its spaces. */
  putPersonRole: async (product: Product, spaceId: string, memberId: string, role: GrantRole) => {
    const call = { ...onMember(spaceId, memberId), body: { role } }
    if (product === 'jiraia') {
      await unwrap(api.PUT('/work/spaces/{spaceId}/members/{memberId}', call))
    } else {
      await unwrap(api.PUT('/work/draw/spaces/{spaceId}/members/{memberId}', call))
    }
    invalidate(`space:${spaceId}:roles`)
    _cleared(product, spaceId)
  },
  removePersonRole: async (product: Product, spaceId: string, memberId: string) => {
    if (product === 'jiraia') {
      await unwrap(api.DELETE('/work/spaces/{spaceId}/members/{memberId}', onMember(spaceId, memberId)))
    } else {
      await unwrap(api.DELETE('/work/draw/spaces/{spaceId}/members/{memberId}', onMember(spaceId, memberId)))
    }
    invalidate(`space:${spaceId}:roles`)
    _cleared(product, spaceId)
  },
  request: async (product: Product, spaceId: string, message: string) => {
    await unwrap(api.POST('/work/access-requests', { body: { product, spaceId, message } }))
    _cleared(product, spaceId)
  },
  decide: async (request: AccessRequest, approve: boolean) => {
    const path = { params: { path: { requestId: request.id } } }
    await unwrap(api.POST('/work/access-requests/{requestId}/decision', { ...path, body: { approve, role: 'member' } }))
    invalidate(`space:${request.spaceId}:roles`)
    _cleared(request.product, request.spaceId)
  },
  setSpaceManager: async (memberId: string, isSpaceManager: boolean) => {
    const path = { params: { path: { memberId } } }
    await unwrap(api.POST('/work/members/{memberId}/space-manager', { ...path, body: { isSpaceManager } }))
    invalidate('members', 'me')
  }
}
