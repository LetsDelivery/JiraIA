import type { Editor } from '@tiptap/core'

import type { Member } from '@/api/requests'
import { type Html, html } from '@/lib/html'

import { icon } from './icons'

/** A comment being written: its Markdown, kept across a redraw of the card. */
export type ComposerHandle = {
  /** The Markdown typed so far, `''` for an open, empty composer. */
  draft: () => string
  focused: () => boolean
  destroy: () => void
}

type Module = typeof import('@/editor/comment')

export type ComposerOptions = {
  members: readonly Member[]
  markdown: string
  placeholder: string
  submit: string
  focus: boolean
  /** Sends files to the card and answers the names they were stored under. */
  attach: (files: File[]) => string[]
  /** What the editor shows for a file the comment cites. */
  look: (name: string) => HTMLElement
  /** The comment to send, with its text for a guess drawn before the API answers. */
  save: (markdown: string, text: string) => void
  cancel: () => void
}

const markup = (submit: string): Html => html`
  <div class="description-box comment-editor-box">
    <div class="description-toolbar" data-composer-toolbar></div>
    <div class="page-editor comment-editor" data-composer-editor></div>
  </div>
  <div class="comment-actions">
    <button type="button" class="button button-primary button-small" data-composer-save>${submit}</button>
    <button type="button" class="button button-ghost button-small" data-composer-cancel>Cancelar</button>
    <label class="button button-ghost button-small comment-attach">${icon('paperclip', 16)}Anexar
      <input type="file" class="sr-only" data-composer-files multiple aria-label="Anexar arquivo ao comentário" /></label>
  </div>
`

/**
 * The description's editor and bar, put where a comment is written (escopo-mvp 2.8): they only come
 * once a person starts a comment. A file pasted, dropped on it or chosen with Anexar goes to the card
 * and shows in the comment. The editor is loaded on first use, as the description's is.
 */
export const mountComposer = (host: HTMLElement, options: ComposerOptions): ComposerHandle => {
  host.innerHTML = markup(options.submit).value
  let editor: Editor | undefined
  let loaded: Module | undefined
  let gone = false
  void import('@/editor/comment').then((module) => {
    if (gone) {
      return
    }
    loaded = module
    editor = module.createCommentEditor({
      element: host.querySelector('[data-composer-editor]') as HTMLElement,
      markdown: options.markdown,
      members: options.members,
      placeholder: options.placeholder,
      attach: options.attach,
      look: options.look
    })
    _wire(host, editor, module, options)
  })
  return {
    draft: () => (editor && loaded ? loaded.commentMarkdown(editor) : options.markdown),
    focused: () => editor?.isFocused ?? options.focus,
    destroy: () => {
      gone = true
      editor?.destroy()
    }
  }
}

const _wire = (host: HTMLElement, editor: Editor, module: Module, options: ComposerOptions): void => {
  host.querySelector('[data-composer-toolbar]')?.append(module.commentToolbar(editor))
  const save = () => {
    const markdown = module.commentMarkdown(editor)
    if (markdown) {
      options.save(markdown, editor.getText({ blockSeparator: '\n' }).trim())
    }
  }
  // A click on Salvar or Cancelar must not take the focus first: the click would land on a moved button.
  host.querySelector('.comment-actions')?.addEventListener('mousedown', (event) => event.preventDefault())
  host.querySelector('[data-composer-save]')?.addEventListener('click', save)
  host.querySelector('[data-composer-cancel]')?.addEventListener('click', options.cancel)
  host.querySelector<HTMLInputElement>('[data-composer-files]')?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement
    module.insertFiles(editor, [...(input.files ?? [])], options.attach)
    input.value = ''
  })
  editor.view.dom.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    }
  })
  if (options.focus) {
    editor.commands.focus('end')
  }
}
