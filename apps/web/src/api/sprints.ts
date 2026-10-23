import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/** Etapa 3b's reads and writes (ADR-0029): a space's sprints. */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type Sprint = Json<'/work/sprints/{sprintId}/start', 'post'>
export type SprintInput = NonNullable<
  paths['/work/spaces/{spaceId}/sprints']['post']['requestBody']
>['content']['application/json']
export type OpenCardsTo = 'next' | 'new' | 'backlog'

const one = (sprintId: string) => ({ params: { path: { sprintId } } })

/** A sprint write changes the space's sprints and, often, where its cards are: clear the whole space. */
const changed = <T>(spaceId: string, result: T): T => {
  invalidate(`space:${spaceId}`)
  return result
}

export const sprintsRead = {
  list: (spaceId: string) =>
    cached(`space:${spaceId}:sprints`, () =>
      unwrap(api.GET('/work/spaces/{spaceId}/sprints', { params: { path: { spaceId }, query: {} } }))
    )
}

export const sprintsWrite = {
  create: async (spaceId: string, body: SprintInput = {}) =>
    changed(spaceId, await unwrap(api.POST('/work/spaces/{spaceId}/sprints', { params: { path: { spaceId } }, body }))),
  update: async (sprint: Sprint, body: SprintInput) =>
    changed(sprint.spaceId, await unwrap(api.PATCH('/work/sprints/{sprintId}', { ...one(sprint.id), body }))),
  start: async (sprint: Sprint, body: SprintInput) =>
    changed(sprint.spaceId, await unwrap(api.POST('/work/sprints/{sprintId}/start', { ...one(sprint.id), body }))),
  close: async (sprint: Sprint, openCardsTo: OpenCardsTo) =>
    changed(
      sprint.spaceId,
      await unwrap(api.POST('/work/sprints/{sprintId}/close', { ...one(sprint.id), body: { openCardsTo } }))
    ),
  remove: async (sprint: Sprint) => {
    await unwrap(api.DELETE('/work/sprints/{sprintId}', one(sprint.id)))
    invalidate(`space:${sprint.spaceId}`)
  }
}
