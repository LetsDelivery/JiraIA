import { Editor, Extension, type Range } from '@tiptap/core'
import BubbleMenu from '@tiptap/extension-bubble-menu'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Highlight from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Mention from '@tiptap/extension-mention'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { PluginKey, TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Suggestion from '@tiptap/suggestion'
import type * as Y from 'yjs'

import { type Member, read } from '@/api/requests'
import { cardKey } from '@/lib/search'

import { BoardEmbed } from './board-embed'
import { editLink } from './format-toolbar'
import { Callout, CardEmbed, CardRef, CommentMark, PageFile, PageImage } from './nodes'
import type { ContentProvider } from './provider'
import { SlashCommand, type SlashContext } from './slash'
import { type MenuItem, suggestionMenu } from './suggestion-menu'

export type PageEditorOptions = SlashContext & {
  element: HTMLElement
  bubble: HTMLElement
  contentId: string
  doc: Y.Doc
  provider: ContentProvider
  user: { name: string; color: string }
  editable: boolean
  members: readonly Member[]
}

type Person = MenuItem & { id: string }
type CardItem = MenuItem & { key: string; title: string }

/** `@` offers the organization's active members — people and agents (escopo-mvp 5.5). */
const people = (members: readonly Member[]) => ({
  char: '@',
  pluginKey: new PluginKey('peopleSuggestion'),
  items: ({ query }: { query: string }): Person[] =>
    members
      .filter(
        (member) =>
          member.status === 'active' &&
          member.kind === 'person' &&
          member.name.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 8)
      .map((member) => ({ id: member.id, label: member.name, ...(member.kind === 'agent' ? { hint: 'Agente' } : {}) })),
  render: () => suggestionMenu<Person>('Pessoas')
})

/** `#` searches cards by key or title and puts the one chosen in the sentence. */
const CardSuggestion = Extension.create({
  name: 'cardSuggestion',
  addProseMirrorPlugins() {
    return [
      Suggestion<CardItem>({
        editor: this.editor,
        pluginKey: new PluginKey('cardSuggestion'),
        char: '#',
        items: async ({ query }) => await cardItems(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: CardItem }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'cardRef', attrs: { key: props.key, title: props.title } },
              { type: 'text', text: ' ' }
            ])
            .run()
        },
        render: () => suggestionMenu<CardItem>('Cards')
      })
    ]
  }
})

const cardItems = async (query: string): Promise<CardItem[]> => {
  if (query.trim().length < 2) {
    return []
  }
  const found = await read.search(query).catch(() => undefined)
  const exact = found?.exact ? [found.exact] : []
  const others = (found?.items ?? []).map((item) => item.card).filter((card) => card.key !== cardKey(query))
  return [...exact, ...others]
    .slice(0, 8)
    .map((card) => ({ key: card.key, title: card.title, label: card.title, hint: card.key }))
}

/** ⌘K asks for a link on the selection, as the bar's button does. */
const LinkShortcut = Extension.create({
  name: 'linkShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        editLink(this.editor)
        return true
      }
    }
  }
})

/**
 * The page editor (escopo-mvp 5.2–5.7): TipTap on the page's Y.Doc, so what one person types reaches
 * the others (5.3) with their cursor and name. History (undo) is Yjs's, per person.
 */
export const createPageEditor = (options: PageEditorOptions): Editor =>
  new Editor({
    element: options.element,
    editable: options.editable,
    extensions: [
      StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: 'Escreva, ou digite / para inserir um bloco' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      LinkShortcut,
      TableKit.configure({ table: { resizable: false } }),
      Callout,
      CardRef,
      CardEmbed,
      BoardEmbed,
      PageImage.configure({ contentId: options.contentId }),
      PageFile.configure({ contentId: options.contentId }),
      CommentMark,
      Mention.configure({ HTMLAttributes: { class: 'mention' }, suggestions: [people(options.members)] }),
      CardSuggestion,
      SlashCommand.configure({
        insertFile: options.insertFile,
        insertCard: options.insertCard,
        insertBoard: options.insertBoard
      }),
      BubbleMenu.configure({
        element: options.bubble,
        shouldShow: ({ editor, state }) =>
          editor.isEditable && state.selection instanceof TextSelection && !state.selection.empty
      }),
      Collaboration.configure({ document: options.doc, field: 'default' }),
      CollaborationCaret.configure({ provider: options.provider, user: options.user })
    ]
  })
