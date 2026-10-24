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
  reviews: () => cached('wiki:reviews', () => unwrap(api.GET('/work/wiki/reviews')))
}

/** A page's state shows in its collection's tree, the home and the reviews, so all of them redraw. */
const pageChanged = (contentId: string, collectionId: string) =>
  invalidate(`wiki:page:${contentId}`, `wiki:collection:${collectionId}:tree`, 'wiki:recent', 'wiki:reviews')

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
    invalidate('wiki:collections', `wiki:collection:${collectionId}`, 'wiki:recent')
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
  }
}
