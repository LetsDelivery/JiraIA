import { defineRoute, type Route } from '@jiraia/http'
import { z } from 'zod'

import { createAttachmentSchema, uploadViewSchema } from '../cards/attachment.schemas.js'
import {
  applyUpdateSchema,
  contentCommentListSchema,
  contentCommentPathSchema,
  contentPathSchema,
  contentTreeSchema,
  contentViewSchema,
  createContentCommentSchema,
  createContentSchema,
  derivedContentSchema,
  documentSchema,
  editContentCommentSchema,
  moveContentSchema,
  realtimeTicketSchema,
  recentContentsQuerySchema,
  recentContentsSchema,
  renameContentSchema,
  resolveContentCommentSchema,
  saveVersionSchema,
  versionListSchema,
  versionPathSchema,
  versionSchema
} from './content.schemas.js'
import type { ContentService } from './content.service.js'
import type { ContentCommentService } from './content-comment.service.js'
import type { ContentFileService } from './content-file.service.js'
import type { DocumentService } from './document.service.js'
import { drawSpacePathSchema } from './draw-space.schemas.js'
import type { RealtimeService } from './realtime.service.js'

/** The page tree of a space (escopo-mvp 5.1). */
export const contentRoutes = (contents: ContentService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/draw/contents',
    requires: 'authenticated',
    schemas: { query: recentContentsQuerySchema },
    responds: recentContentsSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await contents.recent(caller, query.limit) })
  }),
  defineRoute({
    method: 'GET',
    path: '/draw/contents/opened',
    requires: 'authenticated',
    schemas: { query: recentContentsQuerySchema },
    responds: recentContentsSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await contents.opened(caller, query.limit) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/draw/contents/{contentId}/visit',
    requires: 'authenticated',
    schemas: { path: contentPathSchema },
    responds: z.void(),
    handler: async ({ caller, path }) => {
      await contents.visit(caller, path.contentId)
      return { statusCode: 204 }
    }
  }),
  defineRoute({
    method: 'GET',
    path: '/draw/spaces/{spaceId}/contents',
    requires: 'authenticated',
    schemas: { path: drawSpacePathSchema },
    responds: contentTreeSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await contents.tree(caller, path.spaceId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/spaces/{spaceId}/contents',
    requires: 'authenticated',
    schemas: { path: drawSpacePathSchema, body: createContentSchema },
    responds: contentViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await contents.create(caller, path.spaceId, body)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/draw/contents/{contentId}',
    requires: 'authenticated',
    schemas: { path: contentPathSchema },
    responds: contentViewSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await contents.read(caller, path.contentId) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/draw/contents/{contentId}',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: renameContentSchema },
    responds: contentViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await contents.rename(caller, path.contentId, body.title)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/contents/{contentId}/move',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: moveContentSchema },
    responds: contentTreeSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await contents.move(caller, path.contentId, body)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/draw/contents/{contentId}',
    requires: 'authenticated',
    schemas: { path: contentPathSchema },
    responds: contentTreeSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await contents.remove(caller, path.contentId) })
  })
]

/** The content: the Yjs state, what the editor derives from it, and the versions (5.2–5.4). */
export const documentRoutes = (documents: DocumentService, realtime: RealtimeService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/draw/contents/{contentId}/document',
    requires: 'authenticated',
    schemas: { path: contentPathSchema },
    responds: documentSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await documents.state(caller, path.contentId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/contents/{contentId}/document',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: applyUpdateSchema },
    responds: documentSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await realtime.pushFromHttp(caller, path.contentId, body.update)
    })
  }),
  defineRoute({
    method: 'PUT',
    path: '/draw/contents/{contentId}/derived',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: derivedContentSchema },
    responds: z.object({ version: z.number().int().nullable() }),
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await documents.saveContent(caller, path.contentId, body)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/draw/contents/{contentId}/versions',
    requires: 'authenticated',
    schemas: { path: contentPathSchema },
    responds: versionListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await documents.versions(caller, path.contentId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/contents/{contentId}/versions',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: saveVersionSchema },
    responds: versionSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await documents.saveVersion(caller, path.contentId, body)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/draw/contents/{contentId}/versions/{number}',
    requires: 'authenticated',
    schemas: { path: versionPathSchema },
    responds: versionSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await documents.version(caller, path.contentId, path.number)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/contents/{contentId}/versions/{number}/restore',
    requires: 'authenticated',
    schemas: { path: versionPathSchema },
    responds: versionSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await documents.restore(caller, path.contentId, path.number)
    })
  })
]

/** Comments on a page (5.7) and the ticket to edit it together (5.3). */
export const contentTalkRoutes = (comments: ContentCommentService, realtime: RealtimeService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/draw/contents/{contentId}/comments',
    requires: 'authenticated',
    schemas: { path: contentPathSchema },
    responds: contentCommentListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await comments.list(caller, path.contentId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/contents/{contentId}/comments',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: createContentCommentSchema },
    responds: contentCommentListSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await comments.create(caller, path.contentId, body)
    })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/draw/contents/{contentId}/comments/{commentId}',
    requires: 'authenticated',
    schemas: { path: contentCommentPathSchema, body: editContentCommentSchema },
    responds: contentCommentListSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await comments.edit(caller, path.contentId, path.commentId, body.body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/contents/{contentId}/comments/{commentId}/resolve',
    requires: 'authenticated',
    schemas: { path: contentCommentPathSchema, body: resolveContentCommentSchema },
    responds: contentCommentListSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await comments.resolve(caller, path.contentId, path.commentId, body.resolved)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/contents/{contentId}/realtime',
    requires: 'authenticated',
    schemas: { path: contentPathSchema },
    responds: realtimeTicketSchema,
    handler: async ({ caller, path }) => ({ statusCode: 201, body: await realtime.ticket(caller, path.contentId) })
  })
]

const contentFilePathSchema = z.object({ contentId: z.uuid(), fileId: z.uuid() })
const contentFileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  /** Reads the file for the next few minutes; ask again for a fresh one. */
  url: z.string()
})

/** Images and files in a page (5.2): upload in two steps, read by id. */
export const contentFileRoutes = (files: ContentFileService): Route[] => [
  defineRoute({
    method: 'POST',
    path: '/draw/contents/{contentId}/files',
    requires: 'authenticated',
    schemas: { path: contentPathSchema, body: createAttachmentSchema },
    responds: uploadViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await files.start(caller, path.contentId, body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/draw/contents/{contentId}/files/{fileId}/complete',
    requires: 'authenticated',
    schemas: { path: contentFilePathSchema },
    responds: contentFileSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await files.complete(caller, path.contentId, path.fileId)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/draw/contents/{contentId}/files/{fileId}',
    requires: 'authenticated',
    schemas: { path: contentFilePathSchema },
    responds: contentFileSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await files.read(caller, path.contentId, path.fileId)
    })
  })
]
