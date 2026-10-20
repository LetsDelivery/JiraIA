import type { Editor } from '@tiptap/core'
import type * as Y from 'yjs'

import type { Content } from '@/api/draw'
import type { Member } from '@/api/requests'

import { createPageEditor } from './editor'
import type { ContentProvider } from './provider'
import { caretColor, type Surface } from './session'
import type { SlashContext } from './slash'

export type PageSurface = Surface & { editor: Editor; bubble: HTMLElement }

export type PageSurfaceOptions = SlashContext & {
  content: Content
  me: { id: string; name: string }
  members: readonly Member[]
  bubble: HTMLElement
}

/** A page's surface: TipTap on the document, with the menu over selected text (escopo-mvp 5.2). */
export const pageSurface =
  (options: PageSurfaceOptions) =>
  (doc: Y.Doc, provider: ContentProvider): PageSurface => {
    const root = document.createElement('div')
    root.className = 'page-editor'
    const editor = createPageEditor({
      ...options,
      element: root,
      contentId: options.content.id,
      doc,
      provider,
      user: { name: options.me.name, color: caretColor(options.me.id) },
      // Editable once the document is loaded — a keystroke before that would be overwritten.
      editable: false
    })
    return {
      root,
      editor,
      bubble: options.bubble,
      derive: () => ({ json: editor.getJSON(), text: editor.getText({ blockSeparator: '\n' }) }),
      isEmpty: () => editor.isEmpty,
      seed: (json) => {
        editor.commands.setContent(json)
      },
      setEditable: (editable) => editor.setEditable(editable),
      destroy: () => {
        editor.destroy()
        options.bubble.remove()
      }
    }
  }
