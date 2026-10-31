import { type MarkdownToken, Node } from '@tiptap/core'

/** `📎 name` alone on its line; Markdown's backslashes undone, as an imported comment escapes `_`. */
const CITATION = /^📎 ([^\n]+?)[ \t]*(?:\n|$)/

export type FileCitationOptions = {
  /** What the editor shows for the file: its picture once the card has it, its name while it goes up. */
  look: (name: string) => HTMLElement
}

/**
 * A file the comment shows on its own line — pasted, dropped or chosen with Anexar — kept in the
 * Markdown as `📎 name`, the way an imported comment cites Jira's pictures. The file itself is the
 * card's attachment of that name (ui/comment-files.ts).
 */
export const FileCitation = Node.create<FileCitationOptions>({
  name: 'fileCitation',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions: () => ({
    look: (name) => Object.assign(document.createElement('span'), { textContent: `📎 ${name}` })
  }),

  addAttributes: () => ({ name: { default: '' } }),

  parseHTML: () => [{ tag: 'div[data-file-citation]', getAttrs: (dom) => ({ name: dom.dataset.fileCitation ?? '' }) }],

  renderText: ({ node }) => `📎 ${node.attrs.name}`,

  renderHTML: ({ node }) => ['div', { 'data-file-citation': String(node.attrs.name) }, `📎 ${node.attrs.name}`],

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'file-citation'
      dom.contentEditable = 'false'
      dom.append(this.options.look(String(node.attrs.name)))
      return { dom }
    }
  },

  renderMarkdown: (node) => `📎 ${String(node.attrs?.name ?? '')}`,

  markdownTokenizer: {
    name: 'fileCitation',
    level: 'block',
    // Only at the start of a line: a citation inside a sentence stays text (and is linked on screen).
    start: (src: string) => (src.startsWith('📎 ') ? 0 : src.indexOf('\n📎 ') + 1 || -1),
    tokenize: (src: string): MarkdownToken | undefined => {
      const found = CITATION.exec(src)
      const name = found?.[1]?.replace(/\\(.)/g, '$1')
      return found && name ? { type: 'fileCitation', raw: found[0], attributes: { name } } : undefined
    }
  },

  parseMarkdown: (token, helpers) => helpers.createNode('fileCitation', { name: token.attributes?.name })
})
