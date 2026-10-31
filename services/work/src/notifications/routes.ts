import { defineRoute, type Route } from '@jiraia/http'

import type { NotificationService } from './notification.service.js'
import {
  listQuerySchema,
  notificationListSchema,
  notificationPathSchema,
  preferenceInputSchema,
  preferencesSchema,
  unreadCountSchema,
  updateNotificationSchema
} from './schemas.js'

export const notificationRoutes = (notifications: NotificationService): Route[] => [
  defineRoute({
    method: 'GET',
    path: '/me/notifications',
    requires: 'authenticated',
    schemas: { query: listQuerySchema },
    responds: notificationListSchema,
    handler: async ({ caller, query }) => ({ statusCode: 200, body: await notifications.list(caller, query.box) })
  }),
  defineRoute({
    method: 'GET',
    path: '/me/notifications/unread',
    requires: 'authenticated',
    schemas: {},
    responds: unreadCountSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await notifications.unread(caller) })
  }),
  defineRoute({
    method: 'PATCH',
    path: '/me/notifications/{notificationId}',
    requires: 'authenticated',
    schemas: { path: notificationPathSchema, body: updateNotificationSchema },
    responds: unreadCountSchema,
    handler: async ({ caller, path, body }) => ({
      statusCode: 200,
      body: await notifications.update(caller, path.notificationId, body)
    })
  }),
  defineRoute({
    method: 'POST',
    path: '/me/notifications/read-all',
    requires: 'authenticated',
    schemas: {},
    responds: unreadCountSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await notifications.readAll(caller) })
  }),
  defineRoute({
    method: 'GET',
    path: '/me/notification-preferences',
    requires: 'authenticated',
    schemas: {},
    responds: preferencesSchema,
    handler: async ({ caller }) => ({ statusCode: 200, body: await notifications.preferences(caller) })
  }),
  defineRoute({
    method: 'PUT',
    path: '/me/notification-preferences',
    requires: 'authenticated',
    schemas: { body: preferenceInputSchema },
    responds: preferencesSchema,
    handler: async ({ caller, body }) => ({
      statusCode: 200,
      body: await notifications.setPreference(caller, body.kind, body.channels)
    })
  })
]
