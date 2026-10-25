import { defineRoute, type Route } from '@jiraia/http'

import { contentPathSchema, contentViewSchema } from '../draw/content.schemas.js'
import {
  collectionListSchema,
  collectionPathSchema,
  collectionViewSchema,
  createCollectionSchema,
  updateCollectionSchema
} from './collection.schemas.js'
import type { CollectionService } from './collection.service.js'
import type { LibraryService } from './library.service.js'
import {
  changeOwnerSchema,
  createWikiPageSchema,
  favoriteSchema,
  officialSchema,
  pageLinesSchema,
  publishSchema,
  recentQuerySchema,
  reviewListSchema,
  wikiPageViewSchema,
  wikiTreeSchema
} from './page.schemas.js'
import type { WikiPageService } from './page.service.js'
import type { WikiContentService } from './wiki-content.service.js'

/** LET’S Wiki's collections (ADR-0033, ADR-0034): list, create, change, delete, and the caller's own. */
export const collectionRoutes = (collections: CollectionService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/wiki/collections',
    requires: 'authenticated',
    schemas: {},
    responds: collectionListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await collections.list(caller) })
  }),
  defineRoute({
    method: 'POST',
    path: '/wiki/collections',
    requires: 'authenticated',
    schemas: { body: createCollectionSchema },
    responds: collectionViewSchema,
    handler: async ({ caller, body }) => ({ statusCode: 201, body: await collections.create(caller, body) })
  }),
  defineRoute({
    method: 'GET',
    path: '/wiki/me/collection',
    requires: 'authenticated',
    schemas: {},
    responds: collectionViewSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await collections.personal(caller) })
  }),
  defineRoute({
    method: 'GET',
    path: '/wiki/collections/{collectionId}',
    requires: 'authenticated',
    schemas: { path: collectionPathSchema },
    responds: collectionViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await collections.read(caller, path.collectionId) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/wiki/collections/{collectionId}',
    requires: 'authenticated',
    schemas: { path: collectionPathSchema, body: updateCollectionSchema },
    responds: collectionViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await collections.update(caller, path.collectionId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/wiki/collections/{collectionId}',
    requires: 'authenticated',
    schemas: { path: collectionPathSchema },
    responds: collectionListSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await collections.remove(caller, path.collectionId)
    })
  })
]

/** A collection's pages: its tree, a new one, or a copy published from Draw or a personal page. */
export const collectionPageRoutes = (pages: WikiPageService, content: WikiContentService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/wiki/collections/{collectionId}/pages',
    requires: 'authenticated',
    schemas: { path: collectionPathSchema },
    responds: wikiTreeSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await pages.tree(caller, path.collectionId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/wiki/collections/{collectionId}/pages',
    requires: 'authenticated',
    schemas: { path: collectionPathSchema, body: createWikiPageSchema },
    responds: contentViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await content.createPage(caller, path.collectionId, body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/wiki/collections/{collectionId}/published',
    requires: 'authenticated',
    schemas: { path: collectionPathSchema, body: publishSchema },
    responds: contentViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await content.publish(caller, path.collectionId, body.contentId)
    })
  })
]

/** The wiki's lists across collections, each only of what the caller reads (ADR-0034). */
export const libraryRoutes = (library: LibraryService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/wiki/pages/recent',
    requires: 'authenticated',
    schemas: { query: recentQuerySchema },
    responds: pageLinesSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await library.recent(caller, query.limit) })
  }),
  defineRoute({
    method: 'GET',
    path: '/wiki/pages/opened',
    requires: 'authenticated',
    schemas: { query: recentQuerySchema },
    responds: pageLinesSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await library.opened(caller, query.limit) })
  }),
  defineRoute({
    method: 'GET',
    path: '/wiki/favorites',
    requires: 'authenticated',
    schemas: {},
    responds: pageLinesSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await library.favorites(caller) })
  }),
  defineRoute({
    method: 'GET',
    path: '/wiki/shared',
    requires: 'authenticated',
    schemas: { query: recentQuerySchema },
    responds: pageLinesSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await library.shared(caller, query.limit) })
  }),
  defineRoute({
    method: 'GET',
    path: '/wiki/reviews',
    requires: 'authenticated',
    schemas: {},
    responds: reviewListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await library.reviews(caller) })
  })
]

/** A wiki page's owner, state, review and star (ADR-0033, ADR-0034); its text goes through the content routes. */
export const wikiPageRoutes = (pages: WikiPageService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/wiki/pages/{contentId}',
    requires: 'authenticated',
    schemas: { path: contentPathSchema },
    responds: wikiPageViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await pages.read(caller, path.contentId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/wiki/pages/{contentId}/official',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: officialSchema },
    responds: wikiPageViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await pages.setOfficial(caller, path.contentId, body.official)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/wiki/pages/{contentId}/review',
    requires: 'authenticated',
    schemas: { path: contentPathSchema },
    responds: wikiPageViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await pages.review(caller, path.contentId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/wiki/pages/{contentId}/owner',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: changeOwnerSchema },
    responds: wikiPageViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await pages.changeOwner(caller, path.contentId, body.ownerId)
    })
  }),
  defineRoute({
    method: 'PUT',
    path: '/wiki/pages/{contentId}/favorite',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: favoriteSchema },
    responds: wikiPageViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await pages.favorite(caller, path.contentId, body.favorite)
    })
  })
]
