import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/** A member's own notices and preferences (escopo-mvp 4.6), cached under `notifications:`. */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type Box = 'inbox' | 'snoozed' | 'archived'
export type Notice = Json<'/work/me/notifications', 'get'>['items'][number]
export type NoticeKind = Notice['kind']
export type Preference = Json<'/work/me/notification-preferences', 'get'>['items'][number]
export type Channel = Preference['channel']

const notice = (notificationId: string) => ({ params: { path: { notificationId } } })

export const noticesRead = {
  list: (box: Box) =>
    cached(`notifications:${box}`, () => unwrap(api.GET('/work/me/notifications', { params: { query: { box } } }))),
  unread: () => cached('notifications:unread', () => unwrap(api.GET('/work/me/notifications/unread'))),
  preferences: () => cached('notifications:preferences', () => unwrap(api.GET('/work/me/notification-preferences')))
}

export const noticesWrite = {
  update: async (
    notificationId: string,
    body: { read?: boolean; archived?: boolean; snoozedUntil?: string | null }
  ) => {
    await unwrap(api.PATCH('/work/me/notifications/{notificationId}', { ...notice(notificationId), body }))
    invalidate('notifications:')
  },
  readAll: async () => {
    await unwrap(api.POST('/work/me/notifications/read-all'))
    invalidate('notifications:')
  },
  setPreference: async (kind: NoticeKind, channel: Channel) => {
    await unwrap(api.PUT('/work/me/notification-preferences', { body: { kind, channel } }))
    invalidate('notifications:preferences')
  }
}
