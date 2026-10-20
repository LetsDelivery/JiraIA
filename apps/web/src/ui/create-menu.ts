import { type ContentKind, drawWrite } from '@/api/draw'
import { contentPath } from '@/lib/draw'
import { html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { openFormDialog, textField } from './dialog'
import { openDrawAi } from './draw-ai'
import { closeFloatingMenu, toggleFloatingMenu } from './floating-menu'
import { icon } from './icons'
import { toast } from './toast'

/** Where new content goes: a space, and the folder or page it goes under, if any. */
export type CreateTarget = { spaceId: string; parentId?: string | undefined }

const OPTIONS = [
  { choice: 'ai', label: 'Criar com IA', hint: 'Descreva e a IA monta o rascunho', glyph: 'sparkles' },
  { choice: 'page', label: 'Página em branco', hint: 'Um documento para escrever junto', glyph: 'fileText' },
  { choice: 'whiteboard', label: 'Quadro branco', hint: 'Notas, formas e setas', glyph: 'chalkboard' },
  { choice: 'folder', label: 'Pasta', hint: 'Para organizar o conteúdo', glyph: 'folder' }
] as const

type Choice = (typeof OPTIONS)[number]['choice']

/** A blank page or board is created at once and opened; a folder asks for its name first. */
const create = async (target: CreateTarget, kind: ContentKind, title: string) => {
  const created = await drawWrite.create(target.spaceId, {
    kind,
    title,
    ...(target.parentId ? { parentId: target.parentId } : {})
  })
  navigate(contentPath(target.spaceId, created.id))
}

const CHOICES: Record<Choice, (target: CreateTarget) => void> = {
  ai: (target) => openDrawAi(target),
  page: (target) =>
    void create(target, 'page', 'Sem título').catch((refusal: unknown) => toast(refusalSentence(refusal), 'error')),
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
        await drawWrite.create(target.spaceId, {
          kind: 'folder',
          title: String(data.get('title')).trim(),
          ...(target.parentId ? { parentId: target.parentId } : {})
        })
      }
    })
}

const content = html`${OPTIONS.map(
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
    content,
    onClick: (clicked) => {
      const choice = clicked.closest<HTMLElement>('[data-create]')?.dataset.create as Choice | undefined
      if (choice) {
        closeFloatingMenu()
        CHOICES[choice](target)
      }
      return choice === undefined
    }
  })
