import { DependencyUnavailableException } from '@jiraia/core'
import { z } from 'zod'

/**
 * A draft made from a prompt (ADR-0011): what someone described in "Criar com IA", turned into a page
 * or a whiteboard they look at, refine in the chat, and create. The model answers in this shape; the
 * service turns it into the content's first document.
 */
export const draftKindSchema = z.enum(['page', 'whiteboard'])
export type DraftKind = z.infer<typeof draftKindSchema>

/** What the model writes: its reply in the chat, and the draft — Markdown for a page, sections for a board. */
export const modelDraftSchema = z.object({
  kind: draftKindSchema,
  title: z.string(),
  reply: z.string(),
  markdown: z.string(),
  sections: z.array(z.object({ title: z.string(), notes: z.array(z.string()) }))
})
export type ModelDraft = z.infer<typeof modelDraftSchema>

export const draftMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(4000)
})
export type DraftMessage = z.infer<typeof draftMessageSchema>

export const draftRequestSchema = z.object({
  /** `auto` lets the model choose between a page and a whiteboard from what was asked. */
  kind: z.enum(['auto', 'page', 'whiteboard']).default('auto'),
  messages: z
    .array(draftMessageSchema)
    .min(1)
    .max(20)
    .refine((messages) => messages.at(-1)?.role === 'user', { message: 'The last message is the person’s' })
})
export type DraftRequest = z.infer<typeof draftRequestSchema>

export const draftViewSchema = z.object({
  kind: draftKindSchema,
  title: z.string(),
  reply: z.string(),
  /** The draft as the person reads it in the chat: Markdown for a page, sections for a whiteboard. */
  markdown: z.string(),
  sections: z.array(z.object({ title: z.string(), notes: z.array(z.string()) })),
  /** The content's first document, ready for `POST …/contents` as `draft`. */
  json: z.record(z.string(), z.unknown()),
  text: z.string(),
  /** Whether a model wrote it, or the offline stand-in did — said in the chat either way. */
  byModel: z.boolean()
})
export type DraftView = z.infer<typeof draftViewSchema>

/** Writes a draft from the conversation so far. A type the service owns, around whichever model. */
export type DraftWriter = {
  readonly byModel: boolean
  write: (request: DraftRequest) => Promise<ModelDraft>
}

type Mark = { type: 'bold' | 'italic' | 'code' }
type Inline = { type: 'text'; text: string; marks?: Mark[] }
type Block = Record<string, unknown>

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g

/** A marked stretch: its delimiter on both sides, and the mark it puts on the text between. */
const MARKS: readonly { open: string; mark: Mark['type'] }[] = [
  { open: '**', mark: 'bold' },
  { open: '`', mark: 'code' },
  { open: '*', mark: 'italic' }
]

const _inlinePart = (part: string): Inline => {
  const found = MARKS.find(({ open }) => part.length > 2 * open.length && part.startsWith(open) && part.endsWith(open))
  return found
    ? { type: 'text', text: part.slice(found.open.length, -found.open.length), marks: [{ type: found.mark }] }
    : { type: 'text', text: part }
}

/** Bold, italic and code inside a line of Markdown, as ProseMirror text nodes. */
export const inline = (line: string): Inline[] =>
  line
    .split(INLINE)
    .filter((part) => part.length > 0)
    .map(_inlinePart)

const paragraph = (text: string): Block => ({ type: 'paragraph', ...(text ? { content: inline(text) } : {}) })
const item = (type: 'listItem' | 'taskItem', text: string, checked?: boolean): Block => ({
  type,
  ...(type === 'taskItem' ? { attrs: { checked: Boolean(checked) } } : {}),
  content: [paragraph(text)]
})

type Rule = { test: RegExp; block: (match: RegExpExecArray) => Block; list?: 'bulletList' | 'orderedList' | 'taskList' }

/** One line of Markdown → one block; consecutive list items are gathered into one list after. */
const RULES: readonly Rule[] = [
  {
    test: /^(#{1,3})\s+(.*)$/,
    block: (m) => ({ type: 'heading', attrs: { level: (m[1] ?? '#').length }, content: inline(m[2] ?? '') })
  },
  { test: /^[-*]\s+\[([ xX])\]\s+(.*)$/, block: (m) => item('taskItem', m[2] ?? '', m[1] !== ' '), list: 'taskList' },
  { test: /^[-*]\s+(.*)$/, block: (m) => item('listItem', m[1] ?? ''), list: 'bulletList' },
  { test: /^\d+[.)]\s+(.*)$/, block: (m) => item('listItem', m[1] ?? ''), list: 'orderedList' },
  { test: /^>\s?(.*)$/, block: (m) => ({ type: 'blockquote', content: [paragraph(m[1] ?? '')] }) },
  { test: /^(-{3,}|\*{3,})$/, block: () => ({ type: 'horizontalRule' }) }
]

const _gather = (blocks: { block: Block; list?: string | undefined }[]): Block[] => {
  const out: Block[] = []
  for (const { block, list } of blocks) {
    const last = out.at(-1) as { type?: string; content?: Block[] } | undefined
    if (list && last?.type === list) {
      last.content?.push(block)
    } else {
      out.push(list ? { type: list, content: [block] } : block)
    }
  }
  return out
}

/**
 * The Markdown a model wrote, as the page editor's document: headings, lists, task lists, quotes,
 * rules, code blocks and paragraphs, with bold, italic and inline code.
 *
 * @example markdownToDoc('# Spec\n- [ ] Validar')   // { type: 'doc', content: [heading, taskList] }
 */
export const markdownToDoc = (markdown: string): { type: 'doc'; content: Block[] } => {
  const parsed: { block: Block; list?: string | undefined }[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim()
    if (line.startsWith('```')) {
      const fence = _codeBlock(lines, index)
      parsed.push({ block: fence.block })
      index = fence.end
    } else if (line) {
      parsed.push(_line(line))
    }
  }
  return { type: 'doc', content: _gather(parsed) }
}

/** A fenced code block from the line that opens it; `end` is the line that closes it. */
const _codeBlock = (lines: readonly string[], start: number): { block: Block; end: number } => {
  const close = lines.findIndex((each, at) => at > start && each.trim().startsWith('```'))
  const end = close < 0 ? lines.length : close
  const code = lines.slice(start + 1, end).join('\n')
  return { block: { type: 'codeBlock', content: code ? [{ type: 'text', text: code }] : [] }, end }
}

const _line = (line: string): { block: Block; list?: string | undefined } => {
  for (const rule of RULES) {
    const match = rule.test.exec(line)
    if (match) {
      return { block: rule.block(match), list: rule.list }
    }
  }
  return { block: paragraph(line) }
}

/** The draft's text, for search and versions: the Markdown, or every section and note in order. */
export const draftText = (draft: ModelDraft): string =>
  draft.kind === 'page'
    ? draft.markdown
    : draft.sections.flatMap((section) => [section.title, ...section.notes]).join('\n')

/** First sentence of the prompt, as a title of reasonable length. */
const _titleOf = (prompt: string): string => {
  const first = prompt.split(/[.!?\n]/)[0]?.trim() ?? ''
  return (first.length > 60 ? `${first.slice(0, 57)}…` : first) || 'Rascunho'
}

/**
 * The stand-in when no model is configured (local, or before the Anthropic key exists — pendência #8):
 * a plain outline from the prompt, and a reply that says so. It never pretends to be the model.
 */
export class OfflineDraftWriter implements DraftWriter {
  readonly byModel = false

  async write(request: DraftRequest): Promise<ModelDraft> {
    const prompt = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.text)
      .join('\n')
    const kind: DraftKind =
      request.kind === 'auto' ? (/quadro|board|mapa|brainstorm/i.test(prompt) ? 'whiteboard' : 'page') : request.kind
    const sentences = prompt
      .split(/(?<=[.!?])\s+|\n+/)
      .map((each) => each.trim())
      .filter(Boolean)
    const reply =
      'Montei um esboço a partir do que você descreveu. A IA ainda não está configurada neste ambiente, então ele é só um ponto de partida para você editar.'
    return {
      kind,
      title: _titleOf(prompt),
      reply,
      markdown:
        kind === 'page'
          ? `# ${_titleOf(prompt)}\n\n## Contexto\n${sentences.join('\n')}\n\n## Próximos passos\n- [ ] Revisar este rascunho`
          : '',
      sections:
        kind === 'whiteboard'
          ? [
              { title: 'Ideias', notes: sentences.slice(0, 8) },
              { title: 'Próximos passos', notes: ['Revisar o quadro'] }
            ]
          : []
    }
  }
}

/** Where no key is configured and no stand-in was handed in: the route says so, with a 503. */
export class UnavailableDraftWriter implements DraftWriter {
  readonly byModel = false

  async write(): Promise<ModelDraft> {
    throw new DependencyUnavailableException('Anthropic', 'ANTHROPIC_API_KEY is not configured')
  }
}
