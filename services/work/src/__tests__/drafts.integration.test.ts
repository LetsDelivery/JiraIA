import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import Anthropic from '@anthropic-ai/sdk'
import { uuidGenerator } from '@jiraia/core'
import { answer, apiEvent, type Call, googleClaims, testDatabase, truncateSchema } from '@jiraia/testing'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

import { buildService } from '../container.js'
import { AnthropicDraftWriter } from '../draw/anthropic-writer.js'
import { InMemoryFileStore } from '../files/file-store.js'
import { bootstrapOrganization } from '../members/bootstrap.js'

/**
 * "Criar com IA" (ADR-0011) against Claude's Messages API as MSW answers it on a counterparty host:
 * the request the writer sends, the draft it reads back, and how a refusal or an outage reaches the
 * person.
 */
const db = await testDatabase('services/work/drizzle')
const BASE = 'https://anthropic.counterparty.test'
const config = {
  DATABASE_URL: 'unused',
  AWS_REGION: 'us-east-1',
  ALLOWED_EMAIL_DOMAIN: 'uselets.com',
  ATTACHMENTS_BUCKET: 'unused',
  REALTIME_URL: 'ws://localhost/realtime'
}

let sent: { model: string; fallbacks: unknown; system: unknown; messages: { role: string; content: unknown }[] }[] = []
let reply: () => Response
const message = (body: Record<string, unknown>, stop = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: JSON.stringify(body) }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 }
})
const anthropic = setupServer(
  http.post(`${BASE}/v1/messages`, async ({ request }) => {
    sent.push((await request.json()) as (typeof sent)[number])
    return reply()
  })
)

let service: ReturnType<typeof buildService>
let spaceId: string
const admin = async (input: Omit<Call, 'subject'>) =>
  answer(await service.router(apiEvent({ ...input, claims: googleClaims('admin@uselets.com') })))
const draft = (body: Record<string, unknown>) => admin({ method: 'POST', path: `/draw/spaces/${spaceId}/drafts`, body })

beforeAll(() => anthropic.listen({ onUnhandledRequest: 'error' }))
afterAll(() => anthropic.close())

beforeEach(async () => {
  await truncateSchema(db, 'work')
  sent = []
  const writer = new AnthropicDraftWriter(new Anthropic({ apiKey: 'test-key-0000', baseURL: BASE, maxRetries: 0 }))
  service = buildService(config, { db, files: new InMemoryFileStore(), writer })
  await bootstrapOrganization(
    { db, clock: { now: () => new Date('2026-10-16T12:00:00Z') }, ids: uuidGenerator },
    { organizationName: "LET'S", admin: { email: 'admin@uselets.com', name: 'Admin' } }
  )
  spaceId = ((await admin({ method: 'POST', path: '/draw/spaces', body: { name: 'Produto' } })).body as { id: string })
    .id
})

describe('drafting from a prompt', () => {
  it('asks Claude Opus 5.5 with fallbacks on, and turns its Markdown into the page’s first document', async () => {
    reply = () =>
      HttpResponse.json(
        message({
          kind: 'page',
          title: 'Devoluções',
          reply: 'Montei a página.',
          markdown: '# Devoluções\n- [ ] Aprovar',
          sections: []
        })
      )
    const result = await draft({ kind: 'page', messages: [{ role: 'user', text: 'Processo de devoluções' }] })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      kind: 'page',
      title: 'Devoluções',
      byModel: true,
      text: '# Devoluções\n- [ ] Aprovar'
    })
    expect((result.body as { json: { content: { type: string }[] } }).json.content.map((block) => block.type)).toEqual([
      'heading',
      'taskList'
    ])
    expect(sent[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' })
    expect(sent[0]?.messages.at(-1)).toEqual({ role: 'system', content: 'Crie uma página.' })
  })

  it('lays a whiteboard out from sections; a refinement carries the conversation', async () => {
    reply = () =>
      HttpResponse.json(
        message({
          kind: 'whiteboard',
          title: 'Ideias',
          reply: 'Ajustei.',
          markdown: '',
          sections: [{ title: 'Dores', notes: ['Atraso'] }]
        })
      )
    const messages = [
      { role: 'user', text: 'Um quadro de ideias' },
      { role: 'assistant', text: 'Montei o quadro.' },
      { role: 'user', text: 'Junte as dores numa seção' }
    ]
    const result = await draft({ messages })

    expect(
      (result.body as { json: { elements: { type: string }[] } }).json.elements.map((element) => element.type)
    ).toEqual(['frame', 'rectangle', 'text'])
    expect(sent[0]?.messages.map((each) => each.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('a refusal is a 400 and an outage a 503, each with a sentence the panel can show', async () => {
    reply = () =>
      HttpResponse.json({
        ...message({}),
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null }
      })
    expect((await draft({ messages: [{ role: 'user', text: 'x' }] })).status).toBe(400)
    reply = () =>
      HttpResponse.json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 529 })
    expect((await draft({ messages: [{ role: 'user', text: 'x' }] })).status).toBe(503)
  })

  it('refuses a conversation that does not end with the person', async () => {
    const result = await draft({ messages: [{ role: 'assistant', text: 'Oi' }] })
    expect(result.status).toBe(400)
    expect(sent).toHaveLength(0)
  })
})
