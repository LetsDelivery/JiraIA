import type { Editor } from '@tiptap/core'

import { type Html, html } from '@/lib/html'

import { detailPanel } from './detail-panel'

/** The description on screen: the editor, and what was typed and not saved yet. */
export type DescriptionHandle = {
  /** The Markdown typed and not saved, which a redraw of the card must keep; nothing when there is none. */
  draft: () => string | undefined
  destroy: () => void
}

type Mount = {
  markdown: string
  /** Text typed before a redraw of the card, opened as still unsaved. */
  draft: string | undefined
  canWrite: boolean
  /** Saves the Markdown; `false` when the API refused it, so the text stays unsaved. */
  save: (markdown: string) => Promise<boolean>
}

/** The description's place on the card: for a writer, one box with the bar on top and the text under it, then Save. */
export const descriptionSection = (canWrite: boolean, empty: boolean): Html =>
  !canWrite && empty
    ? html``
    : detailPanel({
        title: html`<span id="card-description-label">Descrição</span>`,
        attributes: html`data-description-block`,
        body: html`
          ${
            canWrite
              ? html`<div class="description-box">
                  <div class="description-toolbar" data-description-toolbar></div>
                  <div class="page-editor description-editor" data-description></div>
                </div>`
              : html`<div class="page-editor description-editor" data-description></div>`
          }
          ${
            canWrite
              ? html`<div class="description-actions">
                  <button type="button" class="button button-primary button-small" data-save-description>Salvar descrição</button>
                  <button type="button" class="button button-ghost button-small" data-cancel-description>Cancelar</button>
                </div>`
              : ''
          }`
      })

/**
 * Puts the editor in the description's place. The editor is loaded on first use, so the board itself
 * does not carry it (escopo-mvp 8.1). Edited text shows Save and Cancel; ⌘Enter saves.
 */
export const mountDescription = (root: HTMLElement, mount: Mount): DescriptionHandle => {
  const block = root.querySelector<HTMLElement>('[data-description-block]')
  const host = block?.querySelector<HTMLElement>('[data-description]')
  let editor: Editor | undefined
  let loaded: Module | undefined
  let dirty = mount.draft !== undefined
  let gone = false
  if (host && block) {
    void import('@/editor/description').then((module) => {
      if (gone) {
        return
      }
      loaded = module
      editor = module.createDescriptionEditor({
        element: host,
        markdown: mount.draft ?? mount.markdown,
        editable: mount.canWrite,
        labelledBy: 'card-description-label'
      })
      _wire(block, editor, module, mount, {
        dirty: () => dirty,
        mark: (on) => {
          dirty = on
          block.classList.toggle('is-dirty', on)
        }
      })
    })
  }
  return {
    // Until the editor has loaded, a draft carried from the last redraw is still the draft.
    draft: () => {
      if (!editor || !loaded) {
        return mount.draft
      }
      return dirty ? loaded.descriptionMarkdown(editor) : undefined
    },
    destroy: () => {
      gone = true
      editor?.destroy()
    }
  }
}

type Module = typeof import('@/editor/description')
type Dirty = { dirty: () => boolean; mark: (on: boolean) => void }

const _wire = (block: HTMLElement, editor: Editor, module: Module, mount: Mount, state: Dirty): void => {
  state.mark(state.dirty())
  if (!mount.canWrite) {
    return
  }
  block.querySelector('[data-description-toolbar]')?.append(module.descriptionToolbar(editor))
  editor.on('update', () => state.mark(true))
  const save = () => {
    state.mark(false)
    editor.commands.blur()
    void mount.save(module.descriptionMarkdown(editor)).then((saved) => state.mark(!saved))
  }
  // A click on Save or Cancel leaves the focus in the text, so the buttons go the moment it leaves.
  block.querySelector('.description-actions')?.addEventListener('mousedown', (event) => event.preventDefault())
  block.querySelector('[data-save-description]')?.addEventListener('click', save)
  block.querySelector('[data-cancel-description]')?.addEventListener('click', () => {
    editor.commands.setContent(mount.markdown, { contentType: 'markdown' })
    state.mark(false)
    editor.commands.blur()
  })
  _bindEditor(editor, save)
}

/** ⌘Enter saves; a click on the blank area under the text puts the cursor at its end. */
const _bindEditor = (editor: Editor, save: () => void): void => {
  // That click lands on the editor's own box, which the browser does not always focus.
  editor.view.dom.addEventListener('mousedown', (event) => {
    if (event.target === editor.view.dom && !editor.isFocused) {
      event.preventDefault()
      editor.commands.focus('end')
    }
  })
  editor.view.dom.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    }
  })
}
