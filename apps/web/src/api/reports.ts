import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/** Etapa 5d's reads and writes: a space's dashboard and the data of each of its widgets (ADR-0016). */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type Dashboard = Json<'/work/spaces/{spaceId}/dashboard', 'get'>
export type Widget = Dashboard['widgets'][number]
export type WidgetKind = Widget['kind']
export type WidgetOf<K extends WidgetKind> = Extract<Widget, { kind: K }>
export type Report = Json<'/work/spaces/{spaceId}/reports/run', 'post'>
export type ReportOf<K extends Report['kind']> = Extract<Report, { kind: K }>

const space = (spaceId: string) => ({ params: { path: { spaceId } } })

export const reportsRead = {
  dashboard: (spaceId: string) =>
    cached(`dashboard:${spaceId}`, () => unwrap(api.GET('/work/spaces/{spaceId}/dashboard', space(spaceId)))),
  /** Not cached: the numbers move with every card, and each widget is asked for once per render. */
  run: (spaceId: string, widget: Widget, page = 1) =>
    unwrap(api.POST('/work/spaces/{spaceId}/reports/run', { ...space(spaceId), body: { widget, page } }))
}

export const reportsWrite = {
  save: async (spaceId: string, widgets: Widget[]) => {
    const saved = await unwrap(api.PUT('/work/spaces/{spaceId}/dashboard', { ...space(spaceId), body: { widgets } }))
    invalidate(`dashboard:${spaceId}`)
    return saved
  },
  restore: async (spaceId: string) => {
    const restored = await unwrap(api.DELETE('/work/spaces/{spaceId}/dashboard', space(spaceId)))
    invalidate(`dashboard:${spaceId}`)
    return restored
  }
}
