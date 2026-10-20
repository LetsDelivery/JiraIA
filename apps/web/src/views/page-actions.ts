import type { Editor } from '@tiptap/core'

import { drawWrite } from '@/api/draw'
import { read, write } from '@/api/requests'
import { html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { openFormDialog, textField } from '@/ui/dialog'
import { icon } from '@/ui/icons'
import { selectField } from '@/ui/select'
import { toast } from '@/ui/toast'

/**
 * What the page editor asks of the screen around it: a file chosen and uploaded, a card picked to
 * embed, a card created from the selected text (escopo-mvp 5.2, 5.5, 5.6).
 */
export const insertFile = (contentId: string, editor: Editor, kind: 'image' | 'file'): void => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = kind === 'image' ? 'image/*' : ''
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (!file) {
      return
    }
    toast(`Enviando ${file.name}…`)
    drawWrite
      .uploadFile(contentId, file)
      .then((stored) => {
        const type = kind === 'image' ? 'pageImage' : 'pageFile'
        editor
          .chain()
          .focus()
          .insertContent({ type, attrs: { fileId: stored.id, name: stored.name, size: stored.size } })
          .run()
      })
      .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  })
  input.click()
}

export const insertCard = (editor: Editor): void => {
  openFormDialog({
    title: 'Embutir card',
    submit: 'Embutir',
    done: 'Card embutido.',
    fields: textField({ name: 'key', label: 'Chave do card', required: true, placeholder: 'PRD-219' }),
    onSubmit: async (data) => {
      const card = await read.cardByKey(String(data.get('key')).trim())
      editor
        .chain()
        .focus()
        .insertContent({ type: 'cardEmbed', attrs: { key: card.key, title: card.title } })
        .run()
    }
  })
}

/** The selected text becomes a card's title; in the page it is replaced by that card (5.6). */
const createCardFromSelection = async (editor: Editor): Promise<void> => {
  const { from, to } = editor.state.selection
  const text = editor.state.doc.textBetween(from, to, ' ').trim().slice(0, 255)
  const spaces = (await read.spaces()).items
  openFormDialog({
    title: 'Criar card a partir do trecho',
    submit: 'Criar card',
    done: 'Card criado.',
    fields: html`
      ${textField({ name: 'title', label: 'Título', required: true, maxLength: 255, value: text })}
      ${selectField({ name: 'spaceId', label: 'Espaço do JiraIA', options: spaces.map((space) => ({ value: space.id, label: `${space.key} · ${space.name}` })), value: spaces[0]?.id ?? '' })}
    `,
    onSubmit: async (data) => {
      const card = await write.createCard(String(data.get('spaceId')), {
        title: String(data.get('title')).trim()
      })
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, { type: 'cardRef', attrs: { key: card.key, title: card.title } })
        .run()
    }
  })
}

type BubbleAction = (editor: Editor) => void

/**
 * The menu over selected text: bold, italic, highlight, comment on the stretch, make it a card. The
 * element is the editor's for as long as the page is open; the menu extension shows and moves it.
 */
export const bubbleMenu = (comment: (editor: Editor) => void): HTMLElement => {
  const menu = document.createElement('div')
  menu.className = 'bubble-menu glass'
  menu.setAttribute('role', 'toolbar')
  menu.setAttribute('aria-label', 'Formatar o trecho')
  menu.innerHTML = html`
    <button type="button" class="button button-ghost button-icon" data-bubble="bold" aria-label="Negrito" title="Negrito"><strong>B</strong></button>
    <button type="button" class="button button-ghost button-icon" data-bubble="italic" aria-label="Itálico" title="Itálico"><em>I</em></button>
    <button type="button" class="button button-ghost button-icon" data-bubble="highlight" aria-label="Realçar" title="Realçar">${icon('pencil', 16)}</button>
    <button type="button" class="button button-ghost button-small" data-bubble="comment">${icon('message', 16)}Comentar</button>
    <button type="button" class="button button-ghost button-small" data-bubble="card">${icon('plus', 16)}Criar card</button>
  `.value
  const actions: Record<string, BubbleAction> = {
    bold: (editor) => editor.chain().focus().toggleBold().run(),
    italic: (editor) => editor.chain().focus().toggleItalic().run(),
    highlight: (editor) => editor.chain().focus().toggleHighlight().run(),
    comment,
    card: (editor) =>
      void createCardFromSelection(editor).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
  }
  menu.addEventListener('mousedown', (event) => event.preventDefault())
  menu.addEventListener('click', (event) => {
    const name = (event.target as HTMLElement).closest<HTMLElement>('[data-bubble]')?.dataset.bubble
    const editor = editorOf(menu)
    if (name && editor) {
      actions[name]?.(editor)
    }
  })
  return menu
}

/** The editor whose menu this is, set by the session once the editor exists. */
const editors = new WeakMap<HTMLElement, Editor>()
export const attachBubble = (menu: HTMLElement, editor: Editor): void => {
  editors.set(menu, editor)
}
const editorOf = (menu: HTMLElement): Editor | undefined => editors.get(menu)
