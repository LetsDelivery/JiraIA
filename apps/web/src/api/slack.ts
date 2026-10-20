import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/** Etapa 5e: the organization's Slack workspace — its state, connecting and disconnecting it. */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never

export type SlackStatus = Json<'/work/integrations/slack', 'get'>

export const slackRead = {
  status: () => cached('slack', () => unwrap(api.GET('/work/integrations/slack')))
}

export const slackWrite = {
  /** Where Slack's consent screen is, for this admin; the browser goes there. */
  install: () => unwrap(api.POST('/work/integrations/slack/install')),
  complete: async (code: string, state: string) => {
    const status = await unwrap(api.POST('/work/integrations/slack/complete', { body: { code, state } }))
    invalidate('slack')
    return status
  },
  disconnect: async () => {
    const status = await unwrap(api.DELETE('/work/integrations/slack'))
    invalidate('slack')
    return status
  }
}
