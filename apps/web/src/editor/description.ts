import { Editor } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'

import { formatToolbar } from './format-toolbar'

export type DescriptionEditorOptions = {
  element: HTMLElement
  markdown: string
  editable: boolean
  /** The id of the element that names the description, for assistive tech. */
  labelledBy: string
}

/**
 * A card's description as rich text kept as Markdown (escopo-mvp 2.5): headings, marks, links, lists,
 * task lists, quotes, code and tables — what Markdown can carry, so what is saved reads the same in the
 * API, the MCP tools and an e-mail. Pasted HTML (a document, a spec) arrives with its structure.
 * No underline or colour: Markdown has none, and they would be lost on saving.
 */
export const createDescriptionEditor = (options: DescriptionEditorOptions): Editor =>
  new Editor({
    element: options.element,
    editable: options.editable,
    content: options.markdown,
    contentType: 'markdown',
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': options.labelledBy }
    },
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: 'Adicione contexto, problema, escopo, critérios de aceite…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Markdown
    ]
  })

/** The description as Markdown; an empty editor is an empty description. */
export const descriptionMarkdown = (editor: Editor): string => (editor.isEmpty ? '' : editor.getMarkdown().trim())

/** The bar over the description: the page's tools that Markdown can keep. */
export const descriptionToolbar = (editor: Editor): HTMLElement => formatToolbar(editor, 'markdown')
