import { defineRoute, type Route } from '@jiraia/http'
import { z } from 'zod'
import {
  attachmentListSchema,
  attachmentPathSchema,
  createAttachmentSchema,
  uploadViewSchema
} from './attachment.schemas.js'
import type { AttachmentService } from './attachment.service.js'
import type { CommentService } from './comment.service.js'
import { cardPathSchema, commentListSchema, commentPathSchema, createCommentSchema, reactSchema } from './schemas.js'
import type { WatcherService } from './watcher.service.js'
import { type WorklogService, worklogListSchema } from './worklog.js'

const watcherListSchema = z.object({ items: z.array(z.object({ id: z.uuid(), name: z.string() })) })

/** What people do around a card: talk on it (2.8), follow it (2.11) and attach files to it (2.9). */
export const conversationRoutes = (comments: CommentService, watchers: WatcherService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/comments',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: commentListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await comments.list(caller, path.cardId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/cards/{cardId}/comments',
    requires: 'authenticated',
    schemas: { path: cardPathSchema, body: createCommentSchema },
    responds: commentListSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await comments.create(caller, path.cardId, body.body)
    })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/cards/{cardId}/comments/{commentId}',
    requires: 'authenticated',
    schemas: { path: commentPathSchema, body: createCommentSchema },
    responds: commentListSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await comments.edit(caller, path.cardId, path.commentId, body.body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/cards/{cardId}/comments/{commentId}/reactions',
    requires: 'authenticated',
    schemas: { path: commentPathSchema, body: reactSchema },
    responds: commentListSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await comments.react(caller, path.cardId, path.commentId, body)
    })
  }),
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/watchers',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: watcherListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await watchers.list(caller, path.cardId) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/cards/{cardId}/watch',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: watcherListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await watchers.watch(caller, path.cardId, true) })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/cards/{cardId}/watch',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: watcherListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await watchers.watch(caller, path.cardId, false) })
  })
]

export const attachmentRoutes = (attachments: AttachmentService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/attachments',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: attachmentListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await attachments.list(caller, path.cardId) })
  }),
  defineRoute({
    method: 'POST',
    path: '/cards/{cardId}/attachments',
    requires: 'authenticated',
    schemas: { path: cardPathSchema, body: createAttachmentSchema },
    responds: uploadViewSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 201,
      body: await attachments.start(caller, path.cardId, body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/cards/{cardId}/attachments/{attachmentId}/complete',
    requires: 'authenticated',
    schemas: { path: attachmentPathSchema },
    responds: attachmentListSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await attachments.complete(caller, path.cardId, path.attachmentId)
    })
  }),
  defineRoute({
    method: 'DELETE',
    path: '/cards/{cardId}/attachments/{attachmentId}',
    requires: 'authenticated',
    schemas: { path: attachmentPathSchema },
    responds: attachmentListSchema,
    handler: async ({ caller, path }) => ({
      statusCode: 200,
      body: await attachments.remove(caller, path.cardId, path.attachmentId)
    })
  })
]

export const worklogRoutes = (worklogs: WorklogService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/cards/{cardId}/worklogs',
    requires: 'authenticated',
    schemas: { path: cardPathSchema },
    responds: worklogListSchema,
    handler: async ({ caller, path }) => ({ statusCode: 200, body: await worklogs.list(caller, path.cardId) })
  })
]
