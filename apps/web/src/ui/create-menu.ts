import { type ContentKind, drawWrite } from '@/api/draw'
import { wikiWrite } from '@/api/wiki'
import { contentPath } from '@/lib/draw'
import { html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { type Area, wikiPagePath } from '@/lib/wiki'
import { openFormDialog, textField } from './dialog'
import { openDrawAi } from './draw-ai'
import { closeFloatingMenu, toggleFloatingMenu } from './floating-menu'
import { icon } from './icons'
import { toast } from './toast'

/** Where new content goes: a space, and the folder or page it goes under, if any. */
export type CreateTarget = {
  spaceId: string
  parentId?: string | undefined
  area?: Area | undefined
  /** A wiki collection of customers starts each page from the customer's outline (ADR-0033). */
  outline?: 'customer' | null | undefined
}

const OPTIONS = [
  { choice: 'ai', label: 'Criar com Laís', hint: 'Descreva e a Laís monta o rascunho', glyph: 'sparkles' },
  { choice: 'page', label: 'Página em branco', hint: 'Um documento para escrever junto', glyph: 'fileText' },
  { choice: 'blank', label: 'Página em branco', hint: 'Sem a ficha de cliente', glyph: 'fileText' },
  { choice: 'whiteboard', label: 'Quadro branco', hint: 'Notas, formas e setas', glyph: 'chalkboard' },
  { choice: 'folder', label: 'Pasta', hint: 'Para organizar o conteúdo', glyph: 'folder' }
] as const

type Choice = (typeof OPTIONS)[number]['choice']

/**
 * Creates in the target's product: a wiki page through the wiki, which starts it from its collection's
 * outline (ADR-0033); anything else through Draw.
 */
const save = (target: CreateTarget, kind: ContentKind, title: string, blank = false) => {
  const body = { kind, title, ...(target.parentId ? { parentId: target.parentId } : {}) }
  return target.area === 'wiki'
    ? wikiWrite.createPage(target.spaceId, { ...body, blank })
    : drawWrite.create(target.spaceId, body)
}

/** A blank page or board is created at once and opened; a folder asks for its name first. */
const create = async (target: CreateTarget, kind: ContentKind, title: string, blank = false) => {
  const created = await save(target, kind, title, blank)
  navigate(target.area === 'wiki' ? wikiPagePath(target.spaceId, created.id) : contentPath(target.spaceId, created.id))
}

const CHOICES: Record<Choice, (target: CreateTarget) => void> = {
  ai: (target) => openDrawAi(target),
  page: (target) =>
    void create(target, 'page', 'Sem título').catch((refusal: unknown) => toast(refusalSentence(refusal), 'error')),
  blank: (target) =>
    void create(target, 'page', 'Sem título', true).catch((refusal: unknown) =>
      toast(refusalSentence(refusal), 'error')
    ),
  whiteboard: (target) =>
    void create(target, 'whiteboard', 'Quadro sem título').catch((refusal: unknown) =>
      toast(refusalSentence(refusal), 'error')
    ),
  folder: (target) =>
    openFormDialog({
      title: 'Nova pasta',
      submit: 'Criar pasta',
      done: 'Pasta criada.',
      fields: textField({
        name: 'title',
        label: 'Nome',
        required: true,
        maxLength: 255,
        placeholder: 'Ex.: 01. Processos'
      }),
      onSubmit: async (data) => {
        await save(target, 'folder', String(data.get('title')).trim())
      }
    })
}

/** The wiki holds written knowledge: pages and folders; whiteboards and Laís' drafts stay in Draw for now. */
const WIKI_CHOICES: ReadonlySet<Choice> = new Set(['page', 'blank', 'folder'])

const CUSTOMER_PAGE = { label: 'Ficha de cliente', hint: 'Resumo, operação, combinados, contatos e links' }

/** What each option says: in a customer collection, a page is the customer's sheet, or a blank one. */
const optionsFor = (target: CreateTarget) => {
  const customer = target.area === 'wiki' && target.outline === 'customer'
  return OPTIONS.filter((option) => target.area !== 'wiki' || WIKI_CHOICES.has(option.choice))
    .filter((option) => option.choice !== 'blank' || customer)
    .map((option) => (customer && option.choice === 'page' ? { ...option, ...CUSTOMER_PAGE } : option))
}

const contentFor = (target: CreateTarget) =>
  html`${optionsFor(target).map(
    (
      option
    ) => html`<button type="button" role="menuitem" class="create-option ${option.choice === 'ai' ? 'is-primary' : ''}" data-create="${option.choice}">
    <span class="create-option-icon" aria-hidden="true">${icon(option.glyph, 18)}</span>
    <span class="create-option-text"><strong>${option.label}</strong><small>${option.hint}</small></span></button>`
  )}`

/** The "+" menu (ADR-0011): a folder, a blank page, a whiteboard — or, first, something made from a prompt. */
export const openCreateMenu = (anchor: HTMLElement, target: CreateTarget): void =>
  toggleFloatingMenu({
    anchor,
    label: 'Criar',
    className: 'create-menu',
    content: contentFor(target),
    onClick: (clicked) => {
      const choice = clicked.closest<HTMLElement>('[data-create]')?.dataset.create as Choice | undefined
      if (choice) {
        closeFloatingMenu()
        CHOICES[choice](target)
      }
      return choice === undefined
    }
  })
