import { Editor, type MarkdownToken } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Mention from '@tiptap/extension-mention'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder, TrailingNode } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'

import type { Member } from '@/api/requests'

import { FileCitation } from './file-citation'
import { formatToolbar } from './format-toolbar'
import { people } from './people'

const MENTION = /^<@([0-9a-f-]{36})>/

/**
 * A mention kept as the API keeps it, `<@memberId>` — what notifications, e-mails and the MCP read —
 * and drawn as `@Name`.
 */
const mention = (members: readonly Member[]) => {
  const names = new Map(members.map((member) => [member.id, member.name]))
  return Mention.extend({
    renderMarkdown: (node) => `<@${String(node.attrs?.id ?? '')}>`,
    markdownTokenizer: {
      name: 'mention',
      level: 'inline',
      start: (src: string) => src.indexOf('<@'),
      tokenize: (src: string): MarkdownToken | undefined => {
        const found = MENTION.exec(src)
        return found ? { type: 'mention', raw: found[0], attributes: { id: found[1] } } : undefined
      }
    },
    parseMarkdown: (token, helpers) => helpers.createNode('mention', { id: token.attributes?.id })
  }).configure({
    renderHTML: ({ node }) => [
      'span',
      { class: 'mention', 'data-type': 'mention', 'data-id': String(node.attrs.id) },
      `@${names.get(String(node.attrs.id)) ?? node.attrs.label ?? 'alguém'}`
    ],
    renderText: ({ node }) => `@${names.get(String(node.attrs.id)) ?? 'alguém'}`,
    suggestions: [people(members)]
  })
}

/**
 * What a comment can carry: the description's Markdown (escopo-mvp 2.5) and mentions. A line break
 * typed in a comment is a line break, as it was when comments were plain text.
 */
const extensions = (members: readonly Member[], placeholder: string, look?: (name: string) => HTMLElement) => [
  StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } }),
  Placeholder.configure({ placeholder }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  Markdown.configure({ markedOptions: { breaks: true } }),
  mention(members),
  look ? FileCitation.configure({ look }) : FileCitation
]

export type CommentEditorOptions = {
  element: HTMLElement
  markdown: string
  members: readonly Member[]
  placeholder: string
  /** Sends files to the card and answers the names they were stored under, to cite in the comment. */
  attach: (files: File[]) => string[]
  /** What the editor shows for a cited file. */
  look: (name: string) => HTMLElement
}

/**
 * Files pasted, dropped or chosen go to the card and stay in the comment, each on its own line with
 * a line under it to go on writing. `at` is where a drop landed; otherwise the cursor.
 */
export const insertFiles = (editor: Editor, files: File[], attach: CommentEditorOptions['attach'], at?: number) => {
  const cited = [...attach(files).map((name) => ({ type: 'fileCitation', attrs: { name } })), { type: 'paragraph' }]
  // After the selection, never over it: a file just cited is selected as one piece.
  editor
    .chain()
    .focus()
    .insertContentAt(at ?? editor.state.selection.to, cited)
    .run()
}

const _paste = (editor: Editor, event: ClipboardEvent, attach: CommentEditorOptions['attach']): boolean => {
  const files = [...(event.clipboardData?.files ?? [])]
  files.length && insertFiles(editor, files, attach)
  return files.length > 0
}

/** A file dropped on the comment is the comment's, not only the card's (the card's drop zone steps aside). */
const _drop = (editor: Editor, event: DragEvent, attach: CommentEditorOptions['attach']): boolean => {
  const files = [...(event.dataTransfer?.files ?? [])]
  const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
  files.length && insertFiles(editor, files, attach, at)
  return files.length > 0
}

export const createCommentEditor = (options: CommentEditorOptions): Editor => {
  const editor: Editor = new Editor({
    element: options.element,
    content: options.markdown,
    contentType: 'markdown',
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Comentário' },
      handlePaste: (_view, event) => _paste(editor, event, options.attach),
      handleDrop: (_view, event, _slice, moved) => !moved && _drop(editor, event, options.attach)
    },
    // A line after the last file, so the cursor has somewhere to go on writing.
    extensions: [...extensions(options.members, options.placeholder, options.look), TrailingNode]
  })
  return editor
}

/** The comment as Markdown; an empty editor is no comment. */
export const commentMarkdown = (editor: Editor): string => (editor.isEmpty ? '' : editor.getMarkdown().trim())

/** The bar over the comment: the description's tools. */
export const commentToolbar = (editor: Editor): HTMLElement => formatToolbar(editor, 'markdown')

/** One editor off the page per member list, reused to turn each comment into markup. */
const renderers = new WeakMap<readonly Member[], Editor>()

/**
 * A saved comment as markup, through the editor's own schema: only what the editor knows survives —
 * no script, no style, no link to `javascript:` — and every text is escaped by ProseMirror.
 */
export const commentHtml = (markdown: string, members: readonly Member[]): string => {
  const renderer =
    renderers.get(members) ??
    new Editor({ element: document.createElement('div'), editable: false, extensions: extensions(members, '') })
  renderers.set(members, renderer)
  renderer.commands.setContent(markdown, { contentType: 'markdown' })
  return renderer.getHTML()
}
