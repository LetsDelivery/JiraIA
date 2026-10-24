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
import {
  changeOwnerSchema,
  createWikiPageSchema,
  officialSchema,
  publishSchema,
  recentQuerySchema,
  recentWikiPagesSchema,
  reviewListSchema,
  wikiPageViewSchema,
  wikiTreeSchema
} from './page.schemas.js'
import type { WikiPageService } from './page.service.js'

/** LET’S Wiki's collections (ADR-0033): list, create, change, delete, and add a page to one. */
export const collectionRoutes = (collections: CollectionService, pages: WikiPageService): Route[] => [
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
  }),
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
      body: await collections.createPage(caller, path.collectionId, body)
    })
  })
]

/** "Publicar na Wiki" (W8): a Draw page copied into a collection as a draft. */
export const publishRoutes = (collections: CollectionService): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/wiki/collections/{collectionId}/published',
    requires: 'authenticated',
    schemas: { path: collectionPathSchema, body: publishSchema },
    responds: contentViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await collections.publish(caller, path.collectionId, body.contentId)
    })
  })
]

/** A wiki page's owner, state and review (ADR-0033); its text goes through the content routes. */
export const wikiPageRoutes = (pages: WikiPageService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/wiki/pages/recent',
    requires: 'authenticated',
    schemas: { query: recentQuerySchema },
    responds: recentWikiPagesSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await pages.recent(caller, query.limit) })
  }),
  defineRoute({
    method: 'GET',
    path: '/wiki/reviews',
    requires: 'authenticated',
    schemas: {},
    responds: reviewListSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await pages.reviews(caller) })
  }),
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
  })
]
