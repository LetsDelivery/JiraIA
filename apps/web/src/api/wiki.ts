import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/**
 * LET’S Wiki's side of the API (ADR-0033): collections, and each page's owner, state and review. A
 * page's text, versions and comments go through Draw's content routes (`api/draw.ts`).
 */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never
type Body<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer T } }
}
  ? T
  : never

export type Collection = Json<'/work/wiki/collections/{collectionId}', 'get'>
export type CollectionInput = Body<'/work/wiki/collections', 'post'>
export type CollectionChanges = Body<'/work/wiki/collections/{collectionId}', 'patch'>
export type WikiNode = Json<'/work/wiki/collections/{collectionId}/pages', 'get'>['items'][number]
export type WikiPage = Json<'/work/wiki/pages/{contentId}', 'get'>
export type WikiLine = Json<'/work/wiki/favorites', 'get'>['items'][number]
export type RecentWikiPage = Json<'/work/wiki/pages/recent', 'get'>['items'][number]
export type ReviewItem = Json<'/work/wiki/reviews', 'get'>['items'][number]
export type NewWikiPage = Body<'/work/wiki/collections/{collectionId}/pages', 'post'>

const collection = (collectionId: string) => ({ params: { path: { collectionId } } })
const page = (contentId: string) => ({ params: { path: { contentId } } })

export const wikiRead = {
  collections: () => cached('wiki:collections', () => unwrap(api.GET('/work/wiki/collections'))),
  collection: (collectionId: string) =>
    cached(`wiki:collection:${collectionId}`, () =>
      unwrap(api.GET('/work/wiki/collections/{collectionId}', collection(collectionId)))
    ),
  tree: (collectionId: string) =>
    cached(`wiki:collection:${collectionId}:tree`, () =>
      unwrap(api.GET('/work/wiki/collections/{collectionId}/pages', collection(collectionId)))
    ),
  page: (contentId: string) =>
    cached(`wiki:page:${contentId}`, () => unwrap(api.GET('/work/wiki/pages/{contentId}', page(contentId)))),
  recent: () => cached('wiki:recent', () => unwrap(api.GET('/work/wiki/pages/recent', { params: { query: {} } }))),
  /** The pages the caller opened last, of every collection they read. */
  opened: () =>
    cached('wiki:recent:opened', () => unwrap(api.GET('/work/wiki/pages/opened', { params: { query: {} } }))),
  /** The caller's starred pages, in the order they starred them. */
  favorites: () => cached('wiki:favorites', () => unwrap(api.GET('/work/wiki/favorites'))),
  /** Pages of other people's personal collections the caller was given a role in. */
  shared: () => cached('wiki:shared', () => unwrap(api.GET('/work/wiki/shared', { params: { query: {} } }))),
  /** The caller's personal collection (ADR-0034), made the first time it is asked for. */
  personal: () => cached('wiki:personal', () => unwrap(api.GET('/work/wiki/me/collection'))),
  reviews: () => cached('wiki:reviews', () => unwrap(api.GET('/work/wiki/reviews')))
}

/** A page's state shows in its collection's tree, the home and the reviews, so all of them redraw. */
const pageChanged = (contentId: string, collectionId: string) =>
  invalidate(
    `wiki:page:${contentId}`,
    `wiki:collection:${collectionId}:tree`,
    'wiki:recent',
    'wiki:reviews',
    'wiki:favorites',
    'wiki:shared'
  )

export const wikiWrite = {
  createCollection: async (body: CollectionInput) => {
    const created = await unwrap(api.POST('/work/wiki/collections', { body }))
    invalidate('wiki:collections')
    return created
  },
  updateCollection: async (collectionId: string, body: CollectionChanges) => {
    const updated = await unwrap(
      api.PATCH('/work/wiki/collections/{collectionId}', { ...collection(collectionId), body })
    )
    invalidate('wiki:collections', `wiki:collection:${collectionId}`, 'wiki:recent', `draw:space:${collectionId}`)
    return updated
  },
  deleteCollection: async (collectionId: string) => {
    await unwrap(api.DELETE('/work/wiki/collections/{collectionId}', collection(collectionId)))
    invalidate('wiki:')
  },
  /** A page starts from its collection's outline (a customer's), a folder empty. */
  createPage: async (collectionId: string, body: NewWikiPage) => {
    const created = await unwrap(
      api.POST('/work/wiki/collections/{collectionId}/pages', { ...collection(collectionId), body })
    )
    invalidate(`wiki:collection:${collectionId}:tree`, `draw:space:${collectionId}:tree`, 'wiki:recent')
    return created
  },
  /** "Publicar na Wiki" (W8): a copy of a Draw page, as a draft in the collection. */
  publish: async (collectionId: string, contentId: string) => {
    const created = await unwrap(
      api.POST('/work/wiki/collections/{collectionId}/published', { ...collection(collectionId), body: { contentId } })
    )
    invalidate(`wiki:collection:${collectionId}:tree`, `draw:space:${collectionId}:tree`, 'wiki:recent')
    return created
  },
  setOfficial: async (item: { contentId: string; collectionId: string }, official: boolean) => {
    const updated = await unwrap(
      api.PUT('/work/wiki/pages/{contentId}/official', { ...page(item.contentId), body: { official } })
    )
    pageChanged(item.contentId, item.collectionId)
    return updated
  },
  review: async (item: { contentId: string; collectionId: string }) => {
    const updated = await unwrap(api.POST('/work/wiki/pages/{contentId}/review', page(item.contentId)))
    pageChanged(item.contentId, item.collectionId)
    return updated
  },
  changeOwner: async (item: { contentId: string; collectionId: string }, ownerId: string) => {
    const updated = await unwrap(
      api.PUT('/work/wiki/pages/{contentId}/owner', { ...page(item.contentId), body: { ownerId } })
    )
    pageChanged(item.contentId, item.collectionId)
    return updated
  },
  /** A star on the page, the caller's own: it shows in Favoritas at once. */
  setFavorite: async (item: { contentId: string; collectionId: string }, favorite: boolean) => {
    const updated = await unwrap(
      api.PUT('/work/wiki/pages/{contentId}/favorite', { ...page(item.contentId), body: { favorite } })
    )
    pageChanged(item.contentId, item.collectionId)
    return updated
  },
  /** The emoji over the page's title, or none; it shows in the trees and lists too. */
  setIcon: async (item: { contentId: string; collectionId: string }, icon: string | null) => {
    await unwrap(api.PUT('/work/draw/contents/{contentId}/icon', { ...page(item.contentId), body: { icon } }))
    invalidate(`draw:content:${item.contentId}`, `draw:space:${item.collectionId}:tree`, 'draw:recent')
    pageChanged(item.contentId, item.collectionId)
  }
}
