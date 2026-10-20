import { cached, invalidate } from '@/lib/cache'

import { api } from './client'
import { unwrap } from './requests'
import type { paths } from './schema'

/**
 * Etapa 5's reads and writes: a space's intake forms and automations, a rule's runs, and the
 * organization's Slack channels. Each is cached under its own prefix and cleared by its writes.
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

export type Form = Json<'/work/forms/{formId}', 'get'>
export type FormQuestion = Form['questions'][number]
export type FormInput = Body<'/work/spaces/{spaceId}/forms', 'post'>
export type Automation = Json<'/work/spaces/{spaceId}/automations', 'get'>['items'][number]
export type AutomationInput = Body<'/work/spaces/{spaceId}/automations', 'post'>
export type Trigger = Automation['trigger']
export type AutomationAction = Automation['actions'][number]
export type Run = Json<'/work/automations/{automationId}/runs', 'get'>['items'][number]
export type SlackChannel = Json<'/work/integrations/slack/channels', 'get'>['items'][number]

const space = (spaceId: string) => ({ params: { path: { spaceId } } })
const form = (formId: string) => ({ params: { path: { formId } } })
const rule = (automationId: string) => ({ params: { path: { automationId } } })

export const intakeRead = {
  forms: (spaceId: string) =>
    cached(`forms:${spaceId}`, () => unwrap(api.GET('/work/spaces/{spaceId}/forms', space(spaceId)))),
  form: (formId: string) => cached(`form:${formId}`, () => unwrap(api.GET('/work/forms/{formId}', form(formId)))),
  automations: (spaceId: string) =>
    cached(`automations:${spaceId}`, () => unwrap(api.GET('/work/spaces/{spaceId}/automations', space(spaceId)))),
  runs: (automationId: string) => unwrap(api.GET('/work/automations/{automationId}/runs', rule(automationId))),
  slackChannels: () => cached('slack-channels', () => unwrap(api.GET('/work/integrations/slack/channels')))
}

export const intakeWrite = {
  createForm: async (spaceId: string, body: FormInput) => {
    const created = await unwrap(api.POST('/work/spaces/{spaceId}/forms', { ...space(spaceId), body }))
    invalidate(`forms:${spaceId}`)
    return created
  },
  updateForm: async (formId: string, spaceId: string, body: FormInput) => {
    const updated = await unwrap(api.PUT('/work/forms/{formId}', { ...form(formId), body }))
    invalidate(`forms:${spaceId}`, `form:${formId}`)
    return updated
  },
  deleteForm: async (formId: string, spaceId: string) => {
    await unwrap(api.DELETE('/work/forms/{formId}', form(formId)))
    invalidate(`forms:${spaceId}`, `form:${formId}`)
  },
  submit: async (formId: string, answers: Record<string, unknown>, spaceId: string) => {
    const sent = await unwrap(api.POST('/work/forms/{formId}/submissions', { ...form(formId), body: { answers } }))
    invalidate(`space:${spaceId}:cards`)
    return sent
  },
  createAutomation: async (spaceId: string, body: AutomationInput) => {
    const created = await unwrap(api.POST('/work/spaces/{spaceId}/automations', { ...space(spaceId), body }))
    invalidate(`automations:${spaceId}`)
    return created
  },
  updateAutomation: async (automationId: string, spaceId: string, body: AutomationInput) => {
    const updated = await unwrap(api.PUT('/work/automations/{automationId}', { ...rule(automationId), body }))
    invalidate(`automations:${spaceId}`)
    return updated
  },
  deleteAutomation: async (automationId: string, spaceId: string) => {
    await unwrap(api.DELETE('/work/automations/{automationId}', rule(automationId)))
    invalidate(`automations:${spaceId}`)
  },
  addSlackChannel: async (name: string, webhookUrl: string) => {
    const created = await unwrap(api.POST('/work/integrations/slack/channels', { body: { name, webhookUrl } }))
    invalidate('slack-channels')
    return created
  },
  removeSlackChannel: async (channelId: string) => {
    await unwrap(api.DELETE('/work/integrations/slack/channels/{channelId}', { params: { path: { channelId } } }))
    invalidate('slack-channels')
  }
}
